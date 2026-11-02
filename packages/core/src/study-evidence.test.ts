import { describe, expect, it } from "vitest";
import { builtinStudyCalculatorState } from "./study-syllabi.js";
import {
  studyAssessmentIsAmbiguous,
  studyEvidenceExternalAsyncField,
  studyEvidenceMatchesField,
  type StudyGradeEvidence,
} from "./study-evidence.js";

const dbms = { title: "Локализованное название курса", code: "DMS52-EN" };
function record(title: string): StudyGradeEvidence {
  return {
    id: "test-evidence",
    courseTitle: dbms.title,
    title,
    score: 88,
    maxScore: 100,
    updatedAt: "2026-10-01T00:00:00Z",
  };
}

describe("DBMS external Async evidence", () => {
  it.each([
    ["Lecture Async 1", "quiz_1"],
    ["Assignment Lecture Async 1", "quiz_1"],
    ["Lecture Async 2", "quiz_2"],
    ["Assignment Lecture Async 2", "quiz_2"],
  ])("maps only the exact source assessment %s", (title, field) => {
    const evidence = record(title);
    expect(studyEvidenceExternalAsyncField(evidence, dbms)).toBe(field);
    const matched = builtinStudyCalculatorState(dbms.code)!
      .definition.fields.filter((candidate) =>
        studyEvidenceMatchesField(candidate, evidence, dbms),
      )
      .map((candidate) => candidate.id);
    expect(matched).toEqual([field]);
    expect(evidence).toEqual(record(title));
  });

  it.each([
    "Assignment 1 Lecture Async 1",
    "Quiz Lecture Async 1",
    "Assignment Lecture Async 1 Midterm",
  ])("rejects a misleading mixed assessment title %s", (title) => {
    const evidence = record(title);
    expect(studyEvidenceExternalAsyncField(evidence, dbms)).toBeNull();
    expect(studyAssessmentIsAmbiguous(title)).toBe(true);
    expect(
      builtinStudyCalculatorState(dbms.code)!.definition.fields.some((field) =>
        studyEvidenceMatchesField(field, evidence, dbms),
      ),
    ).toBe(false);
  });

  it.each([
    "Calculated Assignment Lecture Async 1",
    "Assignment Lecture Async 1 bonus",
    "Assignment Lecture Async 3",
  ])("does not loosen the explicit alias to %s", (title) => {
    expect(studyEvidenceExternalAsyncField(record(title), dbms)).toBeNull();
  });

  it("does not give another syllabus the DBMS-specific external aggregate mapping", () => {
    const evidence = record("Assignment Lecture Async 1");
    expect(
      studyEvidenceExternalAsyncField(evidence, {
        title: "Operating Systems",
        code: "OS52-EN",
      }),
    ).toBeNull();
  });
});
