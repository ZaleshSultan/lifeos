import type { AcademicRecord } from "../../api/types";
import type { StudyWorkspaceCourse } from "../../api/study";
import type { StudyDraft } from "./model";
import { matchSyllabusProfile } from "./syllabus-profiles";

function normalized(value: string): string {
  return value.toLocaleLowerCase("ru-RU").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
function belongsToCourse(record: AcademicRecord, course: StudyWorkspaceCourse): boolean {
  const a = normalized(record.courseTitle);
  const b = normalized(course.title);
  if (a === b || a.startsWith(b + " ") || b.startsWith(a + " ")) return true;
  const p = matchSyllabusProfile(course.title, course.code);
  return p !== null && matchSyllabusProfile(record.courseTitle)?.id === p.id;
}

function matchingGrade(fieldId: string, record: AcademicRecord): boolean {
  const title = normalized(record.title);
  const a = /^assignment_(\d+)$/.exec(fieldId);
  if (a) {
    const m = /(?:^| )(?:assignment|асаймент|задание|lab)\s*(\d+)(?: |$)/.exec(title);
    return Boolean(m && m[1] === a[1]);
  }
  // A single quiz is NOT assumed to equal the weighted quiz aggregate.
  if (fieldId === "quiz_1" || fieldId === "quiz_2") return false;
  // Semester totals and "calculated grade" often have a different weight and
  // must not be treated as individual assessment scores.
  if (/calculated|register|аттестац|итог семестр|total/.test(title)) return false;
  if (fieldId === "midterm") return /(?:^| )midterm(?: |$)/.test(title) && !/assignment/.test(title);
  if (fieldId === "endterm") return /(?:^| )endterm(?: |$)/.test(title) && !/assignment/.test(title);
  if (fieldId === "final_exam") return /(?:^| )(?:final exam|final test|итоговый экзамен)(?: |$)/.test(title);
  if (fieldId === "cisco") return /cisco certificate/.test(title);
  return false;
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
  const suitable = records.filter((record) =>
    belongsToCourse(record, course) &&
    record.rawJson?._is_mocked !== true &&
    record.score !== null &&
    record.maxScore !== null &&
    record.maxScore > 0 &&
    record.score >= 0 &&
    record.score <= record.maxScore);
  const updates: Record<string, string> = {};
  let matches = 0;
  let ambiguous = 0;
  let unavailable = 0;
  for (const field of draft.definition.fields) {
    if ((draft.inputs[field.id] ?? "").trim()) continue;
    const found = suitable.filter((record) => matchingGrade(field.id, record));
    if (found.length > 1) { ambiguous += 1; continue; }
    if (found.length === 0) { unavailable += 1; continue; }
    const row = found[0];
    const percentage = Math.round((row.score! / row.maxScore!) * 10000) / 100;
    updates[field.id] = String(percentage);
    matches += 1;
  }
  return { updates, matches, ambiguous, unavailable };
}
