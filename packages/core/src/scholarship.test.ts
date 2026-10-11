import { describe, expect, it } from "vitest";
import {
  calculateScholarshipCourse,
  calculateScholarshipDashboard,
  defaultScholarshipConfig,
  validateScholarshipConfig,
  type ScholarshipCourseInput,
} from "./scholarship.js";
import {
  builtinStudyCalculatorState,
  syllabusProfiles,
} from "./study-syllabi.js";
import type { StudyGradeEvidence } from "./study-evidence.js";

function course(code = "DMS52-EN"): ScholarshipCourseInput {
  const profile = syllabusProfiles.find((item) => item.courseCode === code)!;
  return {
    id: code,
    code,
    title: profile.title,
    calculator: builtinStudyCalculatorState(code),
    scholarship: defaultScholarshipConfig(),
  };
}
function grade(
  c: ScholarshipCourseInput,
  title: string,
  score: number | null,
  id = title,
): StudyGradeEvidence {
  return {
    id,
    courseTitle: c.title,
    title,
    score,
    maxScore: 100,
    updatedAt: "2026-10-11T00:00:00Z",
  };
}

describe("scholarship survival planner", () => {
  it.each(syllabusProfiles.map((p) => [p.courseCode]))(
    "preserves %s syllabus weights and unknown grades",
    (code) => {
      const c = course(code);
      const plan = calculateScholarshipCourse(c, []);
      expect(plan.evidence.map((r) => r.weightInFinal)).toEqual(
        c.calculator!.definition.fields.map(
          (f) => f.weightPercent * (f.period === "exam" ? 0.4 : 0.3),
        ),
      );
      expect(plan.evidence.every((r) => r.confirmed === null)).toBe(true);
      expect(plan.minimum).toBe(0);
      expect(plan.maximum).toBe(100);
      expect(plan.requiredAverage).toBe(70);
      expect(plan.risk).toBe("unknown");
      expect(plan.scenarios!.realistic.finalScore).toBeCloseTo(70);
      expect(plan.actions).toHaveLength(c.calculator!.definition.fields.length);
      expect(plan.actions.every((a) => a.requiredUnderScenario === 70)).toBe(
        true,
      );
      expect(plan.scenarios!.realistic.requiredExam).toBe(70);
    },
  );
  it.each([
    ["DMS52-EN", 72.1, 80, 61, 70.03],
    ["OS52-EN", 66.25, 70, 73, 70.075],
  ])(
    "reproduces %s critical example with hypothetical ATT2 and real exam",
    (code, att1, att2, exam, expected) => {
      const c = course(String(code));
      c.scholarship!.scenarios.realistic.periodTotals.att2 = Number(att2);
      const plan = calculateScholarshipCourse(c, [
        grade(c, "ATT1", Number(att1)),
        grade(c, "Final Exam", Number(exam)),
      ]);
      expect(plan.scenarios!.realistic.finalScore).toBeCloseTo(
        Number(expected),
        8,
      );
      expect(plan.scenarios!.realistic.att2).toBe(att2);
      expect(plan.scenarios!.realistic.requiredExam).toBe(
        code === "DMS52-EN" ? 60.93 : 72.82,
      );
      expect(plan.scenarios!.realistic.requiredExamInteger).toBe(exam);
      expect(plan.evidence.filter((r) => r.period === "att1")).toHaveLength(1);
      expect(plan.risk).toBe("narrow");
    },
  );
  it("never turns missing values or manual predictions into confirmed zero", () => {
    const c = course();
    c.calculator!.values.assignment_1 = 100;
    const plan = calculateScholarshipCourse(c, [
      grade(c, "Assignment 2", 0),
      grade(c, "Assignment 3", null),
    ]);
    expect(plan.confirmedCount).toBe(1);
    expect(plan.minimum).toBe(0);
    expect(plan.maximum).toBe(94);
    expect(
      plan.evidence.find((r) => r.id === "assignment_1")!.confirmed,
    ).toBeNull();
    expect(
      plan.evidence.find((r) => r.id === "assignment_3")!.confirmed,
    ).toBeNull();
    expect(plan.scenarios!.realistic.manualOverrides).toBe(1);
  });
  it("recalculates after Moodle changes while preserving manual state and scenario settings", () => {
    const c = course();
    c.calculator!.values.assignment_1 = 80;
    const before = structuredClone(c);
    const first = calculateScholarshipCourse(c, [grade(c, "Assignment 1", 30)]);
    const second = calculateScholarshipCourse(c, [
      grade(c, "Assignment 1", 90),
    ]);
    expect(second.minimum! - first.minimum!).toBeCloseTo(3.6);
    expect(
      second.scenarios!.realistic.finalScore! -
        first.scenarios!.realistic.finalScore!,
    ).toBeCloseTo(3.6);
    expect(second.warnings.join(" ")).toContain("Ручные оценки сохранены");
    expect(c).toEqual(before);
  });
  it("uses independent defaults, individual overrides and the assignment-only what-if", () => {
    const c = course();
    c.scholarship!.scenarios.realistic.defaults.assignment = 40;
    c.scholarship!.scenarios.realistic.overrides.assignment_4 = 90;
    c.scholarship!.scenarios.realistic.periodTotals.att2 = 80;
    c.calculator!.values.assignment_5 = 95;
    const p = calculateScholarshipCourse(c, [], { assignmentScore: 70 });
    expect(p.scenarios!.realistic.values.assignment_1).toBe(70);
    expect(p.scenarios!.realistic.values.assignment_4).toBe(70);
    expect(p.scenarios!.realistic.values.assignment_5).toBe(70);
    expect(p.scenarios!.realistic.att2).toBe(70);
    expect(c.calculator!.values.assignment_5).toBe(95);
    expect(c.scholarship!.scenarios.realistic.periodTotals.att2).toBe(80);
    expect(p.scenarios!.pessimistic.values.midterm).toBe(50);
    expect(p.scenarios!.optimistic.values.midterm).toBe(90);
  });
  it("solves a hypothetical partial ATT2 total around fixed verified work", () => {
    const c = course();
    c.scholarship!.scenarios.realistic.periodTotals.att2 = 80;
    const p = calculateScholarshipCourse(c, [grade(c, "Assignment 4", 100)]);
    expect(p.scenarios!.realistic.values.assignment_4).toBe(100);
    expect(p.scenarios!.realistic.att2).toBeCloseTo(80);
    c.scholarship!.scenarios.realistic.periodTotals.att2 = 5;
    const impossible = calculateScholarshipCourse(c, [
      grade(c, "Assignment 4", 100),
    ]);
    expect(impossible.scenarios!.realistic.finalScore).toBeNull();
    expect(impossible.warnings.join(" ")).toContain("несовместимо");
  });
  it("requires a fully specified ATT2 hypothesis before showing an exam requirement", () => {
    const c = course();
    c.scholarship!.scenarios.realistic.defaults.quiz = null;
    expect(
      calculateScholarshipCourse(c, []).scenarios!.realistic.requiredExam,
    ).toBeNull();
    c.scholarship!.scenarios.realistic.periodTotals.att2 = 80;
    c.scholarship!.scenarios.realistic.periodTotals.att1 = 72.1;
    expect(
      calculateScholarshipCourse(c, []).scenarios!.realistic.requiredExam,
    ).toBe(60.93);
  });
  it("uses a period aggregate instead of its individual children", () => {
    const c = course();
    const p = calculateScholarshipCourse(c, [
      grade(c, "ATT1", 72.1),
      grade(c, "Assignment 1", 100),
      grade(c, "Midterm", 100),
    ]);
    expect(p.minimum).toBeCloseTo(21.63);
    expect(p.maximum).toBeCloseTo(91.63);
    expect(p.confirmedCount).toBe(1);
  });
  it("maps asynchronous DBMS work using confirmed relative points, keeping partial credit", () => {
    const c = course();
    c.scholarship!.bindings.quiz_1 = {
      mode: "weighted",
      ruleConfirmed: true,
      entries: [
        { recordId: "async1", weight: 25 },
        { recordId: "async2", weight: 75 },
      ],
    };
    const first = {
      ...grade(c, "Asynchronous work 1", 10, "async1"),
      maxScore: 10,
    };
    const second = {
      ...grade(c, "Asynchronous work 2", null, "async2"),
      maxScore: 30,
    };
    const p = calculateScholarshipCourse(c, [
      first,
      second,
      grade(c, "Quiz aggregate", 100),
    ]);
    expect(p.minimum).toBeCloseTo(0.75);
    expect(p.maximum).toBe(100);
    expect(
      p.evidence
        .filter((r) => r.originalFieldId === "quiz_1")
        .map((r) => [r.weightInFinal, r.confirmed]),
    ).toEqual([
      [0.75, 100],
      [2.25, null],
    ]);
    expect(
      p.actions.find((a) => a.fieldId === "quiz_1_part_2")!.gainPer10,
    ).toBe(0.225);
  });
  it("uses an explicitly selected Quiz aggregate alone", () => {
    const c = course();
    c.scholarship!.bindings.quiz_2 = {
      mode: "aggregate",
      ruleConfirmed: true,
      entries: [{ recordId: "total", weight: 100 }],
    };
    const p = calculateScholarshipCourse(c, [
      grade(c, "Quiz total", 80, "total"),
      grade(c, "Asynchronous work", 100),
    ]);
    expect(p.evidence.find((r) => r.id === "quiz_2")!.confirmed).toBe(80);
    expect(p.minimum).toBeCloseTo(2.4);
  });
  it("does not average asynchronous grades or mix them with aggregates by guessing", () => {
    const c = course();
    const p = calculateScholarshipCourse(c, [
      grade(c, "Asynchronous work 1", 100),
    ]);
    expect(p.confirmedCount).toBe(0);
    expect(p.warnings.join(" ")).toContain("способ подсчёта");
    c.scholarship!.bindings.quiz_1 = {
      mode: "weighted",
      ruleConfirmed: true,
      entries: [
        { recordId: "total", weight: 50 },
        { recordId: "a", weight: 50 },
      ],
    };
    const unsafe = calculateScholarshipCourse(c, [
      grade(c, "Quiz total", 80, "total"),
      grade(c, "Asynchronous work", 100, "a"),
    ]);
    expect(unsafe.minimum).toBe(0);
    expect(unsafe.warnings.join(" ")).toContain("нельзя складывать");
  });
  it("does not use ambiguous titles, mocked grades or another teacher's section", () => {
    const c = course();
    c.title += " | Teacher A";
    const p = calculateScholarshipCourse(c, [
      {
        ...grade(c, "Assignment 1", 100),
        courseTitle: c.title.replace("Teacher A", "Teacher B"),
      },
      grade(c, "Assignment 2 / 3", 100),
      { ...grade(c, "Midterm", 100), rawJson: { _is_mocked: true } },
    ]);
    expect(p.confirmedCount).toBe(0);
  });
  it("supports user formulas without changing them", () => {
    const c = course();
    const original = c.calculator!;
    original.definition = {
      ...original.definition,
      fields: [
        {
          id: "custom_a",
          label: "Seminar",
          period: "att1",
          weightPercent: 100,
        },
        {
          id: "custom_b",
          label: "Practice",
          period: "att2",
          weightPercent: 100,
        },
        { id: "final_exam", label: "Exam", period: "exam", weightPercent: 100 },
      ],
    };
    const plan = calculateScholarshipCourse(c, []);
    expect(plan.evidence.map((r) => r.weightInFinal)).toEqual([30, 30, 40]);
    expect(c.calculator).toBe(original);
  });
  it("ranks work by practical final-score gain and deadline urgency", () => {
    const c = course();
    const p = calculateScholarshipCourse(c, [], {
      now: "2026-10-11T00:00:00Z",
      work: [
        {
          title: "Assignment 1",
          courseTitle: c.title,
          dueAt: "2026-10-12T00:00:00Z",
        },
      ],
    });
    expect(p.actions[0].kind).toBe("exam");
    expect(p.actions[0].gainPer10).toBe(4);
    expect(
      p.actions.find((a) => a.fieldId === "assignment_1")!.priority,
    ).toBeGreaterThan(
      p.actions.find((a) => a.fieldId === "assignment_2")!.priority,
    );
    for (const action of p.actions) {
      expect(action.minimumIfOthers100).toBeGreaterThanOrEqual(0);
      expect(action.requiredUnderScenario).toBe(70);
    }
  });
  it("distinguishes impossible, risk, a narrow 70 result and a safer 75 result", () => {
    const c = course();
    expect(
      calculateScholarshipCourse(c, [grade(c, "Final Exam", 0)]).risk,
    ).toBe("impossible");
    expect(
      calculateScholarshipCourse(c, [grade(c, "Final Exam", 60)]).risk,
    ).toBe("at_risk");
    expect(
      calculateScholarshipCourse(c, [grade(c, "Final Exam", 70)]).risk,
    ).toBe("narrow");
    expect(
      calculateScholarshipCourse(c, [grade(c, "Final Exam", 90)]).risk,
    ).toBe("safe");
  });
  it("keeps planning targets separate from configurable eligibility policy", () => {
    const c = course();
    c.scholarship!.threshold = 75;
    const p = calculateScholarshipCourse(c, [grade(c, "Final Exam", 30)], {
      target: 80,
    });
    expect(p.maximum).toBe(72);
    expect(p.scholarshipPossible).toBe(false);
    expect(p.targetPossible).toBe(false);
  });
  it("summarizes all five courses, exclusions and missing formulas conservatively", () => {
    const courses = syllabusProfiles.map((p) => course(p.courseCode));
    courses[0].scholarship!.included = false;
    const unknown = {
      id: "unknown",
      code: "unknown",
      title: "Unknown",
      calculator: null,
    };
    const p = calculateScholarshipDashboard(
      [...courses, unknown],
      [grade(courses[1], "Final Exam", 0)],
    );
    expect(p.courses).toHaveLength(6);
    expect(p.relevantCount).toBe(5);
    expect(p.impossibleCount).toBe(1);
    expect(p.numericallyPossible).toBe(false);
    expect(
      p.priorities.every(
        (a) => a.courseId !== courses[0].id && a.courseId !== courses[1].id,
      ),
    ).toBe(true);
    expect(
      calculateScholarshipDashboard([unknown], []).numericallyPossible,
    ).toBeNull();
  });
  it("validates bounded configurations and disallows repeated evidence across components", () => {
    const c = defaultScholarshipConfig();
    expect(validateScholarshipConfig(c)).toBe(true);
    c.bindings.quiz_1 = {
      mode: "weighted",
      ruleConfirmed: true,
      entries: [{ recordId: "same", weight: 100 }],
    };
    c.bindings.quiz_2 = {
      mode: "aggregate",
      ruleConfirmed: true,
      entries: [{ recordId: "same", weight: 100 }],
    };
    expect(validateScholarshipConfig(c)).toBe(false);
    c.bindings = {};
    c.scenarios.realistic.defaults.exam = 101;
    expect(validateScholarshipConfig(c)).toBe(false);
    expect(() =>
      calculateScholarshipCourse(course(), [], { target: NaN }),
    ).toThrow();
  });
});

