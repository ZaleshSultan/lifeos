import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiBudgetReservation, AiBudgetStore } from "@lifeos/core";
import {
  AiGovernor,
  AiGovernorError,
  createAiGovernor,
  estimateAiInputTokens,
  governedOpenRouterFetch,
  readAiGovernorConfig,
  type AiGovernorConfig,
} from "./ai-governor.js";
function fixture(overrides: Partial<AiGovernorConfig> = {}) {
  const rows = new Map<string, AiBudgetReservation>();
  const store: AiBudgetStore = {
    reserve: vi.fn(async (input) => {
      const key = input.userId + ":" + input.requestId;
      if (rows.has(key)) return "duplicate";
      const all = [...rows.values()],
        owned = all.filter((r) => r.userId === input.userId),
        feature = owned.filter((r) => r.feature === input.feature);
      if (
        owned.filter((r) => r.taskId === input.taskId).length >=
        input.limits.maxIterations
      )
        return "iteration_limit";
      const sum = (x: AiBudgetReservation[]) =>
        x.reduce((n, r) => n + r.reservedTokens, 0);
      if (
        sum(all) + input.reservedTokens > input.limits.globalTokens ||
        sum(owned) + input.reservedTokens > input.limits.userTokens ||
        sum(feature) + input.reservedTokens > input.limits.featureTokens
      )
        return "token_budget_exceeded";
      rows.set(key, input);
      return "reserved";
    }),
    finish: vi.fn(async () => undefined),
  };
  const config = { ...readAiGovernorConfig({}), ...overrides };
  const governor = new AiGovernor({ store, config });
  return { rows, store, config, governor };
}
const request = {
  userId: "owner",
  feature: "chat" as const,
  estimatedInputTokens: 100,
  maxOutputTokens: 20,
  requestId: "request-a",
};
afterEach(() => {
  vi.useRealTimers();
});
describe("durable AI execution boundary", () => {
  it("reserves before execution and stores only bounded accounting metadata", async () => {
    const f = fixture();
    const operation = vi.fn(async () => ({
      answer: "safe",
      usage: { total_tokens: 110, completion_tokens: 10 },
    }));
    const result = await f.governor.run(request, operation);
    expect(result.value.answer).toBe("safe");
    expect(result.receipt.reservedTokens).toBe(120);
    expect(result.receipt.estimatedCostMicros).toBeNull();
    expect(result.receipt.reportedTokens).toBe(110);
    expect(f.store.reserve).toHaveBeenCalledBefore(operation);
    expect(f.store.finish).toHaveBeenCalledWith(
      {
        userId: "owner",
        requestId: "request-a",
        state: "completed",
        reportedTokens: 110,
      },
      expect.any(AbortSignal),
    );
    expect(JSON.stringify([...f.rows.values()])).not.toContain("safe");
  });
  it("fails closed without durable accounting or when the store errors", async () => {
    const op = vi.fn(async () => "never");
    await expect(
      createAiGovernor({ source: {} }).run(request, op),
    ).rejects.toMatchObject({ code: "ai_budget_unavailable" });
    const f = fixture();
    vi.mocked(f.store.reserve).mockRejectedValue(
      new Error("private-credential"),
    );
    await expect(f.governor.run(request, op)).rejects.toMatchObject({
      code: "ai_budget_unavailable",
    });
    expect(op).not.toHaveBeenCalled();
    expect(JSON.stringify(f.governor.status())).not.toContain("private");
  });
  it("idempotency survives governor recreation and isolates owners", async () => {
    const f = fixture();
    const op = vi.fn(async () => "one");
    await f.governor.run(request, op);
    const next = new AiGovernor({ store: f.store, config: f.config });
    await expect(next.run(request, op)).rejects.toMatchObject({
      code: "ai_duplicate_request",
    });
    await next.run({ ...request, userId: "other-owner" }, op);
    expect(op).toHaveBeenCalledTimes(2);
  });
  it("halts recursive jobs even when each iteration gets a new request id", async () => {
    const f = fixture({
      ...readAiGovernorConfig({}),
      limits: { ...readAiGovernorConfig({}).limits, maxIterations: 2 },
    });
    const op = vi.fn(async () => "one");
    await f.governor.run(
      { ...request, taskId: "same-task", requestId: "step1" },
      op,
    );
    await f.governor.run(
      { ...request, taskId: "same-task", requestId: "step2" },
      op,
    );
    await expect(
      f.governor.run(
        { ...request, taskId: "same-task", requestId: "step3" },
        op,
      ),
    ).rejects.toMatchObject({ code: "ai_iteration_limit" });
    expect(op).toHaveBeenCalledTimes(2);
  });
  it("enforces global, owner and feature token reservations across calls", async () => {
    const base = readAiGovernorConfig({});
    const f = fixture({
      limits: {
        ...base.limits,
        userTokens: 200,
        featureTokens: 200,
        globalTokens: 200,
      },
    });
    const op = vi.fn(async () => "one");
    await f.governor.run(request, op);
    await expect(
      f.governor.run(
        { ...request, userId: "other", requestId: "request-b" },
        op,
      ),
    ).rejects.toMatchObject({ code: "ai_token_budget_exceeded" });
    expect(op).toHaveBeenCalledTimes(1);
  });
  it("does not execute when a configured cost cap has unknown pricing", async () => {
    const base = readAiGovernorConfig({});
    const f = fixture({ limits: { ...base.limits, userCostMicros: 1000 } });
    const op = vi.fn(async () => "no");
    await expect(f.governor.run(request, op)).rejects.toMatchObject({
      code: "ai_pricing_unconfigured",
    });
    expect(f.store.reserve).not.toHaveBeenCalled();
    expect(op).not.toHaveBeenCalled();
  });
  it("labels configured rate-based costs as estimates", async () => {
    const f = fixture({
      inputCostMicrosPer1k: 100,
      outputCostMicrosPer1k: 200,
    });
    expect(
      (await f.governor.run(request, async () => "ok")).receipt
        .estimatedCostMicros,
    ).toBe(14);
  });
  it("rejects output metering above the reservation and keeps its full charge", async () => {
    const f = fixture();
    await expect(
      f.governor.run(request, async () => ({
        usage: { total_tokens: 500, completion_tokens: 40 },
      })),
    ).rejects.toMatchObject({ code: "ai_output_budget_exceeded" });
    expect(f.rows.size).toBe(1);
    expect(f.store.finish).toHaveBeenCalledWith(
      expect.objectContaining({ reportedTokens: 500, state: "failed" }),
      expect.any(AbortSignal),
    );
  });
  it("retains the concurrency slot when an aborted provider ignores cancellation", async () => {
    vi.useFakeTimers();
    const f = fixture({ timeoutMs: 100, maxConcurrent: 1 });
    let finish: (v: string) => void = () => undefined;
    const op = vi.fn(
      () =>
        new Promise<string>((r) => {
          finish = r;
        }),
    );
    const pending = f.governor.run(request, op);
    const assertion = expect(pending).rejects.toMatchObject({
      code: "ai_timeout",
    });
    await vi.advanceTimersByTimeAsync(101);
    await assertion;
    expect(f.governor.status().active).toBe(1);
    await expect(
      f.governor.run({ ...request, requestId: "other" }, async () => "no"),
    ).rejects.toMatchObject({ code: "ai_concurrency_limit" });
    finish("settled");
    await Promise.resolve();
    await Promise.resolve();
    expect(f.governor.status().active).toBe(0);
  });
  it.each([10, 1000])(
    "allows a shorter caller deadline and never extends the global one (%s ms)",
    async (timeoutMs) => {
      vi.useFakeTimers();
      const f = fixture({ timeoutMs: 100 });
      const pending = f.governor.run(
        { ...request, timeoutMs },
        (signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () =>
              reject(new Error("aborted")),
            );
          }),
      );
      const assertion = expect(pending).rejects.toMatchObject({
        code: "ai_timeout",
      });
      await vi.advanceTimersByTimeAsync(Math.min(timeoutMs, 100));
      await assertion;
    },
  );
  it.each([0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects an invalid caller deadline before reservation (%s)",
    async (timeoutMs) => {
      const f = fixture();
      await expect(
        f.governor.run({ ...request, timeoutMs }, async () => "no"),
      ).rejects.toMatchObject({ code: "ai_invalid_execution" });
      expect(f.store.reserve).not.toHaveBeenCalled();
    },
  );
  it("cancels caller signals and emergency shutdown without retries", async () => {
    const f = fixture();
    const controller = new AbortController();
    controller.abort();
    const op = vi.fn(async () => "no");
    await expect(
      f.governor.run({ ...request, signal: controller.signal }, op),
    ).rejects.toMatchObject({ code: "ai_cancelled" });
    f.governor.shutdown();
    await expect(f.governor.run(request, op)).rejects.toMatchObject({
      code: "ai_shutdown",
    });
    expect(op).not.toHaveBeenCalled();
  });
  it("opens the circuit after bounded provider failures and never retries automatically", async () => {
    const f = fixture({ failureThreshold: 2 });
    const op = vi.fn(async () => {
      throw new Error("raw private-provider-body");
    });
    for (let i = 0; i < 2; i++)
      await expect(
        f.governor.run({ ...request, requestId: `failed${i}` }, op),
      ).rejects.toBeInstanceOf(AiGovernorError);
    await expect(
      f.governor.run({ ...request, requestId: "blocked" }, op),
    ).rejects.toMatchObject({ code: "ai_circuit_open" });
    expect(op).toHaveBeenCalledTimes(2);
    expect(f.governor.status().automaticRetries).toBe(0);
  });
  it("cancels an in-flight request and leaves a conservative durable receipt", async () => {
    const f = fixture();
    const controller = new AbortController();
    const promise = f.governor.run(
      { ...request, signal: controller.signal },
      (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new Error("cancelled")),
            { once: true },
          );
        }),
    );
    const assertion = expect(promise).rejects.toMatchObject({
      code: "ai_cancelled",
    });
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    await assertion;
    expect(f.rows.size).toBe(1);
    expect(f.store.finish).toHaveBeenCalledWith(
      expect.objectContaining({ state: "cancelled" }),
      expect.any(AbortSignal),
    );
  });
  it("handles partial provider metering without inventing total usage", async () => {
    const f = fixture();
    const result = await f.governor.run(request, async () => ({
      usage: { completion_tokens: 10 },
    }));
    expect(result.receipt.reportedTokens).toBeNull();
    expect(result.receipt.reservedTokens).toBe(120);
    expect(
      readAiGovernorConfig({
        LIFEOS_AI_ESTIMATED_INPUT_MICROS_PER_1K: "",
        LIFEOS_AI_ESTIMATED_OUTPUT_MICROS_PER_1K: "",
      }).inputCostMicrosPer1k,
    ).toBeNull();
  });
  it("invalid optional config turns external execution off without crashing core", () => {
    expect(
      createAiGovernor({
        source: { LIFEOS_AI_EXECUTION_TIMEOUT_MS: "private-invalid" },
      }).status().killSwitch,
    ).toBe(true);
    expect(() =>
      readAiGovernorConfig({ LIFEOS_AI_USER_DAILY_TOKENS: "0" }),
    ).toThrow();
    expect(estimateAiInputTokens("ж")).toBe(2);
  });
});
describe("owned OpenRouter transport", () => {
  it("allows only the fixed endpoint, caps output, validates metering and preserves response", async () => {
    const f = fixture();
    const http = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [],
          usage: { total_tokens: 50, completion_tokens: 2 },
        }),
        { headers: { "content-type": "application/json" } },
      ),
    );
    const transport = governedOpenRouterFetch(
      f.governor,
      "owner",
      "finance",
      http,
    );
    const response = await transport(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        body: JSON.stringify({
          model: "test",
          messages: [],
          max_tokens: 999999,
        }),
      },
    );
    expect(response.ok).toBe(true);
    expect((await response.json()).usage.completion_tokens).toBe(2);
    expect(JSON.parse(http.mock.calls[0][1]!.body as string).max_tokens).toBe(
      2048,
    );
    expect(http.mock.calls[0][1]!.redirect).toBe("error");
    expect(f.store.reserve).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "owner", feature: "finance" }),
      expect.any(AbortSignal),
    );
    await expect(
      transport("https://evil.example/api", { method: "POST", body: "{}" }),
    ).rejects.toMatchObject({ code: "ai_invalid_execution" });
    expect(http).toHaveBeenCalledTimes(1);
  });
  it("uses no unguarded fallback fetch and rejects large or partial responses", async () => {
    const http = vi.fn<typeof fetch>();
    const transport = governedOpenRouterFetch(
      undefined,
      "owner",
      "finance",
      http,
    );
    await expect(
      transport("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        body: "{}",
      }),
    ).rejects.toMatchObject({ code: "ai_budget_unavailable" });
    expect(http).not.toHaveBeenCalled();
    const f = fixture();
    http.mockResolvedValue(new Response("x".repeat(256 * 1024 + 1)));
    await expect(
      governedOpenRouterFetch(
        f.governor,
        "owner",
        "finance",
        http,
      )("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        body: "{}",
      }),
    ).rejects.toMatchObject({ code: "ai_output_budget_exceeded" });
  });
});

