import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiBudgetStore } from "@lifeos/core";
import {
  CAPTURE_MAX_VOICE_BYTES,
  CAPTURE_MAX_VOICE_SECONDS,
} from "@lifeos/core";
import {
  AiGovernor,
  AiGovernorError,
  readAiGovernorConfig,
} from "../ai-governor.js";
import {
  captureSpeechCapability,
  downloadTelegramVoice,
  transcribeCaptureVoice,
  validateOggOpus,
  validateTelegramVoice,
  VoiceCaptureError,
  type GovernedCaptureSpeechAdapter,
} from "./voice.js";

const now = new Date("2026-11-03T18:00:00Z");
const sentAt = now.getTime() / 1000;
const metadata = {
  file_id: "synthetic-file",
  file_unique_id: "stable-file",
  duration: 12,
  mime_type: "audio/ogg",
  file_size: 1000,
};
const destination =
  "https://api.telegram.org/file/bot123:synthetic/voice/file_1.oga";
function ogg() {
  const bytes = new Uint8Array(47);
  bytes.set(Buffer.from("OggS"));
  bytes[5] = 2;
  bytes[26] = 1;
  bytes[27] = 19;
  bytes.set(Buffer.from("OpusHead"), 28);
  bytes[36] = 1;
  bytes[37] = 1;
  return bytes;
}
const response = (
  bytes = ogg(),
  headers: HeadersInit = { "content-type": "audio/ogg" },
) => new Response(Uint8Array.from(bytes).buffer, { status: 200, headers });
afterEach(() => vi.useRealTimers());

describe("Telegram voice metadata boundary", () => {
  it("uses stable Telegram timestamps and keeps references out of a public capability", () => {
    const a = validateTelegramVoice(metadata, sentAt, now);
    const b = validateTelegramVoice(
      metadata,
      sentAt,
      new Date(now.getTime() + 30_000),
    );
    expect(a).toEqual(b);
    expect(a.referenceExpiresAt).toBe("2026-11-04T17:55:00.000Z");
    expect(captureSpeechCapability()).toEqual({
      available: false,
      reason: "voice_transcription_unavailable",
      manualTranscript: true,
    });
    expect(JSON.stringify(captureSpeechCapability())).not.toContain(
      metadata.file_id,
    );
  });
  it("allows optional sender MIME/size and already expired references for manual fallback", () => {
    expect(
      validateTelegramVoice(
        { file_id: "f", file_unique_id: "u", duration: 1 },
        sentAt - 90_000,
        now,
      ),
    ).toMatchObject({ mimeType: null, fileSize: null });
  });
  it.each([
    { duration: CAPTURE_MAX_VOICE_SECONDS + 1 },
    { file_size: CAPTURE_MAX_VOICE_BYTES + 1 },
  ])("rejects configured duration/byte limits before a download", (change) => {
    expect(() =>
      validateTelegramVoice({ ...metadata, ...change }, sentAt, now),
    ).toThrowError("voice_too_large");
  });
  it.each([
    { mime_type: "audio/mpeg" },
    { mime_type: "text/html" },
    { mime_type: 1 },
    { duration: 0 },
    { duration: 1.5 },
    { file_size: -1 },
    { file_size: "100" },
    { file_id: "\nunsafe" },
    { file_unique_id: "" },
  ])("rejects unsupported or malformed sender metadata", (change) => {
    expect(() =>
      validateTelegramVoice({ ...metadata, ...change }, sentAt, now),
    ).toThrowError("voice_unsupported");
  });
  it.each([undefined, NaN, -1, sentAt + 301, Number.MAX_SAFE_INTEGER])(
    "rejects missing or future Telegram timestamps",
    (date) => {
      expect(() => validateTelegramVoice(metadata, date, now)).toThrowError(
        "voice_unsupported",
      );
    },
  );
});

