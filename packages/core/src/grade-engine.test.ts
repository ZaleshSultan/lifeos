import { describe, expect, it } from "vitest";
import {
  calculateGrade,
  type GradeAssessmentInput,
} from "./grade-engine.js";

describe("calculateGrade", () => {
  const referenceAssessments: GradeAssessmentInput[] = [
    {
      weightPercent: 25,
      maxScore: null,
      actualScore: 80,
      status: "graded",
    },
    {
      weightPercent: 20,
      maxScore: null,
      actualScore: 90,
      status: "graded",
    },
    {
      weightPercent: 20,
      maxScore: null,
      actualScore: null,
      status: "pending",
    },
    {
      weightPercent: 35,
      maxScore: null,
      actualScore: null,
      status: "pending",
    },
  ];

  it("calculates reference example correctly without targetGrade", () => {
    const result = calculateGrade(referenceAssessments);

    expect(result.totalWeightPercent).toBe(100);
    expect(result.completedWeightPercent).toBe(45);
    expect(result.remainingWeightPercent).toBe(55);
    expect(result.earnedWeightedPercent).toBe(38);
    expect(result.currentGrade).not.toBeNull();
    expect(result.currentGrade!).toBeCloseTo(84.4444, 4);
    expect(result.projectedFinalGrade).not.toBeNull();
    expect(result.projectedFinalGrade!).toBeCloseTo(84.4444, 4);
    expect(result.requiredAverageOnRemaining).toBeNull();
    expect(result.targetAchieved).toBe(false);
    expect(result.targetImpossible).toBe(false);
  });

  it("evaluates targetGrade = 90 in reference example (achievable, not yet achieved)", () => {
    const result = calculateGrade(referenceAssessments, 90);

    expect(result.requiredAverageOnRemaining).not.toBeNull();
    expect(result.requiredAverageOnRemaining!).toBeCloseTo(94.5455, 4);
    expect(result.targetAchieved).toBe(false);
    expect(result.targetImpossible).toBe(false);
  });

  it("evaluates targetGrade = 95 in reference example (impossible)", () => {
    const result = calculateGrade(referenceAssessments, 95);

    expect(result.requiredAverageOnRemaining).not.toBeNull();
    expect(result.requiredAverageOnRemaining!).toBeCloseTo(103.6364, 4);
    expect(result.targetAchieved).toBe(false);
    expect(result.targetImpossible).toBe(true);
  });

  it("evaluates targetGrade = 30 in reference example (already achieved)", () => {
    const result = calculateGrade(referenceAssessments, 30);

    expect(result.requiredAverageOnRemaining).not.toBeNull();
    expect(result.requiredAverageOnRemaining!).toBeLessThanOrEqual(0);
    expect(result.requiredAverageOnRemaining!).toBeCloseTo(-14.5455, 4);
    expect(result.targetAchieved).toBe(true);
    expect(result.targetImpossible).toBe(false);
  });

  it("handles empty assessments array without targetGrade", () => {
    const result = calculateGrade([]);

    expect(result.totalWeightPercent).toBe(0);
    expect(result.completedWeightPercent).toBe(0);
    expect(result.remainingWeightPercent).toBe(0);
    expect(result.earnedWeightedPercent).toBe(0);
    expect(result.currentGrade).toBeNull();
    expect(result.projectedFinalGrade).toBeNull();
    expect(result.requiredAverageOnRemaining).toBeNull();
    expect(result.targetAchieved).toBe(false);
    expect(result.targetImpossible).toBe(false);
  });

  it("handles empty assessments array with targetGrade", () => {
    const result = calculateGrade([], 80);

    expect(result.totalWeightPercent).toBe(0);
    expect(result.completedWeightPercent).toBe(0);
    expect(result.remainingWeightPercent).toBe(0);
    expect(result.earnedWeightedPercent).toBe(0);
    expect(result.currentGrade).toBeNull();
    expect(result.projectedFinalGrade).toBeNull();
    expect(result.requiredAverageOnRemaining).toBeNull();
    expect(result.targetAchieved).toBe(false);
    expect(result.targetImpossible).toBe(true);
  });

  it("handles all assessments graded with remainingWeightPercent = 0 and no target given", () => {
    const assessments: GradeAssessmentInput[] = [
      {
        weightPercent: 40,
        maxScore: null,
        actualScore: 85,
        status: "graded",
      },
      {
        weightPercent: 60,
        maxScore: null,
        actualScore: 95,
        status: "graded",
      },
    ];

    const result = calculateGrade(assessments);

    expect(result.totalWeightPercent).toBe(100);
    expect(result.completedWeightPercent).toBe(100);
    expect(result.remainingWeightPercent).toBe(0);
    expect(result.earnedWeightedPercent).toBe(91); // 40*0.85 + 60*0.95 = 34 + 57 = 91
    expect(result.currentGrade).toBe(91);
    expect(result.projectedFinalGrade).toBe(result.currentGrade);
    expect(result.requiredAverageOnRemaining).toBeNull();
    expect(result.targetAchieved).toBe(false);
    expect(result.targetImpossible).toBe(false);
  });

  it("handles all assessments graded when targetGrade is evaluated", () => {
    const assessments: GradeAssessmentInput[] = [
      {
        weightPercent: 100,
        maxScore: null,
        actualScore: 85,
        status: "graded",
      },
    ];

    const achieved = calculateGrade(assessments, 80);
    expect(achieved.remainingWeightPercent).toBe(0);
    expect(achieved.targetAchieved).toBe(true);
    expect(achieved.targetImpossible).toBe(false);
    expect(achieved.requiredAverageOnRemaining).toBeNull();

    const notAchieved = calculateGrade(assessments, 90);
    expect(notAchieved.remainingWeightPercent).toBe(0);
    expect(notAchieved.targetAchieved).toBe(false);
    expect(notAchieved.targetImpossible).toBe(true);
    expect(notAchieved.requiredAverageOnRemaining).toBeNull();
  });

  it("handles all assessments still pending (completedWeightPercent = 0)", () => {
    const assessments: GradeAssessmentInput[] = [
      {
        weightPercent: 50,
        maxScore: 100,
        actualScore: null,
        status: "pending",
      },
      {
        weightPercent: 50,
        maxScore: 100,
        actualScore: null,
        status: "submitted",
      },
    ];

    const result = calculateGrade(assessments, 75);

    expect(result.totalWeightPercent).toBe(100);
    expect(result.completedWeightPercent).toBe(0);
    expect(result.remainingWeightPercent).toBe(100);
    expect(result.earnedWeightedPercent).toBe(0);
    expect(result.currentGrade).toBeNull();
    expect(result.projectedFinalGrade).toBeNull();
    expect(result.requiredAverageOnRemaining).toBe(75);
    expect(result.targetAchieved).toBe(false);
    expect(result.targetImpossible).toBe(false);
  });

  it("handles an assessment with weightPercent = 0 without crash or NaN", () => {
    const assessments: GradeAssessmentInput[] = [
      {
        weightPercent: 0,
        maxScore: 50,
        actualScore: 40,
        status: "graded",
      },
      {
        weightPercent: 100,
        maxScore: 100,
        actualScore: 80,
        status: "graded",
      },
    ];

    const result = calculateGrade(assessments);

    expect(result.totalWeightPercent).toBe(100);
    expect(result.completedWeightPercent).toBe(100);
    expect(result.remainingWeightPercent).toBe(0);
    expect(result.earnedWeightedPercent).toBe(80);
    expect(result.currentGrade).toBe(80);
    expect(result.projectedFinalGrade).toBe(80);
    expect(Number.isNaN(result.currentGrade)).toBe(false);
  });

  it("handles all assessments with weightPercent = 0", () => {
    const assessments: GradeAssessmentInput[] = [
      {
        weightPercent: 0,
        maxScore: 100,
        actualScore: 100,
        status: "graded",
      },
    ];

    const result = calculateGrade(assessments);

    expect(result.totalWeightPercent).toBe(0);
    expect(result.completedWeightPercent).toBe(0);
    expect(result.remainingWeightPercent).toBe(0);
    expect(result.earnedWeightedPercent).toBe(0);
    expect(result.currentGrade).toBeNull();
    expect(result.projectedFinalGrade).toBeNull();
  });

  it("correctly converts raw scores when maxScore is provided and not null", () => {
    const assessments: GradeAssessmentInput[] = [
      {
        weightPercent: 100,
        maxScore: 50,
        actualScore: 42, // (42/50)*100 = 84%
        status: "graded",
      },
    ];

    const result = calculateGrade(assessments);

    expect(result.earnedWeightedPercent).toBe(84);
    expect(result.currentGrade).toBe(84);
    expect(result.projectedFinalGrade).toBe(84);
  });

  it("handles missed assessment with actualScore = null as score 0", () => {
    const assessmentsWithNullScore: GradeAssessmentInput[] = [
      {
        weightPercent: 50,
        maxScore: 100,
        actualScore: null,
        status: "missed",
      },
      {
        weightPercent: 50,
        maxScore: null,
        actualScore: 100,
        status: "graded",
      },
    ];

    const assessmentsWithZeroScore: GradeAssessmentInput[] = [
      {
        weightPercent: 50,
        maxScore: 100,
        actualScore: 0,
        status: "missed",
      },
      {
        weightPercent: 50,
        maxScore: null,
        actualScore: 100,
        status: "graded",
      },
    ];

    const resultNull = calculateGrade(assessmentsWithNullScore);
    const resultZero = calculateGrade(assessmentsWithZeroScore);

    expect(resultNull.completedWeightPercent).toBe(100);
    expect(resultNull.remainingWeightPercent).toBe(0);
    expect(resultNull.earnedWeightedPercent).toBe(50);
    expect(resultNull.currentGrade).toBe(50);
    expect(resultNull.projectedFinalGrade).toBe(50);
    expect(resultNull).toEqual(resultZero);
  });

  it("does not count submitted assessments as graded even if actualScore is present", () => {
    const assessments: GradeAssessmentInput[] = [
      {
        weightPercent: 40,
        maxScore: null,
        actualScore: 90,
        status: "submitted", // provisional score, not final
      },
      {
        weightPercent: 60,
        maxScore: null,
        actualScore: 80,
        status: "graded",
      },
    ];

    const result = calculateGrade(assessments);

    expect(result.completedWeightPercent).toBe(60);
    expect(result.remainingWeightPercent).toBe(40);
    expect(result.earnedWeightedPercent).toBe(48); // 60 * 0.8
    expect(result.currentGrade).toBe(80);
  });

  it("preserves literal weights that do not sum to 100 without renormalizing", () => {
    const assessments: GradeAssessmentInput[] = [
      {
        weightPercent: 60,
        maxScore: null,
        actualScore: 100,
        status: "graded",
      },
      {
        weightPercent: 60,
        maxScore: null,
        actualScore: 50,
        status: "graded",
      },
    ];

    const result = calculateGrade(assessments);

    expect(result.totalWeightPercent).toBe(120);
    expect(result.completedWeightPercent).toBe(120);
    expect(result.remainingWeightPercent).toBe(0);
    expect(result.earnedWeightedPercent).toBe(90); // 60 + 30 = 90
    expect(result.currentGrade).toBe(75); // (90 / 120) * 100 = 75
  });

  it("omits targetGrade calculations when targetGrade is not provided", () => {
    const result = calculateGrade([
      {
        weightPercent: 50,
        maxScore: null,
        actualScore: 80,
        status: "graded",
      },
      {
        weightPercent: 50,
        maxScore: null,
        actualScore: null,
        status: "pending",
      },
    ]);

    expect(result.requiredAverageOnRemaining).toBeNull();
    expect(result.targetAchieved).toBe(false);
    expect(result.targetImpossible).toBe(false);
  });

  it("tests exact boundary conditions for targetAchieved (<= 0) and targetImpossible (> 100)", () => {
    // 50% completed with 80% score -> earnedWeightedPercent = 40.
    // Remaining weight = 50%.
    const assessments: GradeAssessmentInput[] = [
      {
        weightPercent: 50,
        maxScore: null,
        actualScore: 80,
        status: "graded",
      },
      {
        weightPercent: 50,
        maxScore: null,
        actualScore: null,
        status: "pending",
      },
    ];

    // Boundary 1: requiredPoints = 40 - 40 = 0 -> requiredAverageOnRemaining = (0/50)*100 = 0.
    // 0 is achieved (<= 0), not impossible.
    const resultZeroBoundary = calculateGrade(assessments, 40);
    expect(resultZeroBoundary.requiredAverageOnRemaining).toBe(0);
    expect(resultZeroBoundary.targetAchieved).toBe(true);
    expect(resultZeroBoundary.targetImpossible).toBe(false);

    // Boundary 2: requiredPoints = 90 - 40 = 50 -> requiredAverageOnRemaining = (50/50)*100 = 100.
    // 100 is neither achieved nor impossible (> 100 required for impossible).
    const resultHundredBoundary = calculateGrade(assessments, 90);
    expect(resultHundredBoundary.requiredAverageOnRemaining).toBe(100);
    expect(resultHundredBoundary.targetAchieved).toBe(false);
    expect(resultHundredBoundary.targetImpossible).toBe(false);

    // Boundary 3: slightly above 100 -> requiredPoints = 90.05 - 40 = 50.05 -> requiredAverage = 100.1 > 100
    const resultImpossible = calculateGrade(assessments, 90.05);
    expect(resultImpossible.requiredAverageOnRemaining).toBeCloseTo(100.1, 4);
    expect(resultImpossible.targetAchieved).toBe(false);
    expect(resultImpossible.targetImpossible).toBe(true);

    // Boundary 4: slightly below 0 -> requiredPoints = 39.95 - 40 = -0.05 -> requiredAverage = -0.1 <= 0
    const resultAlreadyAchieved = calculateGrade(assessments, 39.95);
    expect(resultAlreadyAchieved.requiredAverageOnRemaining).toBeCloseTo(-0.1, 4);
    expect(resultAlreadyAchieved.targetAchieved).toBe(true);
    expect(resultAlreadyAchieved.targetImpossible).toBe(false);
  });
});
