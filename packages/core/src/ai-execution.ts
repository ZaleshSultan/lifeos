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
}
