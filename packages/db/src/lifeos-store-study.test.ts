import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { SupabaseLifeOSStore } from "./lifeos-store.js";
import type { Database } from "./types.js";

const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const courseId = "aaaaaaaa-0000-4000-8000-000000000001";
const assignmentId = "aaaaaaaa-0000-4000-8000-000000000002";

function fixture(source = "manual") {
  const courses = [{ id: courseId, user_id: owner, metadata: {}, code: "RU" }];
  const assignments: Array<Record<string, unknown>> = [
    {
      id: assignmentId,
      study_course_id: courseId,
      external_id: null,
      source,
      title: "Original assignment",
      max_score: null,
      actual_score: null,
      status: "pending",
      raw_json: { original_provenance: "preserve" },
    },
  ];
  const requests: Array<{ url: URL; method: string }> = [];
  const client = createClient<Database>(
    "http://study.test",
    "sb_secret_fixture",
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: async (input, init) => {
          const url = new URL(String(input));
          const method = init?.method ?? "GET";
          requests.push({ url, method });
          const table = url.pathname.split("/").pop();
          const rows: Array<Record<string, unknown>> =
            table === "study_courses" ? courses : assignments;
          const matches = rows.filter((row) =>
            [...url.searchParams].every(([key, filter]) => {
              if (filter.startsWith("eq."))
                return String(row[key]) === filter.slice(3);
              if (filter.startsWith("gt."))
                return String(row[key]) > filter.slice(3);
              if (filter.startsWith("in.("))
                return filter
                  .slice(4, -1)
                  .split(",")
                  .includes(String(row[key]));
              return true;
            }),
          );
          if (method === "POST") {
            const created = {
              id: "new-assignment",
              ...JSON.parse(String(init?.body)),
            };
            rows.push(created);
            return Response.json(created);
          }
          if (method === "PATCH")
            matches.forEach((row) =>
              Object.assign(row, JSON.parse(String(init?.body))),
            );
          const single = new Headers(init?.headers)
            .get("accept")
            ?.includes("vnd.pgrst.object");
          return Response.json(single ? (matches[0] ?? null) : matches);
        },
      },
    },
  );
  return { store: new SupabaseLifeOSStore(client), assignments, requests };
}

describe("manual study assignment persistence", () => {
  it("rejects a foreign course before inserting and keeps a stable workspace error", async () => {
    const f = fixture();
    await expect(
      f.store.createManualStudyAssignment(other, {
        studyCourseId: courseId,
        title: "Foreign assignment",
      }),
    ).rejects.toThrow("study_course_not_found");
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0].url.searchParams.get("user_id")).toBe(`eq.${other}`);
    expect(f.requests[0].method).toBe("GET");
    expect(f.assignments).toHaveLength(1);
  });

  it("preserves a real zero and creates only a manual assignment for the owned course", async () => {
    const f = fixture();
    const saved = await f.store.createManualStudyAssignment(owner, {
      studyCourseId: courseId,
      title: "Manual assignment",
      actualScore: 0,
      maxScore: 30,
      dueAt: "2026-10-10T10:00:00Z",
      source: "moodle",
      externalId: "forged-source",
    });
    expect(saved).toMatchObject({
      source: "manual",
      externalId: null,
      actualScore: 0,
      maxScore: 30,
      dueAt: "2026-10-10T10:00:00Z",
    });
    expect(f.assignments).toHaveLength(2);
  });

  it("rejects scores without a maximum on creation and partial editing", async () => {
    const f = fixture();
    await expect(
      f.store.createManualStudyAssignment(owner, {
        studyCourseId: courseId,
        title: "Invalid",
        actualScore: 15,
      }),
    ).rejects.toThrow("invalid_study_assignment");
    await expect(
      f.store.editManualStudyAssignment(owner, assignmentId, {
        actualScore: 15,
      }),
    ).rejects.toThrow("invalid_study_assignment");
    expect(f.requests.every((request) => request.method === "GET")).toBe(true);
    expect(f.assignments[0].actual_score).toBeNull();
  });

  it("edits owned manual scores and deadlines while preserving source metadata", async () => {
    const f = fixture();
    const saved = await f.store.editManualStudyAssignment(owner, assignmentId, {
      actualScore: 15,
      maxScore: 30,
      dueAt: "2026-10-11T10:00:00Z",
      rawJson: { source_url: "https://example.edu/assignment" },
    });
    expect(saved).toMatchObject({
      actualScore: 15,
      maxScore: 30,
      dueAt: "2026-10-11T10:00:00Z",
      rawJson: {
        original_provenance: "preserve",
        source_url: "https://example.edu/assignment",
      },
    });
    await expect(
      f.store.editManualStudyAssignment(owner, assignmentId, {
        maxScore: null,
      }),
    ).rejects.toThrow("invalid_study_assignment");
    expect(f.assignments[0].max_score).toBe(30);
  });

  it("rejects foreign and synchronized assignments without changing their scores", async () => {
    const f = fixture("moodle");
    await expect(
      f.store.editManualStudyAssignment(other, assignmentId, {
        actualScore: 15,
        maxScore: 30,
      }),
    ).rejects.toThrow("study_assignment_not_found");
    await expect(
      f.store.editManualStudyAssignment(owner, assignmentId, {
        actualScore: 15,
        maxScore: 30,
      }),
    ).rejects.toThrow("study_assignment_read_only");
    expect(f.requests.every((request) => request.method === "GET")).toBe(true);
    expect(f.assignments[0].actual_score).toBeNull();
  });
});
