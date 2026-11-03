import {
  CAPTURE_MAX_TEXT,
  CAPTURE_MAX_VOICE_SECONDS,
  type AiRoutingAccounting,
} from "@lifeos/core";
import { AiGovernorError } from "./ai-governor.js";
import {
  validateBoundedOggOpus,
  VoiceCaptureError,
  type TelegramVoiceAudio,
} from "./telegram/voice.js";

// Reviewed 2026-11-04: native file transcription, distinct from ChatGPT plan access.
// https://developers.openai.com/api/docs/guides/speech-to-text
// https://developers.openai.com/api/docs/models/gpt-transcribe
export const CAPTURE_SPEECH_ENDPOINT =
  "https://api.openai.com/v1/audio/transcriptions";
export const CAPTURE_SPEECH_MODEL = "gpt-transcribe";
export const CAPTURE_SPEECH_MIN_MICROS_PER_MINUTE = 4_500;
const MAX_RESPONSE_BYTES = 64 * 1024;
const object = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === "object" && !Array.isArray(v);
const integer = (v: unknown, maximum: number) =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= maximum;
function failure(
  category: ConstructorParameters<
    typeof AiGovernorError
  >[1] = "ai_invalid_response",
): never {
  throw new AiGovernorError("ai_provider_unavailable", category);
}
function check(signal: AbortSignal) {
  if (signal.aborted) throw new AiGovernorError("ai_cancelled");
}
function bounded<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const stop = () => reject(new AiGovernorError("ai_cancelled"));
    if (signal.aborted) {
      stop();
      return;
    }
    signal.addEventListener("abort", stop, { once: true });
    work
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", stop));
  });
}

