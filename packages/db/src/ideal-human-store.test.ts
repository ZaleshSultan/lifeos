import { describe, expect, it, vi } from "vitest";
import { emptyIdealHumanDay, IdealHumanConflictError } from "@lifeos/core";
import { idealHumanStore } from "./ideal-human-store.js";

type Client = Parameters<typeof idealHumanStore>[0];
function fixture(rows: unknown[] = [], error: unknown = null) {
  const order = vi.fn(async () => ({ data: rows, error }));
  const maybeSingle = vi.fn(async () => ({ data: rows[0] ?? null, error }));
  const query = { order, maybeSingle, eq: vi.fn() };
  const eq = query.eq.mockImplementation(() => query);
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const rpc = vi.fn();
  const store = idealHumanStore({ from, rpc } as unknown as Client);
  return { store, from, select, eq, order, rpc, maybeSingle };
}
function observedDay() {
  return {
    ...emptyIdealHumanDay("2026-11-03"),
    weightKg: 51.2,
    notes: "Actual measured observation",
  };
}

describe("Ideal Human scoped persistence", () => {
  it("loads the owner's stored content before clearing and uses its revision in the atomic RPC", async () => {
    const day = {
      ...observedDay(),
      revision: 4,
      energy: 3,
      tomorrowPlan: "Keep this draft",
    };
    const f = fixture([{ date: day.date, entry: day, revision: 4 }]);
    f.rpc.mockImplementation(async (_rpc, input) => ({
      data: { ...input.p_entry, revision: 5 },
      error: null,
    }));
    const result = await f.store.clearReflection("owner-a", day.date, 4);
    expect(f.eq.mock.calls).toEqual([
      ["user_id", "owner-a"],
      ["date", day.date],
    ]);
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith(
      "save_ideal_human_day",
      expect.objectContaining({
        p_user_id: "owner-a",
        p_date: day.date,
        p_expected_revision: 4,
        p_entry: expect.objectContaining({
          notes: "",
          energy: null,
          mood: null,
          weightKg: 51.2,
          tomorrowPlan: "Keep this draft",
        }),
      }),
    );
    expect(result).toMatchObject({ notes: "", weightKg: 51.2, revision: 5 });
  });
  it("retains a readable row when its last private reflection is cleared", async () => {
    const day = {
      ...emptyIdealHumanDay("2026-11-03"),
      notes: "Private",
      revision: 1,
    };
    const f = fixture([{ date: day.date, entry: day, revision: 1 }]);
    f.rpc.mockImplementation(async (_rpc, input) => ({
      data: { ...input.p_entry, revision: 2 },
      error: null,
    }));
    const result = await f.store.clearReflection("owner-a", day.date, 1);
    expect(result.notes).toBe("");
    const reload = fixture([{ date: day.date, entry: result, revision: 2 }]);
    await expect(reload.store.getDays("owner-a")).resolves.toEqual([result]);
    await expect(reload.store.saveDay("owner-a", result, 2)).rejects.toThrow(
      "Record at least",
    );
    expect(reload.rpc).not.toHaveBeenCalled();
  });
  it("never creates a row from a supplied revision or overwrites a stale/competing update", async () => {
    const missing = fixture();
    await expect(
      missing.store.clearReflection("other-owner", "2026-11-03", 1),
    ).rejects.toBeInstanceOf(IdealHumanConflictError);
    expect(missing.rpc).not.toHaveBeenCalled();
    const f = fixture([
      { date: "2026-11-03", entry: observedDay(), revision: 3 },
    ]);
    await expect(
      f.store.clearReflection("owner", "2026-11-03", 2),
    ).rejects.toBeInstanceOf(IdealHumanConflictError);
    expect(f.rpc).not.toHaveBeenCalled();
    f.rpc.mockResolvedValue({
      data: null,
      error: { message: "ideal_human_conflict" },
    });
    await expect(
      f.store.clearReflection("owner", "2026-11-03", 3),
    ).rejects.toBeInstanceOf(IdealHumanConflictError);
  });
  it("does not mutate corrupt stored content or repeatedly increment an already-cleared revision", async () => {
    const bad = fixture([
      {
        date: "2026-11-03",
        entry: { notes: "private", weightKg: "bad" },
        revision: 1,
      },
    ]);
    await expect(
      bad.store.clearReflection("owner", "2026-11-03", 1),
    ).rejects.toThrow("needs recovery");
    expect(bad.rpc).not.toHaveBeenCalled();
    const empty = { ...emptyIdealHumanDay("2026-11-03"), revision: 2 };
    const f = fixture([{ date: empty.date, entry: empty, revision: 2 }]);
    await expect(
      f.store.clearReflection("owner", empty.date, 2),
    ).resolves.toEqual(empty);
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("reads only the authenticated owner's dedicated rows without mutating settings", async () => {
    const f = fixture([
      {
        date: "2026-11-03",
        entry: { date: "2026-11-03", weightKg: 51.2 },
        revision: 3,
      },
    ]);
    const [day] = await f.store.getDays("owner-a");
    expect(day.weightKg).toBe(51.2);
    expect(day.revision).toBe(3);
    expect(day.sleepMinutes).toBeNull();
    expect(f.from).toHaveBeenCalledExactlyOnceWith("ideal_human_days");
    expect(f.eq).toHaveBeenCalledExactlyOnceWith("user_id", "owner-a");
    expect(f.order).toHaveBeenCalledExactlyOnceWith("date", {
      ascending: true,
    });
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("returns empty state without fabricating Day 1 entries", async () => {
    const f = fixture();
    await expect(f.store.getDays("owner-a")).resolves.toEqual([]);
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("does not report database failures as an empty successful journal", async () => {
    const f = fixture([], { message: "private diagnostic" });
    await expect(f.store.getDays("owner-a")).rejects.toThrow(
      "Ideal Human storage unavailable",
    );
  });
  it("reports a malformed saved record safely without overwriting or exposing it", async () => {
    const f = fixture([
      {
        date: "2026-11-03",
        entry: { date: "2026-11-03", weightKg: "private-record" },
        revision: 1,
      },
    ]);
    await expect(f.store.getDays("owner-a")).rejects.toThrow("needs recovery");
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("writes one owner/date atomically and returns the database revision", async () => {
    const f = fixture();
    const day = observedDay();
    f.rpc.mockResolvedValue({ data: { ...day, revision: 1 }, error: null });
    await expect(f.store.saveDay("owner-b", day, 0)).resolves.toMatchObject({
      weightKg: 51.2,
      revision: 1,
    });
    const { revision: _revision, ...entry } = day;
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith("save_ideal_human_day", {
      p_user_id: "owner-b",
      p_date: day.date,
      p_entry: entry,
      p_expected_revision: 0,
    });
    expect(f.from).not.toHaveBeenCalled();
  });
  it("rejects a missing or mismatched revision without making a database call", async () => {
    const f = fixture();
    await expect(f.store.saveDay("owner", observedDay(), -1)).rejects.toThrow(
      "revision",
    );
    await expect(f.store.saveDay("owner", observedDay(), 2)).rejects.toThrow(
      "revision",
    );
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("returns explicit conflicts and preserves safe errors for other database failures", async () => {
    const f = fixture();
    f.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "ideal_human_conflict" },
    });
    await expect(
      f.store.saveDay("owner", observedDay(), 0),
    ).rejects.toBeInstanceOf(IdealHumanConflictError);
    f.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "private diagnostic" },
    });
    await expect(f.store.saveDay("owner", observedDay(), 0)).rejects.toThrow(
      "Ideal Human save unavailable",
    );
  });
  it("rejects unvalidated fields rather than passing them to the RPC", async () => {
    const f = fixture();
    await expect(
      f.store.saveDay(
        "owner",
        { ...observedDay(), userId: "other" } as ReturnType<typeof observedDay>,
        0,
      ),
    ).rejects.toThrow("Unexpected");
    expect(f.rpc).not.toHaveBeenCalled();
  });
});
