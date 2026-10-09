import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  configureStudyCalculator,
  loadStudyWorkspaceCourses,
  saveStudyCalculator,
} from "./study-workspace.js";
import type { Database } from "./types.js";

const courseId = "11111111-1111-4111-8111-111111111111";
const definition = {
  version: 1,
  sourceName: "schedule.html",
  attestationThreshold: 25,
  fields: ["att1", "att2", "exam"].map((period) => ({
    id: period,
    label: period,
    period,
    weightPercent: 100,
  })),
};

function fixture() {
  const courses: Array<Record<string, unknown>> = [
    {
      id: courseId,
      user_id: "owner",
      code: "CS",
      title: "Networks",
      status: "active",
      starts_on: "2026-09-01",
      ends_on: null,
      external_course_key: "moodle:1",
      updated_at: "2026-09-24T00:00:00Z",
      metadata: {
        untouched: "keep",
        study_calculator_v1: { definition, values: {}, target: 70 },
      },
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      user_id: "other",
      status: "active",
      title: "Private",
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      user_id: "owner",
      status: "completed",
      title: "Old",
    },
  ];
  const schedules = [
    {
      id: "slot1",
      study_course_id: courseId,
      day_of_week: "monday",
      start_time: "16:00:00",
      end_time: "16:50:00",
      room: "204",
      instructor_name: "Teacher",
      session_type: "practice",
    },
    {
      id: "slot2",
      study_course_id: courses[1].id,
      day_of_week: "tuesday",
      room: "secret",
    },
  ];
  const schemes: Array<Record<string, unknown>> = [];
  const documents: Array<Record<string, unknown>> = [];
  const requests: Array<{ table: string; method: string; url: URL }> = [];
  let conflict = false;
  const client = createClient<Database>("http://test.local", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input, init) => {
        const url = new URL(String(input));
        const table = url.pathname.split("/").pop()!;
        const method = init?.method ?? "GET";
        requests.push({ table, method, url });
        if (table === "activate_study_grading_scheme") {
          const body = JSON.parse(String(init?.body));
          schemes
            .filter(
              (scheme) =>
                scheme.user_id === body.p_user_id &&
                scheme.study_course_id === body.p_course_id,
            )
            .forEach((scheme) => {
              scheme.is_active = scheme.id === body.p_scheme_id;
            });
          return new Response("null", {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        const tableRows =
          table === "study_courses"
            ? courses
            : table === "course_schedules"
              ? schedules
              : table === "grading_schemes"
                ? schemes
                : documents;
        if (method === "POST")
          tableRows.push({
            ...JSON.parse(String(init?.body)),
            id: `00000000-0000-4000-8000-${String(tableRows.length + 1).padStart(12, "0")}`,
            created_at: "2026-10-08T00:00:00Z",
          });
        let rows = tableRows
          .filter((row) => {
            return [...url.searchParams].every(([key, filter]) => {
              if (filter.startsWith("eq."))
                return row[key as keyof typeof row] === filter.slice(3);
              if (filter.startsWith("gt."))
                return String(row[key as keyof typeof row]) > filter.slice(3);
              if (filter.startsWith("in.("))
                return filter
                  .slice(4, -1)
                  .split(",")
                  .includes(String(row[key as keyof typeof row]));
              return true;
            });
          })
          .sort((a, b) => String(a.id).localeCompare(String(b.id)));
        if (url.searchParams.has("limit"))
          rows = rows.slice(0, Number(url.searchParams.get("limit")));
        if (method === "PATCH") {
          if (conflict) rows = [];
          else
            rows.forEach((row) =>
              Object.assign(row, JSON.parse(String(init?.body))),
            );
        }
        const accept = new Headers(init?.headers).get("accept") ?? "";
        return new Response(
          JSON.stringify(
            accept.includes("vnd.pgrst.object") ? (rows[0] ?? null) : rows,
          ),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      },
    },
  });
  return {
    client,
    courses,
    schemes,
    documents,
    requests,
    setConflict: () => {
      conflict = true;
    },
  };
}

describe("study workspace", () => {
  it("loads only active owned courses and scopes schedules through their IDs", async () => {
    const f = fixture();
    const result = await loadStudyWorkspaceCourses(f.client, "owner");
    expect(result).toHaveLength(1);
    expect(result[0].schedules.map((slot) => slot.id)).toEqual(["slot1"]);
    expect(result[0].calculator?.values).toEqual({});
    for (const request of f.requests) {
      if (request.table === "study_courses")
        expect(request.url.searchParams.get("user_id")).toBe("eq.owner");
      else if (request.table === "course_schedules")
        expect(request.url.searchParams.get("study_course_id")).toBe(
          `in.(${courseId})`,
        );
      else {
        expect(request.url.searchParams.get("user_id")).toBe("eq.owner");
        expect(request.url.searchParams.get("study_course_id")).toBe(
          `eq.${courseId}`,
        );
      }
    }
  });

  it("does not invent runtime course formulas when no definition is stored", async () => {
    const f = fixture();
    f.courses[0].code = "DMS52-EN";
    f.courses[0].metadata = { untouched: "keep" };
    const result = await loadStudyWorkspaceCourses(f.client, "owner");
    expect(result[0].calculator).toBeNull();
  });

  it("uses the stored active scheme for any course and sanitizes manual grade provenance", async () => {
    const f = fixture();
    f.schemes.push({
      id: "scheme",
      user_id: "owner",
      study_course_id: courseId,
      definition,
      is_active: true,
      verification: "verified",
      version: 1,
    });
    (
      f.courses[0].metadata as { study_calculator_v1: { values: unknown } }
    ).study_calculator_v1.values = {
      att1: { earned: 15, max: 30, kind: "actual", source: "client" },
    };
    const [course] = await loadStudyWorkspaceCourses(f.client, "owner");
    expect(course.calculator?.values.att1).toEqual({
      earned: 15,
      max: 30,
      kind: "actual",
      source: "manual_confirmed",
    });
    expect(course.gradingSchemes[0].isActive).toBe(true);
  });

  it("stores a user syllabus definition and preserves matching calculator values", async () => {
    const f = fixture();
    (
      f.courses[0].metadata as {
        study_calculator_v1: { values: Record<string, number> };
      }
    ).study_calculator_v1.values = { att1: 72 };
    const customDefinition = {
      ...definition,
      sourceName: "Networks syllabus Fall 2026",
      fields: definition.fields.map((field) => ({
        ...field,
        label: `Custom ${field.label}`,
      })),
    };

    const saved = await configureStudyCalculator(f.client, "owner", courseId, {
      definition: customDefinition,
      target: 85,
      confirmed: true,
    });

    expect(saved.definition).toMatchObject(customDefinition);
    expect(saved.definition.verification).toBe("verified");
    expect(saved.values).toEqual({ att1: 72 });
    expect(saved.target).toBe(85);
    expect(f.courses[0].metadata).toMatchObject({
      untouched: "keep",
      study_calculator_v1: saved,
    });
  });

  it("rejects an invalid syllabus definition before writing", async () => {
    const f = fixture();
    const invalid = {
      ...definition,
      fields: definition.fields.map((field, index) =>
        index === 0 ? { ...field, weightPercent: 90 } : field,
      ),
    };
    await expect(
      configureStudyCalculator(f.client, "owner", courseId, {
        definition: invalid,
      }),
    ).rejects.toThrow("invalid_study_calculator");
    expect(f.requests.some((request) => request.method === "PATCH")).toBe(
      false,
    );
  });

  it("requires confirmation before replacing a definition and retains attendance", async () => {
    const f = fixture();
    await expect(
      configureStudyCalculator(f.client, "owner", courseId, { definition }),
    ).rejects.toThrow("study_scheme_needs_review");
    expect(f.requests.some((request) => request.method === "POST")).toBe(false);
    const saved = await saveStudyCalculator(f.client, "owner", courseId, {
      values: { att1: { earned: 15, max: 30, kind: "actual" } },
      target: 70,
      attendancePercent: 80,
      maxima: { exam: 30 },
    });
    expect(saved.attendancePercent).toBe(80);
    expect(saved.maxima).toEqual({ exam: 30 });
    expect(
      (await loadStudyWorkspaceCourses(f.client, "owner"))[0].calculator
        ?.maxima,
    ).toEqual({ exam: 30 });
    expect(saved.values.att1).toMatchObject({
      kind: "actual",
      source: "manual_confirmed",
    });
    await expect(
      saveStudyCalculator(f.client, "owner", courseId, {
        values: {},
        target: 70,
        attendancePercent: 120,
      }),
    ).rejects.toThrow("invalid_study_calculator");
    await expect(
      saveStudyCalculator(f.client, "owner", courseId, {
        values: {},
        target: 70,
        maxima: { exam: 0 },
      }),
    ).rejects.toThrow("invalid_study_calculator");
    await expect(
      saveStudyCalculator(f.client, "owner", courseId, {
        values: {},
        target: 70,
        maxima: { unmapped: 30 },
      }),
    ).rejects.toThrow("invalid_study_calculator");
  });

  it("saves a scenario without changing its formula, Moodle link or unrelated metadata", async () => {
    const f = fixture();
    const saved = await saveStudyCalculator(f.client, "owner", courseId, {
      values: { att1: 0, att2: null },
      target: 80,
      definition: { fields: [] },
    });
    expect(saved.values).toEqual({ att1: 0, att2: null });
    expect(saved.definition).toEqual(definition);
    expect(f.courses[0].external_course_key).toBe("moodle:1");
    expect(f.courses[0].metadata).toMatchObject({
      untouched: "keep",
      study_calculator_v1: saved,
    });
    const patch = f.requests.find((request) => request.method === "PATCH")!;
    expect(patch.url.searchParams.get("user_id")).toBe("eq.owner");
    expect(patch.url.searchParams.get("updated_at")).toBe(
      "eq.2026-09-24T00:00:00Z",
    );
  });

  it("rejects another user's course and invalid values before writing", async () => {
    const f = fixture();
    await expect(
      saveStudyCalculator(f.client, "other", courseId, {
        values: {},
        target: 70,
      }),
    ).rejects.toThrow("study_course_not_found");
    await expect(
      saveStudyCalculator(f.client, "owner", courseId, {
        values: { att1: 101 },
        target: 70,
      }),
    ).rejects.toThrow("invalid_study_calculator");
    await expect(
      saveStudyCalculator(f.client, "owner", courseId, {
        values: { unknown: 10 },
        target: 70,
      }),
    ).rejects.toThrow("invalid_study_calculator");
    expect(f.requests.some((request) => request.method === "PATCH")).toBe(
      false,
    );
  });

  it("reports a concurrent metadata change instead of overwriting it", async () => {
    const f = fixture();
    f.setConflict();
    await expect(
      saveStudyCalculator(f.client, "owner", courseId, {
        values: {},
        target: 70,
      }),
    ).rejects.toThrow("study_calculator_conflict");
  });
});
