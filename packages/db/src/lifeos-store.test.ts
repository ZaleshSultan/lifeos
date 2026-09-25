import { describe, expect, it, vi } from "vitest";
import { SupabaseLifeOSStore } from "./lifeos-store.js";

interface FakeRow {
  [key: string]: unknown;
  id?: string;
  user_id?: string;
  status?: string;
}

interface FakeQueryReceipt {
  table: string;
  action: string;
  columns?: string;
  filters: Record<string, unknown>;
  inFilters: Record<string, unknown[]>;
  greaterThanFilters: Record<string, string>;
  limit?: number;
  payload?: unknown;
}

class FakeSupabaseClient {
  transactions: FakeRow[] = [];
  tags: FakeRow[] = [];
  receipts: FakeRow[] = [];
  obsidianSettings: FakeRow[] = [];
  oauthConnections: FakeRow[] = [];
  studyCourses: FakeRow[] = [];
  courseSchedules: FakeRow[] = [];
  assessmentItems: FakeRow[] = [];
  academicTerms: FakeRow[] = [];
  courseReadings: FakeRow[] = [];
  academicRecords: FakeRow[] = [];
  sourceEvents: FakeRow[] = [];
  userSettings: FakeRow[] = [];
  workouts: FakeRow[] = [];
  workoutSets: FakeRow[] = [];
  fitnessExercises: FakeRow[] = [];
  queries: FakeQueryReceipt[] = [];
  selectErrors: Record<string, string> = {};
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  rpcError: { message: string } | null = null;

  from(table: string): FakeQuery {
    return new FakeQuery(this, table);
  }

  rpc(name: string, args: Record<string, unknown>): Promise<{
    data: null;
    error: { message: string } | null;
  }> {
    this.rpcCalls.push({ name, args });
    return Promise.resolve({ data: null, error: this.rpcError });
  }
}

class FakeQuery {
  private action = "select";
  private readonly filters: Record<string, unknown> = {};
  private readonly inFilters: Record<string, unknown[]> = {};
  private readonly greaterThanFilters: Record<string, string> = {};
  private readonly orders: Array<{
    column: string;
    ascending: boolean;
    nullsFirst: boolean;
  }> = [];
  private rowLimit: number | undefined;
  private rowOffset = 0;
  private readonly notNullColumns: string[] = [];
  private payload: unknown;
  private columns: string | undefined;

  constructor(
    private readonly client: FakeSupabaseClient,
    private readonly table: string,
  ) {}

  select(columns?: string): this {
    this.columns = columns;
    return this;
  }

  insert(payload: unknown): this {
    this.action = "insert";
    this.payload = payload;
    return this;
  }

  update(payload: unknown): this {
    this.action = "update";
    this.payload = payload;
    return this;
  }

  delete(): this {
    this.action = "delete";
    return this;
  }

  upsert(payload: unknown, _options?: unknown): this {
    this.action = "upsert";
    this.payload = payload;
    return this;
  }

  eq(key: string, value: unknown): this {
    this.filters[key] = value;
    return this;
  }

  is(key: string, value: unknown): this {
    return this.eq(key, value);
  }

  not(key: string, operator: string, value: unknown): this {
    if (operator !== "is" || value !== null) throw new Error("Unsupported filter");
    this.notNullColumns.push(key);
    return this;
  }

  range(start: number, end: number): this {
    this.rowOffset = start;
    this.rowLimit = end - start + 1;
    return this;
  }

  in(key: string, values: unknown[]): this {
    this.inFilters[key] = values;
    return this;
  }

  ilike(key: string, value: string): this {
    this.filters[key] = { $ilike: value };
    return this;
  }

  gt(key: string, value: string): this {
    this.greaterThanFilters[key] = value;
    return this;
  }

  order(
    column: string,
    options?: { ascending?: boolean; nullsFirst?: boolean },
  ): this {
    const ascending = options?.ascending ?? true;
    this.orders.push({
      column,
      ascending,
      nullsFirst: options?.nullsFirst ?? !ascending,
    });
    return this;
  }

  limit(count: number): this {
    this.rowLimit = count;
    return this;
  }

  maybeSingle(): Promise<{ data: FakeRow | null; error: null }> {
    const data =
      this.action === "select" ? (this.filteredRows()[0] ?? null) : null;
    this.recordQuery();
    return Promise.resolve({ data, error: null });
  }

  single(): Promise<{ data: FakeRow; error: null }> {
    let data: FakeRow;
    if (this.action === "upsert") {
      data = this.upsertRow();
    } else if (this.action === "insert") {
      data = this.insertRow();
    } else if (this.action === "update") {
      data = this.updateRow();
    } else {
      data = this.filteredRows()[0] ?? {};
    }
    this.recordQuery();
    return Promise.resolve({ data, error: null });
  }

  then<
    TResult1 = { data: FakeRow[] | null; error: { message: string } | null },
    TResult2 = never,
  >(
    onfulfilled?:
      | ((value: {
          data: FakeRow[] | null;
          error: { message: string } | null;
        }) => TResult1)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    if (this.action === "delete") {
      this.deleteRows();
    }
    if (this.action === "update") {
      this.updateRow();
    }
    if (this.action === "upsert") this.upsertRow();
    const errorMessage =
      this.client.selectErrors[
        `${this.table}:${this.greaterThanFilters.id ?? ""}`
      ];
    return Promise.resolve({
      data:
        this.action === "select" && !errorMessage ? this.filteredRows() : null,
      error: errorMessage ? { message: errorMessage } : null,
    })
      .then((value) => {
        this.recordQuery();
        return value;
      })
      .then(onfulfilled, onrejected);
  }

  private recordQuery(): void {
    this.client.queries.push({
      table: this.table,
      action: this.action,
      columns: this.columns,
      filters: { ...this.filters },
      inFilters: { ...this.inFilters },
      greaterThanFilters: { ...this.greaterThanFilters },
      limit: this.rowLimit,
      payload: this.payload,
    });
  }

  private insertRow(): FakeRow {
    const payload = (this.payload ?? {}) as FakeRow;
    const row: FakeRow = {
      id:
        (payload.id as string) ??
        `gen-${Math.random().toString(36).slice(2, 9)}`,
      created_at: "2026-08-28T18:00:00Z",
      updated_at: "2026-08-28T18:00:00Z",
      ...payload,
    };
    this.tableRows().push(row);
    return row;
  }

  private updateRow(): FakeRow {
    const payload = (this.payload ?? {}) as FakeRow;
    const rows = this.filteredRows();
    if (rows[0]) {
      Object.assign(rows[0], payload, { updated_at: "2026-08-28T18:00:00Z" });
      return rows[0];
    }
    return {};
  }

  private deleteRows(): void {
    const toDelete = new Set(this.filteredRows());
    const rows = this.tableRows();
    const remaining = rows.filter((r) => !toDelete.has(r));
    rows.length = 0;
    rows.push(...remaining);
  }

