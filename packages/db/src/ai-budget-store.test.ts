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
  it("links provider-attempt quotas to the existing owned execution without another budget reservation", async () => {
    const f = fixture({ outcome: "reserved", retryAt: null });
    const request = {
      userId: "owner-a",
      requestId: "req1",
      feature: "classification" as const,
      attempt: 1,
      provider: "gemini" as const,
      quotaDomain: "project-alias",
      model: "gemini-free",
      reservedTokens: 50,
      limits: {
        requestsPerMinute: 2,
        requestsPerDay: 5,
        tokensPerMinute: 100,
        tokensPerDay: 500,
      },
    };
    await expect(f.store.reserveProviderAttempt!(request)).resolves.toEqual({
      outcome: "reserved",
      retryAt: null,
    });
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith(
      "reserve_ai_provider_attempt",
      {
        p_user_id: "owner-a",
        p_request_id: "req1",
        p_feature: "classification",
        p_attempt: 1,
        p_provider: "gemini",
        p_quota_domain: "project-alias",
        p_model: "gemini-free",
        p_tokens: 50,
        p_limits: request.limits,
      },
    );
    await expect(
      fixture({ outcome: "reserved", retryAt: null, secret: "private" }).store
        .reserveProviderAttempt!(request),
    ).rejects.toThrow("AI provider quota unavailable");
  });
  it("persists only safe cooldown facts and projects local counters without a credential or domain echo", async () => {
    const f = fixture(true);
    await f.store.cooldownProviderQuota!({
      userId: "owner-b",
      requestId: "req2",
      provider: "openrouter",
      quotaDomain: "account-alias",
      retryAt: "2026-11-04T12:00:00Z",
      reviewRequired: false,
    });
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith(
      "cooldown_ai_provider_quota",
      {
        p_user_id: "owner-b",
        p_request_id: "req2",
        p_provider: "openrouter",
        p_quota_domain: "account-alias",
        p_retry_at: "2026-11-04T12:00:00Z",
        p_review_required: false,
      },
    );
    const identity = {
      userId: "owner-b",
      provider: "openrouter" as const,
      quotaDomain: "account-alias",
    };
    await expect(
      fixture(null).store.providerQuotaStatus!(identity),
    ).resolves.toBeNull();
    const snapshot = {
      requestsInMinute: 1,
      requestsInDay: 2,
      tokensInMinute: 10,
      tokensInDay: 20,
      requestsPerDay: 50,
      retryAt: null,
      reviewRequired: false,
    };
    await expect(
      fixture(snapshot).store.providerQuotaStatus!(identity),
    ).resolves.toEqual(snapshot);
    await expect(
      fixture({ ...snapshot, userId: "foreign" }).store.providerQuotaStatus!(
        identity,
      ),
    ).rejects.toThrow();
    await expect(
      fixture({ ...snapshot, requestsInDay: -1 }).store.providerQuotaStatus!(
        identity,
      ),
    ).rejects.toThrow();
  });
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
