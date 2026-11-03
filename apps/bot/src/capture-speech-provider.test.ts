import { describe, expect, it, vi } from "vitest";
import type { AiRoutingAccounting } from "@lifeos/core";
import {
  callCaptureSpeechProvider,
  CAPTURE_SPEECH_ENDPOINT,
  CAPTURE_SPEECH_MODEL,
} from "./capture-speech-provider.js";
import { speechOgg } from "./capture-speech-provider.test-fixtures.js";

const KEY = "sk-synthetic-speech-test-only";
const TEXT = "Завтра жаттығу DBMS and film a plan";
const routing: AiRoutingAccounting = {
  version: 1,
  provider: "openai",
  model: CAPTURE_SPEECH_MODEL,
  selectedModelId: "speech",
  credentialLabel: "speech-fixture",
  billing: "api",
  attempts: 0,
  fallback: false,
  inputTokens: null,
  outputTokens: null,
  reportedCostMicros: null,
  costSource: "unknown",
};
function input() {
  return {
    audio: { bytes: speechOgg(), mimeType: "audio/ogg" as const },
    signal: new AbortController().signal,
    apiKey: KEY,
    model: CAPTURE_SPEECH_MODEL,
    audioCostMicrosPerMinute: 4500,
    maxOutputTokens: 8192,
    routing,
  };
}
function result(extra: Record<string, unknown> = {}) {
  return {
    text: TEXT,
    languages: [{ code: "ru" }, { code: "kk" }, { code: "en" }],
    usage: { type: "duration", seconds: 1 },
    ...extra,
  };
}
describe("native speech provider (all requests mocked)", () => {
  it("uses one fixed native multipart request and normalizes duration-priced safe accounting", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(result()));
    const value = await callCaptureSpeechProvider(input(), fetcher);
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, request] = fetcher.mock.calls[0];
    expect(url).toBe(CAPTURE_SPEECH_ENDPOINT);
    expect(request).toMatchObject({
      method: "POST",
      redirect: "error",
      signal: expect.any(AbortSignal),
      headers: { Authorization: "Bearer " + KEY },
    });
    const body = request!.body as FormData;
    expect([...body.keys()].sort()).toEqual([
      "file",
      "model",
      "response_format",
    ]);
    expect(body.get("model")).toBe("gpt-transcribe");
    const audio = body.get("file") as File;
    expect(audio.name).toBe("voice.ogg");
    expect(audio.type).toBe("audio/ogg");
    expect(Array.from(new Uint8Array(await audio.arrayBuffer()))).toEqual(
      Array.from(speechOgg()),
    );
    expect(value).toMatchObject({
      text: TEXT,
      languages: ["ru", "kk", "en"],
      routing: {
        attempts: 1,
        fallback: false,
        reportedCostMicros: 75,
        costSource: "rate_estimate",
      },
    });
    expect(JSON.stringify(value.routing)).not.toContain(TEXT);
    expect(JSON.stringify(value.routing)).not.toContain(KEY);
  });
  it("keeps unknown-language detection honest and normalizes optional bounded token usage", async () => {
    const optional = await callCaptureSpeechProvider(input(), async () =>
      Response.json(result({ languages: undefined, usage: undefined })),
    );
    expect(optional.languages).toEqual([]);
    expect(optional.usage).toBeUndefined();
    expect(optional.routing).toMatchObject({
      reportedCostMicros: null,
      costSource: "unknown",
    });
    const value = await callCaptureSpeechProvider(input(), async () =>
      Response.json(
        result({
          languages: [],
          usage: {
            type: "tokens",
            input_tokens: 5,
            output_tokens: 4,
            total_tokens: 9,
          },
        }),
      ),
    );
    expect(value.languages).toEqual([]);
    expect(value.usage).toEqual({ total_tokens: 9, completion_tokens: 4 });
    expect(value.routing.costSource).toBe("unknown");
  });
  it.each([
    { text: "" },
    { text: "\u0000secret" },
    { text: "x".repeat(8001) },
    { text: "я".repeat(5000) },
    { text: "accidental " + KEY },
    { languages: [{ code: "ru private data" }] },
    { languages: [{ code: "ru" }, { code: "ru" }] },
    { languages: "ru" },
    { usage: null },
    { usage: { type: "duration", seconds: 121 } },
    { usage: { type: "duration", seconds: -1 } },
    {
      usage: {
        type: "tokens",
        input_tokens: 1,
        output_tokens: 2,
        total_tokens: 1,
      },
    },
  ])(
    "rejects invalid, oversized or unaccountable output %j",
    async (change) => {
      await expect(
        callCaptureSpeechProvider(input(), async () =>
          Response.json(result(change)),
        ),
      ).rejects.toMatchObject({
        code: "ai_provider_unavailable",
        providerCategory: "ai_invalid_response",
      });
    },
  );
  it.each([
    [400, "ai_unsupported_model"],
    [401, "ai_invalid_credentials"],
    [403, "ai_invalid_credentials"],
    [404, "ai_unsupported_model"],
    [429, "ai_quota_exceeded"],
    [500, "ai_unavailable"],
  ] as const)(
    "sanitizes HTTP %i without retrying, rotating keys or reading an error body",
    async (status, category) => {
      const fetcher = vi.fn<typeof fetch>(
        async () => new Response(KEY + TEXT, { status }),
      );
      await expect(
        callCaptureSpeechProvider(input(), fetcher),
      ).rejects.toMatchObject({
        message: "ai_provider_unavailable",
        providerCategory: category,
      });
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );
  it("rejects malformed JSON, non-JSON, invalid UTF8 and declared/actual response overflows", async () => {
    for (const response of [
      new Response("{", { headers: { "content-type": "application/json" } }),
      new Response("<html>secret</html>", {
        headers: { "content-type": "text/html" },
      }),
      new Response(Uint8Array.of(0xff), {
        headers: { "content-type": "application/json" },
      }),
      new Response("{}", {
        headers: {
          "content-type": "application/json",
          "content-length": "65537",
        },
      }),
      new Response(" ".repeat(65537), {
        headers: { "content-type": "application/json" },
      }),
    ])
      await expect(
        callCaptureSpeechProvider(input(), async () => response),
      ).rejects.toMatchObject({ providerCategory: "ai_invalid_response" });
  });
  it("fails before fetch for unsupported audio, model, price and pre-cancelled work", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      callCaptureSpeechProvider({ ...input(), model: "whisper-1" }, fetcher),
    ).rejects.toMatchObject({ providerCategory: "ai_unsupported_model" });
    await expect(
      callCaptureSpeechProvider(
        { ...input(), audioCostMicrosPerMinute: 0 },
        fetcher,
      ),
    ).rejects.toMatchObject({ providerCategory: "ai_unsupported_model" });
    await expect(
      callCaptureSpeechProvider(
        {
          ...input(),
          audio: { bytes: Uint8Array.of(1, 2), mimeType: "audio/ogg" },
        },
        fetcher,
      ),
    ).rejects.toMatchObject({ code: "voice_unsupported" });
    const controller = new AbortController();
    controller.abort();
    await expect(
      callCaptureSpeechProvider(
        { ...input(), signal: controller.signal },
        fetcher,
      ),
    ).rejects.toMatchObject({ code: "ai_cancelled" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("bounds cancellation even if fetch or a response reader ignores abort", async () => {
    for (const fetcher of [
      vi.fn<typeof fetch>(async () => new Promise<Response>(() => {})),
      vi.fn<typeof fetch>(
        async () =>
          new Response(
            new ReadableStream({
              start() {},
              cancel: () => new Promise<void>(() => {}),
            }),
            { headers: { "content-type": "application/json" } },
          ),
      ),
    ]) {
      const controller = new AbortController();
      const pending = callCaptureSpeechProvider(
        { ...input(), signal: controller.signal },
        fetcher,
      );
      const rejected = expect(pending).rejects.toMatchObject({
        code: "ai_cancelled",
      });
      await Promise.resolve();
      controller.abort();
      await rejected;
      expect(fetcher).toHaveBeenCalledOnce();
    }
  });
  it("sanitizes network exceptions containing credential/audio/private text", async () => {
    await expect(
      callCaptureSpeechProvider(input(), async () => {
        throw new Error(KEY + TEXT);
      }),
    ).rejects.toMatchObject({
      message: "ai_provider_unavailable",
      providerCategory: "ai_unavailable",
    });
  });
});
