import {
  CAPTURE_MAX_TEXT,
  CAPTURE_MAX_VOICE_BYTES,
  CAPTURE_MAX_VOICE_SECONDS,
} from "@lifeos/core";
import type { AiRoutingAccounting } from "@lifeos/core";
import {
  AiGovernorError,
  type AiGovernor,
  type AiRunOptions,
} from "../ai-governor.js";

export type VoiceCaptureErrorCode =
  | "voice_unsupported"
  | "voice_too_large"
  | "voice_reference_expired"
  | "voice_download_origin_rejected"
  | "voice_download_failed"
  | "voice_download_timeout"
  | "voice_cancelled"
  | "voice_transcription_unavailable"
  | "voice_consent_required"
  | "voice_transcription_failed"
  | "voice_quota_exceeded";
export class VoiceCaptureError extends Error {
  constructor(readonly code: VoiceCaptureErrorCode) {
    super(code);
    this.name = "VoiceCaptureError";
  }
}
/** Server-only Telegram reference. Never returned through capture API projections. */
export interface CaptureVoiceReference {
  fileId: string;
  fileUniqueId: string;
  durationSeconds: number;
  mimeType: string | null;
  fileSize: number | null;
  referenceExpiresAt: string;
}
export interface TelegramVoiceAudio {
  bytes: Uint8Array;
  mimeType: "audio/ogg";
}
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const fileId = (value: unknown): value is string =>
  typeof value === "string" && /^[\x21-\x7e]{1,1024}$/.test(value);
const oggMime = (value: unknown): value is string =>
  typeof value === "string" &&
  /^audio\/(?:ogg|opus)(?:\s*;\s*codecs=(?:opus|"opus"))?$/i.test(value);
// Reserve the accepted five-minute Telegram clock skew while retaining a
// deterministic expiry across retries and never exceeding 24h after receipt.
const VOICE_REFERENCE_TTL_MS = 86_400_000 - 300_000;

export function validateTelegramVoice(
  value: unknown,
  sentAt: unknown,
  now = new Date(),
): CaptureVoiceReference {
  if (!Number.isFinite(now.getTime()))
    throw new VoiceCaptureError("voice_unsupported");
  if (!record(value) || !fileId(value.file_id) || !fileId(value.file_unique_id))
    throw new VoiceCaptureError("voice_unsupported");
  if (!Number.isSafeInteger(value.duration) || Number(value.duration) < 1)
    throw new VoiceCaptureError("voice_unsupported");
  if (Number(value.duration) > CAPTURE_MAX_VOICE_SECONDS)
    throw new VoiceCaptureError("voice_too_large");
  if (value.mime_type !== undefined && !oggMime(value.mime_type))
    throw new VoiceCaptureError("voice_unsupported");
  if (
    value.file_size !== undefined &&
    (!Number.isSafeInteger(value.file_size) || Number(value.file_size) < 1)
  )
    throw new VoiceCaptureError("voice_unsupported");
  if (
    value.file_size !== undefined &&
    Number(value.file_size) > CAPTURE_MAX_VOICE_BYTES
  )
    throw new VoiceCaptureError("voice_too_large");
  if (
    !Number.isSafeInteger(sentAt) ||
    Number(sentAt) < 1 ||
    Number(sentAt) * 1000 > now.getTime() + 300_000
  )
    throw new VoiceCaptureError("voice_unsupported");
  const expires = new Date(Number(sentAt) * 1000 + VOICE_REFERENCE_TTL_MS);
  if (!Number.isFinite(expires.getTime()))
    throw new VoiceCaptureError("voice_unsupported");
  return {
    fileId: value.file_id,
    fileUniqueId: value.file_unique_id,
    durationSeconds: Number(value.duration),
    mimeType:
      typeof value.mime_type === "string"
        ? value.mime_type.toLowerCase()
        : null,
    fileSize: value.file_size === undefined ? null : Number(value.file_size),
    referenceExpiresAt: expires.toISOString(),
  };
}