  private upsertRow(): FakeRow {
    if (
      this.table !== "user_settings" &&
      this.table !== "user_obsidian_settings" &&
      this.table !== "user_oauth_connections"
    ) {
      return {};
    }

    if (!this.payload || Array.isArray(this.payload)) {
      throw new Error("Unexpected upsert payload");
    }

    const payload = this.payload as FakeRow;
    const rows = this.tableRows();
    const existing = rows.find((row) => {
      if (this.table === "user_oauth_connections") {
        return (
          row.user_id === payload.user_id && row.provider === payload.provider
        );
      }

      return row.user_id === payload.user_id;
    });
    const defaults = {
      ...(this.table === "user_oauth_connections"
        ? {
            id: "oauth-1",
            provider_account_email: null,
            access_token: null,
            refresh_token: null,
            expires_at: null,
            scopes: [],
            status: "connected",
          }
        : {
            enabled: false,
            mode: "local_vault",
            vault_path: null,
            status: "disconnected",
          }),
      metadata: {},
      created_at: "2026-06-15T10:00:00Z",
      updated_at: "2026-06-15T10:00:00Z",
    };

    if (existing) {
      Object.assign(existing, payload, {
        updated_at: "2026-06-15T10:00:00Z",
      });
      return existing;
    }

    const row = { ...defaults, ...payload };
    rows.push(row);
    return row;
  }

  private filteredRows(): FakeRow[] {
    const rows = this.tableRows().filter((row) => {
      if (this.notNullColumns.some((column) => row[column] == null)) return false;
      for (const [key, value] of Object.entries(this.filters)) {
        if (value && typeof value === "object" && "$ilike" in value) {
          const rowVal = String(row[key as keyof FakeRow] ?? "");
          const searchVal = String((value as { $ilike: string }).$ilike);
          if (rowVal.toLowerCase() !== searchVal.toLowerCase()) {
            return false;
          }
        } else if (row[key as keyof FakeRow] !== value) {
          return false;
        }
      }

      for (const [key, values] of Object.entries(this.inFilters)) {
        if (!values.includes(row[key as keyof FakeRow])) {
          return false;
        }
      }

      for (const [key, value] of Object.entries(this.greaterThanFilters)) {
        if (String(row[key]) <= value) {
          return false;
        }
      }

      return true;
    });
    rows.sort((left, right) => {
      for (const { column, ascending, nullsFirst } of this.orders) {
        if (left[column] == null && right[column] == null) {
          continue;
        }
        if (left[column] == null) {
          return nullsFirst ? -1 : 1;
        }
        if (right[column] == null) {
          return nullsFirst ? 1 : -1;
        }
        const difference = String(left[column] ?? "").localeCompare(
          String(right[column] ?? ""),
        );
        if (difference !== 0) {
          return ascending ? difference : -difference;
        }
      }
      return 0;
    });
    return this.rowLimit === undefined ? rows : rows.slice(this.rowOffset, this.rowOffset + this.rowLimit);
  }

  private tableRows(): FakeRow[] {
    if (this.table === "user_settings") return this.client.userSettings;
    if (this.table === "workouts") return this.client.workouts;
    if (this.table === "workout_sets") return this.client.workoutSets;
    if (this.table === "fitness_exercises") return this.client.fitnessExercises;
    if (this.table === "finance_transactions") {
      return this.client.transactions;
    }

    if (this.table === "finance_tags") {
      return this.client.tags;
    }

    if (this.table === "finance_receipts") {
      return this.client.receipts;
    }

    if (this.table === "user_obsidian_settings") {
      return this.client.obsidianSettings;
    }

    if (this.table === "user_oauth_connections") {
      return this.client.oauthConnections;
    }

    if (this.table === "study_courses") {
      return this.client.studyCourses;
    }

    if (this.table === "course_schedules") {
      return this.client.courseSchedules;
    }

    if (this.table === "assessment_items") {
      return this.client.assessmentItems;
    }

    if (this.table === "academic_terms") {
      return this.client.academicTerms;
    }

    if (this.table === "course_readings") {
      return this.client.courseReadings;
    }
    if (this.table === "academic_records") {
      return this.client.academicRecords;
    }
    if (this.table === "source_events") {
      return this.client.sourceEvents;
    }

    return [];
  }
}

const txA = "11111111-1111-4111-8111-111111111111";
const receiptA = "22222222-2222-4222-8222-222222222222";
const tagA = "33333333-3333-4333-8333-333333333333";

function storeWith(client: FakeSupabaseClient): SupabaseLifeOSStore {
  return new SupabaseLifeOSStore(client as never, {
    allowPlaintextOAuthTokens: true,
  });
}

const customWorkoutProgram = {
  title: "Мой план",
  days: [{ id: "legs", title: "Ноги", exercises: [{ name: "Приседания", sets: [{ reps: 8, weightKg: 40, restSeconds: 120 }] }] }],
};

function workoutClient(): FakeSupabaseClient {
  const client = new FakeSupabaseClient();
  client.workouts = [
    { id: "workout-a", user_id: "user-a", title: "Ноги", started_at: "2026-09-24T10:00:00Z", ended_at: null },
    { id: "workout-b", user_id: "user-b", title: "Private", started_at: "2026-09-24T10:00:00Z", ended_at: null },
  ];
  client.fitnessExercises = [
    { id: "exercise-a", user_id: "user-a", name: "Приседания", category: "strength" },
    { id: "exercise-b", user_id: "user-b", name: "Private exercise", category: "strength" },
  ];
  client.workoutSets = [
    { id: "set-a", user_id: "user-a", workout_id: "workout-a", exercise_id: "exercise-a", set_index: 1, reps: 8, weight_kg: 40, rest_seconds: 120, completed: false, completed_at: null, created_at: "2026-09-24T10:00:00Z" },
    { id: "set-b", user_id: "user-b", workout_id: "workout-b", exercise_id: "exercise-b", set_index: 1, reps: 8, weight_kg: 40, rest_seconds: 120, completed: false, completed_at: null, created_at: "2026-09-24T10:00:00Z" },
  ];
  return client;
}

