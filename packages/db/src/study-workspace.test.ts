import { defaultScholarshipConfig } from "../../core/src/scholarship.js";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  configureStudyCalculator,
  loadStudyWorkspaceCourses,
  saveStudyCalculator,
  saveScholarshipPlan,
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
        let rows = (table === "study_courses" ? courses : schedules)
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
      else
        expect(request.url.searchParams.get("study_course_id")).toBe(
          `in.(${courseId})`,
        );
    }
  });

  it("uses the built-in syllabus when a known active course has no stored calculator", async () => {
    const f = fixture();
    f.courses[0].code = "DMS52-EN";
    f.courses[0].metadata = { untouched: "keep" };
    const result = await loadStudyWorkspaceCourses(f.client, "owner");
    expect(result[0].calculator?.definition.fields).toHaveLength(11);
    expect(result[0].calculator?.definition.sourceName).toContain("Syllabus");
  });

  it("uses the same known-title fallback when the course code is imported from Moodle", async () => {
    const f = fixture();
    f.courses[0].title = "Computer Networks | Teacher";
    f.courses[0].code = "MOODLE-123";
    f.courses[0].metadata = { untouched: "keep" };
    const [course] = await loadStudyWorkspaceCourses(f.client, "owner");
    expect(course.calculator?.definition.fields).toHaveLength(12);
    expect(
      course.calculator?.definition.fields.find((field) => field.id === "cisco")
        ?.label,
    ).toBe("Cisco certificate");
    const saved = await saveStudyCalculator(f.client, "owner", courseId, {
      values: { assignment_1: 0, cisco: 80 },
      target: 70,
    });
    expect(saved.definition).toEqual(course.calculator?.definition);
    expect(saved.values).toEqual({ assignment_1: 0, cisco: 80 });
  });

  it.each([
    ["Русский язык B2", "K(RUSSIAN)L51-RU"],
    ["Computer Networks", "OS52-EN"],
  ])(
    "does not infer a fallback for conflicting subject %s / %s",
    async (title, code) => {
      const f = fixture();
      Object.assign(f.courses[0], { title, code, metadata: {} });
      const [course] = await loadStudyWorkspaceCourses(f.client, "owner");
      expect(course.calculator).toBeNull();
      await expect(
        saveStudyCalculator(f.client, "owner", courseId, {
          values: {},
          target: 70,
        }),
      ).rejects.toThrow("study_calculator_not_configured");
      expect(f.requests.some((request) => request.method === "PATCH")).toBe(
        false,
      );
    },
  );

  it("checks configuration expectations against the same title-based fallback returned on load", async () => {
    const f = fixture();
    Object.assign(f.courses[0], {
      title: "Digital Logic Design",
      code: "MOODLE-456",
      metadata: {},
    });
    const [course] = await loadStudyWorkspaceCourses(f.client, "owner");
    const saved = await configureStudyCalculator(f.client, "owner", courseId, {
      definition: course.calculator!.definition,
      expectedState: course.calculator,
      values: { assignment_1: 90 },
    });
    expect(saved.definition).toEqual(course.calculator!.definition);
    expect(saved.values).toEqual({ assignment_1: 90 });
    expect(saved.target).toBe(70);
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
    });

    expect(saved.definition).toEqual(customDefinition);
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

  it("atomically upgrades a formula with mapped scores and an unchanged expected scenario", async () => {
    const f = fixture();
    const expectedState = (
      f.courses[0].metadata as {
        study_calculator_v1: unknown;
      }
    ).study_calculator_v1;
    const nextDefinition = {
      ...definition,
      fields: definition.fields.map((field) => ({
        ...field,
        id: `new_${field.id}`,
      })),
    };
    const saved = await configureStudyCalculator(f.client, "owner", courseId, {
      definition: nextDefinition,
      expectedState,
      values: { new_att1: 0, new_att2: null, new_exam: 90 },
      target: 70,
    });
    expect(saved.values).toEqual({ new_att1: 0, new_att2: null, new_exam: 90 });
    expect(f.courses[0].metadata).toMatchObject({
      untouched: "keep",
      study_calculator_v1: saved,
    });
    expect(
      f.requests
        .find((request) => request.method === "PATCH")
        ?.url.searchParams.get("user_id"),
    ).toBe("eq.owner");
  });

  it("configures a course with no matching fallback when its expected state is null", async () => {
    const f = fixture();
    f.courses[0].metadata = { untouched: "keep" };
    const saved = await configureStudyCalculator(f.client, "owner", courseId, {
      definition,
      expectedState: null,
      values: {},
    });
    expect(saved).toEqual({ definition, values: {}, target: 70 });
    expect(f.courses[0].metadata).toMatchObject({
      untouched: "keep",
      study_calculator_v1: saved,
    });
  });

  it("rejects an expected null state when a saved custom calculator already exists", async () => {
    const f = fixture();
    await expect(
      configureStudyCalculator(f.client, "owner", courseId, {
        definition,
        expectedState: null,
      }),
    ).rejects.toThrow("study_calculator_conflict");
    expect(f.requests.some((request) => request.method === "PATCH")).toBe(
      false,
    );
  });

  it("rejects a configuration if the course changes between the read and update", async () => {
    const f = fixture();
    f.setConflict();
    await expect(
      configureStudyCalculator(f.client, "owner", courseId, {
        definition,
        expectedState: (
          f.courses[0].metadata as { study_calculator_v1: unknown }
        ).study_calculator_v1,
      }),
    ).rejects.toThrow("study_calculator_conflict");
    expect(f.courses[0].metadata).toMatchObject({
      study_calculator_v1: { values: {} },
    });
  });

  it.each(["definition", "values", "target"])(
    "does not silently overwrite a concurrent %s edit during auto-application",
    async (edited) => {
      const f = fixture();
      const expectedState = structuredClone(
        (
          f.courses[0].metadata as {
            study_calculator_v1: {
              definition: typeof definition;
              values: Record<string, number>;
              target: number;
            };
          }
        ).study_calculator_v1,
      );
      const current = structuredClone(expectedState);
      if (edited === "definition")
        current.definition.sourceName = "Custom formula";
      if (edited === "values") current.values = { att1: 85 };
      if (edited === "target") current.target = 90;
      f.courses[0].metadata = { study_calculator_v1: current };
      await expect(
        configureStudyCalculator(f.client, "owner", courseId, {
          definition,
          values: {},
          expectedState,
        }),
      ).rejects.toThrow("study_calculator_conflict");
      expect(f.requests.some((request) => request.method === "PATCH")).toBe(
        false,
      );
    },
  );

  it("rejects invalid mapped values during configuration", async () => {
    const f = fixture();
    await expect(
      configureStudyCalculator(f.client, "owner", courseId, {
        definition,
        values: { wrong_field: 70 },
      }),
    ).rejects.toThrow("invalid_study_calculator");
    expect(f.requests.some((request) => request.method === "PATCH")).toBe(
      false,
    );
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

describe("scholarship course metadata", () => {
  it("saves and reloads three scenarios while preserving calculator and unrelated metadata", async () => {
    const f = fixture();
    const config = defaultScholarshipConfig(80);
    config.scenarios.realistic.defaults.assignment = 70;
    const original = structuredClone(f.courses[0].metadata);
    await expect(
      saveScholarshipPlan(f.client, "owner", courseId, {
        config,
        expectedConfig: null,
      }),
    ).resolves.toEqual(config);
    expect(f.courses[0].metadata).toEqual({
      ...(original as object),
      scholarship_planner_v1: config,
    });
    const courses = await loadStudyWorkspaceCourses(f.client, "owner");
    expect(courses[0].scholarship).toEqual(config);
    const patch = f.requests.find((r) => r.method === "PATCH")!;
    expect(patch.url.searchParams.get("user_id")).toBe("eq.owner");
    expect(patch.url.searchParams.get("updated_at")).toBe(
      "eq.2026-09-24T00:00:00Z",
    );
    await saveStudyCalculator(f.client, "owner", courseId, {
      values: { att1: 72.1 },
      target: 70,
    });
    expect(
      (f.courses[0].metadata as Record<string, unknown>).scholarship_planner_v1,
    ).toEqual(config);
  });
  it("blocks other owners, completed courses, stale settings and concurrent metadata writes", async () => {
    const config = defaultScholarshipConfig();
    const input = { config, expectedConfig: null };
    const f = fixture();
    await expect(
      saveScholarshipPlan(f.client, "other", courseId, input),
    ).rejects.toThrow("study_course_not_found");
    await expect(
      saveScholarshipPlan(f.client, "owner", String(f.courses[2].id), input),
    ).rejects.toThrow("study_course_not_found");
    await saveScholarshipPlan(f.client, "owner", courseId, input);
    await expect(
      saveScholarshipPlan(f.client, "owner", courseId, input),
    ).rejects.toThrow("study_calculator_conflict");
    f.setConflict();
    await expect(
      saveScholarshipPlan(f.client, "owner", courseId, {
        config,
        expectedConfig: config,
      }),
    ).rejects.toThrow("study_calculator_conflict");
  });
  it("rejects invalid configurations and missing comparison state before writing", async () => {
    const f = fixture();
    for (const input of [
      { config: defaultScholarshipConfig() },
      {
        config: { ...defaultScholarshipConfig(), threshold: 101 },
        expectedConfig: null,
      },
      { config: defaultScholarshipConfig(), expectedConfig: {} },
    ])
      await expect(
        saveScholarshipPlan(f.client, "owner", courseId, input),
      ).rejects.toThrow("invalid_scholarship_plan");
    expect(f.requests.some((r) => r.method === "PATCH")).toBe(false);
  });
  it("ignores malformed saved planning settings without losing a valid calculator", async () => {
    const f = fixture();
    (f.courses[0].metadata as Record<string, unknown>).scholarship_planner_v1 =
      { target: Infinity };
    const [c] = await loadStudyWorkspaceCourses(f.client, "owner");
    expect(c.scholarship).toBeNull();
    expect(c.calculator).not.toBeNull();
  });
});
