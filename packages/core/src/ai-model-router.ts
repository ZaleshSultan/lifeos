/** Routing policy only. Provider I/O, credentials and durable budgets stay at trusted boundaries. */
export const AI_ROUTER_PROVIDERS = [
  "gemini",
  "openrouter",
  "openai",
  "anthropic",
  "chatgpt_plan",
] as const;
export type AiRouterProviderId = (typeof AI_ROUTER_PROVIDERS)[number];
export const AI_ROUTER_TIERS = [
  "deterministic",
  "fast",
  "balanced",
  "advanced",
  "vision",
  "voice",
] as const;
export type AiRouterTier = (typeof AI_ROUTER_TIERS)[number];
export type AiRouterModelTier = Exclude<AiRouterTier, "deterministic">;
export const AI_ROUTER_CAPABILITIES = [
  "text",
  "json",
  "vision",
  "audio",
] as const;
export type AiRouterCapability = (typeof AI_ROUTER_CAPABILITIES)[number];
export const AI_ROUTER_DATA_CATEGORIES = [
  "general",
  "health",
  "finance",
  "university",
] as const;
export type AiRouterDataCategory = (typeof AI_ROUTER_DATA_CATEGORIES)[number];
export type AiRouterBilling = "api" | "chatgpt_plan" | "free";
export interface AiRouterSettings {
  version: 1;
  mode: "auto" | "manual";
  allowedTiers: AiRouterTier[];
  allowedProviders: AiRouterProviderId[];
  manualModelId: string | null;
  tierModels: Record<AiRouterModelTier, string[]>;
  privacy: Record<AiRouterDataCategory, AiRouterProviderId[]>;
  spending: {
    paidCallsAuthorized: boolean;
    maxRequestCostMicros: number;
    maxDailyCostMicros: number;
  };
  fallback: {
    enabled: boolean;
    maxAttempts: number;
    allowProviderChange: boolean;
  };
}
/** Public catalog metadata, never a credential container or an arbitrary endpoint. */
export interface AiRouterModel {
  id: string;
  label: string;
  provider: AiRouterProviderId;
  model: string;
  tiers: AiRouterModelTier[];
  capabilities: AiRouterCapability[];
  billing: AiRouterBilling;
  inputCostMicrosPer1k: number | null;
  outputCostMicrosPer1k: number | null;
  /** Reviewed native transcription rate; absent on text-only legacy catalogs. */
  audioCostMicrosPerMinute?: number | null;
  configured: boolean;
  authorized: boolean;
  status:
    | "configured"
    | "connected"
    | "disconnected"
    | "expired"
    | "permission_required"
    | "disabled";
  privacy: "external" | "local";
  metadataVerified: boolean;
  planScopeGranted?: boolean;
  reliabilityScore?: number | null;
  latencyMs?: number | null;
}
export const AI_ROUTER_TASK_CATEGORIES = [
  "deterministic",
  "tagging",
  "classification",
  "chat",
  "planning",
  "complex_reasoning",
  "nutrition_photo",
  "code",
  "document_extraction",
  "voice",
] as const;
export type AiRouterTaskCategory = (typeof AI_ROUTER_TASK_CATEGORIES)[number];
/** Categories describe the actual data leaving LifeOS, not a model's claimed privacy. */
export interface AiRouterTask {
  category: AiRouterTaskCategory;
  dataCategories: AiRouterDataCategory[];
  requiredCapabilities?: AiRouterCapability[];
}
export interface AiRouterCandidate {
  modelId: string;
  label: string;
  provider: AiRouterProviderId;
  model: string;
  billing: AiRouterBilling;
  estimatedCostMicros: number | null;
  privacy: "external" | "local";
}
export type AiRouterBlockedReason =
  | "invalid_request"
  | "invalid_settings"
  | "invalid_registry"
  | "tier_not_allowed"
  | "model_not_allowlisted"
  | "manual_model_required"
  | "model_unavailable"
  | "capability_unavailable"
  | "provider_not_allowed"
  | "permission_required"
  | "privacy_not_allowed"
  | "pricing_unavailable"
  | "paid_authorization_required"
  | "cost_limit"
  | "plan_permission_required";
