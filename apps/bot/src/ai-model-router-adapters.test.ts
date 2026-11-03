import { describe, it, expect, vi, afterEach } from "vitest";
import {
  defaultAiRouterSettings,
  parseFinanceText,
  type AiRouterSettings,
  type AiBudgetStore,
} from "@lifeos/core";
import { AiGovernor, readAiGovernorConfig } from "./ai-governor.js";
import { AiModelRouter, routedOpenRouterFetch } from "./ai-model-router.js";
import { createMealVisionService } from "./nutrition-routes.js";
import { createLifeosAiService, readLifeosAiConfig } from "./lifeos-ai.js";
const OWNER = "11111111-1111-4111-8111-111111111111";
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9WQAAAAASUVORK5CYII=";
function fixture(text: string) {
  const settings: AiRouterSettings = {
    ...defaultAiRouterSettings(),
    allowedTiers: ["balanced", "vision"],
    allowedProviders: ["openrouter"],
    tierModels: {
      fast: [],
      balanced: ["selected"],
      advanced: [],
      vision: ["selected"],
      voice: [],
    },
    privacy: {
      general: ["openrouter"],
      health: ["openrouter"],
      finance: ["openrouter"],
      university: ["openrouter"],
    },
    spending: {
      paidCallsAuthorized: true,
      maxRequestCostMicros: 100000,
      maxDailyCostMicros: 1000000,
    },
  };
  const budget: AiBudgetStore = {
    reserve: vi.fn(async () => "reserved" as const),
    finish: vi.fn(async () => undefined),
  };
  const fetchImpl = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          model: "vendor/model",
          choices: [
            {
              finish_reason: "stop",
              message: { role: "assistant", content: text },
            },
          ],
          usage: {
            prompt_tokens: 5,
            completion_tokens: 3,
            total_tokens: 8,
            cost: 0.000001,
          },
        }),
        { headers: { "content-type": "application/json" } },
      ),
  );
  const now = Date.now();
  const router = new AiModelRouter(
    {
      enabled: true,
      paidRequestsEnabled: true,
      configurationInvalid: false,
      maxRequestCostMicros: 100000,
      maxDailyCostMicros: 1000000,
      maxOutputTokens: 2048,
      credentials: [
        {
          id: "finance-project",
          provider: "openrouter",
          ownerUserId: OWNER,
          features: ["chat", "finance", "meal_photo"],
          secret: "scoped-test-key",
        },
      ],
      models: [
        {
          model: {
            id: "selected",
            label: "Selected",
            provider: "openrouter",
            model: "vendor/model",
            tiers: ["balanced", "vision"],
            capabilities: ["text", "json", "vision"],
            billing: "api",
            inputCostMicrosPer1k: 10,
            outputCostMicrosPer1k: 10,
            configured: false,
            authorized: false,
            status: "disconnected",
            privacy: "external",
            metadataVerified: true,
          },
          verifiedAtMs: now,
          credentialIds: ["finance-project"],
          providerOnly: [],
          sort: "price",
          requireZdr: true,
        },
      ],
    },
    {
      governor: new AiGovernor({
        store: budget,
        config: readAiGovernorConfig({}),
      }),
      settings: {
        get: async () => ({ settings, revision: 1 }),
        save: async () => ({ settings, revision: 1 }),
      },
      fetchImpl,
    },
  );
  return { router, budget, fetchImpl };
}
afterEach(() => vi.unstubAllGlobals());
describe("existing feature adapters share routing and accounting", () => {
  it("routes consented meal photos once, labels actual provider and keeps the result a draft", async () => {
    const f = fixture(
      JSON.stringify({
        items: [
          {
            label: "Rice",
            portion: "small bowl",
            caloriesKcal: 100,
            proteinG: 3,
            fatG: 1,
            carbsG: 20,
          },
        ],
        uncertainty: ["Estimate only"],
      }),
    );
    const service = createMealVisionService({
      router: f.router,
      governor: new AiGovernor({
        store: f.budget,
        config: readAiGovernorConfig({}),
      }),
      source: { LIFEOS_MEAL_VISION_ENABLED: "true" },
    });
    const draft = await service.analyze(OWNER, {
      mimeType: "image/png",
      imageBase64: PNG,
      consentToExternalAnalysis: true,
      requestId: "11111111-1111-4111-8111-111111111112",
    });
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
    expect(f.budget.reserve).toHaveBeenCalledTimes(1);
    expect(draft).toMatchObject({
      source: "openrouter",
      requiresReview: true,
      estimated: true,
      modelRoute: {
        modelId: "selected",
        provider: "openrouter",
        model: "vendor/model",
        costSource: "provider_reported",
      },
    });
    expect(draft.items[0].caloriesKcal).toBe(100);
  });
  it("allows the trusted finance transport without an unrelated legacy OpenRouter key", async () => {
    const f = fixture(
      JSON.stringify({
        amount: 120,
        currency: "KZT",
        transactionType: "expense",
        category: "Food",
        description: "Coffee",
        merchant: null,
        tags: [],
        confidence: 0.8,
      }),
    );
    const result = await parseFinanceText("spent 120 KZT coffee", {
      aiEnabled: true,
      trustedRouterTransport: true,
      fetchImpl: routedOpenRouterFetch(f.router, OWNER),
    });
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
    expect(f.budget.reserve).toHaveBeenCalledTimes(1);
    expect(result.parser).toBe("model_router");
    expect(result.amount).toBe(120);
    const sent = f.fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(sent[1].headers).get("authorization")).toBe(
      "Bearer scoped-test-key",
    );
  });
  it("does not fall through to a network client if the trusted finance bridge is absent", async () => {
    const network = vi.fn(async () => {
      throw new Error("no network");
    });
    vi.stubGlobal("fetch", network);
    const result = await parseFinanceText("spent 120 KZT coffee", {
      aiEnabled: true,
      trustedRouterTransport: true,
    });
    expect(result.parser).toBe("rules");
    expect(network).not.toHaveBeenCalled();
  });
  it("rejects owner privacy and missing per-photo consent before transport", async () => {
    const f = fixture("{}");
    const service = createMealVisionService({
      router: f.router,
      governor: new AiGovernor({
        store: f.budget,
        config: readAiGovernorConfig({}),
      }),
      source: { LIFEOS_MEAL_VISION_ENABLED: "true" },
    });
    await expect(
      service.analyze(OWNER, {
        mimeType: "image/png",
        imageBase64: PNG,
        consentToExternalAnalysis: false,
        requestId: "11111111-1111-4111-8111-111111111113",
      }),
    ).rejects.toThrow();
    await expect(
      service.analyze("22222222-2222-4222-8222-222222222222", {
        mimeType: "image/png",
        imageBase64: PNG,
        consentToExternalAnalysis: true,
        requestId: "11111111-1111-4111-8111-111111111114",
      }),
    ).rejects.toThrow();
    expect(f.fetchImpl).not.toHaveBeenCalled();
    expect(f.budget.reserve).not.toHaveBeenCalled();
  });
});

