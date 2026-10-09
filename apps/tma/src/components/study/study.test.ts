import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("../../telegram", () => ({
  telegram: { initData: "", hapticImpact: () => {} },
}));
import type { StudyCalculatorState } from "../../../../../packages/core/src/study.js";
import type { StudyWorkspaceCourse } from "../../api/study";
import type { AcademicRecord } from "../../api/types";
import { StudyScenarioResult } from "./StudyCalculator";
import { StudyGrades } from "./StudyGrades";
import {
  createStudyDraft,
  parseStudyDraft,
  parseStudyScore,
  reconcileStudyDraft,
  studyDaySessions,
  studyDraftIsDirty,
  studyWeekday,
  studyTimezone,
  studyWallTimeToIso,
  studyIsoToWallTime,
  studySessionIsOnline,
} from "./model";
import {
  filterStudyDueItems,
  studySafeSourceUrl,
} from "./StudyWorkspacePanels";
import {
  studyTabIds,
  studyTabFromSearch,
  studyNavigationUrl,
} from "./navigation";

const scenario: StudyCalculatorState = {
  definition: {
    version: 1,
    sourceName: "Учебный план",
    attestationThreshold: 25,
    fields: [
      { id: "a1", label: "Работа 1", period: "att1", weightPercent: 100 },
      { id: "a2", label: "Работа 2", period: "att2", weightPercent: 100 },
      { id: "exam", label: "Экзамен", period: "exam", weightPercent: 100 },
    ],
  },
  values: { a1: null, a2: 0, exam: null },
  target: 80,
};

describe("study calculator form", () => {
  it("keeps unknown scores blank and a real zero editable as zero", () => {
    const draft = createStudyDraft(scenario);
    expect(draft.inputs).toEqual({ a1: "", a2: "0", exam: "" });
    expect(parseStudyDraft(draft).state).toEqual(scenario);
    expect(studyDraftIsDirty(draft)).toBe(false);
  });

  it("accepts decimal comma while rejecting out of range and nonnumeric values", () => {
    expect(parseStudyScore("82,5")).toBe(82.5);
    expect(parseStudyScore("0")).toBe(0);
    expect(parseStudyScore("100")).toBe(100);
    expect(parseStudyScore(" ")).toBeNull();
    for (const value of ["-1", "100.1", "abc", "Infinity", "1e2", "12,3,4"]) {
      expect(parseStudyScore(value)).toBe("invalid");
    }
    const draft = createStudyDraft(scenario);
    expect(parseStudyDraft({ ...draft, target: "" }).state).toBeNull();
    expect(
      parseStudyDraft({ ...draft, inputs: { ...draft.inputs, a1: "101" } })
        .invalidFields,
    ).toEqual(["a1"]);
  });

  it("preserves unsaved course inputs across background refreshes and adopts remote values after save", () => {
    const clean = createStudyDraft(scenario);
    const dirty = { ...clean, inputs: { ...clean.inputs, a1: "83" } };
    const remote = { ...scenario, values: { ...scenario.values, a1: 60 } };
    expect(studyDraftIsDirty(dirty)).toBe(true);
    expect(reconcileStudyDraft(dirty, remote)).toBe(dirty);
    expect(reconcileStudyDraft(clean, remote).inputs.a1).toBe("60");
    expect(reconcileStudyDraft(undefined, remote).inputs.a1).toBe("60");
  });

  it("renders incomplete results as unknown, preserves zero and explains the range", () => {
    const html = renderToStaticMarkup(
      createElement(StudyScenarioResult, { state: scenario }),
    );
    expect(html).toContain("Не все баллы введены");
    expect(html).toContain("Возможный итог");
    expect(html).toContain("0–70");
    expect(html).toContain("отмечена пересдача");
    expect(html).toContain("Заполни обе аттестации");
  });

  it("rounds the required exam score upward so the recommendation reaches the target", () => {
    const html = renderToStaticMarkup(
      createElement(StudyScenarioResult, {
        state: { ...scenario, values: { a1: 80.09, a2: 80, exam: null } },
      }),
    );
    expect(html).toContain("80 / 100");
    expect(html).toContain("округлён вверх до 0,1");
  });
});

