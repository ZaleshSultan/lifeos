import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  loadPlanningSnapshot,
  type PlanningSnapshotRange,
} from "./planning-snapshot.js";
import type { Database } from "./types.js";

type Row = Record<string, unknown>;
type QueryResult = { data: Row[] | null; error: { message: string } | null };
interface QueryTrace {
  table: string;
  columns: string;
  equals: Record<string, unknown>;
  includes: Record<string, unknown[]>;
  lowerBounds: Record<string, string>;
  upperBounds: Record<string, string>;
  excluded: Record<string, string>;
  orFilter?: string;
  limit?: number;
}

/** Applies the ownership and range predicates, so isolation assertions use returned rows too. */
class Query implements PromiseLike<QueryResult> {
  private trace: QueryTrace;
  private orders: Array<{
    key: string;
    ascending: boolean;
    nullsFirst: boolean;
  }> = [];
  constructor(
    private owner: FakeClient,
    table: string,
  ) {
    this.trace = {
      table,
      columns: "",
      equals: {},
      includes: {},
      lowerBounds: {},
      upperBounds: {},
      excluded: {},
    };
  }
  select(columns: string): this {
    this.trace.columns = columns;
    return this;
  }
  eq(key: string, value: unknown): this {
    this.trace.equals[key] = value;
    return this;
  }
  is(key: string, value: unknown): this {
    return this.eq(key, value);
  }
  in(key: string, values: unknown[]): this {
    this.trace.includes[key] = values;
    return this;
  }
  gte(key: string, value: string): this {
    this.trace.lowerBounds[key] = value;
    return this;
  }
  lt(key: string, value: string): this {
    this.trace.upperBounds[key] = value;
    return this;
  }
  not(key: string, operator: string, values: string): this {
    if (operator !== "in")
      throw new Error("Unexpected fake exclusion operator");
    this.trace.excluded[key] = values;
    return this;
  }
  or(filter: string): this {
    this.trace.orFilter = filter;
    return this;
  }
  order(
    key: string,
    options?: { ascending?: boolean; nullsFirst?: boolean },
  ): this {
    this.orders.push({
      key,
      ascending: options?.ascending ?? true,
      nullsFirst: options?.nullsFirst ?? false,
    });
    return this;
  }
  limit(value: number): this {
    this.trace.limit = value;
    return this;
  }
  then<T = QueryResult, E = never>(
    onfulfilled?: ((value: QueryResult) => T | PromiseLike<T>) | null,
    onrejected?: ((reason: unknown) => E | PromiseLike<E>) | null,
  ): PromiseLike<T | E> {
    this.owner.queries.push(this.trace);
    const error = this.owner.errors[this.trace.table];
    if (error)
      return Promise.resolve({ data: null, error: { message: error } }).then(
        onfulfilled,
        onrejected,
      );
    let rows = (this.owner.rows[this.trace.table] ?? []).filter(
      (row) =>
        Object.entries(this.trace.equals).every(
          ([key, value]) => row[key] === value,
        ) &&
        Object.entries(this.trace.includes).every(([key, values]) =>
          values.includes(row[key]),
        ) &&
        Object.entries(this.trace.lowerBounds).every(
          ([key, value]) => typeof row[key] === "string" && row[key] >= value,
        ) &&
        Object.entries(this.trace.upperBounds).every(
          ([key, value]) => typeof row[key] === "string" && row[key] < value,
        ) &&
        Object.entries(this.trace.excluded).every(
          ([key, values]) =>
            !values.slice(1, -1).split(",").includes(String(row[key])),
        ),
    );
    rows = [...rows]
      .sort((a, b) => {
        for (const order of this.orders) {
          const left = a[order.key],
            right = b[order.key];
          if (left === right) continue;
          if (left == null) return order.nullsFirst ? -1 : 1;
          if (right == null) return order.nullsFirst ? 1 : -1;
          const result = String(left).localeCompare(String(right));
          if (result) return order.ascending ? result : -result;
        }
        return 0;
      })
      .slice(0, this.trace.limit);
    const columns = this.trace.columns.split(",");
    const projected = rows.map((row) =>
      Object.fromEntries(columns.map((column) => [column, row[column]])),
    );
    return Promise.resolve({ data: projected, error: null }).then(
      onfulfilled,
      onrejected,
    );
  }
}

