import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultAiRouterSettings,
  type AiBudgetReservation,
  type AiBudgetStore,
  type AiRouterSettings,
} from "@lifeos/core";
import type { AiRouterSettingsStore } from "@lifeos/db";
import {
  AiGovernor,
  readAiGovernorConfig,
  type AiGovernorConfig,
} from "./ai-governor.js";
import {
  AiModelRouter,
  type AiRouterExecutionInput,
} from "./ai-model-router.js";
import { readAiModelRouterConfig } from "./ai-model-router-config.js";

const OWNER = "10000000-0000-4000-8000-000000000001",
  OTHER = "10000000-0000-4000-8000-000000000002";
const NOW = Date.parse("2026-11-03T12:00:00Z"),
  KEY = "sk-or-v1-synthetic-first-project",
  KEY2 = "sk-or-v1-synthetic-second-project";
const INPUT: AiRouterExecutionInput = {
  userId: OWNER,
  feature: "chat",
  task: { category: "chat", dataCategories: ["general"] },
  messages: [
    { role: "user", content: "Synthetic question never to be logged" },
  ],
  maxOutputTokens: 20,
  requestId: "request-one",
};
function completion(model = "fixture/model-a", output = 4) {
  return Response.json({
    model,
    provider: "synthetic-provider",
    choices: [
      {
        finish_reason: "stop",
        message: { role: "assistant", content: "Completed mock answer" },
      },
    ],
    usage: {
      prompt_tokens: 8,
      completion_tokens: output,
      total_tokens: 8 + output,
      cost: 0.00002,
    },
  });
}
function approved(): AiRouterSettings {
  return {
    ...defaultAiRouterSettings(),
    allowedTiers: ["deterministic", "balanced"],
    allowedProviders: ["openrouter"],
    tierModels: {
      fast: [],
      balanced: ["model-a"],
      advanced: [],
      vision: [],
      voice: [],
    },
    privacy: {
      general: ["openrouter"],
      health: [],
      finance: [],
      university: [],
    },
    spending: {
      paidCallsAuthorized: true,
      maxRequestCostMicros: 1_000_000,
      maxDailyCostMicros: 2_000_000,
    },
  };
}
function fixture(
  options: {
    modelCount?: number;
    keyCount?: number;
    settings?: AiRouterSettings;
    source?: Record<string, string>;
    governor?: Partial<AiGovernorConfig>;
  } = {},
) {
  let clock = NOW,
    reserveHook: (() => void | Promise<void>) | undefined;
  const credentials = Array.from(
    { length: options.keyCount ?? 1 },
    (_, index) => ({
      id: "key-" + index,
      provider: "openrouter",
      ownerUserId: OWNER,
      features: ["chat"],
      env: index ? "LIFEOS_OPENROUTER_KEY_SECOND" : "OPENROUTER_API_KEY",
    }),
  );
  const models = Array.from(
    { length: options.modelCount ?? 1 },
    (_, index) => ({
      id: "model-" + (index ? "b" : "a"),
      label: "Mock catalog " + index,
      provider: "openrouter",
      model: "fixture/model-" + (index ? "b" : "a"),
      tiers: ["balanced"],
      capabilities: ["text", "json"],
      billing: "api",
      inputCostMicrosPer1k: 1000,
      outputCostMicrosPer1k: 2000,
      verifiedAt: new Date(NOW).toISOString(),
      source: "https://openrouter.ai/docs/models",
      credentialIds: credentials.map((c) => c.id),
      providerOnly: ["synthetic-provider"],
      requireZdr: true,
      sort: "price",
    }),
  );
  const source = {
    LIFEOS_AI_ROUTER_ENABLED: "true",
    LIFEOS_AI_ROUTER_PAID_REQUESTS_ENABLED: "true",
    LIFEOS_AI_ROUTER_MAX_REQUEST_COST_MICROS: "1000000",
    LIFEOS_AI_ROUTER_MAX_DAILY_COST_MICROS: "2000000",
    OPENROUTER_API_KEY: KEY,
    LIFEOS_OPENROUTER_KEY_SECOND: KEY2,
    LIFEOS_AI_ROUTER_CREDENTIALS_JSON: JSON.stringify(credentials),
    LIFEOS_AI_ROUTER_MODELS_JSON: JSON.stringify(models),
    ...options.source,
  };
  const config = readAiModelRouterConfig(source, NOW);
  const settings = options.settings ?? approved();
  if (!options.settings) settings.tierModels.balanced = models.map((m) => m.id);
  const policies = new Map([
    [OWNER, { settings: structuredClone(settings), revision: 1 }],
    [OTHER, { settings: structuredClone(settings), revision: 1 }],
  ]);
  const settingsStore: AiRouterSettingsStore = {
    get: vi.fn(async (userId) =>
      structuredClone(
        policies.get(userId) ?? {
          settings: defaultAiRouterSettings(),
          revision: 0,
        },
      ),
    ),
    save: vi.fn(async (userId, value, expected) => {
      const old = policies.get(userId);
      if (!old || old.revision !== expected)
        throw new Error("mock settings conflict");
      const next = { settings: structuredClone(value), revision: expected + 1 };
      policies.set(userId, next);
      return structuredClone(next);
    }),
  };
  const rows = new Map<string, AiBudgetReservation>(),
    reservations: AiBudgetReservation[] = [],
    finishes: Parameters<AiBudgetStore["finish"]>[0][] = [];
  const budget: AiBudgetStore = {
    reserve: vi.fn(async (raw) => {
      // Real RPC arguments are immutable snapshots; do not let later routing mutation hide a bug.
      const value = structuredClone(raw);
      reservations.push(value);
      const key = value.userId + ":" + value.requestId;
      if (rows.has(key)) return "duplicate";
      const own = [...rows.values()].filter(
        (row) => row.userId === value.userId,
      );
      const cost =
        own.reduce((sum, row) => sum + (row.estimatedCostMicros ?? 0), 0) +
        (value.estimatedCostMicros ?? 0);
      if (
        value.limits.userCostMicros !== null &&
        cost > value.limits.userCostMicros
      )
        return "cost_budget_exceeded";
      if (
        own.reduce((sum, row) => sum + row.reservedTokens, 0) +
          value.reservedTokens >
        value.limits.userTokens
      )
        return "token_budget_exceeded";
      rows.set(key, value);
      await reserveHook?.();
      return "reserved";
    }),
    finish: vi.fn(async (value) => {
      finishes.push(structuredClone(value));
    }),
  };
  const governor = new AiGovernor({
    store: budget,
    config: { ...readAiGovernorConfig({}), ...options.governor },
    now: () => clock,
  });
  const fetcher = vi.fn<typeof fetch>(async () => completion());
  const router = new AiModelRouter(config, {
    governor,
    settings: settingsStore,
    fetchImpl: fetcher,
    now: () => clock,
  });
  return {
    config,
    source,
    router,
    governor,
    fetcher,
    settingsStore,
    budget,
    rows,
    reservations,
    finishes,
    policies,
    advance(ms: number) {
      clock += ms;
    },
    onReserve(hook: () => void | Promise<void>) {
      reserveHook = hook;
    },
    change(update: (value: AiRouterSettings) => void, userId = OWNER) {
      const old = policies.get(userId)!;
      const next = structuredClone(old);
      update(next.settings);
      next.revision++;
      policies.set(userId, next);
    },
  };
}
afterEach(() => vi.useRealTimers());
describe("unified router with the existing durable governor", () => {
  it("dispatches a configured authorized model and records one safe durable receipt", async () => {
    const f = fixture();
    const result = await f.router.execute(INPUT);
    expect(result.text).toBe("Completed mock answer");
    expect(result.modelRoute).toMatchObject({
      provider: "openrouter",
      model: "fixture/model-a",
      modelId: "model-a",
      billing: "api",
      reportedCostMicros: 20,
      fallback: false,
      privacy: "external",
    });
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect(f.fetcher.mock.calls[0][0]).toBe(
      "https://openrouter.ai/api/v1/chat/completions",
    );
    expect(f.fetcher.mock.calls[0][1]?.redirect).toBe("error");
    expect(f.reservations).toHaveLength(1);
    expect(f.finishes).toHaveLength(1);
    expect(f.finishes[0]).toMatchObject({
      userId: OWNER,
      requestId: INPUT.requestId,
      state: "completed",
      routing: {
        selectedModelId: "model-a",
        credentialLabel: "key-0",
        reportedCostMicros: 20,
        costSource: "provider_reported",
      },
    });
    expect(JSON.stringify([f.reservations, f.finishes])).not.toContain(
      INPUT.messages[0].content,
    );
    expect(JSON.stringify([f.reservations, f.finishes])).not.toContain(KEY);
  });
  it("uses one OpenRouter fallback array and one reservation while reporting the actual served model", async () => {
    const settings = approved();
    settings.tierModels.balanced.push("model-b");
    settings.fallback = {
      enabled: true,
      maxAttempts: 2,
      allowProviderChange: false,
    };
    const f = fixture({ modelCount: 2, settings });
    f.fetcher.mockImplementation(async () => completion("fixture/model-b"));
    const result = await f.router.execute(INPUT),
      body = JSON.parse(f.fetcher.mock.calls[0][1]!.body as string);
    expect(body.models).toEqual(["fixture/model-a", "fixture/model-b"]);
    expect(body.provider).toMatchObject({
      zdr: true,
      data_collection: "deny",
      allow_fallbacks: true,
      only: ["synthetic-provider"],
    });
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect(f.rows.size).toBe(1);
    expect(f.reservations[0].routing?.selectedModelId).toBe("model-a");
    expect(f.finishes[0].routing).toMatchObject({
      selectedModelId: "model-b",
      attempts: 1,
      fallback: true,
      reportedCostMicros: 20,
    });
    expect(result.modelRoute).toMatchObject({
      modelId: "model-b",
      model: "fixture/model-b",
      fallback: true,
      reportedCostMicros: 20,
    });
  });
  it("blocks unconfigured, unauthorized and out-of-scope connections before reservation or fetch", async () => {
    for (const scenario of [
      "paid",
      "privacy",
      "owner",
      "key",
      "feature",
    ] as const) {
      const f = fixture();
      let input = INPUT;
      if (scenario === "paid")
        f.change((value) => {
          value.spending.paidCallsAuthorized = false;
        });
      if (scenario === "privacy")
        f.change((value) => {
          value.privacy.general = [];
        });
      if (scenario === "owner") input = { ...INPUT, userId: OTHER };
      if (scenario === "key") f.config.credentials[0].secret = "";
      if (scenario === "feature")
        f.config.credentials[0].features = ["finance"];
      await expect(f.router.execute(input)).rejects.toMatchObject({
        code: expect.stringMatching(/^ai_router_/),
      });
      expect(f.fetcher).not.toHaveBeenCalled();
      expect(f.budget.reserve).not.toHaveBeenCalled();
    }
  });
  it("requires both operator and owner paid authorization and keeps other-owner status key-free", async () => {
    const f = fixture({
      source: { LIFEOS_AI_ROUTER_PAID_REQUESTS_ENABLED: "false" },
    });
    await expect(f.router.execute(INPUT)).rejects.toMatchObject({
      code: "ai_router_permission_required",
    });
    expect(f.fetcher).not.toHaveBeenCalled();
    const other = await f.router.snapshot(OTHER);
    expect(
      other.providers.every(
        (provider) => provider.credentialLabels.length === 0,
      ),
    ).toBe(true);
    expect(other.models.every((model) => !model.configured)).toBe(true);
    expect(JSON.stringify(other)).not.toContain(KEY);
    expect(other.chatgptPlan).toMatchObject({
      identityConnected: false,
      planUsageAuthorized: false,
      usesApiCredits: false,
    });
  });
  it("does not call a model for disabled or deterministic routing", async () => {
    const disabled = fixture({ source: { LIFEOS_AI_ROUTER_ENABLED: "false" } });
    await expect(disabled.router.execute(INPUT)).rejects.toMatchObject({
      code: "ai_router_disabled",
    });
    expect(disabled.fetcher).not.toHaveBeenCalled();
    const f = fixture();
    const decision = await f.router.preview(
      OWNER,
      { category: "tagging", dataCategories: ["general"] },
      20,
      20,
    );
    expect(decision.kind).toBe("deterministic");
    await expect(
      f.router.execute({
        ...INPUT,
        task: { category: "tagging", dataCategories: ["general"] },
      }),
    ).rejects.toMatchObject({ code: "ai_router_deterministic_rules" });
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(f.rows.size).toBe(0);
  });
  it("reuses durable request identity across router/governor retries without a second provider request", async () => {
    const f = fixture();
    await f.router.execute(INPUT);
    await expect(f.router.execute(INPUT)).rejects.toMatchObject({
      code: "ai_duplicate_request",
    });
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect(f.rows.size).toBe(1);
    expect(f.reservations).toHaveLength(2);
  });
  it("enforces request ceilings and the lower owner/operator durable daily ceiling", async () => {
    const tiny = approved();
    tiny.spending.maxRequestCostMicros = 1;
    const a = fixture({ settings: tiny });
    await expect(a.router.execute(INPUT)).rejects.toMatchObject({
      code: "ai_router_cost_limit",
    });
    expect(a.fetcher).not.toHaveBeenCalled();
    const f = fixture({
      source: { LIFEOS_AI_ROUTER_MAX_DAILY_COST_MICROS: "1000" },
    });
    const result = await f.router.execute(INPUT);
    const firstCost = result.modelRoute.estimatedCostMicros!;
    expect(f.reservations[0].limits.userCostMicros).toBe(1000);
    f.change((value) => {
      value.spending.maxDailyCostMicros = firstCost * 2 - 1;
    });
    await expect(
      f.router.execute({ ...INPUT, requestId: "request-two" }),
    ).rejects.toMatchObject({ code: "ai_cost_budget_exceeded" });
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  });
  it("honors the shared kill switch and fails closed without durable stores", async () => {
    const killed = fixture({ governor: { killSwitch: true } });
    await expect(killed.router.execute(INPUT)).rejects.toMatchObject({
      code: "ai_shutdown",
    });
    expect(killed.fetcher).not.toHaveBeenCalled();
    const f = fixture(),
      noBudget = new AiModelRouter(f.config, {
        settings: f.settingsStore,
        fetchImpl: f.fetcher,
      });
    await expect(noBudget.execute(INPUT)).rejects.toMatchObject({
      code: "ai_budget_unavailable",
    });
    vi.mocked(f.settingsStore.get).mockRejectedValue(
      new Error("private storage error"),
    );
    await expect(f.router.execute(INPUT)).rejects.toMatchObject({
      code: "ai_router_storage_unavailable",
    });
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it("rotates explicitly scoped keys after 401 even with one model, never after 403 or quota429", async () => {
    const settings = approved();
    settings.fallback = {
      enabled: true,
      maxAttempts: 2,
      allowProviderChange: false,
    };
    const f = fixture({ keyCount: 2, settings });
    f.fetcher
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(completion());
    const result = await f.router.execute(INPUT);
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    expect(
      f.fetcher.mock.calls.map(
        (call) => (call[1]!.headers as Record<string, string>).authorization,
      ),
    ).toEqual(["Bearer " + KEY, "Bearer " + KEY2]);
    expect(f.rows.size).toBe(1);
    expect(result.modelRoute.fallback).toBe(true);
    expect(f.finishes[0].routing).toMatchObject({
      credentialLabel: "key-1",
      attempts: 2,
    });
    for (const status of [403, 429]) {
      const stopped = fixture({ keyCount: 2, settings });
      stopped.fetcher.mockResolvedValue(new Response(null, { status }));
      await expect(stopped.router.execute(INPUT)).rejects.toBeInstanceOf(Error);
      expect(stopped.fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it("keeps different OpenRouter provider/ZDR constraints in separate bounded requests", async () => {
    const settings = approved();
    settings.tierModels.balanced.push("model-b");
    settings.fallback = {
      enabled: true,
      maxAttempts: 2,
      allowProviderChange: false,
    };
    const f = fixture({ modelCount: 2, settings });
    f.config.models[0].requireZdr = false;
    f.config.models[1].providerOnly = ["different-zdr-provider"];
    f.fetcher
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(completion("fixture/model-b"));
    await f.router.execute(INPUT);
    const [first, second] = f.fetcher.mock.calls.map((call) =>
      JSON.parse(call[1]!.body as string),
    );
    expect(first).toMatchObject({
      model: "fixture/model-a",
      provider: {
        only: ["synthetic-provider"],
        zdr: false,
        allow_fallbacks: false,
      },
    });
    expect(first).not.toHaveProperty("models");
    expect(second).toMatchObject({
      model: "fixture/model-b",
      provider: {
        only: ["different-zdr-provider"],
        zdr: true,
        allow_fallbacks: false,
      },
    });
    expect(f.rows.size).toBe(1);
    expect(f.finishes[0].routing?.attempts).toBe(2);
  });
  it("stops before the first external transfer if consent changes while reservation is pending", async () => {
    const f = fixture();
    f.onReserve(() =>
      f.change((value) => {
        value.privacy.general = [];
      }),
    );
    await expect(f.router.execute(INPUT)).rejects.toBeInstanceOf(Error);
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(f.rows.size).toBe(1);
    expect(f.finishes[0].state).toBe("failed");
  });
  it("does not dispatch a new fallback after the owner revokes policy", async () => {
    const settings = approved();
    settings.tierModels.balanced.push("model-b");
    settings.fallback = {
      enabled: true,
      maxAttempts: 2,
      allowProviderChange: false,
    };
    const f = fixture({ modelCount: 2, settings });
    f.config.models[1].requireZdr = false;
    f.fetcher.mockImplementation(async () => {
      f.change((value) => {
        value.spending.paidCallsAuthorized = false;
      });
      return new Response(null, { status: 503 });
    });
    await expect(f.router.execute(INPUT)).rejects.toBeInstanceOf(Error);
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect(f.rows.size).toBe(1);
  });
  it("rechecks metadata expiry after startup and capabilities before dispatch", async () => {
    const f = fixture();
    expect(f.router.catalog(OWNER)[0].metadataVerified).toBe(true);
    f.advance(31 * 86400_000);
    expect(f.router.catalog(OWNER)[0].metadataVerified).toBe(false);
    await expect(f.router.execute(INPUT)).rejects.toMatchObject({
      code: "ai_router_model_unavailable",
    });
    expect(f.fetcher).not.toHaveBeenCalled();
    const g = fixture();
    await expect(
      g.router.execute({
        ...INPUT,
        task: {
          category: "chat",
          dataCategories: ["general"],
          requiredCapabilities: ["vision"],
        },
      }),
    ).rejects.toMatchObject({ code: "ai_router_capability_unavailable" });
    expect(g.fetcher).not.toHaveBeenCalled();
  });
  it("does not retry ambiguous or unapproved served-model responses", async () => {
    const settings = approved();
    settings.tierModels.balanced.push("model-b");
    settings.fallback = {
      enabled: true,
      maxAttempts: 2,
      allowProviderChange: false,
    };
    for (const failure of ["network", "served-model"] as const) {
      const f = fixture({ modelCount: 2, keyCount: 2, settings });
      if (failure === "network")
        f.fetcher.mockRejectedValue(new Error("synthetic ambiguous send"));
      else f.fetcher.mockResolvedValue(completion("unapproved/model"));
      await expect(f.router.execute(INPUT)).rejects.toBeInstanceOf(Error);
      expect(f.fetcher).toHaveBeenCalledTimes(1);
      expect(f.rows.size).toBe(1);
      expect(f.finishes[0].state).toBe("failed");
    }
  });
  it("enforces output limits without publishing a success receipt or fallback", async () => {
    const f = fixture();
    f.fetcher.mockResolvedValue(completion("fixture/model-a", 1000));
    await expect(f.router.execute(INPUT)).rejects.toMatchObject({
      code: "ai_output_budget_exceeded",
    });
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect(f.finishes[0].state).toBe("failed");
  });
  it("bounds a stalled provider with the existing deadline and preserves the reservation", async () => {
    vi.useFakeTimers();
    const f = fixture({ governor: { timeoutMs: 100 } });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    f.fetcher.mockImplementation(async (_url, init) => {
      entered();
      return new Promise<Response>((_resolve, reject) =>
        init!.signal!.addEventListener(
          "abort",
          () => reject(new Error("mock aborted")),
          { once: true },
        ),
      );
    });
    const pending = expect(f.router.execute(INPUT)).rejects.toMatchObject({
      code: "ai_timeout",
    });
    await started;
    await vi.advanceTimersByTimeAsync(101);
    await pending;
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect(f.rows.size).toBe(1);
    expect(f.finishes[0].state).toBe("timed_out");
  });
  it("propagates caller cancellation to a running request without starting fallback", async () => {
    const f = fixture(),
      controller = new AbortController();
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    f.fetcher.mockImplementation(async (_url, init) => {
      entered();
      return new Promise<Response>((_resolve, reject) =>
        init!.signal!.addEventListener(
          "abort",
          () => reject(new Error("mock cancelled")),
          { once: true },
        ),
      );
    });
    const pending = expect(
      f.router.execute({ ...INPUT, signal: controller.signal }),
    ).rejects.toMatchObject({ code: "ai_cancelled" });
    await started;
    controller.abort();
    await pending;
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect(f.rows.size).toBe(1);
    expect(f.finishes[0].state).toBe("cancelled");
  });
});
