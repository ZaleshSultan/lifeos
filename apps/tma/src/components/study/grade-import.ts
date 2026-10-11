import type { AcademicRecord } from "../../api/types";
import type { StudyWorkspaceCourse } from "../../api/study";
import type { StudyDraft } from "./model";
import {
  studyEvidenceBelongsToCourse,
  studyEvidenceMatchesField,
  studyEvidencePercent,
  studyAssessmentIsAmbiguous,
} from "../../../../../packages/core/src/study-evidence.js";

export const studyGradeBelongsToCourse = studyEvidenceBelongsToCourse;

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
      ambiguous:
        studyAssessmentIsAmbiguous(record.title) &&
        !draft.definition.fields.some((field) =>
          studyEvidenceMatchesField(field, record, course),
        ),
      fieldIds: draft.definition.fields
        .filter((field) =>
          studyEvidenceMatchesField(field, record, course, true),
        )
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
    const verifiedPercent = studyEvidencePercent(row);
    if (verifiedPercent === null) {
      unavailable += 1;
      continue;
    }
    const percentage = Math.round(verifiedPercent * 100) / 100;
    updates[field.id] = String(percentage);
    matches += 1;
  }
  return { updates, matches, ambiguous, unavailable };
}
