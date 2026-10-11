import { describe, expect, it } from "vitest";
import { validateStudyCalculatorDefinition } from "../../../../../packages/core/src/study.js";
import { createStudyDraft } from "./model";
import { previewMoodleGrades } from "./grade-import";
import { matchSyllabusProfile, syllabusProfiles } from "./syllabus-profiles";
import type { StudyWorkspaceCourse } from "../../api/study";
import type { AcademicRecord } from "../../api/types";

describe("2026–2027 grading syllabus profiles", () => {
  it("contains only valid 30/30/40 calculator definitions", () => {
    expect(syllabusProfiles).toHaveLength(5);
    for (const profile of syllabusProfiles) {
      expect(validateStudyCalculatorDefinition(profile.definition)).toBe(true);
      expect(
        profile.definition.fields.filter((f) => f.period === "exam"),
      ).toHaveLength(1);
      expect(
        profile.definition.fields.find((f) => f.period === "exam")
          ?.weightPercent,
      ).toBe(100);
    }
  });

  it("uses syllabus-specific weights instead of a shared fake formula", () => {
    const db = syllabusProfiles.find((p) => p.id === "dbms")!;
    expect(
      db.definition.fields
        .filter((f) => f.period === "att1")
        .map((f) => f.weightPercent),
    ).toEqual([20, 20, 20, 10, 30]);
    const dld = syllabusProfiles.find((p) => p.id === "dld")!;
    expect(
      dld.definition.fields
        .filter((f) => f.period === "att1")
        .map((f) => f.weightPercent),
    ).toEqual([20, 20, 20, 40]);
    const cn = syllabusProfiles.find((p) => p.id === "networks")!;
    expect(
      cn.definition.fields
        .filter((f) => f.period === "att2")
        .map((f) => f.weightPercent),
    ).toEqual([15, 15, 15, 15, 10, 30]);
    const os = syllabusProfiles.find((p) => p.id === "os")!;
    expect(
      os.definition.fields
        .filter((f) => f.period === "att1")
        .map((f) => f.weightPercent),
    ).toEqual([20, 20, 20, 20, 20]);
    const ru = syllabusProfiles.find((p) => p.id === "russian")!;
    expect(
      ru.definition.fields
        .filter((f) => f.period === "att2")
        .map((f) => f.weightPercent),
    ).toEqual([60, 40]);
  });

  it("preserves every exact assessment label in both attestations", () => {
    const expected: Record<string, string[][]> = {
      dbms: [
        ["Assignment 1", "Assignment 2", "Assignment 3", "Quiz", "Midterm"],
        ["Assignment 4", "Assignment 5", "Assignment 6", "Quiz", "Endterm"],
      ],
      dld: [
        ["Assignment 1", "Assignment 2", "Assignment 3", "Midterm"],
        ["Assignment 4", "Assignment 5", "Assignment 6", "Endterm"],
      ],
      networks: [
        [
          "Assignment 1",
          "Assignment 2",
          "Assignment 3",
          "Assignment 4",
          "Midterm",
        ],
        [
          "Assignment 5",
          "Assignment 6",
          "Assignment 7",
          "Assignment 8",
          "Cisco certificate",
          "Endterm",
        ],
      ],
      os: [
        [
          "Assignment 1",
          "Assignment 2",
          "Assignment 3",
          "Assignment 4",
          "Midterm",
        ],
        [
          "Assignment 5",
          "Assignment 6",
          "Assignment 7",
          "Assignment 8",
          "Endterm",
        ],
      ],
      russian: [
        ["Задание", "Рубежный контроль"],
        ["Задание", "Рубежный контроль"],
      ],
    };
    for (const profile of syllabusProfiles) {
      expect(
        ["att1", "att2"].map((period) =>
          profile.definition.fields
            .filter((field) => field.period === period)
            .map((field) => field.label),
        ),
      ).toEqual(expected[profile.id]);
    }
  });

  it("selects only matching academic subjects", () => {
    expect(
      matchSyllabusProfile("Database Management Systems | Tankeyev Samat")?.id,
    ).toBe("dbms");
    expect(
      matchSyllabusProfile("Operating Systems | Seilkhanova Kymbat")?.id,
    ).toBe("os");
    expect(matchSyllabusProfile("Русский язык C1_4")?.id).toBe("russian");
    expect(matchSyllabusProfile("Unknown statistics course")).toBeNull();
  });
});

