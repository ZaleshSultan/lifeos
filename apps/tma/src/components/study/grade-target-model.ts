import {
  calculateCourseGradeTarget,
  gradeEvidenceIdentity,
  type GradePolicyReview,
  type GradeTargetLmsSource,
} from "../../../../../packages/core/src/grade-target.js";
import type { StudyWorkspaceCourse } from "../../api/study-types";
import type { AcademicRecord } from "../../api/types";
import { studyScoreLabel, type StudyDraft } from "./model";

export function studyRawGradeLabel(
  record: Pick<AcademicRecord, "score" | "maxScore" | "percentage">,
): string {
  if (
    record.score !== null &&
    Number.isFinite(record.score) &&
    record.score >= 0
  ) {
    return record.maxScore !== null &&
      Number.isFinite(record.maxScore) &&
      record.maxScore > 0
      ? `${studyScoreLabel(record.score)} / ${studyScoreLabel(record.maxScore)}`
      : `${studyScoreLabel(record.score)} · максимум неизвестен`;
  }
  return record.percentage !== null &&
    Number.isFinite(record.percentage) &&
    record.percentage >= 0 &&
    record.percentage <= 100
    ? `${studyScoreLabel(record.percentage)}% (исходные баллы/максимум неизвестны)`
    : "Числовая оценка не подтверждена";
}

/** An explicit unknown selector never falls back to another owned course. */
export function studyCourseIdFromSearch(
  params: URLSearchParams,
): string | null {
  const values = params.getAll("courseId");
  return values.length > 1 ? "__invalid__" : (values[0] ?? null);
}
export function resolveOwnedStudyCourse(
  courses: StudyWorkspaceCourse[],
  requestedId: string | null | undefined,
) {
  return requestedId == null
    ? (courses.find((course) => course.calculator) ?? courses[0])
    : courses.find((course) => course.id === requestedId);
}
export function studyGradeScope(
  courses: StudyWorkspaceCourse[],
  records: AcademicRecord[],
  selectedCourseId: string | null | undefined,
) {
  const selected =
    selectedCourseId == null
      ? undefined
      : courses.find((course) => course.id === selectedCourseId);
  const unavailable = selectedCourseId != null && !selected;
  return {
    selected,
    unavailable,
    courses: unavailable ? [] : selected ? [selected] : courses,
    records: unavailable
      ? []
      : !selected
        ? records
        : records.filter((record) => {
            const identity = gradeEvidenceIdentity(record);
            return (
              identity &&
              `moodle:${identity.course}` === selected.externalCourseKey
            );
          }),
  };
}

export function courseGradeTarget(
  course: StudyWorkspaceCourse,
  records: AcademicRecord[],
  review: GradePolicyReview | undefined,
  now: string,
  lms?: GradeTargetLmsSource,
) {
  return calculateCourseGradeTarget({
    courseId: course.id,
    externalCourseKey: course.externalCourseKey,
    courseStartsOn: course.startsOn,
    courseEndsOn: course.endsOn,
    calculator: course.calculator,
    bindings: course.scholarship?.bindings ?? {},
    records,
    review,
    now,
    lms,
  });
}

/** Restoring facts changes only the local what-if draft, never LMS observations. */
export function restoreObservedDraft(
  draft: StudyDraft,
  values: Record<string, number | null>,
): StudyDraft {
  return {
    ...draft,
    inputs: Object.fromEntries(
      draft.definition.fields.map((field) => [
        field.id,
        values[field.id] === null || values[field.id] === undefined
          ? ""
          : String(values[field.id]),
      ]),
    ),
  };
}