describe("bounded memory-only Telegram audio download", () => {
  it("accepts a bounded Ogg/Opus profile and forbids redirects", async () => {
    const fetcher = vi.fn(async () => response());
    const result = await downloadTelegramVoice(destination, { fetcher });
    expect(result.mimeType).toBe("audio/ogg");
    expect(result.bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(result.bytes)).toEqual(Array.from(ogg()));
    expect(fetcher).toHaveBeenCalledWith(
      destination,
      expect.objectContaining({
        redirect: "error",
        signal: expect.any(AbortSignal),
      }),
    );
  });
  it.each([
    "http://api.telegram.org/file/bot123:synthetic/voice/a.oga",
    "https://evil.example/file/bot123:synthetic/a.oga",
    "https://api.telegram.org.evil.example/file/bot123:synthetic/a.oga",
    "https://user:pass@api.telegram.org/file/bot123:synthetic/a.oga",
    "https://api.telegram.org:444/file/bot123:synthetic/a.oga",
    destination + "?token=hidden",
    destination + "#fragment",
    "https://api.telegram.org/file/bot123:synthetic/../secret.oga",
    "https://api.telegram.org/file/bot123:synthetic/%2e%2e/a.oga",
    "https://api.telegram.org/file/bot123:synthetic/voice%2fa.oga",
    "https://api.telegram.org/file/bot123:synthetic\\voice\\a.oga",
  ])("rejects untrusted origins/paths without any request", async (url) => {
    const fetcher = vi.fn(async () => response());
    await expect(downloadTelegramVoice(url, { fetcher })).rejects.toMatchObject(
      { code: "voice_download_origin_rejected" },
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("enforces actual streamed bytes even when content length is absent", async () => {
    const bytes = new Uint8Array(48);
    bytes.set(ogg());
    await expect(
      downloadTelegramVoice(destination, {
        fetcher: async () => response(bytes),
        maxBytes: 47,
      }),
    ).rejects.toMatchObject({ code: "voice_too_large" });
  });
  it("rejects oversized, malformed and unexpected HTTP responses", async () => {
    for (const received of [
      response(ogg(), {
        "content-length": String(CAPTURE_MAX_VOICE_BYTES + 1),
      }),
      response(ogg(), { "content-length": "invalid" }),
      response(ogg(), { "content-type": "text/html" }),
      new Response("synthetic-private-error", { status: 403 }),
    ]) {
      await expect(
        downloadTelegramVoice(destination, { fetcher: async () => received }),
      ).rejects.toBeInstanceOf(VoiceCaptureError);
    }
  });
  it.each([
    new Uint8Array(0),
    Buffer.from("<html>not audio</html>"),
    (() => {
      const a = ogg();
      a[28] = 0;
      return a;
    })(),
    (() => {
      const a = ogg();
      a[27] = 250;
      return a;
    })(),
  ])("rejects unsupported or truncated containers", (bytes) => {
    expect(() => validateOggOpus(bytes)).toThrowError("voice_unsupported");
  });
  it("keeps timeout bounded if fetch ignores abort", async () => {
    const fetcher = vi.fn(async () => new Promise<Response>(() => {}));
    await expect(
      downloadTelegramVoice(destination, { fetcher, timeoutMs: 15 }),
    ).rejects.toMatchObject({ code: "voice_download_timeout" });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("keeps cancellation bounded if a response reader and cancel ignore abort", async () => {
    const controller = new AbortController();
    const body = new ReadableStream<Uint8Array>({
      start() {},
      cancel: () => new Promise<void>(() => {}),
    });
    const promise = downloadTelegramVoice(destination, {
      fetcher: async () => new Response(body),
      signal: controller.signal,
    });
    const rejected = expect(promise).rejects.toMatchObject({
      code: "voice_cancelled",
    });
    controller.abort();
    await rejected;
  });
  it("does not call fetch with an already cancelled signal", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn(async () => response());
    await expect(
      downloadTelegramVoice(destination, {
        fetcher,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "voice_cancelled" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("sanitizes upstream exceptions containing token URLs or private notes", async () => {
    await expect(
      downloadTelegramVoice(destination, {
        fetcher: async () => {
          throw new Error(destination + " private note");
        },
      }),
    ).rejects.toMatchObject({ message: "voice_download_failed" });
  });
});

function speechFixture() {
  const rows = new Set<string>();
  const store: AiBudgetStore = {
    reserve: vi.fn(async (input) => {
      if (rows.has(input.userId + input.requestId)) return "duplicate";
      rows.add(input.userId + input.requestId);
      return "reserved";
    }),
    finish: vi.fn(async () => {}),
  };
  const governor = new AiGovernor({
    store,
    config: { ...readAiGovernorConfig({}), timeoutMs: 50 },
  });
  const adapter: GovernedCaptureSpeechAdapter = {
    available: true,
    audioPricingVerified: true,
    reservation: {
      feature: "chat",
      estimatedInputTokens: 500,
      maxOutputTokens: 200,
      estimatedCostMicros: 10,
      maxRequestCostMicros: 20,
      maxUserDailyCostMicros: 100,
    },
    transcribe: vi.fn(async () => ({
      text: "Синтетическая расшифровка для теста",
    })),
  };
  const audio = { bytes: ogg(), mimeType: "audio/ogg" as const };
  const dependencies = {
    governor,
    adapter,
    download: vi.fn(async () => audio),
    authorize: vi.fn(
      async (_stage: "before_download" | "before_transcription") => true,
    ),
    now: () => now,
  };
  const input = {
    userId: "owner",
    captureId: "capture-1",
    requestId: "capture:1:transcription:1",
    reference: validateTelegramVoice(metadata, sentAt, now),
    consent: {
      confirmed: true as const,
      userId: "owner",
      captureId: "capture-1",
      expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    },
  };
  return { store, adapter, dependencies, input, audio };
}
describe("optional speech port uses only existing shared governance", () => {
  it("never downloads without a configured shared-governor audio adapter", async () => {
    const f = speechFixture();
    await expect(
      transcribeCaptureVoice(f.input, {
        ...f.dependencies,
        adapter: undefined,
      }),
    ).rejects.toMatchObject({ code: "voice_transcription_unavailable" });
    await expect(
      transcribeCaptureVoice(f.input, {
        ...f.dependencies,
        governor: undefined,
      }),
    ).rejects.toMatchObject({ code: "voice_transcription_unavailable" });
    expect(f.dependencies.download).not.toHaveBeenCalled();
    expect(f.adapter.transcribe).not.toHaveBeenCalled();
    expect(f.store.reserve).not.toHaveBeenCalled();
  });
  it("requires fresh capture/owner-bound explicit consent", async () => {
    const f = speechFixture();
    for (const consent of [
      { ...f.input.consent, userId: "other" },
      { ...f.input.consent, captureId: "other" },
      { ...f.input.consent, expiresAt: now.toISOString() },
      {
        ...f.input.consent,
        expiresAt: new Date(now.getTime() + 301_000).toISOString(),
      },
    ]) {
      await expect(
        transcribeCaptureVoice({ ...f.input, consent }, f.dependencies),
      ).rejects.toMatchObject({ code: "voice_consent_required" });
    }
    expect(f.dependencies.download).not.toHaveBeenCalled();
    expect(f.store.reserve).not.toHaveBeenCalled();
  });
  it("reserves once before download, rechecks permission, clears audio and stores no transcript in accounting", async () => {
    const f = speechFixture();
    const result = await transcribeCaptureVoice(f.input, f.dependencies);
    expect(result.transcript).toContain("Синтетическая");
    expect(f.store.reserve).toHaveBeenCalledBefore(f.dependencies.download);
    expect(f.dependencies.authorize).toHaveBeenCalledWith(
      "before_transcription",
    );
    expect(f.audio.bytes.every((byte) => byte === 0)).toBe(true);
    expect(JSON.stringify(vi.mocked(f.store.reserve).mock.calls)).not.toContain(
      result.transcript,
    );
    expect(JSON.stringify(vi.mocked(f.store.finish).mock.calls)).not.toContain(
      result.transcript,
    );
    await expect(
      transcribeCaptureVoice(f.input, f.dependencies),
    ).rejects.toMatchObject({ code: "ai_duplicate_request" });
    expect(f.adapter.transcribe).toHaveBeenCalledOnce();
  });
  it("retains a budget failure without downloading or retrying", async () => {
    const f = speechFixture();
    vi.mocked(f.store.reserve).mockResolvedValue("cost_budget_exceeded");
    await expect(
      transcribeCaptureVoice(f.input, f.dependencies),
    ).rejects.toMatchObject({ code: "ai_cost_budget_exceeded" });
    expect(f.dependencies.download).not.toHaveBeenCalled();
    expect(f.adapter.transcribe).not.toHaveBeenCalled();
  });
  it("rejects expired references and permission revoked during download", async () => {
    const f = speechFixture();
    await expect(
      transcribeCaptureVoice(
        {
          ...f.input,
          reference: {
            ...f.input.reference,
            referenceExpiresAt: now.toISOString(),
          },
        },
        f.dependencies,
      ),
    ).rejects.toMatchObject({ code: "voice_reference_expired" });
    vi.mocked(f.dependencies.authorize).mockImplementation(
      async (stage) => stage !== "before_transcription",
    );
    await expect(
      transcribeCaptureVoice(f.input, f.dependencies),
    ).rejects.toMatchObject({ code: "voice_consent_required" });
    expect(f.adapter.transcribe).not.toHaveBeenCalled();
    expect(f.audio.bytes.every((byte) => byte === 0)).toBe(true);
  });
  it("rejects invalid transcripts and sanitizes provider failures", async () => {
    for (const text of [
      "",
      "\0credential",
      "x".repeat(201),
      "x".repeat(8001),
    ]) {
      const f = speechFixture();
      vi.mocked(f.adapter.transcribe).mockResolvedValue({ text });
      await expect(
        transcribeCaptureVoice(f.input, f.dependencies),
      ).rejects.toMatchObject({ code: "voice_transcription_failed" });
    }
    const f = speechFixture();
    vi.mocked(f.adapter.transcribe).mockRejectedValue(
      new Error("private-provider-body"),
    );
    await expect(
      transcribeCaptureVoice(f.input, f.dependencies),
    ).rejects.toMatchObject({ message: "voice_transcription_failed" });
  });
  it("preserves a shared-governor quota category without key rotation or retry", async () => {
    const f = speechFixture();
    vi.mocked(f.adapter.transcribe).mockRejectedValue(
      new AiGovernorError("ai_provider_unavailable", "ai_quota_exceeded"),
    );
    await expect(
      transcribeCaptureVoice(f.input, f.dependencies),
    ).rejects.toMatchObject({
      code: "ai_provider_unavailable",
      providerCategory: "ai_quota_exceeded",
    });
    expect(f.adapter.transcribe).toHaveBeenCalledOnce();
  });
  it("uses the existing timeout and cancellation receipt rather than a second execution framework", async () => {
    const f = speechFixture();
    let finish: ((value: { text: string }) => void) | undefined;
    vi.mocked(f.adapter.transcribe).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await expect(
      transcribeCaptureVoice(f.input, f.dependencies),
    ).rejects.toMatchObject({ code: "ai_timeout" });
    expect(f.adapter.transcribe).toHaveBeenCalledOnce();
    expect(f.store.finish).toHaveBeenCalledWith(
      expect.objectContaining({ state: "timed_out" }),
      expect.any(AbortSignal),
    );
    expect(f.audio.bytes.every((byte) => byte === 0)).toBe(true);
    finish?.({ text: "late synthetic result" });
  });
});