describe("safe optional Moodle grade import", () => {
  const profile = syllabusProfiles[0];
  const course = {
    id: "course-1",
    title: "Database Management Systems",
    code: "DBMS",
    calculator: null,
    schedules: [],
    startsOn: null,
    endsOn: null,
    externalCourseKey: null,
  } satisfies StudyWorkspaceCourse;
  const draft = createStudyDraft({
    definition: profile.definition,
    values: {},
    target: 70,
  });
  const grade = (id: string, title: string, score: number): AcademicRecord => ({
    id,
    userId: "u",
    sourceEventId: null,
    courseTitle: "Database Management Systems | Teacher",
    recordType: "assignment",
    title,
    valueText: null,
    score,
    maxScore: 100,
    percentage: score,
    occursAt: null,
    dueAt: null,
    createdAt: "2026-10-10T00:00:00Z",
    updatedAt: "2026-10-10T00:00:00Z",
  });

  it("imports the confirmed DBMS rubric into an empty calculator and preserves manual edits", () => {
    const rows = [
      grade("a1", "Assignment 1", 75),
      grade("a2", "Assignment 2", 50),
      grade("a3", "Assignment 3", 70),
      {
        ...grade("q1", "Lecture Async 1", 88),
        rawJson: { itemtype: "category" },
      },
      grade("m", "Quiz Midterm", 81),
      grade("total", "Calculated grade Register Midterm", 72.1),
      { ...grade("q2", "Lecture Async 2", 0), score: null },
    ];
    const preview = previewMoodleGrades(course, draft, rows);
    expect(preview.updates).toEqual({
      assignment_1: "75",
      assignment_2: "50",
      assignment_3: "70",
      quiz_1: "88",
      midterm: "81",
    });
    expect(preview.updates.quiz_2).toBeUndefined();
    const manual = {
      ...draft,
      inputs: { ...draft.inputs, quiz_1: "65", midterm: "60" },
    };
    const safe = previewMoodleGrades(course, manual, rows);
    expect(safe.updates.quiz_1).toBeUndefined();
    expect(safe.updates.midterm).toBeUndefined();
  });

  it("accepts exact unique assignments but refuses ambiguous duplicates", () => {
    const preview = previewMoodleGrades(course, draft, [
      grade("a", "Assignment 1", 90),
      grade("b", "Assignment 1", 60),
      grade("c", "Assignment 2", 70),
    ]);
    expect(preview.ambiguous).toBe(1);
    expect(preview.updates.assignment_1).toBeUndefined();
    expect(preview.updates.assignment_2).toBe("70");
    expect(preview.matches).toBe(1);
  });

  it("never interprets a calculated register midterm as a single assessment", () => {
    const preview = previewMoodleGrades(course, draft, [
      grade("m", "Calculated grade Register Midterm", 76.4),
    ]);
    expect(preview.updates.midterm).toBeUndefined();
    expect(preview.matches).toBe(0);
  });

  it("rejects calculated assignment totals before matching their assignment numbers", () => {
    const preview = previewMoodleGrades(course, draft, [
      grade("a", "Assignment 1 calculated grade", 90),
      grade("b", "Assignment 2 total", 80),
      grade("c", "Assignment 3 average", 75),
    ]);
    expect(preview.updates).toEqual({});
  });

  it("never guesses a multi-assignment aggregate, lab alias or unqualified quiz", () => {
    const preview = previewMoodleGrades(course, draft, [
      grade("a", "Assignment 1 and Assignment 2", 85),
      grade("b", "Lab 3", 90),
      grade("q", "Quiz", 80),
    ]);
    expect(preview.ambiguous).toBe(2);
    expect(preview.updates).toEqual({});
  });

  it("keeps duplicate items ambiguous even if one duplicate has no published grade", () => {
    const preview = previewMoodleGrades(course, draft, [
      grade("a", "Assignment 1", 90),
      { ...grade("b", "Assignment 1", 0), score: null, percentage: null },
    ]);
    expect(preview.ambiguous).toBe(1);
    expect(preview.updates.assignment_1).toBeUndefined();
  });

  it.each([
    "Assignment 1 / 2",
    "Assignment 1–3",
    "Assignment 1, 2",
    "Assignment 1 and 2",
    "Assignment 1 and Assignment 99",
    "Assignment 1 + Quiz",
    "Midterm / Quiz",
  ])("does not infer an individual grade from %s", (title) => {
    const preview = previewMoodleGrades(course, draft, [
      grade("aggregate", title, 85),
    ]);
    expect(preview.updates).toEqual({});
    expect(preview.matches).toBe(0);
    expect(preview.ambiguous).toBeGreaterThan(0);
  });

  it("normalizes unique item grades to percentages while retaining descriptive labels", () => {
    const preview = previewMoodleGrades(course, draft, [
      { ...grade("a", "Assignment 1: ERD Diagram", 17), maxScore: 20 },
      { ...grade("b", "Midterm Exam", 35), maxScore: 50 },
    ]);
    expect(preview.updates).toEqual({ assignment_1: "85", midterm: "70" });
    expect(preview.matches).toBe(2);
  });

  it("distinguishes actual zero from missing, invalid and mocked grades", () => {
    const preview = previewMoodleGrades(course, draft, [
      grade("zero", "Assignment 1", 0),
      { ...grade("missing", "Assignment 2", 0), score: null, percentage: null },
      { ...grade("unbounded", "Assignment 3", 50), maxScore: null },
      { ...grade("invalid", "Assignment 4", Number.NaN), percentage: null },
      { ...grade("mocked", "Assignment 5", 85), rawJson: { _is_mocked: true } },
      {
        ...grade("different", "Assignment 6", 90),
        courseTitle: "Digital Logic Design",
      },
    ]);
    expect(preview.updates).toEqual({ assignment_1: "0" });
    expect(preview.matches).toBe(1);
  });

  it("does not import grades from similarly named subjects or a different known course section", () => {
    expect(
      previewMoodleGrades(course, draft, [
        {
          ...grade("a", "Assignment 1", 90),
          courseTitle: "Database Management Systems Advanced",
        },
      ]).updates,
    ).toEqual({});
    expect(
      previewMoodleGrades(
        { ...course, title: "Database Management Systems | Teacher A" },
        draft,
        [
          {
            ...grade("b", "Assignment 1", 90),
            courseTitle: "Database Management Systems | Teacher B",
          },
        ],
      ).updates,
    ).toEqual({});
  });

  it("never overwrites explicitly entered scenario values", () => {
    const preview = previewMoodleGrades(
      course,
      {
        ...draft,
        inputs: { ...draft.inputs, assignment_1: "88" },
      },
      [grade("a", "Assignment 1", 90)],
    );
    expect(preview.updates.assignment_1).toBeUndefined();
  });
});
