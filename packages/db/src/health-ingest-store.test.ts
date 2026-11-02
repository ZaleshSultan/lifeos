import { afterEach, describe, expect, it, vi } from "vitest";
import type { HealthIngestPayload } from "@lifeos/core";
import { SupabaseLifeOSStore } from "./lifeos-store.js";

// An in-memory PostgREST boundary: test real store orchestration and conflicts.
type Row = Record<string, any>;
class HealthClient {
  tables: Record<string, Row[]> = {};
  queries: Array<{
    table: string;
    action: string;
    filters: Record<string, unknown>;
  }> = [];
  beforeRun?: (query: HealthQuery) => void;
  updates: Array<{ table: string; payload: Row }> = [];
  rows(table: string): Row[] {
    return (this.tables[table] ??= []);
  }
  from(table: string): HealthQuery {
    return new HealthQuery(this, table);
  }
}
class HealthQuery implements PromiseLike<any> {
  action = "select";
  payload: Row[] = [];
  conflicts = ["id"];
  filters: Record<string, unknown> = {};
  inFilters: Record<string, unknown[]> = {};
  bounds: Array<[string, string, boolean]> = [];
  orders: Array<[string, boolean]> = [];
  rowLimit = Infinity;
  constructor(
    private client: HealthClient,
    private table: string,
  ) {}
  select(_columns?: string, _options?: unknown): this {
    return this;
  }
  eq(key: string, value: unknown): this {
    this.filters[key] = value;
    return this;
  }
  is(key: string, value: null): this {
    this.filters[key] = value;
    return this;
  }
  in(key: string, values: unknown[]): this {
    this.inFilters[key] = values;
    return this;
  }
  delete(): this {
    this.action = "delete";
    return this;
  }
  gte(key: string, value: string): this {
    this.bounds.push([key, value, true]);
    return this;
  }
  lte(key: string, value: string): this {
    this.bounds.push([key, value, false]);
    return this;
  }
  order(key: string, options: { ascending?: boolean } = {}): this {
    this.orders.push([key, options.ascending ?? true]);
    return this;
  }
  limit(value: number): this {
    this.rowLimit = value;
    return this;
  }
  upsert(payload: Row | Row[], options?: { onConflict: string }): this {
    this.action = "upsert";
    this.payload = Array.isArray(payload) ? payload : [payload];
    this.conflicts = options?.onConflict.split(",") ?? ["id"];
    return this;
  }
  insert(payload: Row | Row[]): this {
    this.action = "insert";
    this.payload = Array.isArray(payload) ? payload : [payload];
    return this;
  }
  update(payload: Row): this {
    this.action = "update";
    this.payload = [payload];
    return this;
  }
  private run() {
    this.client.beforeRun?.(this);
    this.client.queries.push({
      table: this.table,
      action: this.action,
      filters: { ...this.filters },
    });
    let data: Row[];
    const rows = this.client.rows(this.table);
    if (this.action === "update") {
      const payload = JSON.parse(JSON.stringify(this.payload[0]));
      this.client.updates.push({ table: this.table, payload });
      data = rows.filter((row) =>
        Object.entries(this.filters).every(([key, value]) =>
          value === null ? row[key] == null : row[key] === value,
        ),
      );
      for (const row of data) Object.assign(row, payload);
    } else if (this.action === "delete") {
      data = rows.filter(
        (row) =>
          Object.entries(this.filters).every(
            ([key, value]) => row[key] === value,
          ) &&
          Object.entries(this.inFilters).every(([key, values]) =>
            values.includes(row[key]),
          ),
      );
      this.client.tables[this.table] = rows.filter(
        (row) => !data.includes(row),
      );
    } else if (this.action !== "select") {
      data = this.payload.map((input) => {
        // JSON wire omits undefined fields; existing fields survive partial upserts.
        const payload = JSON.parse(JSON.stringify(input));
        const existing =
          this.action === "upsert"
            ? rows.find((row) =>
                this.conflicts.every((key) => row[key] === payload[key]),
              )
            : undefined;
        if (existing) {
          Object.assign(existing, payload);
          return { ...existing };
        }
        const row = {
          id: `${this.table}-${rows.length + 1}`,
          created_at: "2026-09-24T10:00:00Z",
          updated_at: "2026-09-24T10:00:00Z",
          ...payload,
        };
        rows.push(row);
        return { ...row };
      });
    } else {
      data = rows.filter(
        (row) =>
          Object.entries(this.filters).every(
            ([key, value]) => row[key] === value,
          ) &&
          this.bounds.every(([key, value, lower]) =>
            lower ? row[key] >= value : row[key] <= value,
          ),
      );
      data.sort((a, b) => {
        for (const [key, ascending] of this.orders) {
          const result = String(a[key]).localeCompare(String(b[key]));
          if (result) return ascending ? result : -result;
        }
        return 0;
      });
      data = data.slice(0, this.rowLimit);
    }
    return {
      data: JSON.parse(JSON.stringify(data)),
      count: data.length,
      error: null,
    };
  }
  async single() {
    const result = this.run();
    return { ...result, data: result.data[0] };
  }
  async maybeSingle() {
    const result = this.run();
    return { ...result, data: result.data[0] ?? null };
  }
  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}

