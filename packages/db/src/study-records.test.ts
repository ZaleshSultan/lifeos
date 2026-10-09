import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  downloadStudyDocument,
  getOwnedAssessment,
  loadStudySupplement,
  saveStudyMapping,
  saveStudyOverride,
} from "./study-records.js";
import type { Database } from "./types.js";

function fixture() {
  const tables: Record<string, Array<Record<string, unknown>>> = {
    study_courses: [
      {
        id: "course-a",
        user_id: "a",
        title: "Owned course",
        code: "CUSTOM",
        external_course_key: "moodle:42",
      },
      {
        id: "course-b",
        user_id: "b",
        title: "private-course",
        code: "PRIVATE",
      },
    ],
    assessment_items: [
      {
        id: "grade-a",
        study_course_id: "course-a",
        external_id: "academic:moodle:42:9",
        source: "moodle",
        title: "Lab 1",
        assessment_type: "assignment",
        max_score: 30,
        actual_score: 15,
        due_at: "2026-10-09T10:00:00Z",
        syllabus_due_at: null,
        status: "graded",
        notes: null,
        updated_at: "2026-10-08T01:00:00Z",
        raw_json: { secret: "raw-moodle-secret" },
      },
      {
        id: "grade-b",
        study_course_id: "course-b",
        title: "private-grade",
        raw_json: { private: "private-payload" },
      },
    ],
    assessment_grade_overrides: [
      {
        id: "override-a",
        user_id: "a",
        study_course_id: "course-a",
        assessment_id: "grade-a",
        earned: 27,
        max_score: 30,
        note: "Confirmed manual",
        updated_at: "2026-10-08T02:00:00Z",
      },
    ],
    assessment_component_mappings: [
      {
        id: "mapping-a",
        user_id: "a",
        study_course_id: "course-a",
        assessment_id: "grade-a",
        component_id: "lab1",
        scheme_id: "scheme-a",
      },
    ],
    source_events: [
      {
        id: "source-linked",
        user_id: "a",
        external_id: "assignment:moodle:42:5",
        source_key: "university_platform",
        provider: "moodle",
        event_type: "task",
        title: "Lab 1",
        due_at: "2026-10-10T10:00:00Z",
        status: "completed",
        source_url: "https://moodle.example/mod/assign/view.php?id=5",
        raw_json: {
          moodle_course_id: "42",
          related_grade_external_id: "academic:moodle:42:9",
          course_title: "Owned course",
        },
      },
      {
        id: "source-ungraded",
        user_id: "a",
        external_id: "assignment:moodle:42:6",
        source_key: "university_platform",
        provider: "moodle",
        event_type: "task",
        title: "New Lab",
        due_at: "2026-10-11T10:00:00Z",
        status: "active",
        source_url: "https://moodle.example/mod/assign/view.php?id=6",
        updated_at: "2026-10-08T00:00:00Z",
        raw_json: { moodle_course_id: "42", course_title: "Owned course" },
      },
      {
        id: "calendar-unrelated",
        user_id: "a",
        source_key: "google_calendar",
        event_type: "calendar_event",
        title: "Dental check",
        due_at: "2026-10-12T10:00:00Z",
        status: "active",
        raw_json: {},
      },
      {
        id: "source-b",
        user_id: "b",
        source_key: "university_platform",
        event_type: "task",
        title: "private-deadline",
        due_at: "2026-10-13T10:00:00Z",
        status: "active",
        raw_json: {},
      },
    ],
    life_entities: [
      {
        id: "manual-deadline",
        user_id: "a",
        domain: "general",
        entity_type: "deadline",
        title: "Manual deadline",
        due_at: "2026-10-14T10:00:00Z",
        status: "active",
        source: "telegram",
        metadata: {},
      },
    ],
    tasks: [
      {
        id: "finance-task",
        user_id: "a",
        title: "Bank transfer",
        due_at: "2026-10-15T10:00:00Z",
        status: "inbox",
        source: "telegram",
        metadata: { domain: "finance" },
      },
    ],
    external_sources: [
      {
        id: "moodle-source",
        user_id: "a",
        source_key: "university_platform",
        source_type: "academic",
        display_name: "Moodle",
        status: "connected",
        last_sync_at: "2026-10-08T00:00:00Z",
      },
    ],
    syllabus_documents: [
      {
        id: "doc-b",
        user_id: "b",
        study_course_id: "course-b",
        file_name: "private.pdf",
        pdf_base64: "private-bytes",
      },
    ],
    grading_schemes: [],
  };
  const requests: Array<{ table: string; method: string; url: URL }> = [];
  const client = createClient<Database>("http://study.test", "test-key", {
    auth: { persistSession: false },
    global: {
      fetch: async (input, init) => {
        const url = new URL(String(input));
        const table = url.pathname.split("/").pop()!;
        const method = init?.method ?? "GET";
        requests.push({ table, method, url });
        let rows = (tables[table] ?? []).filter((row) =>
          [...url.searchParams].every(([column, filter]) =>
            filter.startsWith("eq.")
              ? String(row[column]) === filter.slice(3)
              : filter.startsWith("gt.")
                ? String(row[column]) > filter.slice(3)
                : filter.startsWith("in.(")
                  ? filter.slice(4, -1).split(",").includes(String(row[column]))
                  : true,
          ),
        );
        rows = rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));
        if (url.searchParams.has("limit"))
          rows = rows.slice(0, Number(url.searchParams.get("limit")));
        const accept = new Headers(init?.headers).get("accept") ?? "";
        return new Response(
          JSON.stringify(
            accept.includes("vnd.pgrst.object") ? (rows[0] ?? null) : rows,
          ),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    },
  });
  return { client, tables, requests };
}
describe("persisted study records", () => {
  it("merges authoritative deadlines through stable grade identities without title heuristics", async () => {
    const f = fixture();
    const result = await loadStudySupplement(f.client, "a");
    expect(result.assignments).toHaveLength(2);
    const grade = result.assignments.find((item) => item.id === "grade-a")!;
    expect(grade).toMatchObject({
      actualScore: 15,
      maxScore: 30,
      effectiveScore: 27,
      effectiveMax: 30,
      componentId: "lab1",
      schemeId: "scheme-a",
      dueAt: "2026-10-10T10:00:00Z",
      sourceUrl: "https://moodle.example/mod/assign/view.php?id=5",
    });
    expect(
      result.assignments.find((item) => item.id === "source:source-ungraded"),
    ).toMatchObject({
      editable: false,
      status: "pending",
      actualScore: null,
      studyCourseId: "course-a",
    });
    expect(result.deadlines.map((item) => item.title)).toEqual([
      "Lab 1",
      "New Lab",
      "Manual deadline",
    ]);
    expect(result.sync).toMatchObject({
      status: "connected",
      updatedAt: "2026-10-08T00:00:00Z",
    });
    expect(JSON.stringify(result)).not.toMatch(
      /private|raw-moodle-secret|Dental check|Bank transfer/,
    );
    f.tables.assessment_items[0].actual_score = 18;
    expect(
      (await loadStudySupplement(f.client, "a")).assignments.find(
        (item) => item.id === "grade-a",
      ),
    ).toMatchObject({ actualScore: 18, effectiveScore: 27 });
  });
  it("never queries another account's assessment before ownership is resolved", async () => {
    const f = fixture();
    await expect(getOwnedAssessment(f.client, "b", "grade-a")).rejects.toThrow(
      "study_assignment_not_found",
    );
    await expect(
      saveStudyOverride(f.client, "b", "grade-a", { earned: 20, max: 30 }),
    ).rejects.toThrow("study_assignment_not_found");
    await expect(
      saveStudyMapping(f.client, "b", "grade-a", { componentId: "lab1" }),
    ).rejects.toThrow("study_assignment_not_found");
    await expect(downloadStudyDocument(f.client, "a", "doc-b")).rejects.toThrow(
      "study_document_not_found",
    );
    for (const request of f.requests.filter(
      (item) => item.table === "assessment_items",
    ))
      expect(request.url.searchParams.get("study_course_id")).toBe(
        "in.(course-b)",
      );
    expect(f.requests.some((request) => request.method !== "GET")).toBe(false);
  });
  it("validates denominators and gives honest sync empty states", async () => {
    const f = fixture();
    await expect(
      saveStudyOverride(f.client, "a", "grade-a", { earned: 20, max: 0 }),
    ).rejects.toThrow("invalid_study_assignment");
    await expect(
      saveStudyOverride(f.client, "a", "grade-a", { earned: 31, max: 30 }),
    ).rejects.toThrow("invalid_study_assignment");
    const other = await loadStudySupplement(f.client, "b");
    expect(other.sync.status).toBe("not_synced");
    expect(other.sync.message).toContain(
      "отсутствие работ не означает отсутствие дедлайнов",
    );
  });
});
