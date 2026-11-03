import { INITIAL_AI_MODEL_CATALOG } from "./ai-model-router-catalog.js";
import {
  AI_EXECUTION_FEATURES,
  AI_ROUTER_PROVIDERS,
  AI_ROUTER_TIERS,
  AI_ROUTER_CAPABILITIES,
  projectAiRouterModel,
  type AiRouterModel,
  type AiRouterProviderId,
  type AiExecutionFeature,
  type EnvSource,
} from "@lifeos/core";

export interface RouterCredential {
  id: string;
  provider: Exclude<AiRouterProviderId, "chatgpt_plan">;
  ownerUserId: string;
  features: AiExecutionFeature[];
  secret: string;
}
export interface RouterModelConfiguration {
  model: AiRouterModel;
  credentialIds: string[];
  verifiedAtMs: number;
  providerOnly: string[];
  sort: "price" | "latency" | "throughput";
  requireZdr: boolean;
}
export interface AiModelRouterConfig {
  enabled: boolean;
  paidRequestsEnabled: boolean;
  configurationInvalid: boolean;
  maxRequestCostMicros: number;
  maxDailyCostMicros: number;
  maxOutputTokens: number;
  credentials: RouterCredential[];
  models: RouterModelConfiguration[];
}
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const label = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const modelId = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/;
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new Error("invalid_router_configuration");
  return v as Record<string, unknown>;
}
function bounded(value: unknown, min: number, max: number): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  )
    throw new Error("invalid_router_configuration");
  return value;
}
function integer(
  source: EnvSource,
  key: string,
  fallback: number,
  max = 1_000_000_000_000,
) {
  const raw = source[key];
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) throw new Error("invalid_router_configuration");
  return bounded(Number(raw), 0, max);
}
function flag(source: EnvSource, key: string) {
  const v = source[key] ?? "false";
  if (!["true", "false"].includes(v))
    throw new Error("invalid_router_configuration");
  return v === "true";
}
function array<T>(v: unknown, allowed: readonly T[], max: number): T[] {
  if (
    !Array.isArray(v) ||
    v.length > max ||
    new Set(v).size !== v.length ||
    v.some((x) => !allowed.includes(x))
  )
    throw new Error("invalid_router_configuration");
  return [...v];
}
function json(source: EnvSource, key: string): unknown[] {
  const raw = source[key] ?? "[]";
  if (Buffer.byteLength(raw) > 64 * 1024)
    throw new Error("invalid_router_configuration");
  const v: unknown = JSON.parse(raw);
  if (!Array.isArray(v) || v.length > 64)
    throw new Error("invalid_router_configuration");
  return v;
}
const envNames: Record<Exclude<AiRouterProviderId, "chatgpt_plan">, RegExp> = {
  gemini: /^(?:GEMINI_API_KEY|LIFEOS_GEMINI_KEY_[A-Z0-9_]+)$/,
  openrouter: /^(?:OPENROUTER_API_KEY|LIFEOS_OPENROUTER_KEY_[A-Z0-9_]+)$/,
  openai: /^(?:OPENAI_API_KEY|LIFEOS_OPENAI_KEY_[A-Z0-9_]+)$/,
  anthropic: /^(?:ANTHROPIC_API_KEY|LIFEOS_ANTHROPIC_KEY_[A-Z0-9_]+)$/,
};
/** Configuration metadata references env names; secret values are never projected. */
export function readAiModelRouterConfig(
  source: EnvSource = process.env,
  now = Date.now(),
): AiModelRouterConfig {
  const inert: AiModelRouterConfig = {
    enabled: false,
    paidRequestsEnabled: false,
    configurationInvalid: false,
    maxRequestCostMicros: 0,
    maxDailyCostMicros: 0,
    maxOutputTokens: 2048,
    credentials: [],
    models: [],
  };
  try {
    const enabled = flag(source, "LIFEOS_AI_ROUTER_ENABLED");
    const paidRequestsEnabled = flag(
      source,
      "LIFEOS_AI_ROUTER_PAID_REQUESTS_ENABLED",
    );
    const credentials: RouterCredential[] = json(
      source,
      "LIFEOS_AI_ROUTER_CREDENTIALS_JSON",
    ).map((raw) => {
      const v = object(raw);
      if (
        Object.keys(v).some(
          (k) =>
            !["id", "provider", "ownerUserId", "features", "env"].includes(k),
        )
      )
        throw new Error("invalid_router_configuration");
      if (
        typeof v.id !== "string" ||
        !label.test(v.id) ||
        typeof v.ownerUserId !== "string" ||
        !uuid.test(v.ownerUserId) ||
        !["gemini", "openrouter", "openai", "anthropic"].includes(
          String(v.provider),
        )
      )
        throw new Error("invalid_router_configuration");
      const provider = v.provider as RouterCredential["provider"];
      if (typeof v.env !== "string" || !envNames[provider].test(v.env))
        throw new Error("invalid_router_configuration");
      const secret = source[v.env] ?? "";
      if (secret.length > 1024 || /[\r\n]/.test(secret))
        throw new Error("invalid_router_configuration");
      if (
        secret.startsWith("sk-ant-oat") ||
        /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(secret)
      )
        throw new Error("invalid_router_configuration");
      // Subscription OAuth tokens are never accepted under API-key variable names.
      if (
        secret &&
        ((provider === "anthropic" && !secret.startsWith("sk-ant-api")) ||
          (provider === "openai" && !secret.startsWith("sk-")))
      )
        throw new Error("invalid_router_configuration");
      return {
        id: v.id,
        provider,
        ownerUserId: v.ownerUserId,
        features: array(v.features, AI_EXECUTION_FEATURES, 8),
        secret,
      };
    });
    if (new Set(credentials.map((c) => c.id)).size !== credentials.length)
      throw new Error("invalid_router_configuration");
    if (
      credentials.some(
        (key) =>
          key.secret &&
          credentials.some(
            (label) =>
              label.id === key.secret ||
              (key.secret.length >= 12 && label.id.includes(key.secret)),
          ),
      )
    )
      throw new Error("invalid_router_configuration");
    const modelRows = json(
      {
        ...source,
        LIFEOS_AI_ROUTER_MODELS_JSON:
          source.LIFEOS_AI_ROUTER_MODELS_JSON ??
          JSON.stringify(INITIAL_AI_MODEL_CATALOG),
      },
      "LIFEOS_AI_ROUTER_MODELS_JSON",
    );
    // Accidentally inserting a configured secret into catalog labels fails closed.
    const rawModels = JSON.stringify(modelRows);
    if (
      credentials.some(
        (c) => c.secret.length >= 12 && rawModels.includes(c.secret),
      )
    )
      throw new Error("invalid_router_configuration");
    const models: RouterModelConfiguration[] = modelRows.map((raw) => {
      const v = object(raw);
      if (
        Object.keys(v).some(
          (k) =>
            ![
              "id",
              "label",
              "provider",
              "model",
              "tiers",
              "capabilities",
              "billing",
              "inputCostMicrosPer1k",
              "outputCostMicrosPer1k",
              "audioCostMicrosPerMinute",
              "verifiedAt",
              "source",
              "credentialIds",
              "providerOnly",
              "sort",
              "requireZdr",
              "reliabilityScore",
              "latencyMs",
            ].includes(k),
        )
      )
        throw new Error("invalid_router_configuration");
      if (
        typeof v.id !== "string" ||
        !modelId.test(v.id) ||
        v.id.includes("://") ||
        typeof v.model !== "string" ||
        !modelId.test(v.model) ||
        v.model.includes("://") ||
        typeof v.label !== "string" ||
        v.label.length < 1 ||
        v.label.length > 120 ||
        /[\u0000-\u001f\u007f]/.test(v.label) ||
        !AI_ROUTER_PROVIDERS.includes(v.provider as AiRouterProviderId) ||
        !["api", "free", "chatgpt_plan"].includes(String(v.billing))
      )
        throw new Error("invalid_router_configuration");
      const provider = v.provider as AiRouterProviderId;
      if ((provider === "chatgpt_plan") !== (v.billing === "chatgpt_plan"))
        throw new Error("invalid_router_configuration");
      const evidence = new URL(String(v.source));
      if (
        evidence.protocol !== "https:" ||
        evidence.username ||
        evidence.password ||
        evidence.search ||
        evidence.hash ||
        ![
          "openrouter.ai",
          "ai.google.dev",
          "aistudio.google.com",
          "developers.openai.com",
          "platform.openai.com",
          "platform.claude.com",
          "docs.anthropic.com",
        ].includes(evidence.hostname)
      )
        throw new Error("invalid_router_configuration");
      const stamp = Date.parse(String(v.verifiedAt));
      if (!Number.isFinite(stamp))
        throw new Error("invalid_router_configuration");
      const metadataVerified = stamp <= now && now - stamp <= 30 * 86400_000;
      const credentialIds = v.credentialIds;
      if (
        !Array.isArray(credentialIds) ||
        credentialIds.length > 3 ||
        credentialIds.some((x) => typeof x !== "string" || !label.test(x)) ||
        new Set(credentialIds).size !== credentialIds.length
      )
        throw new Error("invalid_router_configuration");
      if (
        credentialIds.some(
          (id) =>
            !credentials.some((c) => c.id === id && c.provider === provider),
        )
      )
        throw new Error("invalid_router_configuration");
      const price = (n: unknown) =>
        n === null ? null : bounded(n, 0, 1_000_000_000_000);
      const tiers = array(
        v.tiers,
        AI_ROUTER_TIERS.filter((x) => x !== "deterministic"),
        5,
      );
      const capabilities = array(v.capabilities, AI_ROUTER_CAPABILITIES, 4);
      if (!tiers.length || !capabilities.length)
        throw new Error("invalid_router_configuration");
      if (
        v.reliabilityScore !== undefined &&
        (typeof v.reliabilityScore !== "number" ||
          !Number.isFinite(v.reliabilityScore) ||
          v.reliabilityScore < 0 ||
          v.reliabilityScore > 1)
      )
        throw new Error("invalid_router_configuration");
      const model: AiRouterModel = {
        id: v.id,
        label: v.label,
        provider,
        model: v.model,
        tiers,
        capabilities,
        billing: v.billing as AiRouterModel["billing"],
        inputCostMicrosPer1k: price(v.inputCostMicrosPer1k),
        outputCostMicrosPer1k: price(v.outputCostMicrosPer1k),
        ...(v.audioCostMicrosPerMinute === undefined
          ? {}
          : { audioCostMicrosPerMinute: price(v.audioCostMicrosPerMinute) }),
        configured: false,
        authorized: false,
        status: enabled ? "disconnected" : "disabled",
        privacy: "external",
        metadataVerified,
        planScopeGranted: false,
        ...(v.reliabilityScore !== undefined
          ? { reliabilityScore: v.reliabilityScore as number }
          : {}),
        ...(v.latencyMs !== undefined
          ? { latencyMs: bounded(v.latencyMs, 0, 3600000) }
          : {}),
      };
      // Optional openrouter/auto is not a priceable model; no unrestricted auto routing.
      if (model.model.startsWith("openrouter/")) model.metadataVerified = false;
      const only = v.providerOnly ?? [];
      if (
        !Array.isArray(only) ||
        only.length > 20 ||
        only.some(
          (x) => typeof x !== "string" || !modelId.test(x) || x.includes("://"),
        )
      )
        throw new Error("invalid_router_configuration");
      const sort = v.sort ?? "price";
      if (
        !["price", "latency", "throughput"].includes(String(sort)) ||
        (v.requireZdr !== undefined && typeof v.requireZdr !== "boolean")
      )
        throw new Error("invalid_router_configuration");
      return {
        model: projectAiRouterModel(model),
        verifiedAtMs: stamp,
        credentialIds: [...credentialIds],
        providerOnly: [...only],
        sort: sort as RouterModelConfiguration["sort"],
        requireZdr: v.requireZdr !== false,
      };
    });
    if (new Set(models.map((m) => m.model.id)).size !== models.length)
      throw new Error("invalid_router_configuration");
    return {
      enabled,
      paidRequestsEnabled,
      configurationInvalid: false,
      credentials,
      models,
      maxRequestCostMicros: integer(
        source,
        "LIFEOS_AI_ROUTER_MAX_REQUEST_COST_MICROS",
        0,
      ),
      maxDailyCostMicros: integer(
        source,
        "LIFEOS_AI_ROUTER_MAX_DAILY_COST_MICROS",
        0,
      ),
      maxOutputTokens: bounded(
        integer(source, "LIFEOS_AI_ROUTER_MAX_OUTPUT_TOKENS", 2048, 8192),
        1,
        8192,
      ),
    };
  } catch {
    return { ...inert, configurationInvalid: true };
  }
}