/** This release has no configured, priced, governed production audio adapter. */
export function captureSpeechCapability() {
  return {
    available: false as const,
    reason: "voice_transcription_unavailable" as const,
    manualTranscript: true as const,
  };
}

function cancelled(signal: AbortSignal): never {
  throw new VoiceCaptureError(
    signal.reason instanceof VoiceCaptureError &&
      signal.reason.code === "voice_download_timeout"
      ? "voice_download_timeout"
      : "voice_cancelled",
  );
}
function check(signal: AbortSignal) {
  if (signal.aborted) cancelled(signal);
}
function bounded<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const stop = () => {
      try {
        cancelled(signal);
      } catch (error) {
        reject(error);
      }
    };
    work
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", stop));
    if (signal.aborted) {
      stop();
      return;
    }
    signal.addEventListener("abort", stop, { once: true });
  });
}
function safeDownloadUrl(value: string): string {
  try {
    if (
      value.length > 8192 ||
      /[^\x21-\x7e]/.test(value) ||
      value.includes("\\") ||
      /(?:^|\/)(?:\.|%2e){1,2}(?:\/|$)/i.test(value)
    )
      throw new Error();
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "api.telegram.org" ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/^\/file\/bot[A-Za-z0-9:_-]{1,4096}\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+$/.test(
        url.pathname,
      ) ||
      url.pathname.includes("%")
    )
      throw new Error();
    return url.href;
  } catch {
    throw new VoiceCaptureError("voice_download_origin_rejected");
  }
}

/** Narrow Ogg/Opus profile; bytes are never decoded, executed, logged or persisted. */
export function validateOggOpus(bytes: Uint8Array): void {
  if (
    bytes.byteLength < 47 ||
    bytes.byteLength > CAPTURE_MAX_VOICE_BYTES ||
    Buffer.from(bytes.subarray(0, 4)).toString("ascii") !== "OggS" ||
    bytes[4] !== 0 ||
    !(bytes[5] & 2)
  )
    throw new VoiceCaptureError("voice_unsupported");
  const segments = bytes[26];
  const packet = 27 + segments;
  if (
    !segments ||
    packet + 19 > bytes.byteLength ||
    bytes[27] < 19 ||
    Buffer.from(bytes.subarray(packet, packet + 8)).toString("ascii") !==
      "OpusHead" ||
    bytes[packet + 8] !== 1 ||
    ![1, 2].includes(bytes[packet + 9])
  )
    throw new VoiceCaptureError("voice_unsupported");
  let payloadBytes = 0;
  for (let index = 27; index < packet; index++) payloadBytes += bytes[index];
  if (packet + payloadBytes > bytes.byteLength)
    throw new VoiceCaptureError("voice_unsupported");
}

