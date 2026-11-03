import { describe, expect, it, vi } from "vitest";
import { defaultAiRouterSettings } from "@lifeos/core";
import {
  AiRouterSettingsConflictError,
  createAiRouterSettingsStore,
} from "./ai-router-settings-store.js";

function fixture(data: unknown = null, error: unknown = null) {
  const maybeSingle = vi.fn(async () => ({ data, error }));
  const limit = vi.fn(async () => ({ data, error }));
  const order = vi.fn(() => ({ limit }));
  const not = vi.fn(() => ({ order }));
  const eq = vi.fn(() => ({ maybeSingle, not }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const rpc = vi.fn(async () => ({ data, error }));
  const store = createAiRouterSettingsStore({
    from,
    rpc,
  } as unknown as Parameters<typeof createAiRouterSettingsStore>[0]);
  return { store, from, select, eq, rpc, not, order, limit };
}

const routing = {
  version: 1,
  provider: "openrouter",
  model: "synthetic/model",
  selectedModelId: "synthetic-model",
  credentialLabel: "project-a",
  billing: "api",
  attempts: 1,
  fallback: false,
  inputTokens: 20,
  outputTokens: 10,
  reportedCostMicros: 4,
  costSource: "provider_reported",
};
const usageRow = {
  feature: "finance",
  state: "completed",
  created_at: "2026-11-03T15:00:00Z",
  estimated_cost_micros: 6,
  reported_cost_micros: 4,
  routing,
};

describe("AI router owner-scoped preferences", () => {
  it("reads only the resolved owner and leaves missing preferences unsaved and offline", async () => {
    const f = fixture();
    const result = await f.store.get("owner-a");
    expect(result).toEqual({
      settings: defaultAiRouterSettings(),
      revision: 0,
    });
    expect(result.settings.spending.paidCallsAuthorized).toBe(false);
    expect(result.settings.privacy.health).toEqual([]);
    expect(f.from).toHaveBeenCalledExactlyOnceWith("ai_router_settings");
    expect(f.select).toHaveBeenCalledExactlyOnceWith("settings,revision");
    expect(f.eq).toHaveBeenCalledExactlyOnceWith("user_id", "owner-a");
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it("uses the authenticated owner and revision CAS without accepting a client owner", async () => {
    const settings = defaultAiRouterSettings();
    const f = fixture({ settings, revision: 3 });
    await expect(f.store.save("owner-b", settings, 2)).resolves.toEqual({
      settings,
      revision: 3,
    });
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith("save_ai_router_settings", {
      p_user_id: "owner-b",
      p_settings: settings,
      p_expected_revision: 2,
    });
    expect(f.from).not.toHaveBeenCalled();
  });

  it("rejects unsafe settings and invalid revisions before a database write", async () => {
    const f = fixture();
    await expect(
      f.store.save(
        "owner",
        { ...defaultAiRouterSettings(), apiKey: "secret" } as never,
        0,
      ),
    ).rejects.toThrow();
    for (const revision of [-1, 1.5, Number.NaN, 2_147_483_647])
      await expect(
        f.store.save("owner", defaultAiRouterSettings(), revision),
      ).rejects.toThrow("Invalid router settings revision");
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it("preserves conflicts and masks arbitrary database diagnostics", async () => {
    await expect(
      fixture(null, { message: "ai_router_settings_conflict" }).store.save(
        "owner",
        defaultAiRouterSettings(),
        0,
      ),
    ).rejects.toBeInstanceOf(AiRouterSettingsConflictError);
    const f = fixture(null, {
      message: "private credential and SQL diagnostics",
    });
    await expect(f.store.get("owner")).rejects.toThrow(
      "Router settings storage unavailable",
    );
    await expect(
      f.store.save("owner", defaultAiRouterSettings(), 0),
    ).rejects.toThrow("Router settings storage unavailable");
  });

  it("keeps ChatGPT plan usage separate from API-money estimates", async () => {
    const plan = {
      ...routing,
      provider: "chatgpt_plan",
      billing: "chatgpt_plan",
      reportedCostMicros: null,
      costSource: "unknown",
    };
    const f = fixture([
      {
        ...usageRow,
        estimated_cost_micros: null,
        reported_cost_micros: null,
        routing: plan,
      },
    ]);
    await expect(f.store.getRecent!("owner")).resolves.toMatchObject([
      {
        estimatedCostMicros: null,
        reportedCostMicros: null,
        routing: { billing: "chatgpt_plan", costSource: "unknown" },
      },
    ]);
  });

  it("fails closed for corrupt persisted records instead of presenting a connected default", async () => {
    for (const row of [
      { settings: defaultAiRouterSettings(), revision: -1 },
      { settings: defaultAiRouterSettings(), revision: 0 },
      {
        settings: {
          ...defaultAiRouterSettings(),
          privacy: { health: ["attacker"] },
        },
        revision: 1,
      },
      { settings: defaultAiRouterSettings(), revision: "1" },
    ])
      await expect(fixture(row).store.get("owner")).rejects.toThrow();
  });

  it("keeps a terminal database revision readable without overflowing a later CAS write", async () => {
    const f = fixture({
      settings: defaultAiRouterSettings(),
      revision: 2_147_483_647,
    });
    await expect(f.store.get("owner")).resolves.toMatchObject({
      revision: 2_147_483_647,
    });
    await expect(
      f.store.save("owner", defaultAiRouterSettings(), 2_147_483_647),
    ).rejects.toThrow("Invalid router settings revision");
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it("projects only the resolved owner's recent routed metadata without IDs or private bodies", async () => {
    const f = fixture([
      {
        ...usageRow,
        user_id: "other-id-not-returned",
        request_id: "private-request",
        prompt: "never-return",
        estimated_cost_micros: "6",
      },
    ]);
    const result = await f.store.getRecent!("owner-b");
    expect(f.from).toHaveBeenCalledExactlyOnceWith("ai_execution_reservations");
    expect(f.select).toHaveBeenCalledExactlyOnceWith(
      "feature,state,created_at,estimated_cost_micros,reported_cost_micros,routing",
    );
    expect(f.eq).toHaveBeenCalledExactlyOnceWith("user_id", "owner-b");
    expect(f.not).toHaveBeenCalledExactlyOnceWith("routing", "is", null);
    expect(f.order).toHaveBeenCalledExactlyOnceWith("created_at", {
      ascending: false,
    });
    expect(f.limit).toHaveBeenCalledExactlyOnceWith(20);
    expect(result).toEqual([
      {
        feature: "finance",
        state: "completed",
        createdAt: usageRow.created_at,
        estimatedCostMicros: 6,
        reportedCostMicros: 4,
        routing,
      },
    ]);
    expect(JSON.stringify(result)).not.toMatch(
      /other-id|private-request|never-return/,
    );
  });

  it("never guesses successful usage or zero cost from malformed or mismatched ledger metadata", async () => {
    for (const bad of [
      { ...usageRow, state: "fake" },
      { ...usageRow, created_at: "not-a-date" },
      { ...usageRow, reported_cost_micros: 9 },
      { ...usageRow, routing: { ...routing, apiKey: "never-return" } },
      { ...usageRow, routing: { ...routing, provider: null } },
      {
        ...usageRow,
        routing: {
          ...routing,
          billing: "chatgpt_plan",
          provider: "chatgpt_plan",
        },
      },
    ])
      await expect(fixture([bad]).store.getRecent!("owner")).rejects.toThrow();
    await expect(
      fixture([], { message: "private connection failure" }).store.getRecent!(
        "owner",
      ),
    ).rejects.toThrow("Router settings storage unavailable");
  });
});
