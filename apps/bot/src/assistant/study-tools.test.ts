import { describe, expect, it, vi } from "vitest";
import {
  defaultScholarshipConfig,
  builtinStudyCalculatorState,
  calculateStudyScenario,
  calculateStudyTargetPlan,
  type StudyCalculatorState,
  type StudyWorkItem,
} from "@lifeos/core";
import type { LifeOSStore, StudyWorkspaceCourse } from "@lifeos/db";
import { executeStudyTool } from "./study-tools.js";

const user = { userId: "authenticated-owner", timezone: "Asia/Almaty" };
const now = new Date("2026-10-11T20:30:00.000Z"); // Monday 01:30 local.
function course(
  input: Partial<StudyWorkspaceCourse> = {},
): StudyWorkspaceCourse {
  return {
    id: "internal-course",
    code: "CUSTOM",
    title: "Custom Systems",
    startsOn: "2026-09-01",
    endsOn: "2026-12-31",
    externalCourseKey: null,
    schedules: [
      {
        id: "internal-slot",
        dayOfWeek: "monday",
        startTime: "09:00:00",
        endTime: "10:30:00",
        room: "A1",
        sessionType: "lecture",
        instructorName: "Teacher",
      },
    ],
    calculator: null,
    ...input,
  };
}
function state(): StudyCalculatorState {
  return {
    definition: {
      version: 1,
      sourceName: "User custom",
      attestationThreshold: 25,
      fields: [
        {
          id: "first",
          label: "First custom task",
          period: "att1",
          weightPercent: 100,
        },
        {
          id: "second",
          label: "Second custom task",
          period: "att2",
          weightPercent: 100,
        },
        {
          id: "exam",
          label: "Custom exam",
          period: "exam",
          weightPercent: 100,
        },
      ],
    },
    values: { first: 80, second: 60, exam: null },
    target: 70,
  };
}
function item(input: Partial<StudyWorkItem> = {}): StudyWorkItem {
  return {
    title: "Assignment",
    courseTitle: "Custom Systems",
    category: "unknown",
    kind: "assignment",
    submissionStatus: "unknown",
    dueAt: null,
    startsAt: null,
    endsAt: null,
    score: null,
    maxScore: null,
    percentage: null,
    source: "moodle",
    ...input,
  };
}
function setup(
  courses: StudyWorkspaceCourse[] = [course()],
  items: StudyWorkItem[] = [],
) {
  const store = {
    getTmaStudySummary: vi
      .fn()
      .mockResolvedValue({ timezone: user.timezone, courses, records: [] }),
    getLmsWork: vi.fn().mockResolvedValue({
      timezone: user.timezone,
      lastSyncSuccessAt: "2026-10-11T19:00:00+00:00",
      lastSyncAttemptAt: null,
      stale: false,
      truncated: false,
      warnings: [],
      unsupportedFeatures: [],
      items,
    }),
    assistant: { listGradeChanges: vi.fn().mockResolvedValue([]) },
  };
  return {
    store,
    execute: (tool: string, args: Record<string, unknown> = {}) =>
      executeStudyTool(
        store as unknown as LifeOSStore,
        user,
        { tool: tool as "classes.today", args },
        now,
      ),
  };
}
describe("assistant academic adapters", () => {
  it("scopes schedule reads to the principal and local date", async () => {
    const { store, execute } = setup();
    const result = await execute("classes.today");
    expect(store.getTmaStudySummary).toHaveBeenCalledWith(
      user.userId,
      user.timezone,
    );
    expect(result.text).toContain("2026-10-12");
    expect(result.text).toContain("09:00–10:30 · Custom Systems · A1");
    expect(result.text).not.toContain("internal-");
    expect(result.sources).toEqual([
      { name: "Saved study timetable", updatedAt: null },
    ]);
  });
  it("constrains recurrence to the course's term dates", async () => {
    const { execute } = setup([course({ endsOn: "2026-10-11" })]);
    expect((await execute("classes.today")).text).toContain("No classes");
  });
  it("reads tomorrow independently from today", async () => {
    const { execute } = setup([
      course({
        schedules: [{ ...course().schedules[0], dayOfWeek: "tuesday" }],
      }),
    ]);
    expect((await execute("classes.today")).text).toContain("No classes");
    expect((await execute("classes.tomorrow")).text).toContain("2026-10-13");
  });
  it("chooses the next recorded class within seven days", async () => {
    const { execute } = setup([
      course({
        schedules: [{ ...course().schedules[0], dayOfWeek: "thursday" }],
      }),
    ]);
    expect((await execute("classes.next")).text).toContain("2026-10-15 09:00");
  });
  it("does not fabricate a next class", async () => {
    const { execute } = setup([]);
    expect((await execute("classes.next")).text).toContain("No upcoming class");
  });
  it("calls the current calculator and preserves custom formulas and missing values", async () => {
    const calculator = state();
    const before = structuredClone(calculator);
    const { execute } = setup([course({ calculator })]);
    const result = await execute("study.forecast", {
      course: "CUSTOM",
      target: 75,
    });
    const requested = { ...calculator, target: 75 };
    expect(result.text).toContain(
      `Required average on remaining work: ${calculateStudyTargetPlan(requested).requiredAverage}%`,
    );
    expect(result.text).toContain(
      `Required final exam score: ${calculateStudyScenario(requested).requiredExamScore}%`,
    );
    expect(result.text).toContain("Custom exam: unknown");
    expect(result.text).toContain("Current final grade: unknown");
    expect(calculator).toEqual(before);
  });
  it("resolves DBMS through existing syllabus aliases", async () => {
    const { execute } = setup([
      course({ code: "A-101", title: "Database Management Systems" }),
    ]);
    expect(
      (await execute("study.forecast", { course: "DBMS", target: 70 })).text,
    ).toContain("Database Management Systems");
  });
  it("rejects missing and ambiguous courses instead of selecting a guessed course", async () => {
    const { execute } = setup([
      course({ code: "FIRST" }),
      course({ code: "OTHER", title: "Custom Networks" }),
    ]);
    await expect(
      execute("study.forecast", { course: "Custom" }),
    ).rejects.toThrow("Several courses");
    await expect(
      execute("study.forecast", { course: "Nonexistent" }),
    ).rejects.toThrow("No saved course");
  });
  it("displays actual Moodle scores, preserves unknown values and excludes manual scores", async () => {
    const { store, execute } = setup(
      [],
      [
        item({
          title: "Known",
          category: "graded",
          score: 8,
          maxScore: 10,
          percentage: 80,
        }),
        item({ title: "Unknown" }),
        item({ title: "Manual private grade", source: "manual", score: 90 }),
      ],
    );
    const result = await execute("study.grades");
    expect(store.getLmsWork).toHaveBeenCalledWith(user.userId, user.timezone);
    expect(result.text).toContain("Known: 8/10");
    expect(result.text).toContain("Unknown: unknown");
    expect(result.text).not.toContain("Manual private");
    expect(result.sources[0].updatedAt).toBe("2026-10-11T19:00:00.000Z");
  });
  it("limits and filters grades to the requested course", async () => {
    const { execute } = setup(
      [],
      [
        item({ title: "First" }),
        item({ title: "Second" }),
        item({ title: "Other", courseTitle: "Other Course" }),
      ],
    );
    const result = await execute("study.grades", {
      course: "Custom",
      limit: 1,
    });
    expect(result.text).toContain("First");
    expect(result.text).not.toContain("Second");
    expect(result.text).not.toContain("Other Course");
    expect(result.text).toContain("Results are limited");
  });
  it("shows known deadlines and stale-data status without declaring unknown work late", async () => {
    const { store, execute } = setup(
      [],
      [
        item({
          title: "Due soon",
          dueAt: "2026-10-12T05:00:00.000Z",
          category: "upcoming",
        }),
        item({ title: "No known date" }),
        item({
          title: "Already graded",
          category: "graded",
          dueAt: "2026-10-12T05:00:00.000Z",
        }),
      ],
    );
    store.getLmsWork.mockResolvedValueOnce({
      ...(await store.getLmsWork()),
      stale: true,
    });
    const result = await execute("study.deadlines");
    expect(result.text).toContain("2026-10-12 10:00");
    expect(result.text).toContain("Due soon");
    expect(result.text).not.toContain("No known date");
    expect(result.text).not.toContain("Already graded");
    expect(result.text).toContain("stale");
  });
  it("only reads recorded grade changes and leaves notification delivery untouched", async () => {
    const { store, execute } = setup();
    store.assistant.listGradeChanges.mockResolvedValueOnce([
      { message: "DBMS: 8/10", createdAt: "2026-10-11T17:00:00.000Z" },
    ]);
    expect((await execute("study.changes")).text).toContain("DBMS: 8/10");
    expect(store.assistant.listGradeChanges).toHaveBeenCalledWith(user.userId, {
      since: "2026-10-04T20:30:00.000Z",
      limit: 20,
    });
    expect(Object.keys(store.assistant)).toEqual(["listGradeChanges"]);
  });
  it("fails clearly when recorded change access is unavailable", async () => {
    const { store } = setup();
    await expect(
      executeStudyTool(
        { ...store, assistant: undefined } as unknown as LifeOSStore,
        user,
        { tool: "study.changes", args: {} },
        now,
      ),
    ).rejects.toThrow("unavailable");
  });
  it("rejects invalid tools and model identity fields before calling the store", async () => {
    const { store, execute } = setup();
    await expect(
      execute("classes.today", { userId: "other-user" }),
    ).rejects.toThrow();
    expect(store.getTmaStudySummary).not.toHaveBeenCalled();
  });
});

