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

describe("Moodle activity labels in published gradebook names", () => {
  const networks = { title: "Computer Networks", code: "CNC53-EN" };
  const dld = { title: "Digital Logic Design", code: "DLD52-EN" };
  const ru = { title: "Русский язык C1", code: "K(RUSSIAN)L51-RU" };
  function observed(
    title: string,
    module: string,
    itemName = title,
  ): StudyGradeEvidence {
    return {
      ...record(title),
      rawJson: { moodle_module: module, item_name: itemName },
    };
  }
  function fields(course: typeof networks, evidence: StudyGradeEvidence) {
    return builtinStudyCalculatorState(course.code)!
      .definition.fields.filter((field) =>
        studyEvidenceMatchesField(field, evidence, course),
      )
      .map((field) => field.id);
  }
  it.each([
    ["Assignment Assignment 3 OS Concepts", "assign", "assignment_3"],
    ["Assignment Midterm", "assign", "midterm"],
    ["Assignment Endterm", "assign", "endterm"],
    ["Assignment Cisco course certificate", "assign", "cisco"],
    ["Quiz Final test", "quiz", "final_exam"],
    ["Assignment Final exam", "assign", "final_exam"],
  ])("recognizes a corroborated activity header in %s", (title, module, id) => {
    expect(fields(networks, observed(title, module))).toEqual([id]);
  });
  it.each([
    ["Quiz Assignment 6 XYZ", "assignment_6"],
    ["Quiz Midterm XYZ", "midterm"],
    ["Quiz Endterm XYZ", "endterm"],
  ])(
    "retains a course identifier after the DLD work name in %s",
    (title, id) => {
      expect(fields(dld, observed(title, "quiz"))).toEqual([id]);
    },
  );
  it.each([
    ["Assignment РК 1", "att1_control"],
    ["Assignment Рубежный контроль 2", "att2_control"],
    ["Assignment Задание 1", "att1_work"],
    ["Assignment Задание 2", "att2_work"],
  ])("uses the explicit assessment type and period in %s", (title, id) => {
    expect(fields(ru, observed(title, "assign"))).toEqual([id]);
  });
  it("does not infer the semester from unnumbered Russian or out-of-range work names", () => {
    for (const title of [
      "Assignment РК",
      "Assignment Задание",
      "Assignment Задание 3",
      "Assignment РК 1 и 2",
    ])
      expect(fields(ru, observed(title, "assign"))).toEqual([]);
  });
  it("accepts corroborating raw names with or without the activity type", () => {
    expect(
      fields(
        dld,
        observed("Quiz Assignment 6 XYZ", "quiz", "Assignment 6 XYZ"),
      ),
    ).toEqual(["assignment_6"]);
    expect(fields(dld, observed("Assignment 6 XYZ", "assign"))).toEqual([
      "assignment_6",
    ]);
    expect(
      fields(dld, observed("Quiz Midterm XYZ", "quiz", "Endterm XYZ")),
    ).toEqual([]);
    expect(fields(dld, record("Quiz Midterm XYZ"))).toEqual([]);
  });
  it("keeps established Cisco and assignment titles containing normal topic words", () => {
    expect(fields(networks, record("Cisco Certificate CCNA"))).toEqual([
      "cisco",
    ]);
    expect(
      fields(
        networks,
        observed("Assignment Cisco course certificate CCNA", "assign"),
      ),
    ).toEqual(["cisco"]);
    expect(fields(networks, record("Cisco Certificated"))).toEqual([]);
    for (const title of [
      "Assignment 1 SQL Practice",
      "Assignment 1 Mock Objects",
      "Assignment 1 Salary Bonus",
    ])
      expect(fields(networks, record(title))).toEqual(["assignment_1"]);
    for (const title of [
      "Practice Final Exam",
      "Mock Midterm",
      "Final Exam Practice Test",
      "Endterm Bonus",
    ])
      expect(fields(networks, record(title))).toEqual([]);
  });
  it("excludes alternative attempts and multi-component names, including records without Moodle metadata", () => {
    for (const title of [
      "Quiz Final test FX",
      "Assignment Final exam FX",
      "Quiz Midterm retake",
      "Quiz Assignment 6 make-up",
      "Assignment Final exam пересдача",
      "Assignment Midterm 2",
      "Quiz Assignment 2 / 3",
      "Quiz Midterm Endterm",
    ]) {
      expect(
        fields(
          dld,
          observed(title, title.startsWith("Quiz") ? "quiz" : "assign"),
        ),
      ).toEqual([]);
      expect(fields(dld, record(title))).toEqual([]);
    }
  });
});