describe("workout persistence", () => {
  it("round-trips a program while preserving unrelated settings and another user", async () => {
    const client = workoutClient();
    client.userSettings = [
      { user_id: "user-a", settings: { reminder_mode: "chill", finance_base_currency: "KZT" } },
      { user_id: "user-b", settings: { workout_program: { ...customWorkoutProgram, title: "Other" } } },
    ];
    const store = storeWith(client);
    await store.saveWorkoutProgram("user-a", customWorkoutProgram);
    expect(await store.getWorkoutProgram("user-a")).toEqual(customWorkoutProgram);
    expect(client.userSettings[0].settings).toEqual({ reminder_mode: "chill", finance_base_currency: "KZT", workout_program: customWorkoutProgram });
    expect((client.userSettings[1].settings as { workout_program: { title: string } }).workout_program.title).toBe("Other");
    expect(client.queries.filter((query) => query.action === "select").every((query) => query.filters.user_id === "user-a")).toBe(true);
  });

  it("returns a workout's GIF snapshot after the saved program changes", async () => {
    const client = workoutClient();
    const store = storeWith(client);
    const gifUrl = "https://example.com/squat.gif";
    const exercise = customWorkoutProgram.days[0].exercises[0];
    const day = customWorkoutProgram.days[0];
    const withGif = {
      ...customWorkoutProgram,
      days: [{ ...day, exercises: [{ ...exercise, gifUrl }] }],
    };
    await store.saveWorkoutProgram("user-a", withGif);
    expect(await store.getWorkoutProgram("user-a")).toEqual(withGif);

    client.workouts[0].ended_at = "2026-09-24T11:00:00Z";
    const started = await store.getOrCreateCurrentWorkout({
      userId: "user-a",
      title: day.title,
      now: "2026-09-25T10:00:00Z",
      manualPlan: [{ ...withGif.days[0].exercises[0], category: "strength", equipment: "unspecified" }],
    });
    expect(started.created).toBe(true);
    const workoutRow = client.workouts.find((row) => row.id === started.id)!;
    expect(workoutRow.metadata).toMatchObject({
      parsedPlan: [{ name: exercise.name, gifUrl }],
    });
    workoutRow.ended_at = null;
    // The fake client does not persist array inserts into workout_sets.
    client.workoutSets.push({
      ...client.workoutSets[0],
      id: "new-set",
      workout_id: started.id,
      created_at: "2026-09-25T10:00:00Z",
    });
    expect((await store.getCurrentWorkout({ userId: "user-a" }))?.exercises[0].gifUrl).toBe(gifUrl);

    await store.saveWorkoutProgram("user-a", customWorkoutProgram);
    workoutRow.ended_at = "2026-09-25T11:00:00Z";
    const history = await store.getWorkoutHistory("user-a");
    expect(history.find((session) => session.id === started.id)?.exercises[0].gifUrl).toBe(gifUrl);
    expect(await store.getWorkoutProgram("user-a")).toEqual(customWorkoutProgram);
  });

  it("omits malformed GIF links from older workout metadata", async () => {
    const client = workoutClient();
    client.workouts[0].metadata = {
      parsedPlan: [{ name: "Приседания", gifUrl: "javascript:alert(1)" }],
    };
    const current = await storeWith(client).getCurrentWorkout({ userId: "user-a" });
    expect(current?.exercises[0]).not.toHaveProperty("gifUrl");
  });

  it("edits recorded set values without altering the saved program or another user's set", async () => {
    const client = workoutClient();
    client.userSettings = [{ user_id: "user-a", settings: { workout_program: customWorkoutProgram } }];
    const summary = await storeWith(client).updateWorkoutSet({ userId: "user-a", setId: "set-a", values: { reps: 7, weightKg: 42.5, restSeconds: 0 } });
    expect(summary.exercises[0].sets[0]).toMatchObject({ targetReps: 7, targetWeightKg: 42.5, restSeconds: 0 });
    expect(client.workoutSets[1].reps).toBe(8);
    expect((client.userSettings[0].settings as { workout_program: unknown }).workout_program).toEqual(customWorkoutProgram);
    expect(client.queries.every((query) => query.filters.user_id === "user-a")).toBe(true);
  });

  it("rejects foreign set IDs and all set mutations after a workout ends", async () => {
    const client = workoutClient();
    const store = storeWith(client);
    const values = { reps: 7, weightKg: 40, restSeconds: 90 };
    await expect(store.updateWorkoutSet({ userId: "user-a", setId: "set-b", values })).rejects.toThrow("workout_not_found");
    client.workouts[0].ended_at = "2026-09-24T11:00:00Z";
    await expect(store.updateWorkoutSet({ userId: "user-a", setId: "set-a", values })).rejects.toThrow("workout_completed");
    await expect(store.completeWorkoutSet({ userId: "user-a", setId: "set-a", completedAt: "2026-09-24T11:01:00Z" })).rejects.toThrow("workout_completed");
    await expect(store.undoWorkoutSet({ userId: "user-a", setId: "set-a" })).rejects.toThrow("workout_completed");
    expect(client.queries.filter((query) => query.action === "update")).toHaveLength(0);
  });

  it("pages history sets, excludes active and foreign sessions, and scopes exercise names", async () => {
    const client = workoutClient();
    client.workouts[0].ended_at = "2026-09-24T11:00:00Z";
    client.workouts[1].ended_at = "2026-09-24T11:00:00Z";
    client.workouts.push({ id: "active-a", user_id: "user-a", started_at: "2026-09-24T12:00:00Z", ended_at: null });
    const base = client.workoutSets[0];
    client.workoutSets = Array.from({ length: 501 }, (_, i) => ({
      ...base, id: `set-${String(i).padStart(4, "0")}`, set_index: i + 1,
      completed: i < 2, completed_at: i < 2 ? "2026-09-24T10:05:00Z" : null,
      exercise_id: i === 500 ? "exercise-b" : "exercise-a",
    }));
    const history = await storeWith(client).getWorkoutHistory("user-a");
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ id: "workout-a", totalSets: 501, completedSets: 2, volumeKg: 640, restTimerEndsAt: null, endedAt: "2026-09-24T11:00:00Z" });
    expect(history[0].exercises[1].name).toBe("Exercise");
    expect(JSON.stringify(history)).not.toContain("Private");
    expect(client.queries.filter((query) => query.table === "workout_sets")).toHaveLength(2);
    expect(client.queries.every((query) => query.filters.user_id === "user-a")).toBe(true);
  });

  it("does not resurrect an older rest timer after completing a set with zero rest", async () => {
    const client = workoutClient();
    client.workoutSets[0].completed = true;
    client.workoutSets[0].completed_at = "2026-09-24T10:10:00Z";
    client.workoutSets.push({ ...client.workoutSets[0], id: "no-rest", set_index: 2, rest_seconds: 0, completed_at: "2026-09-24T10:10:05Z" });
    const current = await storeWith(client).getCurrentWorkout({ userId: "user-a" });
    expect(current?.restTimerEndsAt).toBeNull();
  });
});

describe("SupabaseLifeOSStore tenant isolation", () => {
  it("rejects adding tags to another user's transaction", async () => {
    const client = new FakeSupabaseClient();
    client.transactions = [{ id: txA, user_id: "user-b" }];
    client.tags = [{ id: tagA, user_id: "user-a" }];

    await expect(
      storeWith(client).addTransactionTags("user-a", txA, [tagA]),
    ).rejects.toThrow("Finance transaction not found");

    expect(
      client.queries.some(
        (query) =>
          query.table === "finance_transaction_tags" &&
          query.action === "upsert",
      ),
    ).toBe(false);
  });

  it("rejects adding another user's tag to a transaction", async () => {
    const client = new FakeSupabaseClient();
    client.transactions = [{ id: txA, user_id: "user-a" }];
    client.tags = [{ id: tagA, user_id: "user-b" }];

    await expect(
      storeWith(client).addTransactionTags("user-a", txA, [tagA]),
    ).rejects.toThrow("Finance tag not found");

    expect(
      client.queries.some(
        (query) =>
          query.table === "finance_transaction_tags" &&
          query.action === "upsert",
      ),
    ).toBe(false);
  });

  it("rejects bank reconciliation for another user's receipt", async () => {
    const client = new FakeSupabaseClient();
    client.transactions = [{ id: txA, user_id: "user-a", status: "draft" }];
    client.receipts = [{ id: receiptA, user_id: "user-b" }];
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await expect(
        storeWith(client).reconcileBankLine("user-a", txA, receiptA),
      ).rejects.toThrow("No receipt matches ID for this user");
    } finally {
      errorSpy.mockRestore();
    }

    expect(
      client.queries.some(
        (query) =>
          query.table === "finance_transactions" && query.action === "update",
      ),
    ).toBe(false);
  });

  it("delegates bank reconciliation to the atomic receipt RPC", async () => {
    const client = new FakeSupabaseClient();
    client.transactions = [{ id: txA, user_id: "user-a", status: "draft" }];
    client.receipts = [{ id: receiptA, user_id: "user-a", status: "linked" }];

    await storeWith(client).reconcileBankLine("user-a", txA, receiptA);

    expect(client.rpcCalls).toEqual([
      {
        name: "reconcile_bank_receipt",
        args: {
          p_user_id: "user-a",
          p_bank_transaction_id: txA,
          p_receipt_id: receiptA,
        },
      },
    ]);
    expect(
      client.queries.some(
        (query) =>
          query.table === "finance_transactions" && query.action === "update",
      ),
    ).toBe(false);
  });

  it("rejects bank reconciliation for another user's draft transaction", async () => {
    const client = new FakeSupabaseClient();
    client.transactions = [{ id: txA, user_id: "user-b", status: "draft" }];
    client.receipts = [{ id: receiptA, user_id: "user-a" }];
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await expect(
        storeWith(client).reconcileBankLine("user-a", txA, receiptA),
      ).rejects.toThrow("No unmatched bank line matches short ID");
    } finally {
      errorSpy.mockRestore();
    }

    expect(
      client.queries.some(
        (query) =>
          query.table === "finance_transactions" && query.action === "update",
      ),
    ).toBe(false);
  });
});

