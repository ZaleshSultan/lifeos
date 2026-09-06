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
  queries: FakeQueryReceipt[] = [];

  from(table: string): FakeQuery {
    return new FakeQuery(this, table);
  }
}

class FakeQuery {
  private action = "select";
  private readonly filters: Record<string, unknown> = {};
  private readonly inFilters: Record<string, unknown[]> = {};
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

  in(key: string, values: unknown[]): this {
    this.inFilters[key] = values;
    return this;
  }

  ilike(key: string, value: string): this {
    this.filters[key] = { $ilike: value };
    return this;
  }

  order(_column: string, _options?: unknown): this {
    return this;
  }

  limit(_count: number): this {
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

  then<TResult1 = { data: FakeRow[] | null; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: FakeRow[] | null; error: null }) => TResult1)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    if (this.action === "delete") {
      this.deleteRows();
    }
    if (this.action === "update") {
      this.updateRow();
    }
    return Promise.resolve({
      data: this.action === "select" ? this.filteredRows() : null,
      error: null,
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
    return this.tableRows().filter((row) => {
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

      return true;
    });
  }

  private tableRows(): FakeRow[] {
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
      ).rejects.toThrow("Academic term ends_on cannot be earlier than starts_on");
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

        const active = await store.getActiveAcademicTerm("user-a", "2026-09-15");
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

        const active = await store.getActiveAcademicTerm("user-a", "2026-09-15");
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

        const active = await store.getActiveAcademicTerm("user-a", "2026-09-15");
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