export type AiRouterSelectionReason =
  | "automatic_tier"
  | "manual_selection"
  | "conversation_consistency"
  | "automatic_fallback";
export type AiRouterDecision =
  | {
      version: 1;
      kind: "deterministic";
      tier: "deterministic";
      reason: "deterministic_rules";
      explanation: string;
      candidates: [];
      fallbackAllowed: false;
      fallbackAtSelection: false;
    }
  | {
      version: 1;
      kind: "selected";
      tier: AiRouterTier;
      reason: AiRouterSelectionReason;
      explanation: string;
      candidates: AiRouterCandidate[];
      fallbackAllowed: boolean;
      fallbackAtSelection: boolean;
    }
  | {
      version: 1;
      kind: "unavailable";
      tier: AiRouterTier | null;
      reason: AiRouterBlockedReason;
      explanation: string;
      candidates: [];
      fallbackAllowed: false;
      fallbackAtSelection: false;
    };
const MODEL_TIERS = AI_ROUTER_TIERS.filter(
  (tier): tier is AiRouterModelTier => tier !== "deterministic",
);
const MAX_MICROS = 1_000_000_000_000;
export class AiRouterValidationError extends Error {
  readonly code = "ai_router_invalid_settings";
  constructor(readonly field: string) {
    super("Invalid AI router settings: " + field);
    this.name = "AiRouterValidationError";
  }
}
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  [null, Object.prototype].includes(Object.getPrototypeOf(value));
const own = (value: object, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);
const keys = (
  value: unknown,
  expected: readonly string[],
  field: string,
): Record<string, unknown> => {
  if (
    !record(value) ||
    Object.keys(value).length !== expected.length ||
    expected.some((key) => !own(value, key))
  )
    throw new AiRouterValidationError(field);
  return value;
};
const bool = (value: unknown, field: string) => {
  if (typeof value !== "boolean") throw new AiRouterValidationError(field);
  return value;
};
const integer = (value: unknown, min: number, max: number, field: string) => {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  )
    throw new AiRouterValidationError(field);
  return value;
};
export function isAiRouterModelId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(value) &&
    !value.includes("://")
  );
}
function list<T extends string>(
  value: unknown,
  allowed: readonly T[],
  max: number,
  field: string,
): T[] {
  if (
    !Array.isArray(value) ||
    value.length > max ||
    value.some(
      (item) => typeof item !== "string" || !allowed.includes(item as T),
    ) ||
    new Set(value).size !== value.length
  )
    throw new AiRouterValidationError(field);
  return [...value] as T[];
}
export function defaultAiRouterSettings(): AiRouterSettings {
  return {
    version: 1,
    mode: "auto",
    allowedTiers: ["deterministic"],
    allowedProviders: [],
    manualModelId: null,
    tierModels: { fast: [], balanced: [], advanced: [], vision: [], voice: [] },
    privacy: { general: [], health: [], finance: [], university: [] },
    spending: {
      paidCallsAuthorized: false,
      maxRequestCostMicros: 0,
      maxDailyCostMicros: 0,
    },
    fallback: { enabled: false, maxAttempts: 1, allowProviderChange: false },
  };
}
/** Strict full-document parser: credentials, endpoints and unknown policy fields are rejected. */
export function parseAiRouterSettings(value: unknown): AiRouterSettings {
  const v = keys(
    value,
    [
      "version",
      "mode",
      "allowedTiers",
      "allowedProviders",
      "manualModelId",
      "tierModels",
      "privacy",
      "spending",
      "fallback",
    ],
    "settings",
  );
  if (v.version !== 1) throw new AiRouterValidationError("version");
  if (v.mode !== "auto" && v.mode !== "manual")
    throw new AiRouterValidationError("mode");
  if (v.manualModelId !== null && !isAiRouterModelId(v.manualModelId))
    throw new AiRouterValidationError("manualModelId");
  const tiers = keys(v.tierModels, MODEL_TIERS, "tierModels");
  const tierModels = {} as Record<AiRouterModelTier, string[]>;
  for (const tier of MODEL_TIERS) {
    const ids = tiers[tier];
    if (
      !Array.isArray(ids) ||
      ids.length > 12 ||
      ids.some((id) => !isAiRouterModelId(id)) ||
      new Set(ids).size !== ids.length
    )
      throw new AiRouterValidationError("tierModels." + tier);
    tierModels[tier] = [...ids];
  }
  const privacyValue = keys(v.privacy, AI_ROUTER_DATA_CATEGORIES, "privacy");
  const privacy = {} as AiRouterSettings["privacy"];
  for (const category of AI_ROUTER_DATA_CATEGORIES)
    privacy[category] = list(
      privacyValue[category],
      AI_ROUTER_PROVIDERS,
      5,
      "privacy." + category,
    );
  const spending = keys(
    v.spending,
    ["paidCallsAuthorized", "maxRequestCostMicros", "maxDailyCostMicros"],
    "spending",
  );
  const fallback = keys(
    v.fallback,
    ["enabled", "maxAttempts", "allowProviderChange"],
    "fallback",
  );
  return {
    version: 1,
    mode: v.mode,
    allowedTiers: list(v.allowedTiers, AI_ROUTER_TIERS, 6, "allowedTiers"),
    allowedProviders: list(
      v.allowedProviders,
      AI_ROUTER_PROVIDERS,
      5,
      "allowedProviders",
    ),
    manualModelId: v.manualModelId as string | null,
    tierModels,
    privacy,
    spending: {
      paidCallsAuthorized: bool(
        spending.paidCallsAuthorized,
        "spending.paidCallsAuthorized",
      ),
      maxRequestCostMicros: integer(
        spending.maxRequestCostMicros,
        0,
        MAX_MICROS,
        "spending.maxRequestCostMicros",
      ),
      maxDailyCostMicros: integer(
        spending.maxDailyCostMicros,
        0,
        MAX_MICROS,
        "spending.maxDailyCostMicros",
      ),
    },
    fallback: {
      enabled: bool(fallback.enabled, "fallback.enabled"),
      maxAttempts: integer(fallback.maxAttempts, 1, 3, "fallback.maxAttempts"),
      allowProviderChange: bool(
        fallback.allowProviderChange,
        "fallback.allowProviderChange",
      ),
    },
  };
}
/** No prompt is sent to a model to classify routing complexity. */
export function classifyAiRouterTask(category: AiRouterTaskCategory): {
  tier: AiRouterTier;
  capabilities: AiRouterCapability[];
} {
  switch (category) {
    case "deterministic":
    case "tagging":
      return { tier: "deterministic", capabilities: [] };
    case "classification":
      return { tier: "fast", capabilities: ["text"] };
    case "chat":
    case "planning":
    case "document_extraction":
      return { tier: "balanced", capabilities: ["text"] };
    case "complex_reasoning":
    case "code":
      return { tier: "advanced", capabilities: ["text"] };
    case "nutrition_photo":
      return { tier: "vision", capabilities: ["text", "vision"] };
    case "voice":
      return { tier: "voice", capabilities: ["audio"] };
  }
}
function validModel(m: AiRouterModel): boolean {
  const price = (v: unknown) =>
    v === null ||
    (typeof v === "number" &&
      Number.isSafeInteger(v) &&
      v >= 0 &&
      v <= MAX_MICROS);
  const unique = (v: unknown, allowed: readonly string[]) =>
    Array.isArray(v) &&
    v.length > 0 &&
    new Set(v).size === v.length &&
    v.every((x) => typeof x === "string" && allowed.includes(x));
  return (
    record(m) &&
    isAiRouterModelId(m.id) &&
    isAiRouterModelId(m.model) &&
    typeof m.label === "string" &&
    m.label.length > 0 &&
    m.label.length <= 120 &&
    !/[\u0000-\u001f\u007f]/.test(m.label) &&
    AI_ROUTER_PROVIDERS.includes(m.provider) &&
    unique(m.tiers, MODEL_TIERS) &&
    unique(m.capabilities, AI_ROUTER_CAPABILITIES) &&
    ["api", "chatgpt_plan", "free"].includes(m.billing) &&
    price(m.inputCostMicrosPer1k) &&
    price(m.outputCostMicrosPer1k) &&
    (m.audioCostMicrosPerMinute === undefined ||
      price(m.audioCostMicrosPerMinute)) &&
    typeof m.configured === "boolean" &&
    typeof m.authorized === "boolean" &&
    [
      "configured",
      "connected",
      "disconnected",
      "expired",
      "permission_required",
      "disabled",
    ].includes(m.status) &&
    ["external", "local"].includes(m.privacy) &&
    typeof m.metadataVerified === "boolean" &&
    (m.planScopeGranted === undefined ||
      typeof m.planScopeGranted === "boolean") &&
    (m.reliabilityScore === undefined ||
      m.reliabilityScore === null ||
      (typeof m.reliabilityScore === "number" &&
        Number.isFinite(m.reliabilityScore) &&
        m.reliabilityScore >= 0 &&
        m.reliabilityScore <= 1)) &&
    (m.latencyMs === undefined ||
      m.latencyMs === null ||
      (Number.isSafeInteger(m.latencyMs) &&
        m.latencyMs >= 0 &&
        m.latencyMs <= 3_600_000)) &&
    (m.provider === "chatgpt_plan"
      ? m.billing === "chatgpt_plan"
      : m.billing !== "chatgpt_plan")
  );
}
/** Plan usage is not priced as API credits or represented as zero-cost API inference. */
export function estimateAiRouterCost(
  model: AiRouterModel,
  inputTokens: number,
  outputTokens: number,
): number | null {
  const prices = [model.inputCostMicrosPer1k, model.outputCostMicrosPer1k];
  if (
    model.billing === "chatgpt_plan" ||
    prices.some(
      (v) =>
        typeof v !== "number" ||
        !Number.isSafeInteger(v) ||
        v < 0 ||
        v > MAX_MICROS,
    ) ||
    (model.billing === "free" && prices.some((v) => v !== 0)) ||
    !Number.isSafeInteger(inputTokens) ||
    inputTokens < 0 ||
    !Number.isSafeInteger(outputTokens) ||
    outputTokens < 0
  )
    return null;
  // The explicit number guard above is also required for calls outside selection.
  if (
    model.inputCostMicrosPer1k === null ||
    model.outputCostMicrosPer1k === null
  )
    return null;
  const amount =
    (BigInt(inputTokens) * BigInt(model.inputCostMicrosPer1k) + 999n) / 1000n +
    (BigInt(outputTokens) * BigInt(model.outputCostMicrosPer1k) + 999n) / 1000n;
  return amount > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(amount);
}
/** A voice route reserves the entire LifeOS 120-second cap, never sender duration. */
export function estimateAiRouterSpeechCost(
  model: AiRouterModel,
): number | null {
  const rate = model.audioCostMicrosPerMinute;
  if (
    model.billing !== "api" ||
    typeof rate !== "number" ||
    !Number.isSafeInteger(rate) ||
    rate <= 0 ||
    rate > MAX_MICROS ||
    !model.capabilities.includes("audio")
  )
    return null;
  const amount = BigInt(rate) * 2n;
  return amount > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(amount);
}
/** Explicit projection; accidental extra credential/config fields are never spread into DTOs. */
export function projectAiRouterModel(model: AiRouterModel): AiRouterModel {
  return {
    id: model.id,
    label: model.label,
    provider: model.provider,
    model: model.model,
    tiers: [...model.tiers],
    capabilities: [...model.capabilities],
    billing: model.billing,
    inputCostMicrosPer1k: model.inputCostMicrosPer1k,
    outputCostMicrosPer1k: model.outputCostMicrosPer1k,
    ...(model.audioCostMicrosPerMinute === undefined
      ? {}
      : { audioCostMicrosPerMinute: model.audioCostMicrosPerMinute }),
    configured: model.configured,
    authorized: model.authorized,
    status: model.status,
    privacy: model.privacy,
    metadataVerified: model.metadataVerified,
    ...(model.planScopeGranted === undefined
      ? {}
      : { planScopeGranted: model.planScopeGranted }),
    ...(model.reliabilityScore === undefined
      ? {}
      : { reliabilityScore: model.reliabilityScore }),
    ...(model.latencyMs === undefined ? {} : { latencyMs: model.latencyMs }),
  };
}
const EXPLANATIONS: Record<AiRouterBlockedReason, string> = {
  invalid_request: "The routing request is invalid.",
  invalid_settings: "Routing settings are unavailable or invalid.",
  invalid_registry: "The reviewed model catalog is invalid.",
  tier_not_allowed: "This task tier is not enabled.",
  model_not_allowlisted:
    "The selected model is outside the approved shortlist.",
  manual_model_required: "Choose an approved model for manual selection.",
  model_unavailable: "The approved model is not configured or available.",
  capability_unavailable: "The approved model lacks a required capability.",
  provider_not_allowed: "The provider is not allowed by the current settings.",
  permission_required: "The owner must authorize this provider connection.",
  privacy_not_allowed: "This data category is not approved for the provider.",
  pricing_unavailable: "Verified pricing is required for this billing path.",
  paid_authorization_required:
    "Paid provider requests require explicit owner authorization.",
  cost_limit: "The estimated request cost exceeds a spending limit.",
  plan_permission_required:
    "ChatGPT identity and explicit plan-usage permission are required.",
};
function unavailable(
  reason: AiRouterBlockedReason,
  tier: AiRouterTier | null,
): AiRouterDecision {
  return {
    version: 1,
    kind: "unavailable",
    tier,
    reason,
    explanation: EXPLANATIONS[reason],
    candidates: [],
    fallbackAllowed: false,
    fallbackAtSelection: false,
  };
}
export interface AiRouterSelectionInput {
  task: AiRouterTask;
  settings: AiRouterSettings;
  models: readonly AiRouterModel[];
  estimatedInputTokens: number;
  maxOutputTokens: number;
  previousModelId?: string;
  /** Trusted ledger hint only; durable reservation must independently enforce the daily limit. */
  remainingDailyCostMicros?: number;
}
export function selectAiModelRoute(
  input: AiRouterSelectionInput,
): AiRouterDecision {
  const task = input.task;
  if (
    !record(task) ||
    !AI_ROUTER_TASK_CATEGORIES.includes(task.category) ||
    !Array.isArray(task.dataCategories) ||
    task.dataCategories.length < 1 ||
    task.dataCategories.length > 4 ||
    new Set(task.dataCategories).size !== task.dataCategories.length ||
    task.dataCategories.some((v) => !AI_ROUTER_DATA_CATEGORIES.includes(v)) ||
    (task.requiredCapabilities !== undefined &&
      (!Array.isArray(task.requiredCapabilities) ||
        task.requiredCapabilities.length > 4 ||
        new Set(task.requiredCapabilities).size !==
          task.requiredCapabilities.length ||
        task.requiredCapabilities.some(
          (v) => !AI_ROUTER_CAPABILITIES.includes(v),
        )))
  )
    return unavailable("invalid_request", null);
  const classification = classifyAiRouterTask(task.category);
  if (classification.tier === "deterministic") {
    if (task.requiredCapabilities?.length)
      return unavailable("invalid_request", "deterministic");
    return {
      version: 1,
      kind: "deterministic",
      tier: "deterministic",
      reason: "deterministic_rules",
      explanation: "LifeOS rules handle this task without an external model.",
      candidates: [],
      fallbackAllowed: false,
      fallbackAtSelection: false,
    };
  }
  const tier = classification.tier;
  if (
    !Number.isSafeInteger(input.estimatedInputTokens) ||
    input.estimatedInputTokens < 0 ||
    input.estimatedInputTokens > 10_000_000 ||
    !Number.isSafeInteger(input.maxOutputTokens) ||
    input.maxOutputTokens < 1 ||
    input.maxOutputTokens > 10_000_000 ||
    (input.remainingDailyCostMicros !== undefined &&
      (!Number.isSafeInteger(input.remainingDailyCostMicros) ||
        input.remainingDailyCostMicros < 0 ||
        input.remainingDailyCostMicros > MAX_MICROS)) ||
    (input.previousModelId !== undefined &&
      !isAiRouterModelId(input.previousModelId))
  )
    return unavailable("invalid_request", tier);
  let settings: AiRouterSettings;
  try {
    settings = parseAiRouterSettings(input.settings);
  } catch {
    return unavailable("invalid_settings", tier);
  }
  if (
    !Array.isArray(input.models) ||
    input.models.length > 128 ||
    input.models.some((m) => !validModel(m)) ||
    new Set(input.models.map((m) => m.id)).size !== input.models.length
  )
    return unavailable("invalid_registry", tier);
  const capabilities = [
    ...new Set([
      ...classification.capabilities,
      ...(task.requiredCapabilities ?? []),
    ]),
  ];
  const byId = new Map(input.models.map((m) => [m.id, m]));
  const estimate = (model: AiRouterModel) =>
    task.category === "voice"
      ? estimateAiRouterSpeechCost(model)
      : estimateAiRouterCost(
          model,
          input.estimatedInputTokens,
          input.maxOutputTokens,
        );
  const candidate = (model: AiRouterModel): AiRouterCandidate => ({
    modelId: model.id,
    label: model.label,
    provider: model.provider,
    model: model.model,
    billing: model.billing,
    estimatedCostMicros: estimate(model),
    privacy: model.privacy,
  });
  const failure = (
    model: AiRouterModel,
    manual: boolean,
  ): AiRouterBlockedReason | null => {
    if (
      !model.metadataVerified ||
      !model.configured ||
      !["configured", "connected"].includes(model.status)
    )
      return "model_unavailable";
    if (!model.authorized) return "permission_required";
    if (!settings.allowedProviders.includes(model.provider))
      return "provider_not_allowed";
    if (
      !model.tiers.some((v) => settings.allowedTiers.includes(v)) ||
      (!manual && !model.tiers.includes(tier))
    )
      return "tier_not_allowed";
    if (capabilities.some((v) => !model.capabilities.includes(v)))
      return "capability_unavailable";
    // All currently supported provider IDs send data off-host. A catalog privacy
    // label cannot waive the owner's category-specific consent.
    if (
      task.dataCategories.some(
        (v) => !settings.privacy[v].includes(model.provider),
      )
    )
      return "privacy_not_allowed";
    if (model.billing === "chatgpt_plan")
      return model.planScopeGranted === true
        ? null
        : "plan_permission_required";
    const cost = estimate(model);
    if (
      cost === null ||
      (model.billing === "free" &&
        (model.inputCostMicrosPer1k !== 0 || model.outputCostMicrosPer1k !== 0))
    )
      return "pricing_unavailable";
    if (model.billing === "api" && !settings.spending.paidCallsAuthorized)
      return "paid_authorization_required";
    if (
      cost >
      Math.min(
        settings.spending.maxRequestCostMicros,
        settings.spending.maxDailyCostMicros,
        input.remainingDailyCostMicros ?? MAX_MICROS,
      )
    )
      return "cost_limit";
    return null;
  };
  if (settings.mode === "manual") {
    if (tier === "voice" && !settings.allowedTiers.includes("voice"))
      return unavailable("tier_not_allowed", tier);
    if (!settings.manualModelId)
      return unavailable("manual_model_required", tier);
    if (
      !MODEL_TIERS.some(
        (t) =>
          settings.allowedTiers.includes(t) &&
          settings.tierModels[t].includes(settings.manualModelId!),
      )
    )
      return unavailable("model_not_allowlisted", tier);
    if (
      tier === "voice" &&
      !settings.tierModels.voice.includes(settings.manualModelId)
    )
      return unavailable("model_not_allowlisted", tier);
    const model = byId.get(settings.manualModelId);
    if (!model) return unavailable("model_unavailable", tier);
    const blocked = failure(model, true);
    if (blocked) return unavailable(blocked, tier);
    return {
      version: 1,
      kind: "selected",
      tier,
      reason: "manual_selection",
      explanation: "Using the explicitly selected approved model.",
      candidates: [candidate(model)],
      fallbackAllowed: false,
      fallbackAtSelection: false,
    };
  }
  if (!settings.allowedTiers.includes(tier))
    return unavailable("tier_not_allowed", tier);
  const ids = settings.tierModels[tier];
  if (!ids.length) return unavailable("model_not_allowlisted", tier);
  const anchor = byId.get(ids[0]);
  if (!anchor) return unavailable("model_unavailable", tier);
  const samePath = (model: AiRouterModel) =>
    model.billing === anchor.billing &&
    (settings.fallback.allowProviderChange ||
      model.provider === anchor.provider);
  const eligible = ids.flatMap((id) => {
    const model = byId.get(id);
    return model && samePath(model) && !failure(model, false) ? [model] : [];
  });
  const previous =
    input.previousModelId && ids.includes(input.previousModelId)
      ? byId.get(input.previousModelId)
      : undefined;
  const sticky =
    previous && samePath(previous) && !failure(previous, false)
      ? previous
      : undefined;
  const anchorFailure = failure(anchor, false);
  const first =
    sticky ??
    (!anchorFailure
      ? anchor
      : settings.fallback.enabled
        ? eligible[0]
        : undefined);
  if (!first) return unavailable(anchorFailure ?? "model_unavailable", tier);
  const models = [first];
  let totalCost = candidate(first).estimatedCostMicros ?? 0;
  const chainLimit = Math.min(
    settings.spending.maxRequestCostMicros,
    settings.spending.maxDailyCostMicros,
    input.remainingDailyCostMicros ?? MAX_MICROS,
  );
  if (settings.fallback.enabled)
    for (const model of eligible) {
      if (
        model.id === first.id ||
        models.length >= settings.fallback.maxAttempts
      )
        continue;
      const cost = candidate(model).estimatedCostMicros;
      if (
        model.billing !== "chatgpt_plan" &&
        (cost === null || totalCost + cost > chainLimit)
      )
        continue;
      models.push(model);
      totalCost += cost ?? 0;
    }
  const reason: AiRouterSelectionReason = sticky
    ? "conversation_consistency"
    : first.id === anchor.id
      ? "automatic_tier"
      : "automatic_fallback";
  return {
    version: 1,
    kind: "selected",
    tier,
    reason,
    explanation: sticky
      ? "Keeping the conversation's approved model after rechecking current policy."
      : first.id === anchor.id
        ? "Using the first approved model for this task tier."
        : "Using an explicitly permitted fallback on the same billing path.",
    candidates: models.map(candidate),
    fallbackAllowed: models.length > 1,
    fallbackAtSelection: first.id !== anchor.id,
  };
}