/** Native audio transport only. Caller must already hold the shared governor reservation. */
export async function callCaptureSpeechProvider(
  input: {
    audio: TelegramVoiceAudio;
    signal: AbortSignal;
    apiKey: string;
    model: string;
    audioCostMicrosPerMinute: number;
    maxOutputTokens: number;
    routing: AiRoutingAccounting;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<{
  text: string;
  languages: string[];
  usage?: { total_tokens: number; completion_tokens: number };
  routing: AiRoutingAccounting;
}> {
  check(input.signal);
  if (
    input.model !== CAPTURE_SPEECH_MODEL ||
    input.audio.mimeType !== "audio/ogg" ||
    !integer(input.maxOutputTokens, 8192) ||
    input.maxOutputTokens < 1 ||
    !integer(input.audioCostMicrosPerMinute, 1_000_000_000_000) ||
    input.audioCostMicrosPerMinute < CAPTURE_SPEECH_MIN_MICROS_PER_MINUTE ||
    !input.apiKey ||
    input.apiKey.length > 1024 ||
    /[\r\n]/.test(input.apiKey)
  )
    failure("ai_unsupported_model");
  validateBoundedOggOpus(input.audio.bytes);
  // Native multipart audio; no text/base64 prompt, remote URL, Files API or temp file.
  const fileBytes = Uint8Array.from(input.audio.bytes);
  const body = new FormData();
  body.set(
    "file",
    new Blob([fileBytes.buffer], { type: "audio/ogg" }),
    "voice.ogg",
  );
  body.set("model", CAPTURE_SPEECH_MODEL);
  body.set("response_format", "json");
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let chunks: Uint8Array[] = [];
  const cancel = () => {
    void reader?.cancel().catch(() => {});
    fileBytes.fill(0);
    for (const part of chunks) part.fill(0);
  };
  input.signal.addEventListener("abort", cancel, { once: true });
  try {
    const pending = fetchImpl(CAPTURE_SPEECH_ENDPOINT, {
      method: "POST",
      redirect: "error",
      signal: input.signal,
      headers: { Authorization: "Bearer " + input.apiKey },
      body,
    });
    void pending.then(
      (late) => {
        if (input.signal.aborted) void late.body?.cancel().catch(() => {});
      },
      () => {},
    );
    const response = await bounded(pending, input.signal);
    check(input.signal);
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      failure(
        response.status === 429
          ? "ai_quota_exceeded"
          : response.status === 401 || response.status === 403
            ? "ai_invalid_credentials"
            : response.status === 400 || response.status === 404
              ? "ai_unsupported_model"
              : "ai_unavailable",
      );
    }
    if (response.body) reader = response.body.getReader();
    const declared = response.headers.get("content-length");
    if (
      !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
        response.headers.get("content-type") ?? "",
      ) ||
      (declared !== null &&
        (!/^\d+$/.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) ||
      !response.body
    )
      failure();
    if (!reader) failure();
    let length = 0;
    for (;;) {
      const chunk = await bounded(reader.read(), input.signal);
      check(input.signal);
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > MAX_RESPONSE_BYTES) failure();
      chunks.push(chunk.value);
    }
    const bytes = Buffer.concat(chunks);
    let data: unknown;
    try {
      data = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    } catch {
      failure();
    } finally {
      bytes.fill(0);
    }
    check(input.signal);
    if (
      !object(data) ||
      typeof data.text !== "string" ||
      !data.text.trim() ||
      data.text.trim().length > CAPTURE_MAX_TEXT ||
      Buffer.byteLength(data.text.trim(), "utf8") > input.maxOutputTokens ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(data.text) ||
      data.text.includes(input.apiKey)
    )
      failure();
    const languages = data.languages === undefined ? [] : data.languages;
    if (
      !Array.isArray(languages) ||
      languages.length > 8 ||
      languages.some(
        (v) =>
          !object(v) ||
          typeof v.code !== "string" ||
          !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/.test(v.code),
      )
    )
      failure();
    const codes = languages.map((v) => (v as { code: string }).code);
    if (new Set(codes).size !== codes.length) failure();
    // No language hint/translation is forced. Unknown or unexpected speech stays owner-reviewed.
    const usage = data.usage;
    let normalized:
      | { total_tokens: number; completion_tokens: number }
      | undefined;
    let observedCost: number | null = null;
    if (usage === undefined) {
      // Optional upstream accounting never releases the conservative120-second reservation.
    } else if (!object(usage)) failure();
    else if (usage.type === "duration") {
      if (
        typeof usage.seconds !== "number" ||
        !Number.isFinite(usage.seconds) ||
        usage.seconds <= 0 ||
        usage.seconds > CAPTURE_MAX_VOICE_SECONDS
      )
        failure();
      observedCost = Math.ceil(
        (usage.seconds * input.audioCostMicrosPerMinute) / 60,
      );
    } else if (usage.type === "tokens") {
      if (
        !integer(usage.input_tokens, 3000) ||
        !integer(usage.output_tokens, input.maxOutputTokens) ||
        !integer(usage.total_tokens, 3000 + input.maxOutputTokens) ||
        Number(usage.total_tokens) !==
          Number(usage.input_tokens) + Number(usage.output_tokens)
      )
        failure();
      normalized = {
        total_tokens: Number(usage.total_tokens),
        completion_tokens: Number(usage.output_tokens),
      };
    } else failure();
    return {
      text: data.text.trim(),
      languages: codes,
      ...(normalized ? { usage: normalized } : {}),
      routing: {
        ...input.routing,
        attempts: 1,
        fallback: false,
        inputTokens: normalized
          ? normalized.total_tokens - normalized.completion_tokens
          : null,
        outputTokens: normalized?.completion_tokens ?? null,
        reportedCostMicros: observedCost,
        costSource: observedCost === null ? "unknown" : "rate_estimate",
      },
    };
  } catch (error) {
    if (error instanceof AiGovernorError || error instanceof VoiceCaptureError)
      throw error;
    check(input.signal);
    return failure("ai_unavailable");
  } finally {
    cancel();
    input.signal.removeEventListener("abort", cancel);
    chunks = [];
    try {
      reader?.releaseLock();
    } catch {
      /* no content-bearing errors */
    }
  }
}