/** Strict single-stream profile for paid dispatch; metadata/granules alone cannot prove duration. */
export function validateBoundedOggOpus(bytes: Uint8Array): number {
  validateOggOpus(bytes);
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const reject = (): never => {
    throw new VoiceCaptureError("voice_unsupported");
  };
  let position = 0,
    sequence = 0,
    serial: number | undefined;
  let pending: number[] = [],
    packets = 0,
    samples = 0,
    preSkip = 0;
  let ended = false,
    previousGranule = 0n;
  while (position < bytes.length) {
    if (
      ended ||
      position + 27 > bytes.length ||
      view.toString("ascii", position, position + 4) !== "OggS" ||
      bytes[position + 4] !== 0
    )
      reject();
    const flags = bytes[position + 5],
      segments = bytes[position + 26];
    if (
      flags > 7 ||
      !segments ||
      Boolean(flags & 1) !== Boolean(pending.length) ||
      Boolean(flags & 2) !== (sequence === 0)
    )
      reject();
    const endHeader = position + 27 + segments;
    if (endHeader > bytes.length) reject();
    let endPage = endHeader;
    for (let n = position + 27; n < endHeader; n++) endPage += bytes[n];
    if (endPage > bytes.length) reject();
    const pageSerial = view.readUInt32LE(position + 14);
    if (serial === undefined) serial = pageSerial;
    if (
      pageSerial !== serial ||
      view.readUInt32LE(position + 18) !== sequence++
    )
      reject();
    // Ogg's CRC excludes the four checksum bytes. A corrupt page never reaches a provider.
    let crc = 0;
    for (let n = position; n < endPage; n++) {
      crc =
        (crc ^
          ((n >= position + 22 && n < position + 26 ? 0 : bytes[n]) << 24)) >>>
        0;
      for (let bit = 0; bit < 8; bit++)
        crc = ((crc << 1) ^ (crc & 0x80000000 ? 0x04c11db7 : 0)) >>> 0;
    }
    if (crc !== view.readUInt32LE(position + 22)) reject();
    let payload = endHeader;
    for (let n = position + 27; n < endHeader; n++) {
      const length = bytes[n];
      if (pending.length + length > 65_536) reject();
      for (let k = 0; k < length; k++) pending.push(bytes[payload++]);
      if (length === 255) continue;
      if (packets === 0) {
        if (
          pending.length !== 19 ||
          Buffer.from(pending.slice(0, 8)).toString("ascii") !== "OpusHead" ||
          pending[8] !== 1 ||
          ![1, 2].includes(pending[9]) ||
          pending[18] !== 0 ||
          n !== endHeader - 1 ||
          sequence !== 1
        )
          reject();
        preSkip = pending[10] | (pending[11] << 8);
      } else if (packets === 1) {
        const tag = Buffer.from(pending);
        if (tag.length < 16 || tag.toString("ascii", 0, 8) !== "OpusTags")
          reject();
        let cursor = 12 + tag.readUInt32LE(8);
        if (cursor + 4 > tag.length) reject();
        const count = tag.readUInt32LE(cursor);
        cursor += 4;
        if (count > tag.length / 4) reject();
        for (let k = 0; k < count; k++) {
          if (cursor + 4 > tag.length) reject();
          const size = tag.readUInt32LE(cursor);
          cursor += 4 + size;
          if (cursor > tag.length) reject();
        }
      } else {
        if (!pending.length || pending.length > 61_440) reject();
        const config = pending[0] >> 3,
          code = pending[0] & 3;
        const frameSamples =
          config < 12
            ? [480, 960, 1920, 2880][config & 3]
            : config < 16
              ? [480, 960][config & 1]
              : [120, 240, 480, 960][config & 3];
        const frames = code === 0 ? 1 : code === 3 ? (pending[1] ?? 0) & 63 : 2;
        const packetSamples = frameSamples * frames;
        if (
          !frames ||
          packetSamples > 5760 ||
          (code === 3 && pending.length < 2)
        )
          reject();
        samples += packetSamples;
        if (samples > CAPTURE_MAX_VOICE_SECONDS * 48_000)
          throw new VoiceCaptureError("voice_too_large");
      }
      packets++;
      pending = [];
    }
    const granule = view.readBigUInt64LE(position + 6);
    if (granule !== 0xffffffffffffffffn) {
      if (granule < previousGranule || granule > BigInt(samples)) reject();
      previousGranule = granule;
    }
    ended = Boolean(flags & 4);
    if (
      ended &&
      (pending.length ||
        granule === 0xffffffffffffffffn ||
        granule < BigInt(preSkip))
    )
      reject();
    position = endPage;
  }
  if (!ended || pending.length || packets < 3 || !samples) reject();
  return samples / 48_000;
}

