import { describe, expect, it } from "vitest";
import { SupabaseLifeOSStore } from "./lifeos-store.js";

type Row = Record<string, unknown>;
function fixture() {
  const original = "2026-01-01T00:00:00Z";
  const deferred = "2099-01-01T08:00:00Z";
  const rows: Row[] = [
    {
      id: "a",
      user_id: "owner",
      status: "pending",
      remind_at: original,
      next_attempt_at: deferred,
      notification_at: deferred,
      delivery_attempts: 2,
      failure_count: 1,
      metadata_json: { event_at: original },
    },
    {
      id: "foreign",
      user_id: "other",
      status: "pending",
      remind_at: original,
      notification_at: deferred,
    },
  ];
  const calls: string[] = [];
  const client = {
    from() {
      const filters: ((row: Row) => boolean)[] = [];
      let payload: Row | undefined;
      const result = () => {
        const data = rows.filter((row) =>
          filters.every((filter) => filter(row)),
        );
        if (payload)
          for (const row of data) {
            Object.assign(row, payload);
            row.notification_at = row.next_attempt_at ?? row.remind_at;
          }
        return { data, error: null };
      };
      const q = {
        select() {
          return q;
        },
        eq(key: string, value: string) {
          filters.push((row) => row[key] === value);
          return q;
        },
        gte(key: string, value: string) {
          calls.push(key);
          filters.push(
            (row) => Date.parse(String(row[key])) >= Date.parse(value),
          );
          return q;
        },
        lte(key: string, value: string) {
          calls.push(key);
          filters.push(
            (row) => Date.parse(String(row[key])) <= Date.parse(value),
          );
          return q;
        },
        order() {
          return q;
        },
        limit() {
          return q;
        },
        update(value: Row) {
          payload = value;
          return q;
        },
        single() {
          const r = result();
          return Promise.resolve({ ...r, data: r.data[0] });
        },
        then(resolve: (value: ReturnType<typeof result>) => unknown) {
          return Promise.resolve(result()).then(resolve);
        },
      };
      return q;
    },
  };
  return {
    store: new SupabaseLifeOSStore(client as never),
    rows,
    calls,
    deferred,
    original,
  };
}

describe("reminder API compatibility with delivery deferrals", () => {
  it("shows a deferred notification at its effective future time while preserving the event", async () => {
    const f = fixture();
    const reminders = await f.store.listUpcomingReminders("owner");
    expect(reminders).toHaveLength(1);
    expect(reminders[0].remindAt).toBe(f.deferred);
    expect(reminders[0].metadataJson).toEqual({ event_at: f.original });
  });
  it("does not present a quiet-hours deferred notification as currently due", async () => {
    const f = fixture();
    expect(
      await f.store.listPendingReminders("owner", "2026-01-02T00:00:00Z"),
    ).toEqual([]);
  });
  it("lets an explicit snooze replace a worker defer without resetting attempts or touching other users", async () => {
    const f = fixture();
    const moved = await f.store.snoozeReminder(
      "owner",
      "a",
      "2098-01-01T09:00:00Z",
    );
    expect(moved.remindAt).toBe("2098-01-01T09:00:00.000Z");
    expect(f.rows[0]).toMatchObject({
      next_attempt_at: null,
      delivery_attempts: 2,
      failure_count: 1,
    });
    expect(f.rows[1].notification_at).toBe(f.deferred);
  });
});