class FakeClient {
  queries: QueryTrace[] = [];
  errors: Record<string, string> = {};
  constructor(readonly rows: Record<string, Row[]> = {}) {}
  from(table: string): Query {
    return new Query(this, table);
  }
  asClient(): SupabaseClient<Database> {
    return this as unknown as SupabaseClient<Database>;
  }
}

const range: PlanningSnapshotRange = {
  startsAt: "2026-10-10T00:00:00Z",
  endsAt: "2026-10-17T00:00:00Z",
  historyStartsAt: "2026-10-03T00:00:00Z",
  historyEndsAt: "2026-10-10T00:00:00Z",
};
const owner = "user-a";

function task(id: string, overrides: Row = {}): Row {
  return {
    id,
    user_id: owner,
    title: `Task ${id}`,
    priority: "medium",
    status: "next",
    due_at: "2026-10-11T10:00:00Z",
    scheduled_for: null,
    metadata: {},
    created_at: "2026-09-01T00:00:00Z",
    completed_at: null,
    ...overrides,
  };
}
function course(id: string, overrides: Row = {}): Row {
  return {
    id,
    user_id: owner,
    title: `Course ${id}`,
    status: "active",
    starts_on: "2026-09-01",
    ends_on: "2026-12-01",
    ...overrides,
  };
}