export async function downloadTelegramVoice(
  url: string,
  options: {
    signal?: AbortSignal;
    fetcher?: typeof fetch;
    timeoutMs?: number;
    maxBytes?: number;
  } = {},
): Promise<TelegramVoiceAudio> {
  const destination = safeDownloadUrl(url);
  const timeout = options.timeoutMs ?? 10_000;
  const maximum = options.maxBytes ?? CAPTURE_MAX_VOICE_BYTES;
  if (
    !Number.isSafeInteger(timeout) ||
    timeout < 1 ||
    timeout > 10_000 ||
    !Number.isSafeInteger(maximum) ||
    maximum < 47 ||
    maximum > CAPTURE_MAX_VOICE_BYTES
  )
    throw new VoiceCaptureError("voice_unsupported");
  const controller = new AbortController();
  const stop = () => controller.abort(new VoiceCaptureError("voice_cancelled"));
  if (options.signal?.aborted) stop();
  options.signal?.addEventListener("abort", stop, { once: true });
  const timer = setTimeout(
    () => controller.abort(new VoiceCaptureError("voice_download_timeout")),
    timeout,
  );
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const cancelReader = () => {
    try {
      void reader?.cancel().catch(() => {});
    } catch {
      /* no content-bearing exceptions */
    }
  };
  const work = (async () => {
    try {
      check(controller.signal);
      const response = await (options.fetcher ?? fetch)(destination, {
        signal: controller.signal,
        redirect: "error",
      });
      if (response.body) reader = response.body.getReader();
      check(controller.signal);
      const declared = response.headers.get("content-length");
      if (
        !response.ok ||
        !reader ||
        (declared !== null &&
          (!/^\d+$/.test(declared) ||
            !Number.isSafeInteger(Number(declared)) ||
            Number(declared) > maximum))
      )
        throw new VoiceCaptureError("voice_download_failed");
      const contentType = response.headers
        .get("content-type")
        ?.split(";", 1)[0]
        .trim()
        .toLowerCase();
      if (
        contentType &&
        !["application/octet-stream", "audio/ogg", "audio/opus"].includes(
          contentType,
        )
      )
        throw new VoiceCaptureError("voice_unsupported");
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        check(controller.signal);
        const next = await reader.read();
        check(controller.signal);
        if (next.done) break;
        size += next.value.byteLength;
        if (size > maximum) throw new VoiceCaptureError("voice_too_large");
        chunks.push(next.value);
      }
      const bytes = Buffer.concat(chunks, size);
      validateOggOpus(bytes);
      return { bytes, mimeType: "audio/ogg" as const };
    } catch (error) {
      if (error instanceof VoiceCaptureError) throw error;
      if (controller.signal.aborted) cancelled(controller.signal);
      throw new VoiceCaptureError("voice_download_failed");
    } finally {
      cancelReader();
    }
  })();
  try {
    return await bounded(work, controller.signal);
  } finally {
    clearTimeout(timer);
    controller.abort();
    options.signal?.removeEventListener("abort", stop);
    cancelReader();
  }
}

/** A future trusted adapter must have independently verified audio pricing. */
export interface GovernedCaptureSpeechAdapter {
  available: true;
  audioPricingVerified: true;
  reservation: Omit<
    AiRunOptions,
    "userId" | "requestId" | "taskId" | "signal"
  > & { estimatedCostMicros: number };
  transcribe(input: {
    audio: TelegramVoiceAudio;
    signal: AbortSignal;
  }): Promise<{
    text: string;
    languages?: string[];
    usage?: { total_tokens: number; completion_tokens: number };
    routing?: AiRoutingAccounting;
  }>;
}

