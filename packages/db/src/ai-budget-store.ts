import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AiBudgetOutcome,
  AiBudgetStore,
  AiProviderQuotaResult,
  AiProviderQuotaSnapshot,
} from "@lifeos/core";
import type { Database, Json } from "./types.js";

// New RPCs stay isolated from the large generated-schema facade.
interface BudgetRpcClient {
  rpc(
    name: string,
    args: Record<string, Json>,
  ): PromiseLike<{ data: unknown; error: unknown }> & {
    abortSignal(
      signal: AbortSignal,
    ): PromiseLike<{ data: unknown; error: unknown }>;
  };
}
function quotaTimestamp(value: unknown): string | null {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    value.length > 64 ||
    !Number.isFinite(Date.parse(value))
  )
    throw new Error("AI provider quota unavailable");
  return new Date(value).toISOString();
}
function quotaObject(
  value: unknown,
  fields: string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== fields.length ||
    fields.some((key) => !Object.hasOwn(value, key))
  )
    throw new Error("AI provider quota unavailable");
  return value as Record<string, unknown>;
}
export function createAiBudgetStore(
  client: SupabaseClient<Database>,
): AiBudgetStore {
  const rpc = client as unknown as BudgetRpcClient;
  const invoke = async (
    name: string,
    args: Record<string, Json>,
    signal?: AbortSignal,
  ) => {
    const request = rpc.rpc(name, args);
    const result = await (signal ? request.abortSignal(signal) : request);
    if (result.error) throw new Error("AI budget storage unavailable");
    return result.data;
  };
  return {
    async reserveProviderAttempt(input, signal) {
      const raw = await invoke(
        "reserve_ai_provider_attempt",
        {
          p_user_id: input.userId,
          p_request_id: input.requestId,
          p_feature: input.feature,
          p_attempt: input.attempt,
          p_provider: input.provider,
          p_quota_domain: input.quotaDomain,
          p_model: input.model,
          p_tokens: input.reservedTokens,
          p_limits: input.limits as unknown as Json,
        },
        signal,
      );
      const value = quotaObject(raw, ["outcome", "retryAt"]);
      if (
        ![
          "reserved",
          "duplicate",
          "execution_inactive",
          "profile_inactive",
          "attempt_limit",
          "cooldown",
          "minute_limit",
          "day_limit",
        ].includes(value.outcome as string)
      )
        throw new Error("AI provider quota unavailable");
      return {
        outcome: value.outcome as AiProviderQuotaResult["outcome"],
        retryAt: quotaTimestamp(value.retryAt),
      };
    },
    async cooldownProviderQuota(input, signal) {
      const result = await invoke(
        "cooldown_ai_provider_quota",
        {
          p_user_id: input.userId,
          p_request_id: input.requestId,
          p_provider: input.provider,
          p_quota_domain: input.quotaDomain,
          p_retry_at: input.retryAt,
          p_review_required: input.reviewRequired,
        },
        signal,
      );
      if (result !== true) throw new Error("AI provider quota unavailable");
    },
    async providerQuotaStatus(input, signal) {
      const raw = await invoke(
        "read_ai_provider_quota",
        {
          p_user_id: input.userId,
          p_provider: input.provider,
          p_quota_domain: input.quotaDomain,
        },
        signal,
      );
      if (raw === null) return null;
      const value = quotaObject(raw, [
        "requestsInMinute",
        "requestsInDay",
        "tokensInMinute",
        "tokensInDay",
        "requestsPerDay",
        "retryAt",
        "reviewRequired",
      ]);
      for (const name of [
        "requestsInMinute",
        "requestsInDay",
        "tokensInMinute",
        "tokensInDay",
        "requestsPerDay",
      ]) {
        if (
          typeof value[name] !== "number" ||
          !Number.isSafeInteger(value[name]) ||
          (value[name] as number) < 0 ||
          (value[name] as number) > 1_000_000_000_000
        )
          throw new Error("AI provider quota unavailable");
      }
      if (typeof value.reviewRequired !== "boolean")
        throw new Error("AI provider quota unavailable");
      return {
        ...value,
        retryAt: quotaTimestamp(value.retryAt),
      } as unknown as AiProviderQuotaSnapshot;
    },
    async reserve(input, signal) {
      const data = await invoke(
        input.routing ? "reserve_ai_router_execution" : "reserve_ai_execution",
        {
          p_user_id: input.userId,
          p_feature: input.feature,
          p_request_id: input.requestId,
          p_task_id: input.taskId,
          p_tokens: input.reservedTokens,
          p_estimated_cost_micros: input.estimatedCostMicros,
          p_limits: input.limits as unknown as Json,
          ...(input.routing
            ? { p_routing: input.routing as unknown as Json }
            : {}),
        },
        signal,
      );
      if (
        typeof data !== "string" ||
        ![
          "reserved",
          "duplicate",
          "token_budget_exceeded",
          "cost_budget_exceeded",
          "iteration_limit",
          "profile_inactive",
        ].includes(data)
      )
        throw new Error("AI budget storage unavailable");
      return data as AiBudgetOutcome;
    },
    async finish(input, signal) {
      const result = await invoke(
        input.routing ? "finish_ai_router_execution" : "finish_ai_execution",
        {
          p_user_id: input.userId,
          p_request_id: input.requestId,
          p_state: input.state,
          p_reported_tokens: input.reportedTokens,
          ...(input.routing
            ? { p_routing: input.routing as unknown as Json }
            : {}),
        },
        signal,
      );
      if (result !== true) throw new Error("AI budget receipt unavailable");
    },
  };
}