describe("SupabaseLifeOSStore Obsidian settings", () => {
  it("loads Obsidian settings scoped by user_id", async () => {
    const client = new FakeSupabaseClient();
    client.obsidianSettings = [
      {
        user_id: "user-a",
        enabled: true,
        mode: "local_vault",
        vault_path: "/vault/a",
        status: "connected",
        metadata: {},
        created_at: "2026-06-15T10:00:00Z",
        updated_at: "2026-06-15T10:00:00Z",
      },
      {
        user_id: "user-b",
        enabled: true,
        mode: "local_vault",
        vault_path: "/vault/b",
        status: "connected",
        metadata: {},
        created_at: "2026-06-15T10:00:00Z",
        updated_at: "2026-06-15T10:00:00Z",
      },
    ];

    const settings = await storeWith(client).getUserObsidianSettings("user-a");

    expect(settings?.vaultPath).toBe("/vault/a");
    expect(
      client.queries.some(
        (query) =>
          query.table === "user_obsidian_settings" &&
          query.filters.user_id === "user-a",
      ),
    ).toBe(true);
  });

  it("upserts Obsidian settings for the requested user", async () => {
    const client = new FakeSupabaseClient();

    const settings = await storeWith(client).upsertUserObsidianSettings(
      "user-a",
      {
        enabled: true,
        mode: "local_vault",
        vaultPath: "/vault/a",
        status: "connected",
        metadata: { host: "arch" },
      },
    );

    expect(settings.userId).toBe("user-a");
    expect(settings.vaultPath).toBe("/vault/a");
    expect(client.obsidianSettings[0]).toMatchObject({
      user_id: "user-a",
      enabled: true,
      vault_path: "/vault/a",
      status: "connected",
    });
  });

  it("requires enabled connected local vault settings", async () => {
    const client = new FakeSupabaseClient();
    client.obsidianSettings = [
      {
        user_id: "user-a",
        enabled: true,
        mode: "local_vault",
        vault_path: "/vault/a",
        status: "connected",
        metadata: {},
        created_at: "2026-06-15T10:00:00Z",
        updated_at: "2026-06-15T10:00:00Z",
      },
      {
        user_id: "user-b",
        enabled: true,
        mode: "local_vault",
        vault_path: "",
        status: "connected",
        metadata: {},
        created_at: "2026-06-15T10:00:00Z",
        updated_at: "2026-06-15T10:00:00Z",
      },
    ];

    await expect(
      storeWith(client).isObsidianEnabledForUser("user-a"),
    ).resolves.toBe(true);
    await expect(
      storeWith(client).isObsidianEnabledForUser("user-b"),
    ).resolves.toBe(false);
    await expect(
      storeWith(client).isObsidianEnabledForUser("missing"),
    ).resolves.toBe(false);
  });
});

describe("SupabaseLifeOSStore OAuth connections", () => {
  it("returns safe OAuth metadata without tokens", async () => {
    const client = new FakeSupabaseClient();
    client.oauthConnections = [
      {
        id: "oauth-a",
        user_id: "user-a",
        provider: "google",
        provider_account_email: "a@example.com",
        access_token: "access-secret",
        refresh_token: "refresh-secret",
        expires_at: "2026-06-15T11:00:00Z",
        scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
        status: "connected",
        metadata: {},
        created_at: "2026-06-15T10:00:00Z",
        updated_at: "2026-06-15T10:00:00Z",
      },
    ];

    const connection = await storeWith(client).getSafeUserOAuthConnection(
      "user-a",
      "google",
    );

    expect(connection).toMatchObject({
      userId: "user-a",
      provider: "google",
      providerAccountEmail: "a@example.com",
      status: "connected",
    });
    expect(JSON.stringify(connection)).not.toContain("access-secret");
    expect(JSON.stringify(connection)).not.toContain("refresh-secret");
    expect(client.queries.at(-1)?.columns).not.toContain("access_token");
    expect(client.queries.at(-1)?.columns).not.toContain("refresh_token");
  });

  it("scopes safe OAuth metadata by user_id and provider", async () => {
    const client = new FakeSupabaseClient();
    client.oauthConnections = [
      {
        id: "oauth-b",
        user_id: "user-b",
        provider: "google",
        provider_account_email: "b@example.com",
        access_token: "access-b",
        refresh_token: "refresh-b",
        expires_at: null,
        scopes: [],
        status: "connected",
        metadata: {},
        created_at: "2026-06-15T10:00:00Z",
        updated_at: "2026-06-15T10:00:00Z",
      },
    ];

    const connection = await storeWith(client).getSafeUserOAuthConnection(
      "user-a",
      "google",
    );

    expect(connection).toBeNull();
    expect(client.queries.at(-1)).toMatchObject({
      table: "user_oauth_connections",
      filters: {
        user_id: "user-a",
        provider: "google",
      },
    });
  });

  it("upserts OAuth connection tokens for the requested user", async () => {
    const client = new FakeSupabaseClient();

    const connection = await storeWith(client).upsertUserOAuthConnection(
      "user-a",
      {
        provider: "google",
        providerAccountEmail: "a@example.com",
        accessToken: "access-secret",
        refreshToken: "refresh-secret",
        expiresAt: "2026-06-15T11:00:00Z",
        scopes: ["scope-a"],
        status: "connected",
      },
    );

    expect(connection.userId).toBe("user-a");
    expect(connection.accessToken).toBe("access-secret");
    expect(client.oauthConnections[0]).toMatchObject({
      user_id: "user-a",
      provider: "google",
      access_token: "access-secret",
      refresh_token: "refresh-secret",
    });
  });

  it("lists connected OAuth users by provider and status", async () => {
    const client = new FakeSupabaseClient();
    client.oauthConnections = [
      {
        id: "oauth-a",
        user_id: "user-a",
        provider: "google",
        provider_account_email: null,
        access_token: "a",
        refresh_token: "ra",
        expires_at: null,
        scopes: [],
        status: "connected",
        metadata: {},
        created_at: "2026-06-15T10:00:00Z",
        updated_at: "2026-06-15T10:00:00Z",
      },
      {
        id: "oauth-b",
        user_id: "user-b",
        provider: "google",
        provider_account_email: null,
        access_token: "b",
        refresh_token: "rb",
        expires_at: null,
        scopes: [],
        status: "revoked",
        metadata: {},
        created_at: "2026-06-15T10:00:00Z",
        updated_at: "2026-06-15T10:00:00Z",
      },
    ];

    const connections =
      await storeWith(client).listConnectedOAuthUsers("google");

    expect(connections.map((item) => item.userId)).toEqual(["user-a"]);
  });

  it("deletes OAuth connections scoped by user and provider", async () => {
    const client = new FakeSupabaseClient();

    await storeWith(client).deleteUserOAuthConnection("user-a", "google");

    expect(client.queries.at(-1)).toMatchObject({
      table: "user_oauth_connections",
      action: "delete",
      filters: {
        user_id: "user-a",
        provider: "google",
      },
    });
  });
});

