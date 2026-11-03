import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiBudgetOutcome, AiBudgetStore } from "@lifeos/core";
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