describe("user-confirmed DBMS Moodle rubric", () => {
  it("matches the official ATT1 72.1 exactly without adding Register twice", () => {
    const c = course();
    const records = [
      grade(c, "Assignment 1", 75),
      grade(c, "Assignment 2", 50),
      grade(c, "Assignment 3", 70),
      { ...grade(c, "Lecture Async 1", 88), rawJson: { itemtype: "category" } },
      grade(c, "Quiz Midterm", 81),
      grade(c, "Calculated grade Register Midterm", 72.1),
    ];
    const p = calculateScholarshipCourse(c, records);
    expect(p.scenarios!.realistic.att1).toBeCloseTo(72.1, 10);
    expect(p.minimum).toBe(21.63);
    expect(p.confirmedCount).toBe(5);
    expect(p.attestationChecks).toEqual([
      { period: "att1", official: 72.1, calculated: 72.1, matches: true },
    ]);
    expect(p.evidence.find((r) => r.id === "quiz_1")!.confirmed).toBe(88);
    expect(p.evidence.find((r) => r.id === "midterm")!.confirmed).toBe(81);
    expect(c.calculator!.values).toEqual({});
  });
  it("keeps an unavailable Lecture Async 2 unknown and warns about a real mismatch", () => {
    const c = course();
    const records = [
      grade(c, "Assignment 1", 75),
      grade(c, "Assignment 2", 50),
      grade(c, "Assignment 3", 70),
      grade(c, "Lecture Async 1", 88),
      grade(c, "Quiz Midterm", 80),
      grade(c, "Lecture Async 2", null),
      grade(c, "Calculated grade Register Midterm", 72.1),
    ];
    const p = calculateScholarshipCourse(c, records);
    expect(p.evidence.find((r) => r.id === "quiz_2")!.confirmed).toBeNull();
    expect(p.attestationChecks[0].matches).toBe(false);
    expect(p.warnings.join(" ")).toContain("расходится");
  });
  it("does not apply the special Async or Quiz Midterm names to OS", () => {
    const c = course("OS52-EN");
    const p = calculateScholarshipCourse(c, [
      grade(c, "Lecture Async 1", 88),
      grade(c, "Quiz Midterm", 81),
    ]);
    expect(p.confirmedCount).toBe(0);
  });
});