describe("router extensions preserve the single governor", () => {
  it("a catalog estimate cannot lower operator pricing and owner caps only tighten", async () => {
    const base = readAiGovernorConfig({});
    const f = fixture({
      ...base,
      inputCostMicrosPer1k: 10,
      outputCostMicrosPer1k: 20,
      limits: { ...base.limits, userCostMicros: 500 },
    });
    const result = await f.governor.run(
      {
        ...request,
        estimatedCostMicros: 1,
        maxUserDailyCostMicros: 100,
        maxRequestCostMicros: 10,
      },
      async () => ({ usage: { total_tokens: 110, completion_tokens: 10 } }),
    );
    expect(result.receipt.estimatedCostMicros).toBe(2);
    expect(f.store.reserve).toHaveBeenCalledWith(
      expect.objectContaining({
        estimatedCostMicros: 2,
        limits: expect.objectContaining({ userCostMicros: 100 }),
      }),
      expect.any(AbortSignal),
    );
  });
  it("blocks a configured price floor beyond the request ceiling before any reservation or provider", async () => {
    const f = fixture({
      inputCostMicrosPer1k: 1000,
      outputCostMicrosPer1k: 1000,
    });
    const operation = vi.fn(async () => ({}));
    await expect(
      f.governor.run(
        { ...request, estimatedCostMicros: 0, maxRequestCostMicros: 1 },
        operation,
      ),
    ).rejects.toMatchObject({ code: "ai_cost_budget_exceeded" });
    expect(f.store.reserve).not.toHaveBeenCalled();
    expect(operation).not.toHaveBeenCalled();
  });
  it("reserves routed metadata before work and finishes with actual served-model metadata", async () => {
    const f = fixture();
    const routing = {
      version: 1 as const,
      provider: "openrouter" as const,
      model: "vendor/first",
      selectedModelId: "first",
      credentialLabel: "project",
      billing: "api" as const,
      attempts: 1,
      fallback: false,
      inputTokens: null,
      outputTokens: null,
      reportedCostMicros: null,
      costSource: "unknown" as const,
    };
    const actual = {
      ...routing,
      model: "vendor/second",
      selectedModelId: "second",
      fallback: true,
      inputTokens: 100,
      outputTokens: 10,
      reportedCostMicros: 2,
      costSource: "provider_reported" as const,
    };
    await f.governor.run(
      { ...request, estimatedCostMicros: 5, maxRequestCostMicros: 10, routing },
      async () => ({
        routing: actual,
        usage: { total_tokens: 110, completion_tokens: 10 },
      }),
    );
    expect(f.store.reserve).toHaveBeenCalledWith(
      expect.objectContaining({ routing }),
      expect.any(AbortSignal),
    );
    expect(f.store.finish).toHaveBeenCalledWith(
      expect.objectContaining({
        routing: actual,
        state: "completed",
        reportedTokens: 110,
      }),
      expect.any(AbortSignal),
    );
  });
});