describe("study navigation, raw points and timezones", () => {
  it("opens every study tab after a direct-link reload without dropping base path", () => {
    for (const tab of studyTabIds) {
      const url = studyNavigationUrl(
        "https://life.example/tma/?screen=home",
        tab,
        "course-one",
      );
      expect(new URL(url).pathname).toBe("/tma/");
      expect(new URL(url).searchParams.get("screen")).toBe("study");
      expect(new URL(url).searchParams.get("studyCourse")).toBe("course-one");
      expect(studyTabFromSearch(new URL(url).search)).toBe(tab);
    }
    expect(studyTabFromSearch("?studyTab=malicious")).toBe("today");
  });

  it("retains earned/max and actual/assumed provenance instead of flattening to percentages", () => {
    const points = {
      ...scenario,
      values: {
        a1: { earned: 15, max: 30, kind: "actual" as const, source: "Moodle" },
        a2: { earned: 90, max: 100, kind: "assumed" as const },
        exam: null,
      },
    };
    const draft = createStudyDraft(points);
    expect(draft.inputs.a1).toBe("15");
    expect(draft.maxima?.a1).toBe("30");
    expect(draft.kinds?.a1).toBe("actual");
    expect(parseStudyDraft(draft).state).toEqual(points);
    expect(
      parseStudyDraft({ ...draft, maxima: { ...draft.maxima, a1: "0" } })
        .invalidFields,
    ).toContain("a1");
    expect(
      parseStudyDraft({ ...draft, inputs: { ...draft.inputs, a1: "31" } })
        .invalidFields,
    ).toContain("a1");
  });

  it("roundtrips the raw maximum for an unknown assessment without inventing a zero grade", () => {
    const initial = createStudyDraft(scenario);
    const edited = {
      ...initial,
      maxima: { ...initial.maxima, exam: "30" },
      pointValues: { ...initial.pointValues, exam: true },
    };
    const state = parseStudyDraft(edited).state!;
    expect(state.values.exam).toBeNull();
    expect(state.maxima).toEqual({ exam: 30 });
    const reloaded = createStudyDraft(JSON.parse(JSON.stringify(state)));
    expect(reloaded.inputs.exam).toBe("");
    expect(reloaded.maxima?.exam).toBe("30");
    expect(parseStudyDraft(reloaded).state).toEqual(state);
    const html = renderToStaticMarkup(
      createElement(StudyScenarioResult, {
        state: {
          ...state,
          target: 70,
          values: { ...state.values, a1: 60, a2: 80 },
        },
        options: { selectedFieldId: "exam" },
      }),
    );
    expect(html).toContain("21 / 30");
  });

  it("uses the profile timezone for manual due dates and falls back to Astana time", () => {
    expect(studyTimezone("invalid-timezone")).toBe("Asia/Almaty");
    const iso = studyWallTimeToIso("2026-10-08T06:00", "Asia/Almaty");
    expect(iso).toBe("2026-10-08T01:00:00.000Z");
    expect(studyIsoToWallTime(iso, "Asia/Almaty")).toBe("2026-10-08T06:00");
    expect(
      studySessionIsOnline({ room: "online", sessionType: "lecture" }),
    ).toBe(true);
    expect(
      studySessionIsOnline({ room: "C1.101", sessionType: "lecture" }),
    ).toBe(false);
  });

  it("filters by profile's local day and keeps missing deadlines distinct", () => {
    const items = [
      { dueAt: "2026-10-07T23:00:00Z", status: "pending" },
      { dueAt: "2026-10-07T01:00:00Z", status: "submitted" },
      { dueAt: null, status: "pending" },
    ];
    const now = new Date("2026-10-08T01:00:00Z");
    expect(filterStudyDueItems(items, "today", "Asia/Almaty", now)).toEqual([
      items[0],
    ]);
    expect(filterStudyDueItems(items, "overdue", "Asia/Almaty", now)).toEqual([
      items[0],
    ]);
    expect(filterStudyDueItems(items, "all", "Asia/Almaty", now)).toHaveLength(
      3,
    );
    expect(studySafeSourceUrl("javascript:alert(1)")).toBeNull();
    expect(studySafeSourceUrl("https://moodle.example/assignment/1")).toContain(
      "https:",
    );
  });
});

describe("study weekly schedule", () => {
  it("selects Sunday using the user timezone instead of the browser UTC day", () => {
    const date = new Date("2026-09-26T22:00:00Z");
    expect(studyWeekday("UTC", date)).toBe("saturday");
    expect(studyWeekday("Asia/Almaty", date)).toBe("sunday");
  });

  it("sorts all selected day sessions and retains independent labs and lectures", () => {
    const course: StudyWorkspaceCourse = {
      id: "course-1",
      code: "TEST",
      title: "Тестовый курс",
      startsOn: null,
      endsOn: null,
      calculator: null,
      externalCourseKey: null,
      schedules: [
        {
          id: "late",
          dayOfWeek: "monday",
          startTime: "14:00:00",
          endTime: "15:00:00",
          room: null,
          sessionType: "lab",
          instructorName: null,
        },
        {
          id: "early",
          dayOfWeek: "monday",
          startTime: "09:00:00",
          endTime: "10:00:00",
          room: null,
          sessionType: "lecture",
          instructorName: null,
        },
        {
          id: "other",
          dayOfWeek: "tuesday",
          startTime: "08:00:00",
          endTime: "09:00:00",
          room: null,
          sessionType: null,
          instructorName: null,
        },
      ],
    };
    expect(
      studyDaySessions([course], "monday").map(({ schedule }) => schedule.id),
    ).toEqual(["early", "late"]);
    expect(studyDaySessions([course], "sunday")).toEqual([]);
  });
});

describe("study synced grades", () => {
  it("shows ungraded and zero values separately without substituting calculator values", () => {
    const record: AcademicRecord = {
      id: "grade-1",
      userId: "user-a",
      sourceEventId: null,
      courseTitle: "Тестовый курс",
      recordType: "assignment",
      title: "Работа",
      valueText: null,
      score: null,
      maxScore: 10,
      percentage: null,
      occursAt: null,
      dueAt: null,
      createdAt: "2026-09-24T00:00:00Z",
      updatedAt: "2026-09-24T00:00:00Z",
    };
    const html = renderToStaticMarkup(
      createElement(StudyGrades, {
        records: [record, { ...record, id: "grade-2", score: 0 }],
      }),
    );
    expect(html).toContain("Ещё не оценено");
    expect(html).toContain("0 / 10");
    expect(html).toContain("Значения калькулятора сохраняются отдельно");
  });
});
