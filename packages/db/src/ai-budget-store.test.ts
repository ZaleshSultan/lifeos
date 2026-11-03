import { describe, expect, it, vi } from "vitest";
import { createAiBudgetStore } from "./ai-budget-store.js";
const input = {
  userId: "owner-a",
  feature: "chat" as const,
  requestId: "req1",
  taskId: "task1",
  reservedTokens: 100,
  estimatedCostMicros: null,
  limits: {
    userTokens: 200,
    featureTokens: 200,
    globalTokens: 1000,
    userCostMicros: null,
    featureCostMicros: null,
    globalCostMicros: null,
    maxIterations: 2,
  },
};
function fixture(data: unknown, error: unknown = null) {
  const query = Object.assign(Promise.resolve({ data, error }), {
    abortSignal: vi.fn(),
  });
  query.abortSignal.mockReturnValue(query);
  const rpc = vi.fn(() => query);
  return {
    rpc,
    query,
    store: createAiBudgetStore({ rpc } as unknown as Parameters<
      typeof createAiBudgetStore
    >[0]),
  };
}
describe("durable AI budget RPC adapter", () => {
  it("passes only owned accounting facts and forwards cancellation", async () => {
    const f = fixture("reserved"),
      controller = new AbortController();
    await expect(f.store.reserve(input, controller.signal)).resolves.toBe(
      "reserved",
    );
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith("reserve_ai_execution", {
      p_user_id: "owner-a",
      p_feature: "chat",
      p_request_id: "req1",
      p_task_id: "task1",
      p_tokens: 100,
      p_estimated_cost_micros: null,
      p_limits: input.limits,
    });
    expect(f.query.abortSignal).toHaveBeenCalledExactlyOnceWith(
      controller.signal,
    );
  });
  it.each([
    "duplicate",
    "token_budget_exceeded",
    "cost_budget_exceeded",
    "iteration_limit",
    "profile_inactive",
  ])("preserves exact safe outcome %s", async (outcome) => {
    await expect(fixture(outcome).store.reserve(input)).resolves.toBe(outcome);
  });
  it("fails closed without exposing private database diagnostics or schema-invalid replies", async () => {
    await expect(
      fixture(null, { message: "private credential" }).store.reserve(input),
    ).rejects.toThrow("AI budget storage unavailable");
    await expect(
      fixture({ outcome: "reserved", secret: "private" }).store.reserve(input),
    ).rejects.toThrow("AI budget storage unavailable");
  });
  it("finishes only the owned receipt and rejects absent acknowledgments", async () => {
    const f = fixture(true);
    await f.store.finish({
      userId: "owner-b",
      requestId: "req1",
      state: "timed_out",
      reportedTokens: null,
    });
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith("finish_ai_execution", {
      p_user_id: "owner-b",
      p_request_id: "req1",
      p_state: "timed_out",
      p_reported_tokens: null,
    });
    await expect(
      fixture(false).store.finish({
        userId: "owner-b",
        requestId: "req1",
        state: "failed",
        reportedTokens: null,
      }),
    ).rejects.toThrow("AI budget receipt unavailable");
  });
});

it("requires the new router RPC before work and does not fall back to an unmetered legacy reservation", async () => {
  const routing = {
    version: 1 as const,
    provider: "openrouter" as const,
    model: "vendor/model",
    selectedModelId: "model",
    credentialLabel: "project",
    billing: "api" as const,
    attempts: 1,
    fallback: false,
    inputTokens: null,
    outputTokens: null,
    reportedCostMicros: null,
    costSource: "unknown" as const,
  };
  const f = fixture("reserved");
  await f.store.reserve({ ...input, routing });
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith(
    "reserve_ai_router_execution",
    expect.objectContaining({ p_user_id: input.userId, p_routing: routing }),
  );
  const unavailable = fixture(null, { message: "function unavailable" });
  await expect(
    unavailable.store.reserve({ ...input, routing }),
  ).rejects.toThrow("AI budget storage unavailable");
  expect(unavailable.rpc).toHaveBeenCalledTimes(1);
  const receipt = fixture(true);
  await receipt.store.finish({
    userId: input.userId,
    requestId: input.requestId,
    state: "failed",
    reportedTokens: null,
    routing,
  });
  expect(receipt.rpc).toHaveBeenCalledExactlyOnceWith(
    "finish_ai_router_execution",
    expect.objectContaining({
      p_user_id: input.userId,
      p_routing: routing,
      p_state: "failed",
    }),
  );
});