describe("SupabaseLifeOSStore Academic Engine Phase 1", () => {
  const courseId = "c1111111-1111-4111-8111-111111111111";

  describe("findStudyCourseByExternalKey", () => {
    it("finds course by case-insensitive external_course_key scoped by userId", async () => {
      const client = new FakeSupabaseClient();
      client.studyCourses = [
        {
          id: courseId,
          user_id: "user-a",
          code: "CS101",
          title: "Intro to CS",
          term: "Fall 2026",
          starts_on: "2026-09-01",
          ends_on: "2026-12-15",
          status: "active",
          progress_percent: 0,
          completed_units: 0,
          total_units: null,
          last_studied_on: null,
          instructor_name: "Dr. Smith",
          instructor_email: "smith@aitu.kz",
          room: "C1.1.200",
          external_course_key: "AITU-CS-101-FALL",
          metadata: {},
          created_at: "2026-08-28T18:00:00Z",
          updated_at: "2026-08-28T18:00:00Z",
        },
        {
          id: "c2222222-2222-4222-8222-222222222222",
          user_id: "user-b",
          code: "CS101",
          title: "Intro to CS",
          term: "Fall 2026",
          starts_on: "2026-09-01",
          ends_on: "2026-12-15",
          status: "active",
          progress_percent: 0,
          completed_units: 0,
          total_units: null,
          last_studied_on: null,
          instructor_name: null,
          instructor_email: null,
          room: null,
          external_course_key: "AITU-CS-101-FALL",
          metadata: {},
          created_at: "2026-08-28T18:00:00Z",
          updated_at: "2026-08-28T18:00:00Z",
        },
      ];

      const match = await storeWith(client).findStudyCourseByExternalKey(
        "user-a",
        "aitu-cs-101-fall",
      );

      expect(match).not.toBeNull();
      expect(match?.id).toBe(courseId);
      expect(match?.instructorName).toBe("Dr. Smith");
      expect(match?.externalCourseKey).toBe("AITU-CS-101-FALL");

      const noMatch = await storeWith(client).findStudyCourseByExternalKey(
        "user-a",
        "NONEXISTENT",
      );
      expect(noMatch).toBeNull();

      const blankMatch = await storeWith(client).findStudyCourseByExternalKey(
        "user-a",
        "   ",
      );
      expect(blankMatch).toBeNull();
    });
  });

  describe("course_schedules methods", () => {
    it("creates, lists, and deletes course schedules", async () => {
      const client = new FakeSupabaseClient();
      client.studyCourses = [
        {
          id: courseId,
          user_id: "user-a",
          code: "CS101",
          title: "Intro to CS",
        },
      ];
      const store = storeWith(client);

      const created = await store.createCourseSchedule("user-a", {
        studyCourseId: courseId,
        dayOfWeek: "monday",
        startTime: "09:00:00",
        endTime: "10:30:00",
        room: "C1.1.200",
        sessionType: "lecture",
        instructorName: "Досумбеков А.Б.",
      });

      expect(created.studyCourseId).toBe(courseId);
      expect(created.dayOfWeek).toBe("monday");
      expect(created.startTime).toBe("09:00:00");
      expect(created.endTime).toBe("10:30:00");
      expect(created.room).toBe("C1.1.200");
      expect(created.instructorName).toBe("Досумбеков А.Б.");
      expect(created.sessionType).toBe("lecture");

      const schedules = await store.listCourseSchedules("user-a", courseId);
      expect(schedules).toHaveLength(1);
      expect(schedules[0].id).toBe(created.id);

      client.courseSchedules = [{ id: created.id, study_course_id: courseId }];
      await store.deleteCourseSchedule("user-a", created.id);
    });

    it("rejects creating a schedule for a course the caller does not own", async () => {
      const client = new FakeSupabaseClient();
      client.studyCourses = [
        {
          id: courseId,
          user_id: "user-a",
          code: "CS101",
          title: "Intro to CS",
        },
      ];
      const store = storeWith(client);

      await expect(
        store.createCourseSchedule("user-b", {
          studyCourseId: courseId,
          dayOfWeek: "monday",
          startTime: "09:00:00",
          endTime: "10:30:00",
        }),
      ).rejects.toThrow("Study course not found");
    });
  });

  describe("assessment_items methods", () => {
    it("creates, updates, and lists assessment items", async () => {
      const client = new FakeSupabaseClient();
      client.studyCourses = [
        {
          id: courseId,
          user_id: "user-a",
          code: "CS101",
          title: "Intro to CS",
        },
      ];
      const store = storeWith(client);

      const item = await store.createAssessmentItem("user-a", {
        studyCourseId: courseId,
        title: "Midterm Exam",
        assessmentType: "exam",
        weightPercent: 30,
        maxScore: 100,
        dueAt: "2026-10-15T10:00:00Z",
        syllabusDueAt: "2026-10-15T10:00:00Z",
        dueSource: "syllabus",
        notes: "Covers chapters 1-5",
      });

      expect(item.studyCourseId).toBe(courseId);
      expect(item.title).toBe("Midterm Exam");
      expect(item.status).toBe("pending");
      expect(item.weightPercent).toBe(30);
      expect(item.maxScore).toBe(100);
      expect(item.actualScore).toBeNull();

      client.assessmentItems = [{ id: item.id, study_course_id: courseId }];

      const updated = await store.updateAssessmentItem("user-a", item.id, {
        actualScore: 92.5,
        status: "graded",
        notes: "Scored 92.5/100",
      });

      expect(updated.actualScore).toBe(92.5);
      expect(updated.status).toBe("graded");
      expect(updated.notes).toBe("Scored 92.5/100");

      const items = await store.listAssessmentItems("user-a", courseId);
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe(item.id);
      expect(items[0].actualScore).toBe(92.5);
    });

    it("rejects creating assessment item with empty title", async () => {
      const client = new FakeSupabaseClient();
      client.studyCourses = [
        {
          id: courseId,
          user_id: "user-a",
          code: "CS101",
          title: "Intro to CS",
        },
      ];
      const store = storeWith(client);

      await expect(
        store.createAssessmentItem("user-a", {
          studyCourseId: courseId,
          title: "   ",
        }),
      ).rejects.toThrow("Assessment item title is required");
    });

    it("rejects updating assessment item with blank title", async () => {
      const client = new FakeSupabaseClient();
      client.studyCourses = [
        {
          id: courseId,
          user_id: "user-a",
          code: "CS101",
          title: "Intro to CS",
        },
      ];
      client.assessmentItems = [{ id: "some-id", study_course_id: courseId }];
      const store = storeWith(client);

      await expect(
        store.updateAssessmentItem("user-a", "some-id", {
          title: "",
        }),
      ).rejects.toThrow("Assessment item title cannot be blank");
    });

    it("rejects updating an assessment item the caller does not own", async () => {
      const client = new FakeSupabaseClient();
      client.studyCourses = [
        {
          id: courseId,
          user_id: "user-a",
          code: "CS101",
          title: "Intro to CS",
        },
      ];
      client.assessmentItems = [{ id: "some-id", study_course_id: courseId }];
      const store = storeWith(client);

      await expect(
        store.updateAssessmentItem("user-b", "some-id", {
          status: "graded",
        }),
      ).rejects.toThrow("Study course not found");
    });

    it("idempotently upserts assessment items by external_id", async () => {
      const client = new FakeSupabaseClient();
      client.studyCourses = [
        {
          id: courseId,
          user_id: "user-a",
          code: "CS101",
          title: "Intro to CS",
        },
      ];
      const store = storeWith(client);

      // First sync: creates new item
      const created = await store.upsertAssessmentItem("user-a", {
        studyCourseId: courseId,
        externalId: "moodle:item:1001",
        source: "moodle",
        title: "Assignment 1",
        assessmentType: "assignment",
        maxScore: 100,
        actualScore: 85,
        status: "graded",
      });

      expect(created.studyCourseId).toBe(courseId);
      expect(created.externalId).toBe("moodle:item:1001");
      expect(created.source).toBe("moodle");
      expect(created.actualScore).toBe(85);
      expect(created.status).toBe("graded");

      // Verify client has exactly 1 item
      expect(client.assessmentItems).toHaveLength(1);

      // Second sync: updates existing item without creating duplicate
      const updated = await store.upsertAssessmentItem("user-a", {
        studyCourseId: courseId,
        externalId: "moodle:item:1001",
        source: "moodle",
        title: "Assignment 1 (Updated)",
        assessmentType: "assignment",
        maxScore: 100,
        actualScore: 95,
        status: "graded",
      });

      expect(updated.id).toBe(created.id);
      expect(updated.title).toBe("Assignment 1 (Updated)");
      expect(updated.actualScore).toBe(95);

      // Ensure no duplicate was inserted
      expect(client.assessmentItems).toHaveLength(1);

      // Find by external ID
      const found = await store.findAssessmentItemByExternalId(
        "user-a",
        courseId,
        "moodle:item:1001",
      );
      expect(found).not.toBeNull();
      expect(found?.id).toBe(created.id);
      expect(found?.actualScore).toBe(95);
    });

    it("deletes assessment item with ownership verification", async () => {
      const client = new FakeSupabaseClient();
      client.studyCourses = [
        {
          id: courseId,
          user_id: "user-a",
          code: "CS101",
          title: "Intro to CS",
        },
      ];
      client.assessmentItems = [
        { id: "item-to-delete", study_course_id: courseId },
      ];
      const store = storeWith(client);

      // Reject non-owner deletion
      await expect(
        store.deleteAssessmentItem("user-b", "item-to-delete"),
      ).rejects.toThrow("Study course not found");

      // Owner deletion succeeds
      await store.deleteAssessmentItem("user-a", "item-to-delete");
      expect(client.assessmentItems).toHaveLength(0);
    });
  });

  describe("academic_terms methods", () => {
    const termId = "t1111111-1111-4111-8111-111111111111";

    it("creates, lists, and updates academic terms", async () => {
      const client = new FakeSupabaseClient();
      const store = storeWith(client);

      const created = await store.createAcademicTerm("user-a", {
        name: "1 триместр 2026-2027",
        institution: "Astana IT University",
        program: "Cybersecurity",
        startsOn: "2026-09-01",
        endsOn: "2026-11-20",
        timezone: "Asia/Almaty",
        status: "planned",
      });

      expect(created.userId).toBe("user-a");
      expect(created.name).toBe("1 триместр 2026-2027");
      expect(created.institution).toBe("Astana IT University");
      expect(created.program).toBe("Cybersecurity");
      expect(created.startsOn).toBe("2026-09-01");
      expect(created.endsOn).toBe("2026-11-20");
      expect(created.timezone).toBe("Asia/Almaty");
      expect(created.status).toBe("planned");

      const list = await store.listAcademicTerms("user-a");
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(created.id);

      const updated = await store.updateAcademicTerm("user-a", created.id, {
        status: "active",
        program: "Information Security",
      });

      expect(updated.id).toBe(created.id);
      expect(updated.status).toBe("active");
      expect(updated.program).toBe("Information Security");
    });

    it("rejects creating academic term with empty name", async () => {
      const client = new FakeSupabaseClient();
      const store = storeWith(client);

      await expect(
        store.createAcademicTerm("user-a", {
          name: "   ",
        }),
      ).rejects.toThrow("Academic term name is required");
    });

    it("rejects creating academic term with endsOn earlier than startsOn", async () => {
      const client = new FakeSupabaseClient();
      const store = storeWith(client);

      await expect(
        store.createAcademicTerm("user-a", {
          name: "Invalid Term",
          startsOn: "2026-12-01",
          endsOn: "2026-09-01",
        }),
      ).rejects.toThrow(
        "Academic term ends_on cannot be earlier than starts_on",
      );
    });

    it("rejects updating academic term with blank name", async () => {
      const client = new FakeSupabaseClient();
      client.academicTerms = [
        {
          id: termId,
          user_id: "user-a",
          name: "Valid Term",
          status: "planned",
        },
      ];
      const store = storeWith(client);

      await expect(
        store.updateAcademicTerm("user-a", termId, {
          name: "  ",
        }),
      ).rejects.toThrow("Academic term name cannot be blank");
    });

    it("rejects updating academic term with both dates passed and out of order", async () => {
      const client = new FakeSupabaseClient();
      client.academicTerms = [
        {
          id: termId,
          user_id: "user-a",
          name: "Valid Term",
          status: "planned",
          starts_on: "2026-09-01",
          ends_on: "2026-12-20",
        },
      ];
      const store = storeWith(client);

      await expect(
        store.updateAcademicTerm("user-a", termId, {
          startsOn: "2026-12-01",
          endsOn: "2026-09-01",
        }),
      ).rejects.toThrow(
        "Academic term ends_on cannot be earlier than starts_on",
      );
    });

    it("rejects updating only endsOn to before the term's already-stored startsOn", async () => {
      // Regression test: updateAcademicTerm's date-order check must
      // consider the EFFECTIVE result (existing value merged with this
      // update), not just whichever of the two date fields happen to be
      // present in this one call. An earlier version of this check only
      // compared update.starts_on/update.ends_on directly, so updating
      // only endsOn silently skipped validation (update.starts_on was
      // undefined) and fell through to a raw Postgres constraint error
      // instead of this friendly one.
      const client = new FakeSupabaseClient();
      client.academicTerms = [
        {
          id: termId,
          user_id: "user-a",
          name: "Valid Term",
          status: "planned",
          starts_on: "2026-09-01",
          ends_on: "2026-12-20",
        },
      ];
      const store = storeWith(client);

      await expect(
        store.updateAcademicTerm("user-a", termId, {
          endsOn: "2026-08-01",
        }),
      ).rejects.toThrow(
        "Academic term ends_on cannot be earlier than starts_on",
      );
    });

    it("rejects updating only startsOn to after the term's already-stored endsOn", async () => {
      const client = new FakeSupabaseClient();
      client.academicTerms = [
        {
          id: termId,
          user_id: "user-a",
          name: "Valid Term",
          status: "planned",
          starts_on: "2026-09-01",
          ends_on: "2026-12-20",
        },
      ];
      const store = storeWith(client);

      await expect(
        store.updateAcademicTerm("user-a", termId, {
          startsOn: "2027-01-15",
        }),
      ).rejects.toThrow(
        "Academic term ends_on cannot be earlier than starts_on",
      );
    });

    it("rejects updating an academic term the caller does not own", async () => {
      const client = new FakeSupabaseClient();
      client.academicTerms = [
        {
          id: termId,
          user_id: "user-a",
          name: "User A Term",
          status: "planned",
        },
      ];
      const store = storeWith(client);

      await expect(
        store.updateAcademicTerm("user-b", termId, {
          status: "completed",
        }),
      ).rejects.toThrow("Academic term not found");
    });

    describe("getActiveAcademicTerm", () => {
      it("prefers explicit status='active' term over overlapping date-range term", async () => {
        const client = new FakeSupabaseClient();
        client.academicTerms = [
          {
            id: "term-explicit-active",
            user_id: "user-a",
            name: "Explicit Active Term",
            starts_on: "2026-01-01",
            ends_on: "2026-05-01",
            status: "active",
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
          },
          {
            id: "term-date-range-match",
            user_id: "user-a",
            name: "Date Range Term",
            starts_on: "2026-09-01",
            ends_on: "2026-11-30",
            status: "planned",
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
          },
        ];
        const store = storeWith(client);

        const active = await store.getActiveAcademicTerm(
          "user-a",
          "2026-09-15",
        );
        expect(active).not.toBeNull();
        expect(active?.id).toBe("term-explicit-active");
        expect(active?.name).toBe("Explicit Active Term");
      });

      it("falls back to date range when no explicit active status exists", async () => {
        const client = new FakeSupabaseClient();
        client.academicTerms = [
          {
            id: "term-planned",
            user_id: "user-a",
            name: "Planned Fall Term",
            starts_on: "2026-09-01",
            ends_on: "2026-11-30",
            status: "planned",
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
          },
          {
            id: "term-completed",
            user_id: "user-a",
            name: "Completed Spring Term",
            starts_on: "2026-01-15",
            ends_on: "2026-05-15",
            status: "completed",
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
          },
        ];
        const store = storeWith(client);

        const active = await store.getActiveAcademicTerm(
          "user-a",
          "2026-09-15",
        );
        expect(active).not.toBeNull();
        expect(active?.id).toBe("term-planned");
        expect(active?.name).toBe("Planned Fall Term");
      });

      it("returns null when neither active status nor date range matches", async () => {
        const client = new FakeSupabaseClient();
        client.academicTerms = [
          {
            id: "term-summer",
            user_id: "user-a",
            name: "Summer Term",
            starts_on: "2026-06-01",
            ends_on: "2026-07-31",
            status: "completed",
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
          },
          {
            id: "term-undated",
            user_id: "user-a",
            name: "Undated Term",
            starts_on: null,
            ends_on: null,
            status: "planned",
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
          },
        ];
        const store = storeWith(client);

        const active = await store.getActiveAcademicTerm(
          "user-a",
          "2026-09-15",
        );
        expect(active).toBeNull();
      });
    });

    describe("linkStudyCourseToTerm", () => {
      it("links study course to term when caller owns both", async () => {
        const client = new FakeSupabaseClient();
        client.studyCourses = [
          {
            id: courseId,
            user_id: "user-a",
            code: "CS101",
            title: "Intro to CS",
            term_id: null,
          },
        ];
        client.academicTerms = [
          {
            id: termId,
            user_id: "user-a",
            name: "1 триместр 2026-2027",
            status: "planned",
          },
        ];
        const store = storeWith(client);

        await store.linkStudyCourseToTerm("user-a", courseId, termId);
        expect(client.studyCourses[0].term_id).toBe(termId);
      });

      it("rejects linking when caller does not own the study course", async () => {
        const client = new FakeSupabaseClient();
        client.studyCourses = [
          {
            id: courseId,
            user_id: "user-b",
            code: "CS101",
            title: "Intro to CS",
          },
        ];
        client.academicTerms = [
          {
            id: termId,
            user_id: "user-a",
            name: "1 триместр 2026-2027",
            status: "planned",
          },
        ];
        const store = storeWith(client);

        await expect(
          store.linkStudyCourseToTerm("user-a", courseId, termId),
        ).rejects.toThrow("Study course not found");
      });

      it("rejects linking when caller does not own the academic term", async () => {
        const client = new FakeSupabaseClient();
        client.studyCourses = [
          {
            id: courseId,
            user_id: "user-a",
            code: "CS101",
            title: "Intro to CS",
          },
        ];
        client.academicTerms = [
          {
            id: termId,
            user_id: "user-b",
            name: "1 триместр 2026-2027",
            status: "planned",
          },
        ];
        const store = storeWith(client);

        await expect(
          store.linkStudyCourseToTerm("user-a", courseId, termId),
        ).rejects.toThrow("Academic term not found");
      });
    });
  });
});