describe("scholarship assistant summaries", () => {
  it("uses saved Moodle grades, the DBMS rubric and hypothetical ATT2 for the exam requirement", async () => {
    const c = course({
      code: "DMS52-EN",
      title: "Database Management Systems",
      calculator: builtinStudyCalculatorState("DMS52-EN"),
      scholarship: defaultScholarshipConfig(),
    });
    c.scholarship!.scenarios.realistic.periodTotals.att2 = 80;
    const f = setup([c]);
    const records = [
      {
        id: "att1",
        courseTitle: c.title,
        title: "ATT1",
        score: 72.1,
        maxScore: 100,
        updatedAt: "2026-10-11T00:00:00Z",
      },
    ];
    f.store.getTmaStudySummary.mockResolvedValue({
      timezone: user.timezone,
      courses: [c],
      records,
    } as never);
    const result = await f.execute("study.scholarship", { course: "DBMS" });
    expect(result.text).toContain("Нужный Final Exam: 60.93");
    expect(result.text).toContain("ATT2 = 80");
    expect(result.text).toContain("не гарантируют выплату");
    expect(result.text).not.toContain("internal-course");
    expect(f.store.getTmaStudySummary).toHaveBeenCalledWith(
      user.userId,
      user.timezone,
    );
  });
  it("applies an assignment-only what-if without writing settings or grades", async () => {
    const c = course({
      code: "OS52-EN",
      title: "Operating Systems",
      calculator: builtinStudyCalculatorState("OS52-EN"),
    });
    const f = setup([c]);
    const before = structuredClone(c);
    const result = await f.execute("study.scholarship", {
      assignmentScore: 70,
    });
    expect(result.text).toContain("все оставшиеся Assignments на 70");
    expect(result.text).toContain("Нужный Final Exam: 70");
    expect(c).toEqual(before);
  });
  it("still answers when deadlines are unavailable and reports missing formulas", async () => {
    const f = setup();
    f.store.getLmsWork.mockRejectedValue(new Error("unavailable"));
    const result = await f.execute("study.scholarship");
    expect(result.text).toContain("Нет подтверждённой схемы оценивания");
    expect(result.text).toContain("недостаточно данных");
  });
  it("requires an unambiguous course instead of reading unrelated subjects", async () => {
    const f = setup([
      course({ code: "DMS52-EN", title: "DBMS | A" }),
      course({ code: "DMS52-EN", title: "DBMS | B" }),
    ]);
    await expect(
      f.execute("study.scholarship", { course: "DBMS" }),
    ).rejects.toThrow("Several courses");
  });
});