/** Shared-governor port, deliberately not wired to an external provider in production. */
export async function transcribeCaptureVoice(
  input: {
    userId: string;
    captureId: string;
    requestId: string;
    reference: CaptureVoiceReference;
    consent: {
      confirmed: true;
      userId: string;
      captureId: string;
      expiresAt: string;
    };
    signal?: AbortSignal;
  },
  dependencies: {
    governor?: Pick<AiGovernor, "run">;
    adapter?: GovernedCaptureSpeechAdapter;
    authorize: (
      stage: "before_download" | "before_transcription",
    ) => Promise<boolean>;
    download: (
      reference: CaptureVoiceReference,
      signal: AbortSignal,
    ) => Promise<TelegramVoiceAudio>;
    now?: () => Date;
  },
): Promise<{ transcript: string; languages?: string[] }> {
  const adapter = dependencies.adapter;
  if (
    !dependencies.governor ||
    !adapter?.available ||
    adapter.audioPricingVerified !== true ||
    !Number.isSafeInteger(adapter.reservation.estimatedCostMicros) ||
    adapter.reservation.estimatedCostMicros < 0
  )
    throw new VoiceCaptureError("voice_transcription_unavailable");
  const now = (dependencies.now ?? (() => new Date()))().getTime();
  const expiry = Date.parse(input.consent?.expiresAt);
  if (
    input.consent?.confirmed !== true ||
    input.consent.userId !== input.userId ||
    input.consent.captureId !== input.captureId ||
    !Number.isFinite(expiry) ||
    expiry <= now ||
    expiry > now + 300_000 ||
    !(await dependencies.authorize("before_download"))
  )
    throw new VoiceCaptureError("voice_consent_required");
  const referenceExpiry = Date.parse(input.reference.referenceExpiresAt);
  if (!Number.isFinite(referenceExpiry) || referenceExpiry <= now)
    throw new VoiceCaptureError("voice_reference_expired");
  if (referenceExpiry > now + 86_400_000)
    throw new VoiceCaptureError("voice_unsupported");
  validateTelegramVoice(
    {
      file_id: input.reference.fileId,
      file_unique_id: input.reference.fileUniqueId,
      duration: input.reference.durationSeconds,
      ...(input.reference.mimeType === null
        ? {}
        : { mime_type: input.reference.mimeType }),
      ...(input.reference.fileSize === null
        ? {}
        : { file_size: input.reference.fileSize }),
    },
    (referenceExpiry - VOICE_REFERENCE_TTL_MS) / 1000,
    new Date(now),
  );
  let safeFailure: VoiceCaptureError | undefined;
  try {
    const result = await dependencies.governor.run(
      {
        ...adapter.reservation,
        userId: input.userId,
        taskId: input.captureId,
        requestId: input.requestId,
        signal: input.signal,
      },
      async (signal) => {
        let audio: TelegramVoiceAudio | undefined;
        const clearAudio = () => audio?.bytes.fill(0);
        signal.addEventListener("abort", clearAudio, { once: true });
        try {
          if (!(await dependencies.authorize("before_download")))
            throw new VoiceCaptureError("voice_consent_required");
          audio = await dependencies.download(input.reference, signal);
          if (signal.aborted) throw new VoiceCaptureError("voice_cancelled");
          if (
            Date.parse(input.consent.expiresAt) <=
              (dependencies.now ?? (() => new Date()))().getTime() ||
            !(await dependencies.authorize("before_transcription"))
          )
            throw new VoiceCaptureError("voice_consent_required");
          validateBoundedOggOpus(audio.bytes);
          const output = await adapter.transcribe({ audio, signal });
          if (signal.aborted) throw new VoiceCaptureError("voice_cancelled");
          if (
            !output ||
            typeof output.text !== "string" ||
            !output.text.trim() ||
            output.text.trim().length > CAPTURE_MAX_TEXT ||
            Buffer.byteLength(output.text.trim(), "utf8") >
              adapter.reservation.maxOutputTokens ||
            /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(
              output.text,
            ) ||
            (output.languages !== undefined &&
              (!Array.isArray(output.languages) ||
                output.languages.length > 8 ||
                new Set(output.languages).size !== output.languages.length ||
                output.languages.some(
                  (code) =>
                    typeof code !== "string" ||
                    !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/.test(code),
                )))
          )
            throw new VoiceCaptureError("voice_transcription_failed");
          return {
            transcript: output.text.trim(),
            ...(output.languages ? { languages: output.languages } : {}),
            ...(output.usage ? { usage: output.usage } : {}),
            ...(output.routing ? { routing: output.routing } : {}),
          };
        } catch (error) {
          if (error instanceof VoiceCaptureError) {
            safeFailure = error;
            throw error;
          }
          if (error instanceof AiGovernorError) throw error;
          safeFailure = new VoiceCaptureError("voice_transcription_failed");
          throw safeFailure;
        } finally {
          clearAudio();
          signal.removeEventListener("abort", clearAudio);
        }
      },
    );
    return {
      transcript: result.value.transcript,
      ...(result.value.languages ? { languages: result.value.languages } : {}),
    };
  } catch (error) {
    if (
      safeFailure &&
      error instanceof AiGovernorError &&
      error.code === "ai_provider_unavailable"
    )
      throw safeFailure;
    throw error;
  }
}
