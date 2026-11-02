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
    },
    signal?: AbortSignal,
  ): Promise<void>;
}
