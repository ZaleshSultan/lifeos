import { describe, expect, it } from "vitest";
import {
  AI_ROUTER_PROVIDERS,
  AI_ROUTER_TIERS,
  AiRouterValidationError,
  classifyAiRouterTask,
  defaultAiRouterSettings,
  estimateAiRouterCost,
  parseAiRouterSettings,
  projectAiRouterModel,
  selectAiModelRoute,
  type AiRouterModel,
  type AiRouterSelectionInput,
  type AiRouterSettings,
} from "./ai-model-router.js";

// These are fictitious unit fixtures, not assertions about provider model availability.
function model(overrides: Partial<AiRouterModel> = {}): AiRouterModel {
  return {
    id: "primary",
    label: "Fixture model",
    provider: "openrouter",
    model: "fixture/model",
    tiers: ["fast", "balanced", "advanced"],
    capabilities: ["text", "json"],
    billing: "api",
    inputCostMicrosPer1k: 1_000,
    outputCostMicrosPer1k: 2_000,
    configured: true,
    authorized: true,
    status: "configured",
    privacy: "external",
    metadataVerified: true,
    ...overrides,
  };
}
function settings(): AiRouterSettings {
  const value = defaultAiRouterSettings();
  value.allowedTiers = [...AI_ROUTER_TIERS];
  value.allowedProviders = [...AI_ROUTER_PROVIDERS];
  for (const tier of [
    "fast",
    "balanced",
    "advanced",
    "vision",
    "voice",
  ] as const)
    value.tierModels[tier] = ["primary", "secondary", "third"];
  value.privacy.general = [...AI_ROUTER_PROVIDERS];
  value.spending = {
    paidCallsAuthorized: true,
    maxRequestCostMicros: 1_000,
    maxDailyCostMicros: 2_000,
  };
  return value;
}
function input(
  overrides: Partial<AiRouterSelectionInput> = {},
): AiRouterSelectionInput {
  return {
    task: { category: "chat", dataCategories: ["general"] },
    settings: settings(),
    models: [model()],
    estimatedInputTokens: 100,
    maxOutputTokens: 100,
    ...overrides,
  };
}
describe("AI model router policy", () => {
  it("defaults to rules with no external providers, spending or fallback permission", () => {
    const first = defaultAiRouterSettings();
    expect(first.allowedTiers).toEqual(["deterministic"]);
    expect(first.allowedProviders).toEqual([]);
    expect(Object.values(first.privacy).flat()).toEqual([]);
    expect(first.spending).toEqual({
      paidCallsAuthorized: false,
      maxRequestCostMicros: 0,
      maxDailyCostMicros: 0,
    });
    expect(first.fallback.enabled).toBe(false);
    first.privacy.general.push("openrouter");
    first.tierModels.fast.push("changed");
    expect(defaultAiRouterSettings().privacy.general).toEqual([]);
    expect(defaultAiRouterSettings().tierModels.fast).toEqual([]);
  });

  it("strictly parses and clones an entire settings document", () => {
    const original = settings();
    const parsed = parseAiRouterSettings(original);
    expect(parsed).toEqual(original);
    parsed.tierModels.balanced.push("later");
    parsed.privacy.general.pop();
    expect(original.tierModels.balanced).not.toContain("later");
    expect(original.privacy.general).toEqual([...AI_ROUTER_PROVIDERS]);
  });

  it.each([
    (v: AiRouterSettings) => ({ ...v, apiKey: "DO_NOT_LEAK_SECRET" }),
    (v: AiRouterSettings) => ({ ...v, baseUrl: "https://untrusted.example" }),
    (v: AiRouterSettings) => ({ ...v, version: 2 }),
    (v: AiRouterSettings) => ({
      ...v,
      allowedProviders: ["openrouter", "openrouter"],
    }),
    (v: AiRouterSettings) => ({
      ...v,
      allowedProviders: ["claude_subscription"],
    }),
    (v: AiRouterSettings) => ({ ...v, allowedTiers: ["unlimited"] }),
    (v: AiRouterSettings) => ({
      ...v,
      manualModelId: "https://untrusted.example/v1",
    }),
    (v: AiRouterSettings) => ({
      ...v,
      tierModels: { ...v.tierModels, fast: Array(13).fill("primary") },
    }),
    (v: AiRouterSettings) => ({
      ...v,
      tierModels: { ...v.tierModels, fast: ["primary", "primary"] },
    }),
    (v: AiRouterSettings) => ({ ...v, privacy: { ...v.privacy, secret: [] } }),
    (v: AiRouterSettings) => ({
      ...v,
      spending: { ...v.spending, maxRequestCostMicros: -1 },
    }),
    (v: AiRouterSettings) => ({
      ...v,
      spending: { ...v.spending, maxDailyCostMicros: 1.5 },
    }),
    (v: AiRouterSettings) => ({
      ...v,
      spending: { ...v.spending, maxDailyCostMicros: Infinity },
    }),
    (v: AiRouterSettings) => ({
      ...v,
      spending: { ...v.spending, maxDailyCostMicros: 1_000_000_000_001 },
    }),
    (v: AiRouterSettings) => ({
      ...v,
      spending: { ...v.spending, paidCallsAuthorized: "true" },
    }),
    (v: AiRouterSettings) => ({
      ...v,
      fallback: { ...v.fallback, maxAttempts: 4 },
    }),
    (v: AiRouterSettings) => ({
      ...v,
      fallback: { ...v.fallback, extraRetry: true },
    }),
  ])(
    "rejects unknown, malformed or unsafe settings without echoing values",
    (mutate) => {
      expect(() => parseAiRouterSettings(mutate(settings()))).toThrow(
        AiRouterValidationError,
      );
      try {
        parseAiRouterSettings(mutate(settings()));
      } catch (error) {
        expect((error as Error).message).not.toContain("DO_NOT_LEAK_SECRET");
        expect((error as Error).message).not.toContain("untrusted.example");
      }
    },
  );

  it("rejects prototype pollution keys instead of merging input", () => {
    const bad = JSON.parse(
      JSON.stringify(settings()).replace(
        '"version":1',
        '"version":1,"__proto__":{"authorized":true}',
      ),
    );
    expect(() => parseAiRouterSettings(bad)).toThrow(AiRouterValidationError);
    expect(({} as { authorized?: boolean }).authorized).toBeUndefined();
  });

  it("classifies task metadata with fixed rules rather than another paid model", () => {
    expect(classifyAiRouterTask("tagging").tier).toBe("deterministic");
    expect(classifyAiRouterTask("classification").tier).toBe("fast");
    expect(classifyAiRouterTask("planning").tier).toBe("balanced");
    expect(classifyAiRouterTask("code").tier).toBe("advanced");
    expect(classifyAiRouterTask("nutrition_photo")).toEqual({
      tier: "vision",
      capabilities: ["text", "vision"],
    });
    expect(classifyAiRouterTask("voice").capabilities).toContain("audio");
  });

  it("keeps deterministic tasks available even when AI configuration is broken", () => {
    const result = selectAiModelRoute(
      input({
        task: { category: "tagging", dataCategories: ["finance"] },
        settings: null as unknown as AiRouterSettings,
        models: [null as unknown as AiRouterModel],
      }),
    );
    expect(result).toMatchObject({
      kind: "deterministic",
      candidates: [],
      fallbackAllowed: false,
    });
  });

  it("requires a genuine capability change to leave deterministic execution", () => {
    expect(
      selectAiModelRoute(
        input({
          task: {
            category: "deterministic",
            dataCategories: ["general"],
            requiredCapabilities: ["vision"],
          },
        }),
      ),
    ).toMatchObject({ kind: "unavailable", reason: "invalid_request" });
  });

  it("selects only the first reviewed model in the explicit task shortlist", () => {
    const result = selectAiModelRoute(
      input({
        models: [
          model({ id: "secondary", reliabilityScore: 1 }),
          model({ reliabilityScore: 0.8 }),
        ],
      }),
    );
    expect(result).toMatchObject({
      kind: "selected",
      tier: "balanced",
      reason: "automatic_tier",
      fallbackAtSelection: false,
      candidates: [{ modelId: "primary", estimatedCostMicros: 300 }],
    });
  });

  it("enforces actual modality capabilities before a vision request", () => {
    expect(
      selectAiModelRoute(
        input({
          task: { category: "nutrition_photo", dataCategories: ["general"] },
          models: [model({ tiers: ["vision"] })],
        }),
      ),
    ).toMatchObject({ kind: "unavailable", reason: "capability_unavailable" });
  });

  it.each(["health", "finance", "university"] as const)(
    "requires separate consent for %s even when general text is authorized",
    (category) => {
      const config = settings();
      expect(
        selectAiModelRoute(
          input({
            settings: config,
            task: { category: "chat", dataCategories: ["general", category] },
          }),
        ),
      ).toMatchObject({ kind: "unavailable", reason: "privacy_not_allowed" });
      config.privacy[category] = ["openrouter"];
      expect(
        selectAiModelRoute(
          input({
            settings: config,
            task: { category: "chat", dataCategories: ["general", category] },
          }),
        ).kind,
      ).toBe("selected");
    },
  );

  it("never treats user preferences as server-side provider authorization", () => {
    expect(
      selectAiModelRoute(input({ models: [model({ authorized: false })] })),
    ).toMatchObject({ kind: "unavailable", reason: "permission_required" });
  });

  it("never lets a catalog privacy label waive consent for an external provider", () => {
    expect(
      selectAiModelRoute(
        input({
          task: { category: "chat", dataCategories: ["health"] },
          models: [model({ privacy: "local" })],
        }),
      ),
    ).toMatchObject({ kind: "unavailable", reason: "privacy_not_allowed" });
  });

  it("does not execute a configured API provider without paid authorization", () => {
    const config = settings();
    config.spending.paidCallsAuthorized = false;
    expect(selectAiModelRoute(input({ settings: config }))).toMatchObject({
      kind: "unavailable",
      reason: "paid_authorization_required",
    });
    expect(
      selectAiModelRoute(
        input({
          settings: config,
          models: [
            model({ inputCostMicrosPer1k: 0, outputCostMicrosPer1k: 0 }),
          ],
        }),
      ),
    ).toMatchObject({
      kind: "unavailable",
      reason: "paid_authorization_required",
    });
  });

  it("requires verified pricing even with a zero cost ceiling", () => {
    const config = settings();
    config.spending.maxRequestCostMicros = 0;
    expect(
      selectAiModelRoute(
        input({
          settings: config,
          models: [model({ inputCostMicrosPer1k: null })],
        }),
      ),
    ).toMatchObject({ kind: "unavailable", reason: "pricing_unavailable" });
  });

  it("permits explicitly free verified zero pricing but never assumes an unpriced model is free", () => {
    const config = settings();
    config.spending = {
      paidCallsAuthorized: false,
      maxRequestCostMicros: 0,
      maxDailyCostMicros: 0,
    };
    expect(
      selectAiModelRoute(
        input({
          settings: config,
          models: [
            model({
              billing: "free",
              inputCostMicrosPer1k: 0,
              outputCostMicrosPer1k: 0,
            }),
          ],
        }),
      ),
    ).toMatchObject({
      kind: "selected",
      candidates: [{ billing: "free", estimatedCostMicros: 0 }],
    });
    for (const bad of [
      model({ billing: "free", inputCostMicrosPer1k: null }),
      model({ billing: "free" }),
    ])
      expect(
        selectAiModelRoute(input({ settings: config, models: [bad] })),
      ).toMatchObject({ kind: "unavailable", reason: "pricing_unavailable" });
  });

  it.each(["request", "daily", "remaining"])(
    "enforces the %s spending ceiling before selection",
    (which) => {
      const config = settings();
      if (which === "request") config.spending.maxRequestCostMicros = 299;
      if (which === "daily") config.spending.maxDailyCostMicros = 299;
      expect(
        selectAiModelRoute(
          input({
            settings: config,
            ...(which === "remaining" ? { remainingDailyCostMicros: 299 } : {}),
          }),
        ),
      ).toMatchObject({ kind: "unavailable", reason: "cost_limit" });
    },
  );

  it("rounds sub-unit token prices upward and refuses unsafe accounting inputs", () => {
    expect(
      estimateAiRouterCost(
        model({ inputCostMicrosPer1k: 1, outputCostMicrosPer1k: 1 }),
        1,
        1,
      ),
    ).toBe(2);
    expect(
      estimateAiRouterCost(model({ inputCostMicrosPer1k: NaN }), 100, 100),
    ).toBeNull();
    expect(estimateAiRouterCost(model(), -1, 100)).toBeNull();
    expect(
      estimateAiRouterCost(
        model({ inputCostMicrosPer1k: 1_000_000_000_000 }),
        Number.MAX_SAFE_INTEGER,
        100,
      ),
    ).toBeNull();
  });

  it("distinguishes a permitted ChatGPT plan grant from API billing or free inference", () => {
    const config = settings();
    config.spending = {
      paidCallsAuthorized: false,
      maxRequestCostMicros: 0,
      maxDailyCostMicros: 0,
    };
    const plan = model({
      provider: "chatgpt_plan",
      billing: "chatgpt_plan",
      inputCostMicrosPer1k: null,
      outputCostMicrosPer1k: null,
    });
    expect(
      selectAiModelRoute(input({ settings: config, models: [plan] })),
    ).toMatchObject({
      kind: "unavailable",
      reason: "plan_permission_required",
    });
    expect(
      selectAiModelRoute(
        input({
          settings: config,
          models: [{ ...plan, planScopeGranted: true }],
        }),
      ),
    ).toMatchObject({
      kind: "selected",
      candidates: [{ billing: "chatgpt_plan", estimatedCostMicros: null }],
    });
  });

  it.each([
    "disconnected",
    "expired",
    "permission_required",
    "disabled",
  ] as const)("does not use a %s connection", (status) => {
    expect(
      selectAiModelRoute(input({ models: [model({ status })] })),
    ).toMatchObject({ kind: "unavailable", reason: "model_unavailable" });
  });

  it("does not skip a missing preferred model when fallback is disabled", () => {
    expect(
      selectAiModelRoute(
        input({
          models: [
            model({ status: "disconnected" }),
            model({ id: "secondary" }),
          ],
        }),
      ),
    ).toMatchObject({ kind: "unavailable", reason: "model_unavailable" });
  });

  it("uses an explicitly permitted available fallback and reports that selection", () => {
    const config = settings();
    config.fallback = {
      enabled: true,
      maxAttempts: 2,
      allowProviderChange: false,
    };
    const result = selectAiModelRoute(
      input({
        settings: config,
        models: [model({ status: "disconnected" }), model({ id: "secondary" })],
      }),
    );
    expect(result).toMatchObject({
      kind: "selected",
      reason: "automatic_fallback",
      fallbackAtSelection: true,
      candidates: [{ modelId: "secondary" }],
    });
  });

  it("conservatively bounds the total fallback chain cost", () => {
    const config = settings();
    config.fallback = {
      enabled: true,
      maxAttempts: 3,
      allowProviderChange: false,
    };
    config.spending.maxRequestCostMicros = 599;
    const result = selectAiModelRoute(
      input({
        settings: config,
        models: [model(), model({ id: "secondary" }), model({ id: "third" })],
      }),
    );
    expect(result).toMatchObject({
      kind: "selected",
      fallbackAllowed: false,
      candidates: [{ modelId: "primary" }],
    });
  });

  it("never switches to a different billing path in a fallback chain", () => {
    const config = settings();
    config.fallback = {
      enabled: true,
      maxAttempts: 3,
      allowProviderChange: true,
    };
    const plan = model({
      id: "secondary",
      provider: "chatgpt_plan",
      billing: "chatgpt_plan",
      inputCostMicrosPer1k: null,
      outputCostMicrosPer1k: null,
      planScopeGranted: true,
    });
    expect(
      selectAiModelRoute(input({ settings: config, models: [model(), plan] })),
    ).toMatchObject({ kind: "selected", candidates: [{ modelId: "primary" }] });
    expect(
      selectAiModelRoute(
        input({
          settings: config,
          models: [model({ status: "disconnected" }), plan],
        }),
      ),
    ).toMatchObject({ kind: "unavailable", reason: "model_unavailable" });
  });

  it("requires explicit provider-change permission and every privacy consent for failover", () => {
    const config = settings();
    config.fallback = {
      enabled: true,
      maxAttempts: 3,
      allowProviderChange: false,
    };
    const models = [
      model({ status: "disconnected" }),
      model({ id: "secondary", provider: "gemini" }),
    ];
    expect(
      selectAiModelRoute(input({ settings: config, models })),
    ).toMatchObject({ kind: "unavailable" });
    config.fallback.allowProviderChange = true;
    config.privacy.general = ["openrouter"];
    expect(
      selectAiModelRoute(input({ settings: config, models })),
    ).toMatchObject({ kind: "unavailable" });
    config.privacy.general.push("gemini");
    expect(
      selectAiModelRoute(input({ settings: config, models })),
    ).toMatchObject({ kind: "selected", candidates: [{ provider: "gemini" }] });
  });

  it("manual mode uses only the selected allowlisted capable model without fallback", () => {
    const config = settings();
    config.mode = "manual";
    config.manualModelId = "primary";
    config.fallback.enabled = true;
    expect(
      selectAiModelRoute(
        input({
          settings: config,
          models: [model({ status: "expired" }), model({ id: "secondary" })],
        }),
      ),
    ).toMatchObject({ kind: "unavailable", reason: "model_unavailable" });
    config.manualModelId = "not_approved";
    expect(
      selectAiModelRoute(
        input({ settings: config, models: [model({ id: "not_approved" })] }),
      ),
    ).toMatchObject({ kind: "unavailable", reason: "model_not_allowlisted" });
    config.manualModelId = null;
    expect(selectAiModelRoute(input({ settings: config }))).toMatchObject({
      kind: "unavailable",
      reason: "manual_model_required",
    });
  });

  it("preserves conversation consistency only after rechecking current authorization", () => {
    const config = settings();
    const models = [model(), model({ id: "secondary" })];
    expect(
      selectAiModelRoute(
        input({ settings: config, models, previousModelId: "secondary" }),
      ),
    ).toMatchObject({
      kind: "selected",
      reason: "conversation_consistency",
      candidates: [{ modelId: "secondary" }],
    });
    models[1].authorized = false;
    expect(
      selectAiModelRoute(
        input({ settings: config, models, previousModelId: "secondary" }),
      ),
    ).toMatchObject({
      kind: "selected",
      reason: "automatic_tier",
      candidates: [{ modelId: "primary" }],
    });
    expect(
      selectAiModelRoute(
        input({ settings: config, models, previousModelId: "unlisted" }),
      ),
    ).toMatchObject({ kind: "selected", reason: "automatic_tier" });
  });

  it("changes the sticky model when required capabilities change", () => {
    const config = settings();
    config.tierModels.vision = ["primary", "secondary"];
    const models = [
      model({ tiers: ["vision"], capabilities: ["text", "vision"] }),
      model({ id: "secondary", tiers: ["vision"] }),
    ];
    expect(
      selectAiModelRoute(
        input({
          settings: config,
          task: { category: "nutrition_photo", dataCategories: ["general"] },
          models,
          previousModelId: "secondary",
        }),
      ),
    ).toMatchObject({
      kind: "selected",
      reason: "automatic_tier",
      candidates: [{ modelId: "primary" }],
    });
  });

  it("fails closed for duplicate, malformed or oversized server registries", () => {
    for (const models of [
      [model(), model()],
      [model({ inputCostMicrosPer1k: -1 })],
      Array.from({ length: 129 }, (_, i) => model({ id: "fixture" + i })),
    ])
      expect(selectAiModelRoute(input({ models }))).toMatchObject({
        kind: "unavailable",
        reason: "invalid_registry",
      });
  });

  it("does not project accidental server-only credential fields", () => {
    const withSecret = {
      ...model(),
      apiKey: "DO_NOT_LEAK_SECRET",
      baseUrl: "https://untrusted.example",
    };
    expect(JSON.stringify(projectAiRouterModel(withSecret))).not.toContain(
      "DO_NOT_LEAK_SECRET",
    );
    expect(projectAiRouterModel(withSecret)).not.toHaveProperty("baseUrl");
    const decision = selectAiModelRoute(input({ models: [withSecret] }));
    expect(JSON.stringify(decision)).not.toContain("DO_NOT_LEAK_SECRET");
    expect(JSON.stringify(decision)).not.toContain("untrusted.example");
  });
});