describe("per-course numerical regression with verified work", () => {
  it.each([
    ["DMS52-EN", "quiz_1", "Lecture Async 1", 88, 2.64, 99.64, 69.5, 68.65],
    ["DLD52-EN", "assignment_1", "Assignment 1", 90, 5.4, 99.4, 68.8, 67],
    ["CNC53-EN", "assignment_5", "Assignment 5", 80, 3.6, 99.1, 69.6, 68.88],
    ["OS52-EN", "assignment_8", "Assignment 8", 50, 3, 97, 71.3, 73],
    [
      "K(RUSSIAN)L51-RU",
      "att1_work",
      "Работы ATT1",
      80,
      14.4,
      96.4,
      67.9,
      65.5,
    ],
  ])(
    "calculates bounds and required exam for %s",
    (code, field, title, value, minimum, maximum, average, exam) => {
      const c = course(String(code));
      if (code === "K(RUSSIAN)L51-RU")
        c.scholarship!.bindings[String(field)] = {
          mode: "aggregate",
          ruleConfirmed: true,
          entries: [{ recordId: "verified", weight: 100 }],
        };
      const p = calculateScholarshipCourse(c, [
        grade(c, String(title), Number(value), "verified"),
      ]);
      expect(p.minimum).toBeCloseTo(Number(minimum), 8);
      expect(p.maximum).toBeCloseTo(Number(maximum), 8);
      expect(p.requiredAverage).toBe(average);
      expect(p.scenarios!.realistic.requiredExam).toBe(exam);
    },
  );
  it("ignores bindings for removed formula fields instead of stealing current grades", () => {
    const c = course();
    c.scholarship!.bindings.removed_field = {
      mode: "aggregate",
      ruleConfirmed: true,
      entries: [{ recordId: "a1", weight: 100 }],
    };
    const p = calculateScholarshipCourse(c, [
      grade(c, "Assignment 1", 90, "a1"),
    ]);
    expect(p.evidence.find((r) => r.id === "assignment_1")!.confirmed).toBe(90);
    expect(p.warnings.join(" ")).toContain("Устаревшие сопоставления");
  });
});

