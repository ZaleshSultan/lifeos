import type { AcademicRecord } from "../../api/types";
import type { StudyWorkspaceCourse } from "../../api/study";
import type { StudyDraft } from "./model";
import { matchSyllabusProfile } from "./syllabus-profiles";

function normalized(value: string): string {
  return value
    .toLocaleLowerCase("ru-RU")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
export function studyGradeBelongsToCourse(
  record: AcademicRecord,
  course: StudyWorkspaceCourse,
): boolean {
  const a = normalized(record.courseTitle);
  const b = normalized(course.title);
  if (!a || !b) return false;
  if (a === b) return true;
  const recordParts = record.courseTitle.split(/\s*(?:\||[–—]|\s-\s)\s*/u);
  const courseParts = course.title.split(/\s*(?:\||[–—]|\s-\s)\s*/u);
  // A shared subject name does not make different teacher/group sections the
  // same course. Plain subject names can still match their LMS metadata suffix.
  if (
    recordParts.length > 1 &&
    courseParts.length > 1 &&
    normalized(recordParts.slice(1).join(" ")) !==
      normalized(courseParts.slice(1).join(" "))
  )
    return false;
  if (normalized(recordParts[0]) === normalized(courseParts[0])) return true;
  const p = matchSyllabusProfile(course.title, course.code);
  return p !== null && matchSyllabusProfile(record.courseTitle)?.id === p.id;
}

function matchingGrade(fieldId: string, record: AcademicRecord): boolean {
  const title = normalized(record.title);
  // Reject aggregates before parsing assignment names: Moodle also labels
  // calculated totals with names such as "Assignment 1 calculated grade".
  if (
    /calculated|register|аттестац|итог семестр|total|aggregate|average|средн/.test(
      title,
    )
  )
    return false;
  const a = /^assignment_(\d+)$/.exec(fieldId);
  if (a) {
    const matches = [
      ...title.matchAll(
        /(?:^| )(?:assignment|асаймент|задание)\s*(\d+)(?= |$)/g,
      ),
    ];
    return matches.some((match) => match[1] === a[1]);
  }
  // A bare Quiz cannot identify one of two attestation fields safely.
  if (fieldId === "quiz_1" || fieldId === "quiz_2") return false;
  if (fieldId === "midterm")
    return /(?:^| )midterm(?: |$)/.test(title) && !/assignment/.test(title);
  if (fieldId === "endterm")
    return /(?:^| )endterm(?: |$)/.test(title) && !/assignment/.test(title);
  if (fieldId === "final_exam")
    return /(?:^| )(?:final exam|final test|итоговый экзамен)(?: |$)/.test(
      title,
    );
  if (fieldId === "cisco") return /cisco certificate/.test(title);
  return false;
}

function ambiguousAssessment(title: string): boolean {
  const value = normalized(title);
  // Count identities independently of the selected definition. Otherwise an
  // aggregate containing an unknown assignment or an unqualified quiz could
  // look like a unique match for one of this course's fields.
  const identities = [
    ...value.matchAll(
      /(?:^| )(?:assignment\s*\d+|асаймент\s*\d+|задание\s*\d+|midterm|endterm|final exam|final test|итоговый экзамен|cisco certificate|quiz)(?= |$)/g,
    ),
  ];
  if (identities.length > 1) return true;
  // Moodle titles also abbreviate multiple assignments as "Assignment 1 / 2"
  // or "Assignment 1 and 2". These never represent one individual score.
  return /(?:assignment|асаймент|задание)\s*\d+\s*(?:[-–—/,&+]|\band\b|\bto\b|\bthrough\b|и|до)\s*\d+/iu.test(
    title,
  );
}

export interface GradeImportPreview {
  updates: Record<string, string>;
  matches: number;
  ambiguous: number;
  unavailable: number;
}

/**
 * Strict import of only uniquely identified, graded Moodle items.
 * Never overwrite user's non-empty scenario values or infer aggregates.
 */
export function previewMoodleGrades(
  course: StudyWorkspaceCourse,
  draft: StudyDraft,
  records: AcademicRecord[],
): GradeImportPreview {
  const candidates = records
    .filter(
      (record) =>
        studyGradeBelongsToCourse(record, course) &&
        record.rawJson?._is_mocked !== true,
    )
    .map((record) => ({
      record,
      ambiguous: ambiguousAssessment(record.title),
      fieldIds: draft.definition.fields
        .filter((field) => matchingGrade(field.id, record))
        .map((field) => field.id),
    }));
  const updates: Record<string, string> = {};
  let matches = 0;
  let ambiguous = 0;
  let unavailable = 0;
  for (const field of draft.definition.fields) {
    if ((draft.inputs[field.id] ?? "").trim()) continue;
    const found = candidates.filter(({ fieldIds }) =>
      fieldIds.includes(field.id),
    );
    if (
      found.length > 1 ||
      found.some(
        (candidate) => candidate.ambiguous || candidate.fieldIds.length > 1,
      )
    ) {
      ambiguous += 1;
      continue;
    }
    if (found.length === 0) {
      unavailable += 1;
      continue;
    }
    const row = found[0].record;
    if (
      row.score === null ||
      row.maxScore === null ||
      !Number.isFinite(row.score) ||
      !Number.isFinite(row.maxScore) ||
      row.maxScore <= 0 ||
      row.score < 0 ||
      row.score > row.maxScore
    ) {
      unavailable += 1;
      continue;
    }
    const percentage = Math.round((row.score / row.maxScore) * 10000) / 100;
    updates[field.id] = String(percentage);
    matches += 1;
  }
  return { updates, matches, ambiguous, unavailable };
}
