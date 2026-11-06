import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { calculateCourseGradeTarget } from "../../../../../packages/core/src/grade-target.js";
import { syllabusProfiles } from "./syllabus-profiles";
import { createStudyDraft } from "./model";
import {
  restoreObservedDraft,
  resolveOwnedStudyCourse,
  studyGradeScope,
  studyCourseIdFromSearch,
  studyRawGradeLabel,
} from "./grade-target-model";
import type { StudyWorkspaceCourse } from "../../api/study-types";
import type { AcademicRecord } from "../../api/types";
import { CourseGradeTargetCard } from "./CourseGradeTargetCard";

describe("course grade observations and simulation", () => {
  const definition = syllabusProfiles[0].definition;
  it.each([
    [{ score: 15, maxScore: 30, percentage: 50 }, "15 / 30"],
    [
      { score: 24, maxScore: null, percentage: null },
      "24 · максимум неизвестен",
    ],
    [
      { score: null, maxScore: null, percentage: 80 },
      "80% (исходные баллы/максимум неизвестны)",
    ],
    [
      { score: null, maxScore: null, percentage: null },
      "Числовая оценка не подтверждена",
    ],
    [
      { score: null, maxScore: null, percentage: 120 },
      "Числовая оценка не подтверждена",
    ],
  ] as const)("keeps raw grade units explicit", (record, expected) => {
    expect(studyRawGradeLabel(record)).toBe(expected);
  });
  it("rejects duplicate course selectors instead of choosing the first", () => {
    expect(studyCourseIdFromSearch(new URLSearchParams())).toBeNull();
    expect(studyCourseIdFromSearch(new URLSearchParams("courseId=owned"))).toBe(
      "owned",
    );
    expect(
      studyCourseIdFromSearch(
        new URLSearchParams("courseId=owned&courseId=foreign"),
      ),
    ).toBe("__invalid__");
  });
  it("never falls back from an explicit unavailable course and scopes facts by stable Moodle identity", () => {
    const courses: StudyWorkspaceCourse[] = ["42", "43"].map((id) => ({
      id: `owned-${id}`,
      code: "DEMO",
      title: "Same title",
      startsOn: null,
      endsOn: null,
      externalCourseKey: `moodle:${id}`,
      schedules: [],
      calculator: { definition, values: {}, target: 70 },
    }));
    const records: AcademicRecord[] = ["42", "43"].map((id) => ({
      id,
      userId: "synthetic-owner",
      sourceEventId: null,
      recordType: "assignment",
      title: "Synthetic grade",
      valueText: null,
      score: 15,
      maxScore: 30,
      percentage: 50,
      occursAt: null,
      dueAt: null,
      createdAt: "2026-11-06T00:00:00Z",
      updatedAt: "2026-11-06T00:00:00Z",
      courseTitle: "Same title",
      rawJson: { moodle_course_id: id, moodle_item_id: "101" },
    }));
    expect(resolveOwnedStudyCourse(courses, "foreign")).toBeUndefined();
    expect(resolveOwnedStudyCourse(courses, "")).toBeUndefined();
    expect(resolveOwnedStudyCourse(courses, null)?.id).toBe("owned-42");
    expect(
      studyGradeScope(courses, records, "owned-43").records.map(
        (row) => row.id,
      ),
    ).toEqual(["43"]);
    expect(studyGradeScope(courses, records, "foreign")).toMatchObject({
      unavailable: true,
      records: [],
      courses: [],
    });
    expect(studyGradeScope(courses, records, null).records).toHaveLength(2);
  });
  it("restores only observed fields in the local draft without changing actuals, target or saved signature", () => {
    const draft = createStudyDraft({ definition, values: {}, target: 80 });
    draft.inputs[definition.fields[0].id] = "99";
    const values = {
      [definition.fields[0].id]: 0,
      [definition.fields[1].id]: 50,
    };
    const before = structuredClone({ draft, values });
    const restored = restoreObservedDraft(draft, values);
    expect(restored.inputs[definition.fields[0].id]).toBe("0");
    expect(restored.inputs[definition.fields[1].id]).toBe("50");
    expect(restored.inputs[definition.fields[2].id]).toBe("");
    expect(restored.target).toBe("80");
    expect(restored.saved).toBe(draft.saved);
    expect({ draft, values }).toEqual(before);
  });
  it("renders conservative conditional forecasts and separate fixed hypotheses", () => {
    const result = calculateCourseGradeTarget({
      courseId: "owned",
      externalCourseKey: null,
      calculator: { definition, values: {}, target: 70 },
      bindings: {},
      records: [],
      now: "2026-11-06T00:00:00Z",
    });
    const html = renderToStaticMarkup(
      createElement(CourseGradeTargetCard, {
        title: "Course <script>",
        result,
        onReview: () => {},
      }),
    );
    expect(html).toContain("Условный план");
    expect(html).toContain("Неизвестно");
    expect(html).toContain("70");
    expect(html).toContain("85");
    expect(html).toContain("100");
    expect(html).toContain("Нет бонусов");
    expect(html).toContain("текущий курс и семестр");
    expect(html).not.toContain("Гарантировано");
    expect(html).not.toContain("<script>");
    expect(html).toContain("disabled");
  });
  it("renders no mathematical guarantee when weights are unknown", () => {
    const result = calculateCourseGradeTarget({
      courseId: "owned",
      externalCourseKey: null,
      calculator: null,
      bindings: {},
      records: [],
      now: "2026-11-06T00:00:00Z",
    });
    const html = renderToStaticMarkup(
      createElement(CourseGradeTargetCard, { title: "Course", result }),
    );
    expect(html).toContain("Нет проверенной структуры весов");
    expect(html).not.toContain("Цель математически достижима");
    expect(html).not.toContain("Диапазон итога");
  });
});
