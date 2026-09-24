import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
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
