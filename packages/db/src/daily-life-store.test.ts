import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_DAILY_LIFE_PREFERENCES,
  DailyLifeConflictError,
} from "@lifeos/core";
import {
  createDailyLifeStore,
  DailyLifeNotFoundError,
} from "./daily-life-store.js";
const id = "00000000-0000-4000-8000-000000000001";
function fixture(data: unknown = null, error: unknown = null) {
  const maybeSingle = vi.fn(async () => ({ data, error }));
  const order = vi.fn(() => ({ limit: vi.fn(async () => ({ data, error })) }));
  const eq = vi.fn(() => ({ maybeSingle, order }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const rpc = vi.fn(async () => ({ data, error }));
  const store = createDailyLifeStore({ from, rpc } as unknown as Parameters<
    typeof createDailyLifeStore
  >[0]);
  return { store, from, select, eq, rpc };
}
describe("Daily Life owned persistence", () => {
  it("uses the complete database aggregate without recomputing a truncated history", async () => {
    const row = {
      id,
      amountMl: 250,
      occurredAt: "2026-11-03T02:00:00Z",
      source: "web",
      undoneAt: null,
    };
    const f = fixture({
      date: "2026-11-03",
      timezone: "Asia/Almaty",
      totalMl: 1098700,
      entries: [row],
      truncated: true,
    });
    await expect(
      f.store.hydration("owner-a", "2026-11-03", "UTC"),
    ).resolves.toMatchObject({
      totalMl: 1098700,
      entries: [row],
      truncated: true,
      timezone: "Asia/Almaty",
    });
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith("get_hydration_summary", {
      p_user_id: "owner-a",
      p_date: "2026-11-03",
    });
    expect(f.from).not.toHaveBeenCalled();
  });
  it("does not invent an empty total when the database or aggregate schema fails", async () => {
    await expect(
      fixture(null, { message: "private" }).store.hydration(
        "owner",
        "2026-11-03",
        "UTC",
      ),
    ).rejects.toThrow("Daily Life storage unavailable");
    await expect(
      fixture({
        date: "2026-11-03",
        timezone: "UTC",
        totalMl: -1,
        entries: [],
        truncated: false,
      }).store.hydration("owner", "2026-11-03", "UTC"),
    ).rejects.toThrow("Invalid saved hydration");
  });
  it("does not call the database for invalid calendar dates or resource IDs", async () => {
    const f = fixture();
    await expect(
      f.store.hydration("owner", "2026-11-31", "UTC"),
    ).rejects.toThrow("Invalid date");
    await expect(
      f.store.undoWater("owner", "------------------------------------"),
    ).rejects.toThrow("Invalid record ID");
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("keeps water add and undo scoped to the resolved owner", async () => {
    const f = fixture({ date: "2026-11-03" });
    await f.store.logWater("owner-b", 250, "water-request-1", "telegram");
    expect(f.rpc).toHaveBeenLastCalledWith("log_hydration", {
      p_user_id: "owner-b",
      p_request_id: "water-request-1",
      p_amount_ml: 250,
      p_source: "telegram",
    });
    await f.store.undoWater("owner-b", id);
    expect(f.rpc).toHaveBeenLastCalledWith("undo_hydration", {
      p_user_id: "owner-b",
      p_entry_id: id,
    });
  });
  it("defaults to no notifications or health sharing without saving a fake preference record", async () => {
    const f = fixture();
    await expect(f.store.preferences("owner")).resolves.toEqual(
      DEFAULT_DAILY_LIFE_PREFERENCES,
    );
    expect(f.eq).toHaveBeenCalledWith("user_id", "owner");
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("saves explicit settings with CAS and preserves safe conflict/not-found codes", async () => {
    const f = fixture({ ...DEFAULT_DAILY_LIFE_PREFERENCES, revision: 1 });
    await f.store.savePreferences("owner", DEFAULT_DAILY_LIFE_PREFERENCES);
    const { revision: _revision, ...prefs } = DEFAULT_DAILY_LIFE_PREFERENCES;
    expect(f.rpc).toHaveBeenCalledWith("save_daily_life_preferences", {
      p_user_id: "owner",
      p_preferences: prefs,
      p_expected_revision: 0,
    });
    await expect(
      fixture(null, { message: "daily_life_conflict" }).store.savePreferences(
        "owner",
        DEFAULT_DAILY_LIFE_PREFERENCES,
      ),
    ).rejects.toBeInstanceOf(DailyLifeConflictError);
    await expect(
      fixture(null, { message: "hydration_not_found" }).store.undoWater(
        "owner",
        id,
      ),
    ).rejects.toBeInstanceOf(DailyLifeNotFoundError);
  });
  it("sends sparse task changes and original timestamp without cross-user fields", async () => {
    const task = {
      id,
      title: "Task",
      notes: "",
      dueAt: null,
      status: "done",
      priority: 7,
      updatedAt: "2026-11-03T02:00:00.123456Z",
      completedAt: "2026-11-03T02:00:00Z",
    };
    const f = fixture(task);
    await expect(
      f.store.manageTask(
        "owner",
        id,
        null,
        { status: "done" },
        "2026-11-03T01:00:00.123456Z",
      ),
    ).resolves.toEqual(task);
    expect(f.rpc).toHaveBeenCalledWith("manage_lifeos_task", {
      p_user_id: "owner",
      p_task_id: id,
      p_request_id: null,
      p_patch: { status: "done" },
      p_expected_updated_at: "2026-11-03T01:00:00.123456Z",
    });
  });
});
