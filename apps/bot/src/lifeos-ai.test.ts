import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createConfiguredLifeosAiService,
  createLifeosAiService,
  LifeosAiError,
  readLifeosAiConfig,
  type LifeosAiClient,
  type LifeosAiConfig,
} from "./lifeos-ai.js";

const messages = [
  { role: "user" as const, text: "What should I focus on today?" },
];
const context = {
  tasks: [{ id: "task-1", title: "Finish report" }],
  availability: [],
};
const reply = {
  answer: "Finish the report; no due date is provided.",
  suggestions: [],
};

function fixture(overrides: Partial<LifeosAiConfig> = {}) {
  const config = {
    ...readLifeosAiConfig({
      LIFEOS_AI_ENABLED: "true",
      GEMINI_API_KEY: "secret-test-key",
    }),
    ...overrides,
  };
  const get = vi.fn<LifeosAiClient["models"]["get"]>().mockResolvedValue({
    name: "models/gemini-3.8-flash",
    supportedActions: ["generateContent"],
  });
  const generateContent = vi
    .fn<LifeosAiClient["models"]["generateContent"]>()
    .mockResolvedValue({ text: JSON.stringify(reply) });
  const client = { models: { get, generateContent } };
  let timestamp = Date.parse("2026-10-10T09:00:00Z");
  return {
    config,
    client,
    get,
    generateContent,
    service: createLifeosAiService(config, { client, now: () => timestamp }),
    advance: (ms: number) => {
      timestamp += ms;
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("LifeOS Gemini configuration", () => {
  it("is disabled by default and separates configurable text and Live models", () => {
    expect(readLifeosAiConfig({})).toMatchObject({
      enabled: false,
      apiKey: undefined,
      textModel: "gemini-3.8-flash",
      liveModel: "gemini-3.1-flash-live-preview",
      liveEnabled: false,
    });
    expect(
      readLifeosAiConfig({
        LIFEOS_AI_LIVE_MODEL: "gemini-3.8-live",
        LIFEOS_AI_TEXT_MODEL: "gemini-custom-flash",
      }),
    ).toMatchObject({
      liveModel: "gemini-3.8-live",
      textModel: "gemini-custom-flash",
    });
  });

  it.each(["0", "-1", "20oops", "60001", "1.5"])(
    "rejects invalid timeout configuration %s",
    (value) => {
      expect(() => readLifeosAiConfig({ LIFEOS_AI_TIMEOUT_MS: value })).toThrow(
        "Invalid environment variable",
      );
    },
  );

  it.each(["true", "false", undefined])(
    "keeps malformed optional configuration inert without blocking startup (enabled=%s)",
    async (enabled) => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const errorSpy = vi.spyOn(console, "error");
      const warnSpy = vi.spyOn(console, "warn");
      const service = createConfiguredLifeosAiService({
        LIFEOS_AI_ENABLED: enabled,
        GEMINI_API_KEY: "secret-test-key",
        LIFEOS_AI_TIMEOUT_MS: "not-a-timeout",
        LIFEOS_AI_LIVE_ENABLED: "true",
      });
      expect(service.status()).toMatchObject({
        enabled: false,
        available: false,
        live: { configured: false, available: false },
      });
      await expect(
        service.ask("user-a", messages, context),
      ).rejects.toMatchObject({ code: "ai_disabled" });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
    },
  );

  it("disables malformed optional usage limits while preserving the strict loader", () => {
    const source = {
      LIFEOS_AI_ENABLED: "true",
      GEMINI_API_KEY: "secret-test-key",
      LIFEOS_AI_REQUESTS_PER_DAY: "-5",
    };
    expect(() => readLifeosAiConfig(source)).toThrow(
      "Invalid environment variable",
    );
    expect(createConfiguredLifeosAiService(source).status()).toMatchObject({
      enabled: false,
      available: false,
    });
  });

  it("preserves valid configured choices without contacting the provider during startup", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const service = createConfiguredLifeosAiService({
      LIFEOS_AI_ENABLED: "true",
      GEMINI_API_KEY: "secret-test-key",
      LIFEOS_AI_TEXT_MODEL: "gemini-custom-flash",
      LIFEOS_AI_LIVE_MODEL: "gemini-3.8-live",
    });
    expect(service.status()).toMatchObject({
      enabled: true,
      available: true,
      textModel: "gemini-custom-flash",
      live: { model: "gemini-3.8-live", available: false },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps missing credentials optional when constructing the feature", async () => {
    const { service, get, generateContent } = fixture({ apiKey: undefined });
    expect(service.status()).toMatchObject({ enabled: true, available: false });
    await expect(
      service.ask("user-a", messages, context),
    ).rejects.toMatchObject({
      code: "ai_missing_credentials",
      statusCode: 503,
    });
    expect(get).not.toHaveBeenCalled();
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("never calls Google while disabled, even if a key is configured", async () => {
    const { service, get, generateContent } = fixture({ enabled: false });
    await expect(
      service.ask("user-a", messages, context),
    ).rejects.toMatchObject({ code: "ai_disabled" });
    expect(get).not.toHaveBeenCalled();
    expect(generateContent).not.toHaveBeenCalled();
    expect(JSON.stringify(service.status())).not.toContain("secret-test-key");
  });

  it("Live flags prepare configuration without enabling a Live endpoint", () => {
    const { service } = fixture({
      liveEnabled: true,
      liveModel: "gemini-3.8-live",
    });
    expect(service.status().live).toEqual({
      configured: true,
      model: "gemini-3.8-live",
      available: false,
    });
  });
});

describe("LifeOS Gemini text service", () => {
  it("verifies actual account capability before sending minimal context without user identity or credentials", async () => {
    const { service, get, generateContent, config } = fixture();
    await expect(
      service.ask("private-user-id", messages, context),
    ).resolves.toEqual({ ...reply, provider: "gemini" });
    expect(get.mock.invocationCallOrder[0]).toBeLessThan(
      generateContent.mock.invocationCallOrder[0],
    );
    expect(get).toHaveBeenCalledWith(
      expect.objectContaining({
        model: config.textModel,
        config: expect.objectContaining({
          abortSignal: expect.any(AbortSignal),
        }),
      }),
    );
    const call = generateContent.mock.calls[0][0];
    expect(call).toMatchObject({
      model: config.textModel,
      config: {
        responseMimeType: "application/json",
        maxOutputTokens: 2048,
        httpOptions: { retryOptions: { attempts: 1 } },
      },
    });
    expect(call.config?.tools).toBeUndefined();
    expect(call.config?.cachedContent).toBeUndefined();
    expect(JSON.stringify(call)).toContain("Finish report");
    expect(JSON.stringify(call)).not.toContain("private-user-id");
    expect(JSON.stringify(call)).not.toContain("secret-test-key");
  });

  it("keeps each user's request context separate and stores no chat sessions", async () => {
    const { service, generateContent } = fixture();
    await service.ask("user-a", messages, { tasks: [{ title: "private A" }] });
    await service.ask("user-b", [{ role: "user", text: "My tasks?" }], {
      tasks: [{ title: "private B" }],
    });
    const second = JSON.stringify(generateContent.mock.calls[1]);
    expect(second).toContain("private B");
    expect(second).not.toContain("private A");
    expect(second).not.toContain(messages[0].text);
  });

  it("caches one account capability result for ten minutes and refreshes on expiry", async () => {
    const { service, get, advance } = fixture();
    await service.ask("user-a", messages, context);
    await service.ask("user-a", messages, context);
    expect(get).toHaveBeenCalledTimes(1);
    advance(10 * 60_000);
    await service.ask("user-a", messages, context);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it.each([
    "gemini-3.1-flash-live-preview",
    "gemini-3.8-live",
    "models/gemini-3.8-live",
    "gemini-native-audio",
    "models/../gemini-3.8-flash",
    "https://elsewhere.example/model",
  ])(
    "rejects inappropriate text model %s without a provider call",
    async (textModel) => {
      const { service, get, generateContent } = fixture({ textModel });
      await expect(
        service.ask("user-a", messages, context),
      ).rejects.toMatchObject({ code: "ai_unsupported_model" });
      expect(get).not.toHaveBeenCalled();
      expect(generateContent).not.toHaveBeenCalled();
    },
  );

  it.each([
    { supportedActions: ["bidiGenerateContent"] },
    {},
    { supportedActions: ["embedContent"] },
  ])(
    "rejects unsupported account metadata %j before generation",
    async (model) => {
      const { service, get, generateContent } = fixture();
      get.mockResolvedValue(model);
      await expect(
        service.ask("user-a", messages, context),
      ).rejects.toMatchObject({ code: "ai_unsupported_model" });
      expect(generateContent).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      { status: 401, message: "secret-test-key invalid" },
      "ai_invalid_credentials",
      503,
    ],
    [
      { status: 403, message: "Access denied secret-test-key" },
      "ai_invalid_credentials",
      503,
    ],
    [
      { status: 400, message: '{"details":[{"reason":"API_KEY_INVALID"}]}' },
      "ai_invalid_credentials",
      503,
    ],
    [
      { status: 429, message: "Quota private-user-id secret-test-key" },
      "ai_quota_exceeded",
      429,
    ],
    [
      { status: 404, message: "Missing model secret-test-key" },
      "ai_unsupported_model",
      503,
    ],
    [
      { status: 400, message: "model is not supported" },
      "ai_unsupported_model",
      503,
    ],
    [
      { status: 500, message: "private context secret-test-key" },
      "ai_unavailable",
      502,
    ],
  ])(
    "maps provider failures to stable errors without exposing the provider message",
    async (failure, code, statusCode) => {
      const { service, generateContent } = fixture();
      generateContent.mockRejectedValue(failure);
      try {
        await service.ask("private-user-id", messages, context);
        expect.fail("Expected provider failure");
      } catch (error) {
        expect(error).toBeInstanceOf(LifeosAiError);
        expect(error).toMatchObject({ code, statusCode });
        const exposed = `${String(error)} ${JSON.stringify(error)}`;
        expect(exposed).not.toContain("secret-test-key");
        expect(exposed).not.toContain("private-user-id");
        expect((error as Error).cause).toBeUndefined();
      }
    },
  );

  it("does not bypass account authentication errors during capability discovery", async () => {
    const { service, get, generateContent } = fixture();
    get.mockRejectedValue({ status: 401, message: "Invalid secret-test-key" });
    await expect(
      service.ask("user-a", messages, context),
    ).rejects.toMatchObject({ code: "ai_invalid_credentials" });
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("aborts timed-out generations and releases concurrency without refunding the usage budget", async () => {
    vi.useFakeTimers();
    const { service, generateContent } = fixture({
      timeoutMs: 100,
      maxConcurrent: 1,
      requestsPerMinute: 2,
    });
    generateContent.mockImplementationOnce(() => new Promise(() => {}));
    const pending = service.ask("user-a", messages, context);
    const assertion = expect(pending).rejects.toMatchObject({
      code: "ai_timeout",
      statusCode: 504,
    });
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    expect(generateContent.mock.calls[0][0].config?.abortSignal?.aborted).toBe(
      true,
    );
    await expect(
      service.ask("user-a", messages, context),
    ).resolves.toMatchObject({ provider: "gemini" });
    await expect(
      service.ask("user-a", messages, context),
    ).rejects.toMatchObject({ code: "ai_rate_limited" });
  });

  it("bounds and aborts the capability discovery call too", async () => {
    vi.useFakeTimers();
    const { service, get, generateContent } = fixture({ timeoutMs: 100 });
    get.mockImplementationOnce(() => new Promise(() => {}));
    const pending = service.ask("user-a", messages, context);
    const assertion = expect(pending).rejects.toMatchObject({
      code: "ai_timeout",
    });
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    expect(get.mock.calls[0][0].config?.abortSignal?.aborted).toBe(true);
    expect(generateContent).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    "not json",
    "```json\n{}\n```",
    JSON.stringify({ answer: "", suggestions: [] }),
    JSON.stringify({
      answer: "Schedule coursework at 07:00 during class.",
      suggestions: [],
    }),
    JSON.stringify({ answer: "Start work at 7 pm.", suggestions: [] }),
    JSON.stringify({ answer: "Study at seven.", suggestions: [] }),
    JSON.stringify({ answer: "Done", suggestions: [], executed: true }),
    JSON.stringify({
      answer: "Done",
      suggestions: [
        { taskId: "task-1", startsAt: "tomorrow", endsAt: "later" },
      ],
    }),
    JSON.stringify({
      answer: "Done",
      suggestions: [
        {
          taskId: "task-1",
          startsAt: "2026-10-10T10:00:00",
          endsAt: "2026-10-10T11:00:00",
        },
      ],
    }),
    JSON.stringify({
      answer: "Done",
      suggestions: [
        {
          taskId: "task-1",
          startsAt: "2026-10-10T11:00:00Z",
          endsAt: "2026-10-10T10:00:00Z",
        },
      ],
    }),
    JSON.stringify({
      answer: "Done",
      suggestions: Array(21).fill({
        taskId: "task-1",
        startsAt: "2026-10-10T10:00:00Z",
        endsAt: "2026-10-10T11:00:00Z",
      }),
    }),
  ])("rejects malformed or unsupported structured output", async (text) => {
    const { service, generateContent } = fixture();
    generateContent.mockResolvedValue({ text });
    await expect(
      service.ask("user-a", messages, context),
    ).rejects.toMatchObject({ code: "ai_invalid_response" });
  });

  it("rejects truncated or blocked output even if a JSON prefix parses", async () => {
    const { service, generateContent } = fixture();
    generateContent.mockResolvedValue({
      text: JSON.stringify(reply),
      candidates: [{ finishReason: "MAX_TOKENS" as never }],
    });
    await expect(
      service.ask("user-a", messages, context),
    ).rejects.toMatchObject({ code: "ai_invalid_response" });
  });

  it("reads SDK candidates without invoking its warning-producing convenience getter", async () => {
    const { service, generateContent } = fixture();
    const textGetter = vi.fn(() => {
      throw new Error("Must not read convenience getter");
    });
    const response = {
      candidates: [
        {
          content: {
            parts: [
              { text: "Private reasoning", thought: true },
              { text: JSON.stringify(reply) },
            ],
          },
        },
      ],
      get text(): string {
        return textGetter();
      },
    };
    generateContent.mockResolvedValue(response);
    await expect(service.ask("user-a", messages, context)).resolves.toEqual({
      ...reply,
      provider: "gemini",
    });
    expect(textGetter).not.toHaveBeenCalled();
    generateContent.mockResolvedValue({
      text: undefined,
      candidates: [
        { content: { parts: [{ executableCode: { code: "untrusted" } }] } },
      ],
    });
    await expect(
      service.ask("user-a", messages, context),
    ).rejects.toMatchObject({ code: "ai_invalid_response" });
  });

  it("returns typed proposals for the deterministic boundary to validate, without executing them", async () => {
    const { service, generateContent } = fixture();
    const suggestions = [
      {
        taskId: "task-1",
        startsAt: "2026-10-10T10:00:00+05:00",
        endsAt: "2026-10-10T11:00:00+05:00",
      },
    ];
    generateContent.mockResolvedValue({
      text: JSON.stringify({ answer: "Consider this time.", suggestions }),
    });
    await expect(service.ask("user-a", messages, context)).resolves.toEqual({
      answer: "Consider this time.",
      suggestions,
      provider: "gemini",
    });
  });

  it("rejects oversized context and chat before contacting Google", async () => {
    const { service, get } = fixture({ maxContextChars: 100 });
    await expect(
      service.ask("user-a", messages, { text: "a".repeat(101) }),
    ).rejects.toMatchObject({ code: "ai_invalid_request" });
    await expect(
      service.ask("user-a", [{ role: "user", text: "a".repeat(2001) }], {}),
    ).rejects.toMatchObject({ code: "ai_invalid_request" });
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await expect(
      service.ask("user-a", messages, circular),
    ).rejects.toMatchObject({ code: "ai_invalid_request" });
    expect(get).not.toHaveBeenCalled();
  });
});

describe("LifeOS Gemini usage limits", () => {
  it("limits each user per minute independently and refreshes only the minute budget", async () => {
    const { service, advance } = fixture({
      requestsPerMinute: 1,
      requestsPerDay: 2,
    });
    await service.ask("user-a", messages, context);
    await expect(
      service.ask("user-a", messages, context),
    ).rejects.toMatchObject({ code: "ai_rate_limited" });
    await service.ask("user-b", messages, context);
    advance(60_000);
    await service.ask("user-a", messages, context);
    advance(60_000);
    await expect(
      service.ask("user-a", messages, context),
    ).rejects.toMatchObject({ code: "ai_rate_limited" });
  });

  it("limits global daily usage and resets on the next UTC day", async () => {
    const { service, advance, generateContent } = fixture({
      globalRequestsPerDay: 2,
    });
    await service.ask("user-a", messages, context);
    await service.ask("user-b", messages, context);
    await expect(
      service.ask("user-c", messages, context),
    ).rejects.toMatchObject({ code: "ai_rate_limited" });
    expect(generateContent).toHaveBeenCalledTimes(2);
    advance(86_400_000);
    await service.ask("user-c", messages, context);
  });

  it("bounds remembered user counters without evicting active daily quotas", async () => {
    const { service, advance } = fixture({
      maxTrackedUsers: 1,
      requestsPerDay: 1,
    });
    await service.ask("user-a", messages, context);
    await expect(
      service.ask("user-b", messages, context),
    ).rejects.toMatchObject({ code: "ai_rate_limited" });
    await expect(
      service.ask("user-a", messages, context),
    ).rejects.toMatchObject({ code: "ai_rate_limited" });
    advance(86_400_000);
    await service.ask("user-b", messages, context);
  });

  it("rejects excess concurrent requests before issuing another provider call", async () => {
    const { service, generateContent } = fixture({ maxConcurrent: 1 });
    let finish: (value: { text: string }) => void = () => {};
    generateContent.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = service.ask("user-a", messages, context);
    await vi.waitFor(() => expect(generateContent).toHaveBeenCalledTimes(1));
    await expect(
      service.ask("user-b", messages, context),
    ).rejects.toMatchObject({ code: "ai_rate_limited" });
    finish({ text: JSON.stringify(reply) });
    await pending;
    await service.ask("user-b", messages, context);
    expect(generateContent).toHaveBeenCalledTimes(2);
  });
});
