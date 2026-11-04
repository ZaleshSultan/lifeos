import { describe, expect, it, vi } from "vitest";
import {
  defaultAiRouterSettings,
  type AiBudgetStore,
  type AiRouterSettings,
} from "@lifeos/core";
import type { AiRouterSettingsStore } from "@lifeos/db";
import { AiGovernor, readAiGovernorConfig } from "./ai-governor.js";
import { AiModelRouter } from "./ai-model-router.js";
import { readAiModelRouterConfig } from "./ai-model-router-config.js";
import {
  transcribeCaptureVoice,
  validateTelegramVoice,
} from "./telegram/voice.js";
import { speechOgg } from "./capture-speech-provider.test-fixtures.js";

const OWNER = "10000000-0000-4000-8000-000000000001";
const OTHER = "10000000-0000-4000-8000-000000000002";
const NOW = Date.parse("2026-11-04T12:00:00Z");
const KEY = "sk-synthetic-speech-project-only";
function fixture() {
  let clock = NOW;
  const settings: AiRouterSettings = {
    ...defaultAiRouterSettings(),
    allowedTiers: ["voice"],
    allowedProviders: ["openai"],
    tierModels: {
      fast: [],
      balanced: [],
      advanced: [],
      vision: [],
      voice: ["speech"],
    },
    privacy: {
      general: ["openai"],
      health: ["openai"],
      finance: ["openai"],
      university: ["openai"],
    },
    spending: {
      paidCallsAuthorized: true,
      maxRequestCostMicros: 10_000,
      maxDailyCostMicros: 100_000,
    },
  };
  const policies = new Map([[OWNER, { settings, revision: 1 }]]);
  const settingsStore: AiRouterSettingsStore = {
    get: vi.fn(async (id) =>
      structuredClone(
        policies.get(id) ?? {
          settings: defaultAiRouterSettings(),
          revision: 0,
        },
      ),
    ),
    save: vi.fn(async () => {
      throw new Error("not part of speech execution");
    }),
  };
  const credentials = [
    {
      id: "speech-key",
      provider: "openai",
      ownerUserId: OWNER,
      features: ["classification"],
      env: "OPENAI_API_KEY",
    },
  ];
  const models = [
    {
      id: "speech",
      label: "Synthetic speech fixture",
      provider: "openai",
      model: "gpt-transcribe",
      tiers: ["voice"],
      capabilities: ["audio"],
      billing: "api",
      inputCostMicrosPer1k: null,
      outputCostMicrosPer1k: null,
      audioCostMicrosPerMinute: 4500,
      verifiedAt: new Date(NOW).toISOString(),
      source: "https://developers.openai.com/api/docs/models/gpt-transcribe",
      credentialIds: ["speech-key"],
      providerOnly: [],
      sort: "price",
      requireZdr: true,
    },
  ];
  const source = {
    LIFEOS_AI_ROUTER_ENABLED: "true",
    LIFEOS_AI_ROUTER_PAID_REQUESTS_ENABLED: "true",
    LIFEOS_AI_ROUTER_MAX_REQUEST_COST_MICROS: "10000",
    LIFEOS_AI_ROUTER_MAX_DAILY_COST_MICROS: "100000",
    LIFEOS_AI_ROUTER_MAX_OUTPUT_TOKENS: "2048",
    OPENAI_API_KEY: KEY,
    LIFEOS_AI_ROUTER_CREDENTIALS_JSON: JSON.stringify(credentials),
    LIFEOS_AI_ROUTER_MODELS_JSON: JSON.stringify(models),
  };
  const config = readAiModelRouterConfig(source, NOW);
  const seen = new Set<string>();
  const budget: AiBudgetStore = {
    reserve: vi.fn(async (value) => {
      if (seen.has(value.requestId)) return "duplicate";
      seen.add(value.requestId);
      return "reserved";
    }),
    finish: vi.fn(async () => {}),
  };
  const governor = new AiGovernor({
    store: budget,
    config: { ...readAiGovernorConfig({}), timeoutMs: 1000 },
  });
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json({
      text: "Завтра жаттығу DBMS and film a plan",
      languages: [{ code: "ru" }, { code: "kk" }, { code: "en" }],
      usage: { type: "duration", seconds: 1 },
    }),
  );
  const router = new AiModelRouter(config, {
    governor,
    settings: settingsStore,
    fetchImpl: fetcher,
    now: () => clock,
  });
  const request = {
    userId: OWNER,
    captureId: "capture-fixture",
    requestId: "capture-fixture:transcription:1",
    consentExpiresAt: new Date(NOW + 60_000).toISOString(),
    expectedSettingsRevision: 1,
  };
  const reference = validateTelegramVoice(
    {
      file_id: "synthetic",
      file_unique_id: "stable",
      duration: 1,
      mime_type: "audio/ogg",
      file_size: speechOgg().length,
    },
    NOW / 1000,
    new Date(NOW),
  );
  const audio = { bytes: speechOgg(), mimeType: "audio/ogg" as const };
  const download = vi.fn(async () => audio);
  async function run() {
    const prepared = await router.prepareSpeech(request);
    return transcribeCaptureVoice(
      {
        ...request,
        reference,
        consent: {
          confirmed: true,
          userId: OWNER,
          captureId: request.captureId,
          expiresAt: request.consentExpiresAt,
        },
      },
      { governor, ...prepared, download, now: () => new Date(clock) },
    );
  }
  return {
    config,
    source,
    settings,
    policies,
    router,
    request,
    reference,
    governor,
    budget,
    fetcher,
    audio,
    download,
    run,
    advance(ms: number) {
      clock += ms;
    },
  };
}
describe("speech uses the unified router policy and one existing governor reservation", () => {
  it("only prepares metadata until explicit governed execution; reserves120 seconds before download", async () => {
    const f = fixture();
    expect(f.config.configurationInvalid).toBe(false);
    const prepared = await f.router.prepareSpeech(f.request);
    expect(prepared.policy).toEqual({
      settingsRevision: 1,
      modelId: "speech",
      provider: "openai",
      maxRequestCostMicros: 9000,
    });
    expect(prepared.adapter.reservation).toMatchObject({
      feature: "classification",
      estimatedInputTokens: 3000,
      estimatedCostMicros: 9000,
      timeoutMs: 20000,
    });
    expect(f.budget.reserve).not.toHaveBeenCalled();
    expect(f.fetcher).not.toHaveBeenCalled();
    const output = await f.run();
    expect(output.languages).toEqual(["ru", "kk", "en"]);
    expect(f.budget.reserve).toHaveBeenCalledOnce();
    expect(f.budget.reserve).toHaveBeenCalledBefore(f.download);
    expect(f.budget.finish).toHaveBeenCalledWith(
      expect.objectContaining({
        routing: expect.objectContaining({
          attempts: 1,
          reportedCostMicros: 75,
        }),
      }),
      expect.any(AbortSignal),
    );
    expect(f.fetcher).toHaveBeenCalledOnce();
    expect(f.audio.bytes.every((v) => v === 0)).toBe(true);
    expect(JSON.stringify(vi.mocked(f.budget.finish).mock.calls)).not.toContain(
      output.transcript,
    );
    expect(
      JSON.stringify(vi.mocked(f.budget.reserve).mock.calls),
    ).not.toContain(KEY);
    await expect(f.run()).rejects.toMatchObject({
      code: "ai_duplicate_request",
    });
    expect(f.download).toHaveBeenCalledOnce();
    expect(f.fetcher).toHaveBeenCalledOnce();
  });
  it.each(["general", "health", "finance", "university"] as const)(
    "requires %s audio privacy consent before download",
    async (category) => {
      const f = fixture();
      f.settings.privacy[category] = [];
      await expect(f.run()).rejects.toMatchObject({
        code: "ai_router_privacy_not_allowed",
      });
      expect(f.download).not.toHaveBeenCalled();
      expect(f.budget.reserve).not.toHaveBeenCalled();
      expect(f.fetcher).not.toHaveBeenCalled();
    },
  );
  it("requires owner-scoped classification credentials and rejects automatic reuse of a chat key", async () => {
    const f = fixture();
    f.config.credentials[0].features = ["chat"];
    await expect(f.run()).rejects.toMatchObject({
      code: "ai_router_model_unavailable",
    });
    const other = fixture();
    await expect(
      other.router.prepareSpeech({
        ...other.request,
        userId: OTHER,
        expectedSettingsRevision: 0,
      }),
    ).rejects.toBeDefined();
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(other.fetcher).not.toHaveBeenCalled();
  });
  it.each([
    (f: ReturnType<typeof fixture>) => {
      f.config.enabled = false;
    },
    (f: ReturnType<typeof fixture>) => {
      f.config.paidRequestsEnabled = false;
    },
    (f: ReturnType<typeof fixture>) => {
      f.settings.spending.paidCallsAuthorized = false;
    },
    (f: ReturnType<typeof fixture>) => {
      f.settings.spending.maxRequestCostMicros = 8999;
    },
    (f: ReturnType<typeof fixture>) => {
      f.config.models[0].model.audioCostMicrosPerMinute = null;
    },
    (f: ReturnType<typeof fixture>) => {
      f.config.models[0].verifiedAtMs = NOW - 31 * 86400_000;
    },
    (f: ReturnType<typeof fixture>) => {
      f.config.models[0].model.capabilities = ["text", "json"];
    },
    (f: ReturnType<typeof fixture>) => {
      f.config.models[0].providerOnly = ["unsupported-pin"];
    },
    (f: ReturnType<typeof fixture>) => {
      f.config.models[0].model.provider = "openrouter";
    },
    (f: ReturnType<typeof fixture>) => {
      f.config.models[0].model.model = "whisper-1";
    },
  ])(
    "fails closed for disabled, unpriced, stale, unsupported or unauthorized paths",
    async (mutate) => {
      const f = fixture();
      mutate(f);
      await expect(f.run()).rejects.toBeDefined();
      expect(f.budget.reserve).not.toHaveBeenCalled();
      expect(f.download).not.toHaveBeenCalled();
      expect(f.fetcher).not.toHaveBeenCalled();
    },
  );
  it("rechecks policy revision, prices, credential scope and expiry after preparation", async () => {
    for (const mutate of [
      (f: ReturnType<typeof fixture>) => {
        f.policies.get(OWNER)!.revision++;
      },
      (f: ReturnType<typeof fixture>) => {
        f.config.models[0].model.audioCostMicrosPerMinute = 5000;
      },
      (f: ReturnType<typeof fixture>) => {
        f.config.credentials[0].features = ["chat"];
      },
      (f: ReturnType<typeof fixture>) => {
        f.config.credentials[0].secret = "sk-synthetic-unreviewed-replacement";
      },
      (f: ReturnType<typeof fixture>) => {
        f.advance(60000);
      },
    ]) {
      const f = fixture();
      const prepared = await f.router.prepareSpeech(f.request);
      mutate(f);
      expect(await prepared.authorize("before_download")).toBe(false);
      expect(await prepared.authorize("before_transcription")).toBe(false);
      expect(f.fetcher).not.toHaveBeenCalled();
    }
  });
  it("stops before provider dispatch when permission changes during the audio download", async () => {
    const f = fixture();
    vi.mocked(f.download).mockImplementation(async () => {
      f.policies.get(OWNER)!.revision++;
      return f.audio;
    });
    await expect(f.run()).rejects.toMatchObject({
      code: "voice_consent_required",
    });
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(f.audio.bytes.every((v) => v === 0)).toBe(true);
  });
  it("blocks quota without download and reports provider quota without fallback or key rotation", async () => {
    const denied = fixture();
    vi.mocked(denied.budget.reserve).mockResolvedValue("cost_budget_exceeded");
    await expect(denied.run()).rejects.toMatchObject({
      code: "ai_cost_budget_exceeded",
    });
    expect(denied.download).not.toHaveBeenCalled();
    expect(denied.fetcher).not.toHaveBeenCalled();
    const f = fixture();
    f.settings.fallback = {
      enabled: true,
      maxAttempts: 3,
      allowProviderChange: true,
    };
    f.fetcher.mockImplementation(
      async () => new Response("private quota body", { status: 429 }),
    );
    await expect(f.run()).rejects.toMatchObject({
      code: "ai_provider_unavailable",
      providerCategory: "ai_quota_exceeded",
    });
    expect(f.fetcher).toHaveBeenCalledOnce();
    expect(f.audio.bytes.every((v) => v === 0)).toBe(true);
  });
  it("requires the reviewed revision and never sends voice through the text/JSON transport", async () => {
    const f = fixture();
    await expect(
      f.router.prepareSpeech({ ...f.request, expectedSettingsRevision: 0 }),
    ).rejects.toMatchObject({ code: "ai_router_consent_changed" });
    await expect(
      f.router.execute({
        userId: OWNER,
        feature: "classification",
        task: { category: "voice", dataCategories: ["general"] },
        messages: [
          { role: "user", content: "audio must not become text/base64" },
        ],
        maxOutputTokens: 10,
      }),
    ).rejects.toMatchObject({ code: "ai_router_audio_transport_required" });
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(f.budget.reserve).not.toHaveBeenCalled();
  });
});
