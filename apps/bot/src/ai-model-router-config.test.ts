import { describe, expect, it } from "vitest";
import { readAiModelRouterConfig } from "./ai-model-router-config.js";

const OWNER = "10000000-0000-4000-8000-000000000001",
  NOW = Date.parse("2026-11-03T12:00:00Z");
const KEY = "sk-or-v1-synthetic-fixture-only";
function fixture() {
  const credentials = [
    {
      id: "project-a",
      provider: "openrouter",
      ownerUserId: OWNER,
      features: ["chat"],
      env: "OPENROUTER_API_KEY",
    },
  ];
  const models = [
    {
      id: "approved-model",
      label: "Synthetic catalog fixture",
      provider: "openrouter",
      model: "fixture/model",
      tiers: ["balanced"],
      capabilities: ["text", "json"],
      billing: "api",
      inputCostMicrosPer1k: 1000,
      outputCostMicrosPer1k: 2000,
      verifiedAt: new Date(NOW).toISOString(),
      source: "https://openrouter.ai/docs/models",
      credentialIds: ["project-a"],
      providerOnly: ["synthetic-provider"],
      requireZdr: true,
      sort: "price",
    },
  ];
  const source: Record<string, string> = {
    LIFEOS_AI_ROUTER_ENABLED: "true",
    LIFEOS_AI_ROUTER_PAID_REQUESTS_ENABLED: "false",
    LIFEOS_AI_ROUTER_MAX_REQUEST_COST_MICROS: "1000",
    LIFEOS_AI_ROUTER_MAX_DAILY_COST_MICROS: "5000",
    OPENROUTER_API_KEY: KEY,
  };
  return {
    credentials,
    models,
    source,
    read() {
      return readAiModelRouterConfig(
        {
          ...source,
          LIFEOS_AI_ROUTER_CREDENTIALS_JSON: JSON.stringify(credentials),
          LIFEOS_AI_ROUTER_MODELS_JSON: JSON.stringify(models),
        },
        NOW,
      );
    },
  };
}
describe("server-only model router configuration", () => {
  it("accepts reviewed native audio rates without inventing zero token prices", () => {
    const f = fixture();
    const source = {
      ...f.source,
      OPENAI_API_KEY: "sk-synthetic-native-audio-only",
      LIFEOS_AI_ROUTER_CREDENTIALS_JSON: JSON.stringify([
        {
          id: "speech-key",
          provider: "openai",
          ownerUserId: OWNER,
          features: ["classification"],
          env: "OPENAI_API_KEY",
        },
      ]),
      LIFEOS_AI_ROUTER_MODELS_JSON: JSON.stringify([
        {
          ...f.models[0],
          provider: "openai",
          model: "gpt-transcribe",
          tiers: ["voice"],
          capabilities: ["audio"],
          inputCostMicrosPer1k: null,
          outputCostMicrosPer1k: null,
          audioCostMicrosPerMinute: 4500,
          credentialIds: ["speech-key"],
          providerOnly: [],
          source:
            "https://developers.openai.com/api/docs/models/gpt-transcribe",
        },
      ]),
    };
    const config = readAiModelRouterConfig(source, NOW);
    expect(config.configurationInvalid).toBe(false);
    expect(config.models[0].model).toMatchObject({
      audioCostMicrosPerMinute: 4500,
      inputCostMicrosPer1k: null,
      outputCostMicrosPer1k: null,
    });
    for (const rate of [-1, 1.2, "4500"]) {
      const rows = JSON.parse(source.LIFEOS_AI_ROUTER_MODELS_JSON);
      rows[0].audioCostMicrosPerMinute = rate;
      expect(
        readAiModelRouterConfig(
          { ...source, LIFEOS_AI_ROUTER_MODELS_JSON: JSON.stringify(rows) },
          NOW,
        ).configurationInvalid,
      ).toBe(true);
    }
  });
  it("defaults to disabled without implicitly consuming existing provider keys", () => {
    const config = readAiModelRouterConfig(
      { OPENROUTER_API_KEY: KEY, GEMINI_API_KEY: "synthetic-gemini-key" },
      NOW,
    );
    expect(config).toMatchObject({
      enabled: false,
      paidRequestsEnabled: false,
      configurationInvalid: false,
      credentials: [],
      maxRequestCostMicros: 0,
      maxDailyCostMicros: 0,
    });
    expect(config.models).toHaveLength(4);
    expect(
      config.models.every(
        (row) =>
          !row.model.configured &&
          !row.model.authorized &&
          row.model.status === "disabled" &&
          row.credentialIds.length === 0,
      ),
    ).toBe(true);
  });
  it("loads explicit owned feature scopes and multiple models using a single key", () => {
    const f = fixture();
    f.models.push({
      ...f.models[0],
      id: "approved-second",
      model: "fixture/second",
    });
    const config = f.read();
    expect(config.configurationInvalid).toBe(false);
    expect(config.credentials).toHaveLength(1);
    expect(config.models).toHaveLength(2);
    expect(config.credentials[0]).toMatchObject({
      id: "project-a",
      ownerUserId: OWNER,
      features: ["chat"],
    });
    expect(config.models[0].model).toMatchObject({
      metadataVerified: true,
      configured: false,
      authorized: false,
    });
  });
  it("keeps optional project keys ordered and private", () => {
    const f = fixture();
    f.credentials.push({
      ...f.credentials[0],
      id: "project-b",
      env: "LIFEOS_OPENROUTER_KEY_SECOND",
    });
    f.models[0].credentialIds.push("project-b");
    f.source.LIFEOS_OPENROUTER_KEY_SECOND = "sk-or-v1-second-synthetic-fixture";
    const config = f.read();
    expect(config.configurationInvalid).toBe(false);
    expect(config.models[0].credentialIds).toEqual(["project-a", "project-b"]);
    expect(JSON.stringify(config.models)).not.toContain(KEY);
  });
  it.each([
    "https://attacker.example/models",
    "http://openrouter.ai/models",
    "https://openrouter.ai@attacker.example/models",
    "https://openrouter.ai/models?key=hidden",
    "https://openrouter.ai/models#secret",
  ])("rejects an untrusted metadata source %s", (source) => {
    const f = fixture();
    f.models[0].source = source;
    expect(f.read()).toMatchObject({
      configurationInvalid: true,
      enabled: false,
      credentials: [],
    });
  });
  it("rejects arbitrary endpoints, credential injection and undeclared cross-provider keys", () => {
    const f = fixture();
    (f.models[0] as unknown as Record<string, unknown>).baseUrl =
      "https://attacker.example";
    expect(f.read().configurationInvalid).toBe(true);
    const other = fixture();
    other.models[0].credentialIds = ["undeclared-key"];
    expect(other.read().configurationInvalid).toBe(true);
    const mismatch = fixture();
    mismatch.credentials[0].provider = "gemini";
    mismatch.credentials[0].env = "GEMINI_API_KEY";
    mismatch.source.GEMINI_API_KEY = "synthetic-gemini-key";
    expect(mismatch.read().configurationInvalid).toBe(true);
  });
  it("rejects configured secrets in displayed key labels and model metadata", () => {
    const f = fixture();
    f.credentials[0].id = KEY;
    f.models[0].credentialIds = [KEY];
    const config = f.read();
    expect(config.configurationInvalid).toBe(true);
    expect(JSON.stringify(config)).not.toContain(KEY);
    const g = fixture();
    g.models[0].label = "Accidentally pasted " + KEY;
    expect(g.read().configurationInvalid).toBe(true);
  });
  it.each(["openrouter", "gemini", "openai", "anthropic"])(
    "rejects native subscription OAuth/JWT values in the %s API-key slot",
    (provider) => {
      const env = (
        {
          openrouter: "OPENROUTER_API_KEY",
          gemini: "GEMINI_API_KEY",
          openai: "OPENAI_API_KEY",
          anthropic: "ANTHROPIC_API_KEY",
        } as Record<string, string>
      )[provider]!;
      for (const forbidden of [
        "sk-ant-oat01-synthetic-native-session",
        "eyJhbGci.eyJzdWI.synthetic-signature",
      ]) {
        const source = {
          LIFEOS_AI_ROUTER_ENABLED: "true",
          LIFEOS_AI_ROUTER_CREDENTIALS_JSON: JSON.stringify([
            {
              id: "native",
              provider,
              ownerUserId: OWNER,
              features: ["chat"],
              env,
            },
          ]),
          [env]: forbidden,
        };
        const config = readAiModelRouterConfig(source, NOW);
        expect(config).toMatchObject({
          configurationInvalid: true,
          enabled: false,
          credentials: [],
        });
        expect(JSON.stringify(config)).not.toContain(forbidden);
      }
    },
  );
  it("marks stale, future and unpriceable automatic catalogs unavailable", () => {
    const stale = fixture();
    stale.models[0].verifiedAt = new Date(NOW - 31 * 86400_000).toISOString();
    expect(stale.read().models[0].model.metadataVerified).toBe(false);
    const future = fixture();
    future.models[0].verifiedAt = new Date(NOW + 1).toISOString();
    expect(future.read().models[0].model.metadataVerified).toBe(false);
    const auto = fixture();
    auto.models[0].model = "openrouter/auto";
    expect(auto.read().models[0].model.metadataVerified).toBe(false);
    for (const alias of [
      "openrouter/auto:floor",
      "openrouter/auto-beta",
      "openrouter/free",
    ]) {
      auto.models[0].model = alias;
      expect(auto.read().models[0].model.metadataVerified).toBe(false);
    }
  });
  it.each(["yes", "TRUE", "1"])(
    "does not enable execution from an ambiguous operator flag %s",
    (flag) => {
      expect(
        readAiModelRouterConfig({ LIFEOS_AI_ROUTER_ENABLED: flag }, NOW),
      ).toMatchObject({ enabled: false, configurationInvalid: true });
    },
  );
  it("validates quotas and enforces subscription/API billing separation", () => {
    const f = fixture();
    f.source.LIFEOS_AI_ROUTER_MAX_DAILY_COST_MICROS = "-1";
    expect(f.read().configurationInvalid).toBe(true);
    const g = fixture();
    g.models[0].billing = "chatgpt_plan";
    expect(g.read().configurationInvalid).toBe(true);
    const h = fixture();
    h.credentials[0].env = "ARBITRARY_AUTH_TOKEN";
    expect(h.read().configurationInvalid).toBe(true);
  });
});