it("handles custom field IDs and long Moodle titles without invalid expanded formulas", () => {
  const c = course();
  c.calculator!.definition = {
    ...c.calculator!.definition,
    fields: [
      { id: "quiz_1", label: "Async", period: "att1", weightPercent: 50 },
      {
        id: "quiz_1_part_1",
        label: "Independent work",
        period: "att1",
        weightPercent: 50,
      },
      { id: "att2", label: "ATT2", period: "att2", weightPercent: 100 },
      { id: "final_exam", label: "Exam", period: "exam", weightPercent: 100 },
    ],
  };
  c.scholarship!.bindings.quiz_1 = {
    mode: "weighted",
    ruleConfirmed: true,
    entries: [{ recordId: "long", weight: 100 }],
  };
  const plan = calculateScholarshipCourse(c, [
    grade(c, "Lecture details " + "x".repeat(350), 80, "long"),
  ]);
  expect(plan.minimum).toBe(12);
  expect(plan.evidence.every((row) => row.label.length <= 300)).toBe(true);
  expect(new Set(plan.evidence.map((row) => row.id)).size).toBe(
    plan.evidence.length,
  );
});

it("links an upcoming Assignment deadline when the ungraded gradebook title has fewer details", () => {
  const c = course();
  const dueAt = "2026-10-12T00:00:00Z";
  const p = calculateScholarshipCourse(c, [grade(c, "Assignment 4", null)], {
    now: "2026-10-11T00:00:00Z",
    work: [{ title: "Assignment 4: ERD diagram", courseTitle: c.title, dueAt }],
  });
  const action = p.actions.find((row) => row.fieldId === "assignment_4")!;
  expect(action.dueAt).toBe(dueAt);
  expect(
    p.evidence.find((row) => row.id === "assignment_4")!.confirmed,
  ).toBeNull();
  expect(action.priority).toBeGreaterThan(
    p.actions.find((row) => row.fieldId === "assignment_5")!.priority,
  );
});
