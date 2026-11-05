/** Narrow accounting contract: never contains prompts, credentials or provider bodies. */
export const AI_EXECUTION_FEATURES = [
  "chat",
  "classification",
  "finance",
  "meal_photo",
  "morning_briefing",
  "evening_review",
  "documentary",
  "agata",
] as const;
export type AiExecutionFeature = (typeof AI_EXECUTION_FEATURES)[number];
export interface AiBudgetLimits {
  userTokens: number;
  featureTokens: number;
  globalTokens: number;
  userCostMicros: number | null;
  featureCostMicros: number | null;
  globalCostMicros: number | null;
  maxIterations: number;
}
export interface AiBudgetReservation {
  userId: string;
  feature: AiExecutionFeature;
  requestId: string;
  taskId: string;
  reservedTokens: number;
  estimatedCostMicros: number | null;
  limits: AiBudgetLimits;
  routing?: AiRoutingAccounting;
}
/** Metadata only: never prompts, response text, credentials or account identifiers. */
export interface AiRoutingAccounting {
  version: 1;
  provider: "gemini" | "openrouter" | "openai" | "anthropic" | "chatgpt_plan";
  model: string;
  selectedModelId: string;
  credentialLabel: string;
  billing: "api" | "free" | "chatgpt_plan";
  attempts: number;
  fallback: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
  reportedCostMicros: number | null;
  costSource: "provider_reported" | "rate_estimate" | "unknown";
}
/** Safe provenance attached only to a fully completed approved model response. */
export interface AiModelRouteReceipt {
  version: 1;
  requestId: string;
  modelId: string;
  provider: AiRoutingAccounting["provider"];
  model: string;
  billing: AiRoutingAccounting["billing"];
  estimatedCostMicros: number | null;
  reportedCostMicros: number | null;
  costSource: AiRoutingAccounting["costSource"];
  upstreamProvider?: string;
  latencyMs: number;
  fallback: boolean;
  reason: string;
  privacy: "external";
}
export type AiBudgetOutcome =
  | "reserved"
  | "duplicate"
  | "token_budget_exceeded"
  | "cost_budget_exceeded"
  | "iteration_limit"
  | "profile_inactive";
export type AiExecutionState =
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out";
export interface AiBudgetStore {
  reserve(
    input: AiBudgetReservation,
    signal?: AbortSignal,
  ): Promise<AiBudgetOutcome>;
  finish(
    input: {
      userId: string;
      requestId: string;
      state: AiExecutionState;
      reportedTokens: number | null;
      routing?: AiRoutingAccounting;
    },
    signal?: AbortSignal,
  ): Promise<void>;
  /** Provider quota bookkeeping belongs to the same reserved execution. */
  reserveProviderAttempt?(
    input: AiProviderAttempt,
    signal?: AbortSignal,
  ): Promise<AiProviderQuotaResult>;
  cooldownProviderQuota?(
    input: AiProviderCooldown,
    signal?: AbortSignal,
  ): Promise<void>;
  providerQuotaStatus?(
    input: AiProviderQuotaIdentity,
    signal?: AbortSignal,
  ): Promise<AiProviderQuotaSnapshot | null>;
}

export type AiQuotaProvider = "gemini" | "openrouter";
/** Trusted server aliases only; never raw account/project IDs or key values. */
export interface AiProviderQuotaIdentity {
  userId: string;
  provider: AiQuotaProvider;
  quotaDomain: string;
}
export interface AiProviderQuotaLimits {
  requestsPerMinute: number;
  requestsPerDay: number;
  tokensPerMinute: number;
  tokensPerDay: number;
}
export interface AiProviderAttempt extends AiProviderQuotaIdentity {
  requestId: string;
  feature: AiExecutionFeature;
  attempt: number;
  model: string;
  reservedTokens: number;
  limits: AiProviderQuotaLimits;
}
export interface AiProviderQuotaSnapshot {
  requestsInMinute: number;
  requestsInDay: number;
  tokensInMinute: number;
  tokensInDay: number;
  requestsPerDay: number;
  retryAt: string | null;
  reviewRequired: boolean;
}
export interface AiProviderQuotaResult {
  outcome:
    | "reserved"
    | "duplicate"
    | "execution_inactive"
    | "profile_inactive"
    | "attempt_limit"
    | "cooldown"
    | "minute_limit"
    | "day_limit";
  retryAt: string | null;
}
export interface AiProviderCooldown extends AiProviderQuotaIdentity {
  requestId: string;
  retryAt: string | null;
  reviewRequired: boolean;
}
