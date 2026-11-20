import { describe, expect, it } from "vitest";
import {
  calculateSyllabusMinimum,
  calculateSyllabusWorkPlan,
  defaultScholarshipConfig,
  scholarshipSyllabusEvidence,
  type ScholarshipCourseInput,
} from "./scholarship.js";
import { builtinStudyCalculatorState } from "./study-syllabi.js";
import type { StudyCalculatorState } from "./study.js";

function os() {
  const course: ScholarshipCourseInput = {
    id: "os",
    title: "Operating Systems",
    code: "OS52-EN",
    calculator: builtinStudyCalculatorState("OS52-EN"),
  };
  const config = defaultScholarshipConfig(70);
  for (const number of [1, 2, 3, 4, 5])
    config.scenarios.realistic.overrides["assignment_" + number] = 80;
  const evidence = scholarshipSyllabusEvidence(course, [
    {
      id: "m",
      courseTitle: course.title,
      title: "Midterm",
      score: 85,
      maxScore: 100,
      updatedAt: "",
    },
  ])!;
  return { evidence, config };
}

function custom(target: number, values: StudyCalculatorState["values"]) {
  const course: ScholarshipCourseInput = {
    id: "course",
    title: "Course",
    code: "C",
    calculator: {
      target,
      values,
      definition: {
        version: 1,
        sourceName: "Custom syllabus",
        attestationThreshold: 25,
        fields: [
          { id: "a", label: "A", period: "att1", weightPercent: 60 },
          { id: "b", label: "B", period: "att1", weightPercent: 40 },
          { id: "c", label: "C", period: "att2", weightPercent: 100 },
          { id: "exam", label: "Exam", period: "exam", weightPercent: 100 },
        ],
      },
    },
  };
  return {
    evidence: scholarshipSyllabusEvidence(course, [])!,
    config: defaultScholarshipConfig(target),
  };
}

describe("balanced per-work syllabus plan", () => {
  it("assigns each remaining OS assessment a usable required score", () => {
    const { evidence, config } = os();
    const plan = calculateSyllabusWorkPlan(evidence, config);
    expect(plan.possible).toBe(true);
    expect(plan.rows).toEqual(
      [
        "assignment_6",
        "assignment_7",
        "assignment_8",
        "endterm",
        "final_exam",
      ].map((id) => ({ id, forecast: null, recommended: 63.91 })),
    );
    expect(plan.projectedFinal).toBeCloseTo(70.0024, 8);
  });

  it("rebalances all other assessments when an endterm forecast is fixed, without changing earned scores", () => {
    const { evidence, config } = os();
    const forecasts = Object.freeze({
      endterm: 80,
      midterm: 0,
      assignment_1: 0,
      retired: 999,
    });
    const before = calculateSyllabusMinimum(evidence, config);
    const plan = calculateSyllabusWorkPlan(evidence, config, forecasts);
    expect(plan.rows).toEqual(
      [
        "assignment_6",
        "assignment_7",
        "assignment_8",
        "endterm",
        "final_exam",
      ].map((id) =>
        id === "endterm"
          ? { id, forecast: 80, recommended: null }
          : { id, forecast: null, recommended: 62.25 },
      ),
    );
    expect(plan.projectedFinal).toBe(70.005);
    expect(calculateSyllabusMinimum(evidence, config)).toEqual(before);
    expect(
      calculateSyllabusWorkPlan(evidence, config).rows.at(-1)?.recommended,
    ).toBe(63.91);
  });

  it("raises only the binding attestation above the common score and accounts for its contribution to the total", () => {
    const { evidence, config } = custom(35, { a: 0 });
    const plan = calculateSyllabusWorkPlan(evidence, config);
    expect(plan.possible).toBe(true);
    expect(plan.rows).toEqual([
      { id: "b", forecast: null, recommended: 62.5 },
      { id: "c", forecast: null, recommended: 39.29 },
      { id: "exam", forecast: null, recommended: 39.29 },
    ]);
    expect(plan.projectedFinal).toBe(35.003);
  });

  it("honors a zero forecast, grade cap, and an unattainable admission threshold", () => {
    const { evidence, config } = custom(70, {});
    const target = calculateSyllabusWorkPlan(evidence, config, { exam: 0 });
    expect(target.possible).toBe(false);
    expect(target.projectedFinal).toBeNull();
    expect(target.rows.every((row) => row.recommended === null)).toBe(true);
    expect(target.rows.at(-1)?.forecast).toBe(0);
    const stage = calculateSyllabusWorkPlan(evidence, config, {
      a: 0,
      b: 0,
      c: 100,
      exam: 100,
    });
    expect(stage.possible).toBe(false);
    expect(stage.projectedFinal).toBe(70);
  });

  it("returns zero for unnecessary remaining scores and the actual result for a completely fixed course", () => {
    const { evidence, config } = custom(50, { a: 100, b: 100, c: 100 });
    expect(calculateSyllabusWorkPlan(evidence, config)).toEqual({
      possible: true,
      projectedFinal: 60,
      rows: [{ id: "exam", forecast: null, recommended: 0 }],
    });
    const complete = custom(70, { a: 50, b: 50, c: 50, exam: 50 });
    expect(
      calculateSyllabusWorkPlan(complete.evidence, complete.config),
    ).toEqual({
      possible: false,
      projectedFinal: 50,
      rows: [],
    });
  });

  it.each([-1, 100.01, NaN, Infinity])(
    "rejects invalid forecasts on remaining assessments (%s)",
    (score) => {
      const { evidence, config } = os();
      expect(() =>
        calculateSyllabusWorkPlan(evidence, config, { endterm: score }),
      ).toThrow(RangeError);
    },
  );
});