describe("read-only planning snapshot", () => {
  it("does not turn completed source deadlines into new planning tasks", async () => {
    const event = {
      id: "event",
      user_id: owner,
      title: "Assignment",
      event_type: "deadline",
      starts_at: null,
      ends_at: null,
      due_at: range.startsAt,
    };
    const client = new FakeClient({
      source_events: [
        { ...event, id: "pending", status: "active" },
        { ...event, id: "done", status: "done" },
        { ...event, id: "completed", status: "completed" },
      ],
    });
    const data = await loadPlanningSnapshot(client.asClient(), owner, range);
    expect(data.events.map((e) => e.id)).toEqual(["pending"]);
  });
  it("scopes every owner table and restricts child rows to that user's course IDs", async () => {
    const client = new FakeClient({
      tasks: [
        task("a"),
        task("b", { user_id: "user-b", title: "Private other task" }),
      ],
      source_events: [
        {
          id: "event-a",
          user_id: owner,
          title: "Owner event",
          status: "active",
          starts_at: range.startsAt,
        },
        {
          id: "event-b",
          user_id: "user-b",
          title: "Private other event",
          status: "active",
        },
      ],
      reminders: [
        {
          user_id: owner,
          message: "Owner reminder",
          status: "pending",
          remind_at: "2026-10-11T09:00:00Z",
        },
        {
          user_id: "user-b",
          message: "Private other reminder",
          status: "pending",
          remind_at: "2026-10-11T09:00:00Z",
        },
      ],
      projects: [
        {
          id: "project-a",
          user_id: owner,
          name: "Owner project",
          status: "active",
          archived_at: null,
        },
        {
          id: "project-b",
          user_id: "user-b",
          name: "Private other project",
          status: "active",
          archived_at: null,
        },
      ],
      study_courses: [
        course("course-a"),
        course("course-b", { user_id: "user-b" }),
      ],
      course_schedules: [
        {
          id: "schedule-a",
          study_course_id: "course-a",
          day_of_week: 1,
          start_time: "10:00",
          end_time: "11:00",
        },
        { id: "schedule-b", study_course_id: "course-b", day_of_week: 2 },
      ],
      assessment_items: [
        {
          id: "assignment-a",
          study_course_id: "course-a",
          title: "Owner assignment",
          status: "pending",
        },
        {
          id: "assignment-b",
          study_course_id: "course-b",
          title: "Private other assignment",
          status: "pending",
        },
      ],
    });
    const snapshot = await loadPlanningSnapshot(
      client.asClient(),
      owner,
      range,
    );
    for (const query of client.queries.filter(
      (q) => !["course_schedules", "assessment_items"].includes(q.table),
    )) {
      expect(query.equals.user_id, query.table).toBe(owner);
    }
    for (const query of client.queries.filter((q) =>
      ["course_schedules", "assessment_items"].includes(q.table),
    )) {
      expect(query.includes.study_course_id).toEqual(["course-a"]);
    }
    expect(snapshot.tasks.map((row) => row.id)).toEqual(["a"]);
    expect(snapshot.events.map((row) => row.id)).toEqual(["event-a"]);
    expect(snapshot.courses.map((row) => row.id)).toEqual(["course-a"]);
    expect(snapshot.schedules.map((row) => row.id)).toEqual(["schedule-a"]);
    expect(snapshot.assessments.map((row) => row.id)).toEqual(["assignment-a"]);
    expect(JSON.stringify(snapshot)).not.toContain("Private other");
    const eventQuery = client.queries.find((q) => q.table === "source_events")!;
    expect(eventQuery.orFilter).toContain(`starts_at.lt.${range.endsAt}`);
    expect(eventQuery.orFilter).toContain(`ends_at.gt.${range.startsAt}`);
  });

  it("projects only relevant fields and never queries health, finance, grade, or credentials tables", async () => {
    const client = new FakeClient({
      tasks: [
        task("a", {
          metadata: {
            domain: "study",
            estimatedMinutes: 45,
            health: "private health",
            providerToken: "private token",
          },
          description: "private full description",
        }),
      ],
      study_courses: [
        course("course-a", { grade: 90, credential: "private password" }),
      ],
      assessment_items: [
        {
          id: "assignment-a",
          study_course_id: "course-a",
          title: "Essay",
          status: "pending",
          grade: 95,
          notes: "private notes",
        },
      ],
    });
    const snapshot = await loadPlanningSnapshot(
      client.asClient(),
      owner,
      range,
    );
    expect(snapshot.tasks[0]).toMatchObject({
      domain: "study",
      estimatedMinutes: 45,
    });
    expect(snapshot.tasks[0]).not.toHaveProperty("metadata");
    expect(JSON.stringify(snapshot)).not.toContain("private");
    expect(snapshot.assessments[0]).not.toHaveProperty("grade");
    expect(new Set(client.queries.map((q) => q.table))).toEqual(
      new Set([
        "tasks",
        "source_events",
        "reminders",
        "projects",
        "study_courses",
        "course_schedules",
        "assessment_items",
      ]),
    );
    for (const query of client.queries) {
      expect(query.columns).not.toContain("*");
      expect(query.columns).not.toMatch(
        /raw_payload|description|credential|token|grade|notes|user_id/,
      );
      expect(query.limit).toBeGreaterThan(0);
      expect(query.limit).toBeLessThanOrEqual(1000);
    }
  });

  it("skips academic child tables when the user owns no active courses", async () => {
    const client = new FakeClient({
      study_courses: [
        course("other", { user_id: "user-b" }),
        course("archived", { status: "archived" }),
      ],
    });
    const snapshot = await loadPlanningSnapshot(
      client.asClient(),
      owner,
      range,
    );
    expect(snapshot.courses).toEqual([]);
    expect(snapshot.schedules).toEqual([]);
    expect(snapshot.assessments).toEqual([]);
    expect(
      client.queries.some((q) =>
        ["course_schedules", "assessment_items"].includes(q.table),
      ),
    ).toBe(false);
  });

  it("unions real created and completed history, deduplicates task IDs, and retains older completed work", async () => {
    const client = new FakeClient({
      tasks: [
        task("created", { created_at: "2026-10-04T10:00:00Z" }),
        task("overlap", {
          created_at: "2026-10-05T10:00:00Z",
          completed_at: "2026-10-06T12:00:00Z",
          status: "done",
        }),
        task("older-completed", {
          created_at: "2026-09-01T10:00:00Z",
          completed_at: "2026-10-08T12:00:00Z",
          status: "done",
        }),
        task("out-of-range", {
          created_at: range.historyEndsAt,
          completed_at: range.historyEndsAt,
          status: "done",
        }),
        task("other-user", {
          user_id: "user-b",
          created_at: "2026-10-05T10:00:00Z",
          completed_at: "2026-10-06T12:00:00Z",
          status: "done",
        }),
      ],
    });
    const snapshot = await loadPlanningSnapshot(
      client.asClient(),
      owner,
      range,
    );
    expect(snapshot.history).toHaveLength(3);
    expect(
      snapshot.history.filter((row) => row.completedAt !== null),
    ).toHaveLength(2);
    expect(snapshot.history).toContainEqual({
      createdAt: "2026-09-01T10:00:00Z",
      completedAt: "2026-10-08T12:00:00Z",
    });
    expect(snapshot.historyTruncated).toBe(false);
    const historyQueries = client.queries.filter(
      (q) => q.columns === "id,created_at,completed_at",
    );
    expect(historyQueries).toHaveLength(2);
    expect(historyQueries.every((q) => q.equals.user_id === owner)).toBe(true);
    expect(
      historyQueries.find((q) => q.equals.status === "done")?.lowerBounds
        .completed_at,
    ).toBe(range.historyStartsAt);
    expect(
      historyQueries.find((q) => q.equals.status !== "done")?.upperBounds
        .created_at,
    ).toBe(range.historyEndsAt);
  });

  it("bounds plan data, marks truncation, and excludes academic children of omitted courses", async () => {
    const client = new FakeClient({
      tasks: Array.from({ length: 201 }, (_, i) =>
        task(String(i).padStart(3, "0")),
      ),
      study_courses: Array.from({ length: 101 }, (_, i) =>
        course(String(i).padStart(3, "0")),
      ),
      course_schedules: [
        { id: "owned-included", study_course_id: "000" },
        { id: "owned-omitted", study_course_id: "100" },
      ],
    });
    const snapshot = await loadPlanningSnapshot(
      client.asClient(),
      owner,
      range,
    );
    expect(snapshot.tasks).toHaveLength(200);
    expect(snapshot.courses).toHaveLength(100);
    expect(snapshot.schedules.map((row) => row.id)).toEqual(["owned-included"]);
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.historyTruncated).toBe(false);
    const childQuery = client.queries.find(
      (q) => q.table === "course_schedules",
    )!;
    expect(childQuery.includes.study_course_id).toHaveLength(100);
    expect(childQuery.includes.study_course_id).not.toContain("100");
  });

  it("marks capped history separately so analytics cannot imply complete coverage", async () => {
    const client = new FakeClient({
      tasks: Array.from({ length: 1001 }, (_, i) =>
        task(`history-${i}`, {
          status: "done",
          created_at: "2026-10-04T10:00:00Z",
          completed_at: "2026-10-05T10:00:00Z",
        }),
      ),
    });
    const snapshot = await loadPlanningSnapshot(
      client.asClient(),
      owner,
      range,
    );
    expect(snapshot.history).toHaveLength(1000);
    expect(snapshot.historyTruncated).toBe(true);
    expect(snapshot.truncated).toBe(false);
  });

  it.each([
    "tasks",
    "source_events",
    "reminders",
    "projects",
    "study_courses",
    "course_schedules",
    "assessment_items",
  ])("redacts database errors from %s", async (table) => {
    const client = new FakeClient({ study_courses: [course("course-a")] });
    client.errors[table] = "secret service role / private SQL details";
    try {
      await loadPlanningSnapshot(client.asClient(), owner, range);
      expect.fail("Expected read failure");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("Planning data unavailable");
      expect(String(error)).not.toContain("secret");
      expect((error as Error).cause).toBeUndefined();
    }
  });
});