it("router configuration cannot override the existing chat feature opt-out", async () => {
  const f = fixture(
    JSON.stringify({ answer: "Recorded priorities.", suggestions: [] }),
  );
  const ai = createLifeosAiService(readLifeosAiConfig({}), {
    governor: new AiGovernor({
      store: f.budget,
      config: readAiGovernorConfig({}),
    }),
    router: f.router,
  });
  expect(ai.status()).toMatchObject({
    enabled: false,
    available: false,
    reason: "ai_disabled",
  });
  await expect(
    ai.ask(OWNER, [{ role: "user", text: "Explain recorded priorities" }], {
      tasks: [],
    }),
  ).rejects.toMatchObject({ code: "ai_disabled" });
  expect(f.fetchImpl).not.toHaveBeenCalled();
  expect(f.budget.reserve).not.toHaveBeenCalled();
});
it("the existing read-only assistant uses a configured routed provider without requiring a Gemini key", async () => {
  const f = fixture(
    JSON.stringify({ answer: "Recorded priorities.", suggestions: [] }),
  );
  const ai = createLifeosAiService(
    readLifeosAiConfig({ LIFEOS_AI_ENABLED: "true" }),
    {
      governor: new AiGovernor({
        store: f.budget,
        config: readAiGovernorConfig({}),
      }),
      router: f.router,
    },
  );
  const answer = await ai.ask(
    OWNER,
    [{ role: "user", text: "Explain recorded priorities" }],
    { tasks: [] },
    { requestId: "routed-chat" },
  );
  expect(answer).toMatchObject({
    provider: "openrouter",
    answer: "Recorded priorities.",
    modelRoute: { modelId: "selected", model: "vendor/model" },
  });
  expect(f.fetchImpl).toHaveBeenCalledTimes(1);
  expect(f.budget.reserve).toHaveBeenCalledTimes(1);
});

it("invalid routing configuration cannot reactivate the legacy Gemini billing path", async () => {
  const f = fixture("{}");
  f.router.config.enabled = false;
  f.router.config.configurationInvalid = true;
  const { routerModeRequested } = await import("./ai-model-router.js");
  expect(routerModeRequested(f.router)).toBe(true);
  const ai = createLifeosAiService(
    readLifeosAiConfig({
      LIFEOS_AI_ENABLED: "true",
      GEMINI_API_KEY: "legacy-key-not-used",
    }),
    {
      governor: new AiGovernor({
        store: f.budget,
        config: readAiGovernorConfig({}),
      }),
      router: f.router,
    },
  );
  expect(ai.status().available).toBe(false);
  await expect(
    ai.ask(OWNER, [{ role: "user", text: "Explain recorded priorities" }], {
      tasks: [],
    }),
  ).rejects.toMatchObject({ code: "ai_router_blocked" });
  expect(f.fetchImpl).not.toHaveBeenCalled();
  expect(f.budget.reserve).not.toHaveBeenCalled();
});