function setup() {
  const client = new HealthClient();
  const store = new SupabaseLifeOSStore(client as any);
  vi.spyOn(store as any, "upsertHealthDailyLifeEntity").mockResolvedValue({
    id: "entity",
  });
  vi.spyOn(store, "enqueueObsidianSync").mockResolvedValue(undefined as any);
  vi.spyOn(store, "resolveCurrentMode").mockResolvedValue({
    mode: "normal",
    label: "Normal",
  } as any);
  return { client, store };
}
function payload(): HealthIngestPayload {
  return {
    userId: "user-a",
    date: "2026-09-23",
    source: "xiaomi_health_connect",
    syncReason: "manual",
    timezone: "Asia/Qyzylorda",
    missing: { stress: true },
    metrics: {
      steps: 4000,
      sleepMinutes: 420,
      deepSleepMinutes: 70,
      restingHeartRate: 58,
      averageHeartRate: 75,
      hrvMs: 41,
      activeEnergyKcal: 400,
      distanceMeters: 3000,
    },
    samples: [
      {
        sampleType: "heart_rate",
        sampledAt: "2026-09-23T10:00:00Z",
        value: 85,
        unit: "bpm",
      },
    ],
    workouts: [
      {
        externalId: "watch-workout-1",
        startedAt: "2026-09-23T10:00:00Z",
        durationMinutes: 30,
      },
    ],
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe("health ingest persistence", () => {
  it("retains short-sleep recovery and whole-day availability after a steps-only sync", async () => {
    const { client, store } = setup();
    const first = payload();
    first.metrics.sleepMinutes = 180;
    const initial = await store.ingestHealthPayload(first);
    const partial = {
      ...payload(),
      metrics: { steps: 6200 },
      missing: {},
      workouts: [],
      samples: [],
    };
    const result = await store.ingestHealthPayload(partial);
    expect(initial).toMatchObject({
      recoveryMode: "recovery",
      dataCompletenessScore: 85,
    });
    expect(result).toMatchObject({
      recoveryMode: "recovery",
      dataCompletenessScore: 85,
    });
    expect(client.rows("health_daily")[0]).toMatchObject({
      sleep_minutes: 180,
      deep_sleep_minutes: 70,
      hrv_ms: 41,
      steps: 6200,
      recovery_mode: "recovery",
      data_completeness_score: 85,
    });
    expect(client.rows("health_workouts")).toHaveLength(1);
    expect(client.rows("health_samples")).toHaveLength(1);
    expect(client.rows("health_sync_runs").at(-1)).toMatchObject({
      recovery_mode: "recovery",
      data_completeness_score: 85,
    });
    expect(store.enqueueObsidianSync).toHaveBeenLastCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          recoveryMode: "recovery",
          dataCompletenessScore: 85,
        }),
      }),
    );
  });

  it("includes retained stages, HRV and child rows when normalized manual metrics are added", async () => {
    const { client, store } = setup();
    const first = payload();
    first.metrics.sleepMinutes = 180;
    await store.ingestHealthPayload(first);
    await store.upsertHealthMetrics({
      userId: "user-a",
      date: first.date,
      source: "manual",
      metrics: [{ type: "mood_score", value: 8 }],
    });
    expect(client.rows("health_daily")[0]).toMatchObject({
      sleep_minutes: 180,
      deep_sleep_minutes: 70,
      hrv_ms: 41,
      mood_score: 8,
      recovery_mode: "recovery",
      data_completeness_score: 95,
    });
  });

  it("recalculates after explicit missing corrections instead of retaining invalidated availability", async () => {
    const { client, store } = setup();
    const first = {
      ...payload(),
      metrics: { sleepMinutes: 180, deepSleepMinutes: 30, hrvMs: 20 },
      workouts: [],
      samples: [],
      missing: {},
    };
    expect(await store.ingestHealthPayload(first)).toMatchObject({
      recoveryMode: "recovery",
      dataCompletenessScore: 35,
    });
    const correction = {
      ...first,
      metrics: { steps: 1200 },
      missing: { sleep_minutes: true, sleep_stages: true, hrv_ms: true },
    };
    expect(await store.ingestHealthPayload(correction)).toMatchObject({
      recoveryMode: "baseline",
      dataCompletenessScore: 10,
    });
    expect(client.rows("health_daily")[0]).toMatchObject({
      sleep_minutes: null,
      deep_sleep_minutes: null,
      hrv_ms: null,
      steps: 1200,
    });
    expect(await store.ingestHealthPayload(correction)).toMatchObject({
      recoveryMode: "baseline",
      dataCompletenessScore: 10,
    });
  });

  it("scores a preserved manual fallback and never clears manual daily-only stages on watch corrections", async () => {
    const { client, store } = setup();
    await store.upsertHealthMetrics({
      userId: "user-a",
      date: "2026-09-23",
      source: "manual",
      metrics: [{ type: "sleep_minutes", value: 180 }],
    });
    const first = {
      ...payload(),
      metrics: { sleepMinutes: 480 },
      workouts: [],
      samples: [],
      missing: {},
    };
    await store.ingestHealthPayload(first);
    Object.assign(client.rows("health_daily")[0], {
      deep_sleep_minutes: 30,
      hrv_ms: 20,
      source: "manual",
      metadata: {
        fieldSources: {
          sleep_minutes: "xiaomi_health_connect",
          deep_sleep_minutes: "manual",
          hrv_ms: "manual",
        },
      },
    });
    const correction = {
      ...first,
      metrics: { steps: 2000 },
      missing: { sleep_minutes: true, sleep_stages: true, hrv_ms: true },
    };
    expect(await store.ingestHealthPayload(correction)).toMatchObject({
      recoveryMode: "recovery",
      dataCompletenessScore: 45,
    });
    expect(client.rows("health_daily")[0]).toMatchObject({
      sleep_minutes: 180,
      deep_sleep_minutes: 30,
      hrv_ms: 20,
      steps: 2000,
    });
  });

  it("retries a concurrent measurement change even when the legacy timestamp is unchanged", async () => {
    const { client, store } = setup();
    await store.ingestHealthPayload(payload());
    client.updates.length = 0;
    let conflicts = 0;
    client.beforeRun = (query) => {
      if (
        query.action === "update" &&
        query.payload[0]?.data_completeness_score !== undefined &&
        conflicts++ === 0
      ) {
        // Another writer commits after the read but before the score-only CAS.
        Object.assign(client.rows("health_daily")[0], {
          sleep_minutes: 180,
          steps: 7777,
        });
      }
    };
    const result = await store.ingestHealthPayload({
      ...payload(),
      metrics: { steps: 6200 },
      missing: {},
      workouts: [],
      samples: [],
    });
    expect(result).toMatchObject({
      recoveryMode: "recovery",
      dataCompletenessScore: 85,
    });
    expect(client.rows("health_daily")[0]).toMatchObject({
      sleep_minutes: 180,
      steps: 7777,
      recovery_mode: "recovery",
    });
    const scoreWrites = client.updates.filter(
      (update) => update.payload.data_completeness_score !== undefined,
    );
    expect(scoreWrites).toHaveLength(2);
    expect(
      scoreWrites.every(
        (update) =>
          Object.keys(update.payload).sort().join(",") ===
          "data_completeness_score,recovery_mode",
      ),
    ).toBe(true);
    expect(
      client.queries
        .filter((query) => query.action === "update")
        .every((query) => query.filters.user_id === "user-a"),
    ).toBe(true);
  });

  it("bounds score conflicts and fails without recording a false successful sync or replacing metrics", async () => {
    const { client, store } = setup();
    const first = payload();
    first.metrics.sleepMinutes = 180;
    await store.ingestHealthPayload(first);
    const previousRuns = client.rows("health_sync_runs").length;
    let conflicts = 0;
    client.beforeRun = (query) => {
      if (
        query.action === "update" &&
        query.payload[0]?.data_completeness_score !== undefined
      ) {
        client.rows("health_daily")[0]!.steps = 8000 + ++conflicts;
      }
    };
    await expect(
      store.ingestHealthPayload({
        ...payload(),
        metrics: { steps: 6200 },
        missing: {},
        workouts: [],
        samples: [],
      }),
    ).rejects.toThrow(
      "Health daily changed during score calculation; retry the sync",
    );
    expect(conflicts).toBe(3);
    expect(client.rows("health_daily")[0]).toMatchObject({
      sleep_minutes: 180,
      steps: 8003,
      recovery_mode: "recovery",
    });
    expect(client.rows("health_sync_runs")).toHaveLength(previousRuns);
  });

  it("clears bogus watch RHR and sleep stages only on explicit missing corrections", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-24T10:00:00Z"));
    const { client, store } = setup();
    await store.ingestHealthPayload(payload());
    await store.ingestHealthPayload({ ...payload(), userId: "user-b" });
    await store.ingestHealthPayload({ ...payload(), date: "2026-09-22" });
    // Updating mood must not relabel the watch's retained RHR as manual data.
    await store.upsertHealthMetrics({
      userId: "user-a",
      date: "2026-09-23",
      source: "manual",
      metrics: [{ type: "mood_score", value: 7 }],
    });
    const corrected = payload();
    delete corrected.metrics.restingHeartRate;
    delete corrected.metrics.deepSleepMinutes;
    delete corrected.metrics.hrvMs;
    corrected.missing = {
      resting_heart_rate: true,
      sleep_stages: true,
      hrv_ms: true,
    };
    await store.ingestHealthPayload(corrected);
    const summary = await store.getTmaHealthSummary("user-a");
    expect(summary).toMatchObject({
      date: "2026-09-23",
      restingHeartRate: null,
      averageHeartRate: 75,
      deepSleepMinutes: null,
      remSleepMinutes: null,
      awakeMinutes: null,
      hrvMs: null,
    });
    expect(
      (await store.getHealthMetricDay("user-a", "2026-09-23")).metrics
        .resting_heart_rate,
    ).toBeUndefined();
    expect(
      (await store.getHealthMetricDay("user-b", "2026-09-23")).metrics
        .resting_heart_rate,
    ).toBe(58);
    expect(
      (await store.getHealthMetricDay("user-a", "2026-09-22")).metrics
        .resting_heart_rate,
    ).toBe(58);
    expect(client.queries.filter((query) => query.action === "delete")).toEqual(
      [
        {
          table: "health_metrics",
          action: "delete",
          filters: {
            user_id: "user-a",
            metric_date: "2026-09-23",
            source: "xiaomi_health_connect",
          },
        },
      ],
    );
  });

  it("keeps a manual RHR as the remaining winner after the watch invalidates its RHR", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-24T10:00:00Z"));
    const { client, store } = setup();
    await store.upsertHealthMetrics({
      userId: "user-a",
      date: "2026-09-23",
      source: "manual",
      metrics: [{ type: "resting_heart_rate", value: 54 }],
    });
    await store.ingestHealthPayload(payload());
    const corrected = payload();
    delete corrected.metrics.restingHeartRate;
    corrected.missing = { resting_heart_rate: true };
    await store.ingestHealthPayload(corrected);
    expect((await store.getTmaHealthSummary("user-a")).restingHeartRate).toBe(
      54,
    );
    expect(client.rows("health_daily")[0]!.resting_heart_rate).toBe(54);
    expect(
      client
        .rows("health_metrics")
        .filter((row) => row.metric_type === "resting_heart_rate"),
    ).toMatchObject([{ source: "manual", value: 54 }]);
  });

  it("preserves omissions without missing flags and does not clear another source's daily extras", async () => {
    const { client, store } = setup();
    await store.ingestHealthPayload(payload());
    const partial = payload();
    delete partial.metrics.restingHeartRate;
    delete partial.metrics.deepSleepMinutes;
    await store.ingestHealthPayload(partial);
    expect(client.rows("health_daily")[0]).toMatchObject({
      resting_heart_rate: 58,
      deep_sleep_minutes: 70,
    });
    expect(
      (await store.getHealthMetricDay("user-a", "2026-09-23")).metrics
        .resting_heart_rate,
    ).toBe(58);
    // A legacy daily-only manual reading has no watch provenance.
    client.rows("health_daily")[0]!.source = "manual";
    client.rows("health_daily")[0]!.metadata = {};
    partial.missing = { sleep_stages: true };
    await store.ingestHealthPayload(partial);
    await store.ingestHealthPayload(partial);
    expect(client.rows("health_daily")[0]!.deep_sleep_minutes).toBe(70);
  });

  it("updates the same day's measured metrics, samples and workouts on retry", async () => {
    const { client, store } = setup();
    const first = payload();
    await store.ingestHealthPayload(first);
    const corrected = payload();
    corrected.metrics.steps = 4800;
    corrected.samples[0]!.value = 88;
    corrected.samples.push({
      ...corrected.samples[0]!,
      sampledAt: "2026-09-23T15:00:00+05:00",
      value: 89,
    });
    corrected.workouts[0]!.durationMinutes = 35;
    await store.ingestHealthPayload(corrected);
    expect(client.rows("health_samples")).toHaveLength(1);
    expect(client.rows("health_samples")[0]).toMatchObject({
      user_id: "user-a",
      value: 89,
    });
    expect(client.rows("health_samples")[0]!.id).toMatch(
      /^[\da-f]{8}-[\da-f]{4}-5[\da-f]{3}-a[\da-f]{3}-[\da-f]{12}$/,
    );
    expect(client.rows("health_workouts")).toHaveLength(1);
    expect(client.rows("health_workouts")[0]!.duration_minutes).toBe(35);
    const day = await store.getHealthMetricDay("user-a", "2026-09-23");
    expect(day.metrics).toMatchObject({
      steps: 4800,
      average_heart_rate: 75,
      resting_heart_rate: 58,
      distance_m: 3000,
    });
    expect(day.metrics.mood_score).toBeUndefined();
    expect(client.rows("health_daily")[0]).toMatchObject({
      hrv_ms: 41,
      deep_sleep_minutes: 70,
    });
    const week = await store.getHealthMetricWeek("user-a", "2026-09-24");
    expect(week.trends.find((day) => day.date === "2026-09-23")!.steps).toBe(
      4800,
    );
  });

  it("keeps sample identities and normalized metric writes separate by source and user", async () => {
    const { client, store } = setup();
    await store.ingestHealthPayload(payload());
    await store.ingestHealthPayload({ ...payload(), userId: "user-b" });
    await store.ingestHealthPayload({ ...payload(), source: "api" });
    expect(
      new Set(client.rows("health_samples").map((row) => row.id)).size,
    ).toBe(3);
    await store.upsertHealthMetrics({
      userId: "user-a",
      date: "2026-09-23",
      source: "manual",
      metrics: [{ type: "mood_score", value: 7 }],
    });
    expect(
      client.rows("health_metrics").filter((row) => row.source === "manual"),
    ).toHaveLength(1);
    expect(
      client
        .rows("health_metrics")
        .filter((row) => row.metric_type === "mood_score"),
    ).toHaveLength(1);
    expect(
      client.rows("health_daily").find((row) => row.user_id === "user-a"),
    ).toMatchObject({ hrv_ms: 41, deep_sleep_minutes: 70 });
    expect(
      (await store.getHealthMetricDay("user-b", "2026-09-23")).metrics
        .mood_score,
    ).toBeUndefined();
  });

  it("does not attach yesterday's sleep stages, HRV or samples to today's metrics", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-24T10:00:00Z"));
    const { client, store } = setup();
    await store.ingestHealthPayload(payload());
    client.rows("health_metrics").push({
      id: "today",
      user_id: "user-a",
      metric_date: "2026-09-24",
      metric_type: "steps",
      value: 1200,
      source: "manual",
    });
    const summary = await store.getTmaHealthSummary("user-a");
    expect(summary).toMatchObject({
      date: "2026-09-24",
      steps: 1200,
      sleepMinutes: null,
      deepSleepMinutes: null,
      hrvMs: null,
      samplesCount: 0,
      restingHeartRate: null,
    });
    expect(summary.weekly.endDate).toBe("2026-09-24");
  });

  it("falls back to one latest date including scalar metrics and daily extras", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-24T10:00:00Z"));
    const { client, store } = setup();
    await store.ingestHealthPayload(payload());
    await store.ingestHealthPayload({
      ...payload(),
      userId: "user-b",
      date: "2026-09-24",
    });
    const summary = await store.getTmaHealthSummary("user-a");
    expect(summary).toMatchObject({
      date: "2026-09-23",
      hasMetrics: true,
      steps: 4000,
      deepSleepMinutes: 70,
      hrvMs: 41,
      samplesCount: 1,
      averageHeartRate: 75,
      distanceM: 3000,
    });
    expect(summary.weekly.endDate).toBe("2026-09-24");
    expect(summary.trends.at(-1)!.steps).toBeNull();
    expect(
      client.queries
        .filter((query) => query.action === "select")
        .every((query) => query.filters.user_id),
    ).toBe(true);
    expect(summary).not.toHaveProperty("raw");
  });
});