describe("course_readings methods", () => {
  const courseId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const readingId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  function makeClient() {
    const client = new FakeSupabaseClient();
    client.studyCourses = [
      {
        id: courseId,
        user_id: "user-a",
        code: "CS101",
        title: "Intro to CS",
      },
    ];
    return client;
  }

  it("creates a course reading with correct defaults", async () => {
    const client = makeClient();
    const store = storeWith(client);

    const reading = await store.createCourseReading("user-a", {
      studyCourseId: courseId,
      title: "Chapter 4",
      author: "Knuth",
      reference: "The Art of Computer Programming, Vol. 1, §4",
      sessionDate: "2026-10-12",
      estimatedMinutes: 90,
      pages: "120-145",
    });

    expect(reading.studyCourseId).toBe(courseId);
    expect(reading.title).toBe("Chapter 4");
    expect(reading.author).toBe("Knuth");
    expect(reading.sessionDate).toBe("2026-10-12");
    expect(reading.estimatedMinutes).toBe(90);
    expect(reading.pages).toBe("120-145");
    expect(reading.required).toBe(true); // default
    expect(reading.status).toBe("pending"); // default
    expect(reading.notes).toBeNull();
    expect(reading.id).toBeDefined();
  });

  it("rejects creating a course reading with a blank title", async () => {
    const client = makeClient();
    const store = storeWith(client);

    await expect(
      store.createCourseReading("user-a", {
        studyCourseId: courseId,
        title: "   ",
      }),
    ).rejects.toThrow("Course reading title is required");
  });

  it("rejects creating a course reading for a course the caller does not own", async () => {
    const client = makeClient(); // studyCourses owned by user-a
    const store = storeWith(client);

    await expect(
      store.createCourseReading("user-b", {
        studyCourseId: courseId,
        title: "Chapter 1",
      }),
    ).rejects.toThrow("Study course not found");
  });

  it("updates a course reading's fields", async () => {
    const client = makeClient();
    client.courseReadings = [
      { id: readingId, study_course_id: courseId, title: "Chapter 4" },
    ];
    const store = storeWith(client);

    const updated = await store.updateCourseReading("user-a", readingId, {
      status: "completed",
      notes: "Read thoroughly",
      estimatedMinutes: 120,
    });

    expect(updated.status).toBe("completed");
    expect(updated.notes).toBe("Read thoroughly");
    expect(updated.estimatedMinutes).toBe(120);
  });

  it("rejects updating a course reading with a blank title", async () => {
    const client = makeClient();
    client.courseReadings = [
      { id: readingId, study_course_id: courseId, title: "Chapter 4" },
    ];
    const store = storeWith(client);

    await expect(
      store.updateCourseReading("user-a", readingId, { title: " " }),
    ).rejects.toThrow("Course reading title cannot be blank");
  });

  it("rejects updating a course reading the caller does not own", async () => {
    const client = makeClient(); // course owned by user-a
    client.courseReadings = [{ id: readingId, study_course_id: courseId }];
    const store = storeWith(client);

    await expect(
      store.updateCourseReading("user-b", readingId, { status: "completed" }),
    ).rejects.toThrow("Study course not found");
  });

  it("rejects updating a course reading that does not exist", async () => {
    const client = makeClient();
    // courseReadings is empty
    const store = storeWith(client);

    await expect(
      store.updateCourseReading("user-a", "nonexistent-id", {
        status: "skipped",
      }),
    ).rejects.toThrow("Course reading not found");
  });

  it("lists course readings ordered by session_date asc (nulls last) then created_at", async () => {
    const client = makeClient();
    // Insert out of order so the fake exercises the requested DB ordering.
    client.courseReadings = [
      {
        id: "r1",
        study_course_id: courseId,
        title: "Chapter 2",
        session_date: "2026-10-19",
        created_at: "2026-09-01T00:00:00Z",
        updated_at: "2026-09-01T00:00:00Z",
        required: true,
        status: "pending",
        metadata: {},
        author: null,
        reference: null,
        estimated_minutes: null,
        pages: null,
        notes: null,
      },
      {
        id: "r2",
        study_course_id: courseId,
        title: "Chapter 1",
        session_date: "2026-10-12",
        created_at: "2026-09-02T00:00:00Z",
        updated_at: "2026-09-02T00:00:00Z",
        required: true,
        status: "pending",
        metadata: {},
        author: null,
        reference: null,
        estimated_minutes: null,
        pages: null,
        notes: null,
      },
    ];
    const store = storeWith(client);

    const readings = await store.listCourseReadings("user-a", courseId);
    expect(readings).toHaveLength(2);
    expect(readings[0].id).toBe("r2");
    expect(readings[1].id).toBe("r1");

    // Confirm the course_readings query was issued.
    const listQuery = client.queries.find(
      (q) => q.table === "course_readings" && q.action === "select",
    );
    expect(listQuery).toBeDefined();
  });

  it("deletes a course reading the caller owns", async () => {
    const client = makeClient();
    client.courseReadings = [
      { id: readingId, study_course_id: courseId, title: "Chapter 4" },
    ];
    const store = storeWith(client);

    await store.deleteCourseReading("user-a", readingId);

    expect(
      client.queries.some(
        (q) => q.table === "course_readings" && q.action === "delete",
      ),
    ).toBe(true);
  });
});

