import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types.js";
import {
  getLmsConnection,
  getLmsWork,
  loadLmsTaskEvents,
  saveLmsSession,
  deleteLmsSession,
  requestLmsSync,
} from "./lms-store.js";

type Row = Record<string, unknown>;
type Result = { data: Row[]; error: null | { message: string } };
class Fake {
  rows: Record<string, Row[]> = {
    user_lms_settings: [],
    source_events: [],
    academic_records: [],
  };
  queries: Array<{
    table: string;
    columns: string;
    eq: Record<string, unknown>;
    gt: Record<string, string>;
    limit: number | undefined;
  }> = [];
  calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  rpcResult = true;
  failureTable = "";
  from(table: string) {
    return new Query(this, table);
  }
  async rpc(name: string, args: Record<string, unknown>) {
    this.calls.push({ name, args });
    return { data: this.rpcResult, error: null };
  }
  client() {
    return this as unknown as SupabaseClient<Database>;
  }
}
class Query implements PromiseLike<Result> {
  private equals: Record<string, unknown> = {};
  private greater: Record<string, string> = {};
  private includes: Record<string, unknown[]> = {};
  private columns = "";
  private max: number | undefined;
  constructor(
    private fake: Fake,
    private table: string,
  ) {}
  select(columns: string) {
    this.columns = columns;
    return this;
  }
  eq(k: string, v: unknown) {
    this.equals[k] = v;
    return this;
  }
  gt(k: string, v: string) {
    this.greater[k] = v;
    return this;
  }
  in(k: string, v: unknown[]) {
    this.includes[k] = v;
    return this;
  }
  order(_k: string) {
    return this;
  }
  limit(v: number) {
    this.max = v;
    return this;
  }
  update(_payload: unknown) {
    return this;
  }
  private result(): Result {
    this.fake.queries.push({
      table: this.table,
      columns: this.columns,
      eq: { ...this.equals },
      gt: { ...this.greater },
      limit: this.max,
    });
    const data = (this.fake.rows[this.table] ?? [])
      .filter(
        (r) =>
          Object.entries(this.equals).every(([k, v]) => r[k] === v) &&
          Object.entries(this.greater).every(([k, v]) => String(r[k]) > v) &&
          Object.entries(this.includes).every(([k, v]) => v.includes(r[k])),
      )
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))
      .slice(0, this.max);
    return {
      data,
      error:
        this.fake.failureTable === this.table
          ? { message: "private upstream secret" }
          : null,
    };
  }
  async maybeSingle() {
    const r = this.result();
    return { ...r, data: r.data[0] ?? null };
  }
  then<TResult1 = Result, TResult2 = never>(
    yes?: ((v: Result) => TResult1 | PromiseLike<TResult1>) | null,
    no?: ((e: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.result()).then(yes, no);
  }
}
const now = new Date("2026-10-10T00:00:00Z");
function connection(user = "a"): Row {
  return {
    id: `setting-${user}`,
    user_id: user,
    platform_type: "aitu_moodle",
    auth_mode: "session",
    is_active: true,
    is_token_valid: true,
    session_state: "connected",
    session_expires_at: "2026-10-11T00:00:00Z",
    last_sync_success_at: now.toISOString(),
    last_sync_attempt_at: now.toISOString(),
    sso_cookie_encrypted: "private ciphertext",
    last_error_category: null,
    unsupported_features: ["quiz_page_unavailable", "unsafe private cookie"],
    sync_requested_at: null,
  };
}
function event(
  id: string,
  status = "unknown",
  dueAt: string | null = "2026-08-01T00:00:00Z",
): Row {
  return {
    id,
    user_id: "a",
    source_key: "university_platform",
    event_type: "task",
    status: "active",
    title: id,
    external_id: `activity:moodle:1:assign:${id}`,
    due_at: dueAt,
    raw_json: {
      course_title: "Course",
      module_type: "assign",
      assessment_type: "assignment",
      submission_status: status,
    },
  };
}
describe("LMS database boundary", () => {
  it("projects safe owner metadata, explicit expiry and legacy state", async () => {
    const f = new Fake();
    f.rows.user_lms_settings = [connection(), connection("b")];
    const result = await getLmsConnection(f.client(), "a", now);
    expect(result.configured).toBe(true);
    expect(result.unsupportedFeatures).toEqual(["quiz_page_unavailable"]);
    expect(JSON.stringify(result)).not.toContain("private");
    expect(f.queries[0].columns).not.toMatch(
      /cookie|encrypted_password|ws_token|username/,
    );
    expect(f.queries[0].eq.user_id).toBe("a");
    f.rows.user_lms_settings[0].session_expires_at = "2026-10-09T00:00:00Z";
    expect(await getLmsConnection(f.client(), "a", now)).toMatchObject({
      configured: false,
      state: "session_expired",
      lastErrorCategory: "session_expired",
    });
    f.rows.user_lms_settings[0].auth_mode = "password";
    expect(await getLmsConnection(f.client(), "a", now)).toMatchObject({
      configured: false,
      state: "legacy_configuration",
    });
  });
  it("loads bounded pages without a historical date cutoff and excludes foreign work", async () => {
    const f = new Fake();
    f.rows.source_events = Array.from({ length: 205 }, (_, i) =>
      event(String(i).padStart(4, "0"), "not_submitted"),
    );
    f.rows.source_events.push({ ...event("private"), user_id: "b" });
    const { rows, truncated } = await loadLmsTaskEvents(f.client(), "a");
    expect(rows).toHaveLength(205);
    expect(truncated).toBe(false);
    expect(f.queries).toHaveLength(3);
    expect(
      f.queries.every(
        (q) => q.eq.user_id === "a" && q.limit === 100 && !("due_at" in q.gt),
      ),
    ).toBe(true);
    expect(f.queries[1].gt.id).toBe("0099");
  });
  it("signals truncation at 2000 rows rather than claiming a complete snapshot", async () => {
    const f = new Fake();
    f.rows.source_events = Array.from({ length: 2001 }, (_, i) =>
      event(String(i).padStart(5, "0")),
    );
    expect(await loadLmsTaskEvents(f.client(), "a")).toMatchObject({
      truncated: true,
      rows: expect.any(Array),
    });
    expect(f.queries).toHaveLength(20);
  });
  it("preserves unknown dates/status, submitted work and grade-only records without duplicates", async () => {
    const f = new Fake();
    f.rows.user_lms_settings = [connection()];
    const submitted = event("submitted", "submitted");
    const graded = event("graded", "unknown");
    // A blank LMS field is missing evidence, not a numeric zero grade.
    (submitted.raw_json as Row).score = " ";
    (graded.raw_json as Row).related_grade_external_id = "academic:moodle:1:9";
    f.rows.source_events = [
      event("overdue", "not_submitted"),
      event("unknown"),
      event("no-date", "unknown", null),
      submitted,
      graded,
      {
        id: "grade-9",
        user_id: "a",
        source_key: "university_platform",
        status: "active",
        event_type: "academic_grade",
        external_id: "academic:moodle:1:9",
      },
    ];
    f.rows.academic_records = [
      {
        id: "ar-9",
        user_id: "a",
        source_event_id: "grade-9",
        title: "Matching grade",
        score: 0,
        max_score: 10,
        percentage: 0,
      },
      {
        id: "ar-extra",
        user_id: "a",
        source_event_id: null,
        title: "Actual midterm",
        course_title: "Course",
        record_type: "midterm",
        score: 7,
        max_score: 10,
        percentage: 70,
      },
      {
        id: "foreign",
        user_id: "b",
        source_event_id: null,
        title: "Private",
        score: 99,
      },
    ];
    const work = await getLmsWork(f.client(), "a", "Asia/Almaty", now);
    expect(work.items.find((i) => i.title === "overdue")?.category).toBe(
      "overdue",
    );
    expect(work.items.find((i) => i.title === "submitted")?.category).toBe(
      "submitted_ungraded",
    );
    expect(work.items.find((i) => i.title === "unknown")?.category).toBe(
      "unknown",
    );
    expect(work.items.find((i) => i.title === "no-date")?.dueAt).toBeNull();
    expect(work.items.find((i) => i.title === "graded")).toMatchObject({
      category: "graded",
      score: 0,
    });
    expect(work.items.find((i) => i.title === "Actual midterm")).toMatchObject({
      category: "graded",
      kind: "midterm",
    });
    expect(
      work.items.some(
        (i) => i.title === "Private" || i.title === "Matching grade",
      ),
    ).toBe(false);
    expect(work.stale).toBe(false);
    expect(f.queries.every((q) => q.eq.user_id === "a")).toBe(true);
  });
  it("requires a matching atomic lease for save/delete, releasing it after failure", async () => {
    const f = new Fake();
    f.rows.user_lms_settings = [connection()];
    const input = {
      userId: "a",
      encryptedCookie: "enc:v1:a:b:c",
      expiresAt: "2026-10-11T00:00:00Z",
    };
    await saveLmsSession(f.client(), input);
    const claim = f.calls[0],
      save = f.calls[1],
      release = f.calls[2];
    expect(claim.name).toBe("claim_lms_sync_lease");
    expect(save.name).toBe("save_lms_session");
    expect(save.args).toMatchObject({
      p_user_id: "a",
      p_owner: claim.args.p_owner,
      p_encrypted_cookie: input.encryptedCookie,
    });
    expect(release.args.p_owner).toBe(claim.args.p_owner);
    await deleteLmsSession(f.client(), "a");
    expect(
      f.calls.find((c) => c.name === "delete_lms_session")?.args.p_user_id,
    ).toBe("a");
    f.rpcResult = false;
    f.calls = [];
    await expect(saveLmsSession(f.client(), input)).rejects.toThrow(
      "lms_sync_in_progress",
    );
    expect(f.calls.map((c) => c.name)).toEqual(["claim_lms_sync_lease"]);
    await expect(
      saveLmsSession(f.client(), { ...input, encryptedCookie: "plaintext" }),
    ).rejects.toThrow("lms_unavailable");
  });
  it("rejects inactive or expired sync and sanitizes upstream errors", async () => {
    const f = new Fake();
    await expect(requestLmsSync(f.client(), "a")).rejects.toThrow(
      "lms_session_required",
    );
    expect(f.queries[0].eq).toMatchObject({
      user_id: "a",
      auth_mode: "session",
      is_active: true,
      is_token_valid: true,
    });
    expect(f.queries[0].gt.session_expires_at).toBeDefined();
    f.failureTable = "source_events";
    await expect(getLmsWork(f.client(), "a", "UTC", now)).rejects.toThrow(
      "lms_unavailable",
    );
  });
});
