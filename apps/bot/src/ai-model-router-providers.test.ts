import { describe, expect, it, vi } from "vitest";
import type { AiRouterModel } from "@lifeos/core";
import {
  callAiRouterProvider,
  normalizeRouterProviderMessages,
  RouterProviderError,
  type RouterProviderInput,
  type RouterProviderMessage,
} from "./ai-model-router-providers.js";

// All provider transport below is mocked; no model requests or real credentials.
function model(overrides: Partial<AiRouterModel> = {}): AiRouterModel {
  return {
    id: "fixture",
    label: "Fixture",
    provider: "openrouter",
    model: "fixture/model",
    tiers: ["balanced"],
    capabilities: ["text", "json"],
    billing: "api",
    inputCostMicrosPer1k: 1_000,
    outputCostMicrosPer1k: 2_000,
    configured: true,
    authorized: true,
    status: "configured",
    metadataVerified: true,
    privacy: "external",
    ...overrides,
  };
}
function input(
  overrides: Partial<RouterProviderInput> = {},
): RouterProviderInput {
  return {
    model: model(),
    fallbackModels: [],
    apiKey: "MOCK_SERVER_KEY_CANARY",
    messages: [
      { role: "system", content: "Be factual." },
      { role: "user", content: "Synthetic test question" },
    ],
    maxOutputTokens: 128,
    signal: new AbortController().signal,
    ...overrides,
  };
}
function completion(overrides: Record<string, unknown> = {}) {
  return {
    model: "fixture/model",
    choices: [
      {
        finish_reason: "stop",
        message: { role: "assistant", content: "Synthetic answer" },
      },
    ],
    usage: {
      prompt_tokens: 30,
      completion_tokens: 10,
      total_tokens: 40,
      cost: 0.00000101,
    },
    ...overrides,
  };
}
const json = (value: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(value), {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
function transport(response: Response | (() => Response)) {
  return vi
    .fn<typeof fetch>()
    .mockImplementation(async () =>
      typeof response === "function" ? response() : response,
    );
}
function pngUrl() {
  const bytes = Buffer.alloc(32);
  Buffer.from("89504e470d0a1a0a", "hex").copy(bytes);
  bytes.writeUInt32BE(32, 16);
  bytes.writeUInt32BE(32, 20);
  return "data:image/png;base64," + bytes.toString("base64");
}

describe("unified router provider transport", () => {
  it("uses the fixed OpenRouter URL, explicit billing/privacy limits and a single server key", async () => {
    const fake = transport(json(completion()));
    const request = input({
      openRouter: {
        providerOnly: ["FixtureProvider"],
        sort: "latency",
        requireZdr: true,
      },
    });
    const result = await callAiRouterProvider(request, fake);
    expect(fake).toHaveBeenCalledOnce();
    const [url, options] = fake.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(options).toMatchObject({
      method: "POST",
      redirect: "error",
      signal: request.signal,
      headers: { authorization: "Bearer MOCK_SERVER_KEY_CANARY" },
    });
    expect(JSON.parse(String(options?.body))).toMatchObject({
      model: "fixture/model",
      max_tokens: 128,
      stream: false,
      provider: {
        only: ["FixtureProvider"],
        sort: "latency",
        data_collection: "deny",
        zdr: true,
        allow_fallbacks: false,
        require_parameters: true,
        max_price: { prompt: 1, completion: 2 },
      },
    });
    expect(String(url)).not.toContain(request.apiKey);
    expect(result).toEqual({
      text: "Synthetic answer",
      servedModel: "fixture/model",
      usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 },
      reportedCostMicros: 2,
    });
  });

  it("uses one documented internal fallback request and reports only the actual approved served model", async () => {
    const next = model({
      id: "second",
      model: "fixture/second",
      inputCostMicrosPer1k: 4_000,
      outputCostMicrosPer1k: 5_000,
    });
    const fake = transport(
      json(
        completion({ model: "fixture/second", provider: "Fixture upstream" }),
      ),
    );
    const result = await callAiRouterProvider(
      input({ fallbackModels: [next] }),
      fake,
    );
    const sent = JSON.parse(String(fake.mock.calls[0][1]?.body));
    expect(sent.models).toEqual(["fixture/model", "fixture/second"]);
    expect(sent).not.toHaveProperty("model");
    expect(sent.provider.allow_fallbacks).toBe(true);
    expect(sent.provider.max_price).toEqual({
      prompt: 4,
      completion: 5,
      request: 0,
    });
    expect(result.servedModel).toBe("fixture/second");
    expect(result.upstreamProvider).toBe("Fixture upstream");
    expect(fake).toHaveBeenCalledOnce();
  });

  it("cannot switch provider or billing path inside an OpenRouter fallback array", async () => {
    for (const secondary of [
      model({ provider: "gemini", model: "gemini-fixture" }),
      model({ billing: "chatgpt_plan", provider: "chatgpt_plan" }),
      model({
        billing: "free",
        model: "fixture/second",
        inputCostMicrosPer1k: 0,
        outputCostMicrosPer1k: 0,
      }),
    ]) {
      const fake = transport(json(completion()));
      await expect(
        callAiRouterProvider(input({ fallbackModels: [secondary] }), fake),
      ).rejects.toMatchObject({ code: "invalid_request", retryable: false });
      expect(fake).not.toHaveBeenCalled();
    }
  });

  it("does not trust arbitrary provider model substitutions", async () => {
    await expect(
      callAiRouterProvider(
        input(),
        transport(json(completion({ model: "unapproved/expensive" }))),
      ),
    ).rejects.toMatchObject({
      code: "invalid_response",
      retryable: false,
      ambiguous: true,
    });
  });

  it("blocks a provider accidentally echoing its credential in a successful result", async () => {
    const choices = [
      {
        finish_reason: "stop",
        message: { role: "assistant", content: "MOCK_SERVER_KEY_CANARY" },
      },
    ];
    await expect(
      callAiRouterProvider(input(), transport(json(completion({ choices })))),
    ).rejects.toMatchObject({
      code: "invalid_response",
      retryable: false,
      ambiguous: true,
    });
  });

  it("keeps direct OpenAI API billing separate from ChatGPT plan access", async () => {
    const fake = transport(json(completion({ model: "fixture-openai-model" })));
    await callAiRouterProvider(
      input({
        model: model({ provider: "openai", model: "fixture-openai-model" }),
      }),
      fake,
    );
    expect(fake.mock.calls[0][0]).toBe(
      "https://api.openai.com/v1/chat/completions",
    );
    expect(JSON.parse(String(fake.mock.calls[0][1]?.body))).toMatchObject({
      model: "fixture-openai-model",
      max_completion_tokens: 128,
      n: 1,
      stream: false,
      store: false,
    });
    const planTransport = transport(json(completion()));
    await expect(
      callAiRouterProvider(
        input({
          model: model({
            provider: "chatgpt_plan",
            billing: "chatgpt_plan",
            planScopeGranted: true,
          }),
        }),
        planTransport,
      ),
    ).rejects.toMatchObject({
      code: "subscription_prepared",
      retryable: false,
      ambiguous: false,
    });
    expect(planTransport).not.toHaveBeenCalled();
  });

  it("maps Gemini content and accounts for generated thinking tokens without exposing thought text", async () => {
    const fake = transport(
      json({
        modelVersion: "gemini-fixture",
        candidates: [
          {
            finishReason: "STOP",
            content: {
              parts: [
                { thought: true, text: "PRIVATE THOUGHT" },
                { text: "Visible synthetic answer" },
              ],
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: 20,
          candidatesTokenCount: 10,
          thoughtsTokenCount: 15,
          totalTokenCount: 45,
        },
      }),
    );
    const result = await callAiRouterProvider(
      input({ model: model({ provider: "gemini", model: "gemini-fixture" }) }),
      fake,
    );
    expect(fake.mock.calls[0][0]).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-fixture:generateContent",
    );
    expect(fake.mock.calls[0][1]?.headers).toMatchObject({
      "x-goog-api-key": "MOCK_SERVER_KEY_CANARY",
    });
    const body = JSON.parse(String(fake.mock.calls[0][1]?.body));
    expect(body.systemInstruction).toEqual({
      parts: [{ text: "Be factual." }],
    });
    expect(body.contents).toEqual([
      { role: "user", parts: [{ text: "Synthetic test question" }] },
    ]);
    expect(body.generationConfig).toEqual({ maxOutputTokens: 128 });
    expect(body).not.toHaveProperty("candidateCount");
    expect(result.text).toBe("Visible synthetic answer");
    expect(result.usage).toEqual({
      prompt_tokens: 20,
      completion_tokens: 25,
      total_tokens: 45,
    });
    expect(JSON.stringify(result)).not.toContain("PRIVATE THOUGHT");
  });

  it("does not invent Gemini actual-model metadata when the provider omits it", async () => {
    await expect(
      callAiRouterProvider(
        input({
          model: model({ provider: "gemini", model: "gemini-fixture" }),
        }),
        transport(
          json({
            candidates: [
              {
                finishReason: "STOP",
                content: { parts: [{ text: "answer" }] },
              },
            ],
          }),
        ),
      ),
    ).rejects.toMatchObject({ code: "invalid_response", ambiguous: true });
  });

  it("uses only a real Anthropic Console API-key path and keeps native subscription OAuth out", async () => {
    const fake = transport(
      json({
        type: "message",
        role: "assistant",
        model: "claude-fixture",
        content: [{ type: "text", text: "Synthetic Claude answer" }],
        stop_reason: "end_turn",
        usage: {
          input_tokens: 20,
          output_tokens: 10,
          cache_read_input_tokens: 5,
          cache_creation_input_tokens: 2,
        },
      }),
    );
    const result = await callAiRouterProvider(
      input({
        model: model({ provider: "anthropic", model: "claude-fixture" }),
        apiKey: "sk-ant-api03-MOCK_CANARY",
      }),
      fake,
    );
    expect(fake.mock.calls[0][0]).toBe("https://api.anthropic.com/v1/messages");
    expect(fake.mock.calls[0][1]?.headers).toMatchObject({
      "x-api-key": "sk-ant-api03-MOCK_CANARY",
      "anthropic-version": "2026-10-21",
    });
    expect(JSON.parse(String(fake.mock.calls[0][1]?.body))).toMatchObject({
      system: "Be factual.",
      messages: [{ role: "user", content: "Synthetic test question" }],
      max_tokens: 128,
      stream: false,
    });
    expect(result.usage).toEqual({
      prompt_tokens: 27,
      completion_tokens: 10,
      total_tokens: 37,
    });
    const denied = transport(json(completion()));
    await expect(
      callAiRouterProvider(
        input({
          model: model({ provider: "anthropic", model: "claude-fixture" }),
          apiKey: "sk-ant-oat01-MOCK_SUBSCRIPTION_TOKEN",
        }),
        denied,
      ),
    ).rejects.toMatchObject({ code: "invalid_credentials" });
    expect(denied).not.toHaveBeenCalled();
  });

  it("passes a bounded validated inline image without fetching an image URL", async () => {
    const url = pngUrl();
    const fake = transport(
      json({
        modelVersion: "gemini-fixture",
        candidates: [
          {
            finishReason: "STOP",
            content: { parts: [{ text: "Synthetic image draft" }] },
          },
        ],
      }),
    );
    await callAiRouterProvider(
      input({
        model: model({
          provider: "gemini",
          model: "gemini-fixture",
          capabilities: ["text", "vision"],
        }),
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Review this synthetic image" },
              { type: "image_url", image_url: { url } },
            ],
          },
        ],
      }),
      fake,
    );
    const body = JSON.parse(String(fake.mock.calls[0][1]?.body));
    expect(body.contents[0].parts[1].inlineData).toMatchObject({
      mimeType: "image/png",
      data: url.split(",")[1],
    });
    expect(fake).toHaveBeenCalledOnce();
  });

  it.each([
    "https://private.example/image.png",
    "http://127.0.0.1/admin",
    "file:///secret",
    "data:image/svg+xml;base64,AAAA",
    "data:image/png;base64,bm90LWEtcG5n",
  ])(
    "rejects remote or invalid image source %s before any request",
    async (url) => {
      const fake = transport(json(completion()));
      await expect(
        callAiRouterProvider(
          input({
            model: model({ capabilities: ["text", "vision"] }),
            messages: [
              {
                role: "user",
                content: [{ type: "image_url", image_url: { url } }],
              },
            ],
          }),
          fake,
        ),
      ).rejects.toMatchObject({ code: "invalid_request" });
      expect(fake).not.toHaveBeenCalled();
    },
  );

  it("keeps image count, dimensions and actual model capability bounded", async () => {
    const part = { type: "image_url" as const, image_url: { url: pngUrl() } };
    expect(() =>
      normalizeRouterProviderMessages([
        { role: "user", content: [part, part] },
      ]),
    ).toThrow(RouterProviderError);
    const big = Buffer.alloc(32);
    Buffer.from("89504e470d0a1a0a", "hex").copy(big);
    big.writeUInt32BE(4097, 16);
    big.writeUInt32BE(32, 20);
    expect(() =>
      normalizeRouterProviderMessages([
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: "data:image/png;base64," + big.toString("base64"),
              },
            },
          ],
        },
      ]),
    ).toThrow(RouterProviderError);
    const fake = transport(json(completion()));
    await expect(
      callAiRouterProvider(
        input({ messages: [{ role: "user", content: [part] }] }),
        fake,
      ),
    ).rejects.toMatchObject({ code: "unsupported_capability" });
    expect(fake).not.toHaveBeenCalled();
  });

  it.each(
    [
      [],
      [{ role: "tool", content: "hidden tool call" }],
      [{ role: "user", content: "Question", tools: [{ type: "web_search" }] }],
      [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Question",
              baseUrl: "https://untrusted.example",
            },
          ],
        },
      ],
      [
        { role: "user", content: "Question" },
        { role: "system", content: "Late elevated authority" },
      ],
      [
        { role: "user", content: "Question" },
        { role: "assistant", content: "Incomplete prefill" },
      ],
      [{ role: "user", content: "x".repeat(65_537) }],
    ].map((messages) => ({ messages })),
  )(
    "rejects unsupported message structure before external I/O",
    async ({ messages }) => {
      const fake = transport(json(completion()));
      await expect(
        callAiRouterProvider(
          input({ messages: messages as RouterProviderMessage[] }),
          fake,
        ),
      ).rejects.toMatchObject({ code: "invalid_request" });
      expect(fake).not.toHaveBeenCalled();
    },
  );

  it.each([
    [401, "invalid_credentials", false, false],
    [403, "invalid_credentials", false, false],
    [429, "quota_exceeded", false, false],
    [404, "model_unavailable", true, false],
    [503, "provider_unavailable", true, false],
    [500, "invalid_response", false, true],
    [302, "invalid_response", false, true],
  ] as const)(
    "classifies HTTP %s without returning provider diagnostics or retrying",
    async (status, code, retryable, ambiguous) => {
      const fake = transport(
        new Response("PRIVATE PROVIDER DIAGNOSTIC", {
          status,
          headers: { location: "https://untrusted.example/steal" },
        }),
      );
      await expect(callAiRouterProvider(input(), fake)).rejects.toMatchObject({
        code,
        retryable,
        ambiguous,
        message: code,
      });
      expect(fake).toHaveBeenCalledOnce();
    },
  );

  it("treats network uncertainty as possibly billed and never retries it", async () => {
    const fake = vi
      .fn<typeof fetch>()
      .mockRejectedValue(
        new Error("PRIVATE PROVIDER DIAGNOSTIC MOCK_SERVER_KEY_CANARY"),
      );
    try {
      await callAiRouterProvider(input(), fake);
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({
        code: "provider_unavailable",
        retryable: false,
        ambiguous: true,
      });
      expect(String(error)).not.toContain("PRIVATE PROVIDER");
      expect(error).not.toHaveProperty("cause");
    }
    expect(fake).toHaveBeenCalledOnce();
  });

  it("distinguishes an explicit 401 authentication rejection from a 403 policy denial", async () => {
    for (const status of [401, 403]) {
      await expect(
        callAiRouterProvider(
          input(),
          transport(new Response("private denial", { status })),
        ),
      ).rejects.toMatchObject({
        code: "invalid_credentials",
        httpStatus: status,
        retryable: false,
        ambiguous: false,
      });
    }
  });

  it.each(["length", "tool_calls", "content_filter", null])(
    "rejects incomplete or unsupported completion reason %s",
    async (finish_reason) => {
      await expect(
        callAiRouterProvider(
          input(),
          transport(
            json(
              completion({
                choices: [
                  {
                    finish_reason,
                    message: {
                      role: "assistant",
                      content: "Incomplete answer",
                    },
                  },
                ],
              }),
            ),
          ),
        ),
      ).rejects.toMatchObject({
        code: "invalid_response",
        retryable: false,
        ambiguous: true,
      });
    },
  );

  it("rejects tool requests even when a provider claims ordinary completion", async () => {
    const choices = [
      {
        finish_reason: "stop",
        message: {
          role: "assistant",
          content: "answer",
          tool_calls: [{ name: "delete_all" }],
        },
      },
    ];
    await expect(
      callAiRouterProvider(input(), transport(json(completion({ choices })))),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("uses unknown usage conservatively and rejects malformed observed accounting", async () => {
    const result = await callAiRouterProvider(
      input(),
      transport(json(completion({ usage: undefined }))),
    );
    expect(result.usage).toBeUndefined();
    expect(result.reportedCostMicros).toBeNull();
    for (const usage of [
      { prompt_tokens: 30, completion_tokens: 10, total_tokens: 20 },
      { prompt_tokens: -1 },
      { cost: -1 },
      { cost: "0" },
    ])
      await expect(
        callAiRouterProvider(input(), transport(json(completion({ usage })))),
      ).rejects.toMatchObject({ code: "invalid_response", ambiguous: true });
  });

  it("bounds response size before parsing and cancels an oversized stream", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(256 * 1024 + 1));
      },
      cancel() {
        cancelled = true;
      },
    });
    await expect(
      callAiRouterProvider(
        input(),
        transport(
          new Response(stream, {
            headers: { "content-type": "application/json" },
          }),
        ),
      ),
    ).rejects.toMatchObject({ code: "invalid_response", ambiguous: true });
    expect(cancelled).toBe(true);
    await expect(
      callAiRouterProvider(
        input(),
        transport(
          new Response("{}", {
            headers: {
              "content-type": "application/json",
              "content-length": "262145",
            },
          }),
        ),
      ),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("rejects HTML and malformed JSON without exposing their contents", async () => {
    for (const response of [
      new Response("PRIVATE HTML DIAGNOSTIC", {
        headers: { "content-type": "text/html" },
      }),
      new Response("PRIVATE JSON DIAGNOSTIC {", {
        headers: { "content-type": "application/json" },
      }),
    ]) {
      try {
        await callAiRouterProvider(input(), transport(response));
        expect.unreachable();
      } catch (error) {
        expect(error).toMatchObject({
          code: "invalid_response",
          ambiguous: true,
        });
        expect(String(error)).not.toContain("PRIVATE");
      }
    }
  });

  it("honors cancellation before a request and while reading its body", async () => {
    const stopped = new AbortController();
    stopped.abort();
    const unused = transport(json(completion()));
    await expect(
      callAiRouterProvider(input({ signal: stopped.signal }), unused),
    ).rejects.toMatchObject({ code: "cancelled", ambiguous: false });
    expect(unused).not.toHaveBeenCalled();
    let reading!: () => void;
    const ready = new Promise<void>((resolve) => {
      reading = resolve;
    });
    const controller = new AbortController();
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull() {
          reading();
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    const active = callAiRouterProvider(
      input({ signal: controller.signal }),
      transport(
        new Response(stream, {
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    await ready;
    await Promise.resolve();
    controller.abort();
    await expect(active).rejects.toMatchObject({
      code: "cancelled",
      retryable: false,
      ambiguous: true,
    });
    expect(cancelled).toBe(true);
  });
});