describe("academic record visibility", () => {
  const academicRow = (index: number): FakeRow => ({
    id: `grade-${String(index).padStart(4, "0")}`,
    user_id: "user-a",
    source_event_id: `event-${index}`,
    course_title: "Computer Networks",
    record_type: "assignment",
    title: `Work ${index}`,
    score: null,
    max_score: 10,
    percentage: null,
    raw_json: {},
    updated_at: "2026-09-24T00:00:00Z",
  });

  it("returns all 67 synced records instead of truncating at 50", async () => {
    const client = new FakeSupabaseClient();
    client.academicRecords = Array.from({ length: 67 }, (_, index) =>
      academicRow(index),
    );
    client.sourceEvents = client.academicRecords.map((row) => ({
      id: row.source_event_id as string,
      user_id: "user-a",
      status: "active",
    }));
    const records = await storeWith(client).listAcademicRecords("user-a");
    expect(records).toHaveLength(67);
    expect(new Set(records.map((record) => record.id)).size).toBe(67);
  });

  it("continues after retired-only pages and returns owned current and manual records in display order", async () => {
    const client = new FakeSupabaseClient();
    client.academicRecords = Array.from({ length: 267 }, (_, index) =>
      academicRow(index),
    );
    client.sourceEvents = client.academicRecords.map((row, index) => ({
      id: row.source_event_id as string,
      user_id: "user-a",
      status: index < 100 ? "missing" : "active",
    }));
    client.academicRecords.push(
      {
        ...academicRow(267),
        source_event_id: null,
        updated_at: "2026-09-25T00:00:00Z",
      },
      { ...academicRow(268), user_id: "user-b", source_event_id: null },
      academicRow(269),
      academicRow(270),
    );
    client.sourceEvents.push({
      id: "event-269",
      user_id: "user-b",
      status: "active",
    });
    // Exercise DB ordering too, independently of fixture insertion order.
    client.academicRecords.reverse();

    const records = await storeWith(client).listAcademicRecords("user-a");
    expect(records.map((record) => record.id)).toEqual([
      academicRow(267).id,
      ...Array.from({ length: 167 }, (_, index) => academicRow(index + 100).id),
    ]);
    for (const query of client.queries) {
      expect(query.filters.user_id).toBe("user-a");
      if (query.table === "source_events") {
        expect(query.inFilters.id.length).toBeLessThanOrEqual(100);
      }
    }
    expect(
      client.queries.filter((query) => query.table === "academic_records"),
    ).toHaveLength(4);
  });

  it("rejects a later page failure instead of returning an incomplete grade list", async () => {
    const client = new FakeSupabaseClient();
    client.academicRecords = Array.from({ length: 101 }, (_, index) => ({
      ...academicRow(index),
      source_event_id: null,
    }));
    client.selectErrors["academic_records:grade-0099"] = "page unavailable";
    await expect(
      storeWith(client).listAcademicRecords("user-a"),
    ).rejects.toThrow("page unavailable");
  });

  it("hides retired or foreign source events and preserves manual and active records", async () => {
    const client = new FakeSupabaseClient();
    const base = {
      user_id: "user-a",
      course_title: "DB",
      record_type: "assignment",
      title: "Work",
      score: null,
      max_score: 10,
      percentage: null,
      raw_json: {},
      updated_at: "2026-09-24T00:00:00Z",
    };
    client.academicRecords = [
      {
        ...base,
        id: "manual",
        source_event_id: null,
        updated_at: "2026-09-24T01:00:00Z",
      },
      { ...base, id: "current", source_event_id: "active" },
      { ...base, id: "old", source_event_id: "missing" },
      { ...base, id: "foreign", source_event_id: "other-user" },
      {
        ...base,
        id: "foreign-record",
        user_id: "user-b",
        source_event_id: null,
      },
    ];
    client.sourceEvents = [
      { id: "active", user_id: "user-a", status: "active" },
      { id: "missing", user_id: "user-a", status: "missing" },
      { id: "other-user", user_id: "user-b", status: "active" },
    ];
    const records = await storeWith(client).listAcademicRecords("user-a");
    expect(records.map((record) => record.id)).toEqual(["manual", "current"]);
    expect(records[1].score).toBeNull();
    expect(
      client.queries.find((query) => query.table === "source_events")?.filters
        .user_id,
    ).toBe("user-a");
  });
});
