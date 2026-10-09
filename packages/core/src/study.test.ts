import { describe, expect, it } from "vitest";
import {
  calculateStudyScenario,
  validateStudyCalculatorDefinition,
  validateStudyCalculatorValues,
  type StudyCalculatorDefinition,
} from "./study.js";

function definition(weights: number[]): StudyCalculatorDefinition {
  return {
    version: 1,
    sourceName: "User-supplied study profile",
    attestationThreshold: 25,
    fields: [
      ...(["att1", "att2"] as const).flatMap((period) =>
        weights.map((weightPercent, index) => ({
          id: `${period}-${index}`,
          label: `Assessment ${index + 1}`,
          period,
          weightPercent,
        })),
      ),
      { id: "exam", label: "Final exam", period: "exam", weightPercent: 100 },
    ],
  };
}

describe("study calculator", () => {
  it.each([
    ["OS", [20, 20, 20, 20, 20]],
    ["DB", [20, 20, 20, 10, 30]],
    ["language", [60, 40]],
    ["networks", [60, 40]],
    ["digital logic", [60, 40]],
  ] as const)(
    "reproduces %s attestation and 30/30/40 coefficients",
    (_name, weights) => {
      const profile = definition([...weights]);
      expect(validateStudyCalculatorDefinition(profile)).toBe(true);
      const values = Object.fromEntries(
        profile.fields.map((field) => [
          field.id,
          field.period === "att1" ? 80 : field.period === "att2" ? 60 : 90,
        ]),
      );
      const result = calculateStudyScenario({
        definition: profile,
        values,
        target: 78,
      });
      expect(result.att1.score).toBeCloseTo(80);
      expect(result.att2.score).toBeCloseTo(60);
      expect(result.finalScore).toBe(78);
      expect(result.requiredExamScore).toBe(90);
      expect(result.targetStatus).toBe("achieved");
    },
  );

  it("applies unequal weights within a period", () => {
    const profile = definition([20, 20, 20, 10, 30]);
    const values = {
      "att1-0": 100,
      "att1-1": 80,
      "att1-2": 50,
      "att1-3": 0,
      "att1-4": 90,
    };
    const result = calculateStudyScenario({
      definition: profile,
      values,
      target: 70,
    });
    expect(result.att1.score).toBe(73);
    expect(result.att2.score).toBeNull();
    expect(result.minimumFinal).toBe(21.9);
    expect(result.maximumFinal).toBe(91.9);
  });

  it("does not treat unknown scores as failed attestations or a completed final", () => {
    const profile = definition([60, 40]);
    const result = calculateStudyScenario({
      definition: profile,
      values: {},
      target: 70,
    });
    expect(result.att1).toEqual({ score: null, earned: 0, complete: false });
    expect(result.att2.score).toBeNull();
    expect(result.examScore).toBeNull();
    expect(result.finalScore).toBeNull();
    expect(result.belowThreshold).toBeNull();
    expect(result.minimumFinal).toBe(0);
    expect(result.maximumFinal).toBe(100);
    expect(result.requiredExamScore).toBeNull();
    expect(result.targetStatus).toBe("possible");
  });

  it("preserves a real zero and distinguishes it from a cleared field", () => {
    const profile = definition([60, 40]);
    const result = calculateStudyScenario({
      definition: profile,
      values: { "att1-0": 0, "att1-1": 0, exam: null },
      target: 80,
    });
    expect(result.att1).toEqual({ score: 0, earned: 0, complete: true });
    expect(result.belowThreshold).toBe(true);
    expect(result.maximumFinal).toBe(70);
    expect(result.targetStatus).toBe("impossible");
  });

  it("keeps the exact threshold boundary and reports an impossible required exam", () => {
    const profile = definition([100]);
    const result = calculateStudyScenario({
      definition: profile,
      values: { "att1-0": 25, "att2-0": 25 },
      target: 70,
    });
    expect(result.belowThreshold).toBe(false);
    expect(result.requiredExamScore).toBe(137.5);
    expect(result.targetStatus).toBe("impossible");
    expect(result.finalScore).toBeNull();
  });

  it("reports achieved targets and requires no negative exam score", () => {
    const profile = definition([100]);
    const result = calculateStudyScenario({
      definition: profile,
      values: { "att1-0": 100, "att2-0": 100 },
      target: 50,
    });
    expect(result.requiredExamScore).toBe(0);
    expect(result.targetStatus).toBe("achieved");
    expect(result.finalScore).toBeNull();
  });

  it.each([NaN, Infinity, -1, 101, "80", undefined, true])(
    "rejects invalid numeric input %s",
    (badScore) => {
      const profile = definition([100]);
      expect(validateStudyCalculatorValues({ exam: badScore }, profile)).toBe(
        false,
      );
    },
  );

  it("rejects foreign fields, duplicate identifiers, bad weights and invalid targets", () => {
    const profile = definition([100]);
    expect(validateStudyCalculatorValues({ "other-course": 50 }, profile)).toBe(
      false,
    );
    expect(
      validateStudyCalculatorDefinition({
        ...profile,
        fields: [...profile.fields, profile.fields[0]],
      }),
    ).toBe(false);
    expect(validateStudyCalculatorDefinition(definition([60, 50]))).toBe(false);
    expect(
      validateStudyCalculatorDefinition({
        ...profile,
        attestationThreshold: -1,
      }),
    ).toBe(false);
    expect(() =>
      calculateStudyScenario({
        definition: profile,
        values: {},
        target: Infinity,
      }),
    ).toThrow(RangeError);
    expect(() =>
      calculateStudyScenario({
        definition: profile,
        values: { exam: 200 },
        target: 70,
      }),
    ).toThrow(RangeError);
  });
});

describe("normalized points, provenance and constrained what-if scenarios", () => {
  it("normalizes 90/100 and 15/30 before weighting and separates actual from assumed", () => {
    const profile = definition([20, 20, 20, 10, 30]);
    const result = calculateStudyScenario({
      definition: profile,
      values: {
        "att1-0": { earned: 90, max: 100, kind: "actual", source: "moodle" },
        "att1-4": {
          earned: 15,
          max: 30,
          kind: "assumed",
          source: "manual scenario",
        },
      },
      target: 70,
    });
    expect(result.fieldContributions[0]).toMatchObject({
      normalizedPercent: 90,
      periodContribution: 18,
      finalContribution: 5.4,
      finalWeightPercent: 6,
      kind: "actual",
    });
    expect(result.fieldContributions[4]).toMatchObject({
      normalizedPercent: 50,
      periodContribution: 15,
      finalContribution: 4.5,
      kind: "assumed",
    });
    expect(result.guaranteedFinal).toBe(5.4);
    expect(result.projection).toBe(9.9);
    expect(result.finalScore).toBeNull();
    expect(result.unknownFieldIds).not.toContain("att1-4");
  });

  it("preserves old percentage-only manual states without manufacturing actual grades", () => {
    const profile = definition([100]);
    const result = calculateStudyScenario({
      definition: profile,
      values: { "att1-0": 60, "att2-0": 80 },
      target: 70,
    });
    expect(result.guaranteedFinal).toBe(0);
    expect(result.minimumFinal).toBe(42);
    expect(result.requiredExamScore).toBe(70);
    expect(result.requiredComponents).toEqual([
      {
        fieldId: "exam",
        requiredPercent: expect.closeTo(70),
        requiredPoints: 70,
        maxScore: 100,
        possible: true,
      },
    ]);
  });

  it("uses scheme-specific top-level weights and validates edits", () => {
    const profile = {
      ...definition([100]),
      topLevelWeights: { att1: 20, att2: 20, exam: 60 },
    };
    const result = calculateStudyScenario({
      definition: profile,
      values: { "att1-0": 60, "att2-0": 80 },
      target: 70,
    });
    expect(result.minimumFinal).toBe(28);
    expect(result.requiredExamScore).toBe(70);
    expect(
      validateStudyCalculatorDefinition({
        ...profile,
        topLevelWeights: { att1: 20, att2: 20, exam: 70 },
      }),
    ).toBe(false);
    expect(
      validateStudyCalculatorDefinition({
        ...profile,
        topLevelWeights: { att1: 20, att2: 20 },
      }),
    ).toBe(false);
  });

  it("rounds the required raw score upward rather than the displayed percentage", () => {
    const profile = definition([100]);
    profile.fields.find((field) => field.id === "exam")!.maxScore = 30;
    const result = calculateStudyScenario(
      {
        definition: profile,
        values: { "att1-0": 60, "att2-0": 80 },
        target: 70.1,
      },
      { selectedFieldId: "exam" },
    );
    expect(result.scenarioRange!.requiredCommonPercent).toBeCloseTo(70.25);
    expect(result.scenarioRange!.components[0]).toMatchObject({
      requiredPoints: 22,
      maxScore: 30,
      possible: true,
    });
    const fractional = {
      ...profile,
      fields: profile.fields.map((field) => ({ ...field, pointStep: 0.5 })),
    };
    expect(
      calculateStudyScenario(
        {
          definition: fractional,
          values: { "att1-0": 60, "att2-0": 80 },
          target: 70.1,
        },
        { selectedFieldId: "exam" },
      ).scenarioRange!.components[0]!.requiredPoints,
    ).toBe(21.5);
  });

  it("solves several unknown works and allows explicit variable ranges", () => {
    const profile = definition([100]);
    const state = { definition: profile, values: { "att1-0": 80 }, target: 70 };
    const result = calculateStudyScenario(state, {
      unknownFieldIds: ["att2-0", "exam"],
    });
    expect(result.scenarioRange).toMatchObject({
      minimumFinal: 24,
      maximumFinal: 94,
      feasible: true,
    });
    expect(result.scenarioRange!.requiredCommonPercent).toBeCloseTo(46 / 0.7);
    expect(
      result.scenarioRange!.components.every(
        (item) => item.requiredPoints === 66,
      ),
    ).toBe(true);
    const constrained = calculateStudyScenario(state, {
      unknownFieldIds: ["att2-0", "exam"],
      ranges: {
        "att2-0": { minPercent: 0, maxPercent: 50 },
        exam: { minPercent: 0, maxPercent: 50 },
      },
    });
    expect(constrained.scenarioRange).toMatchObject({
      minimumFinal: 24,
      maximumFinal: 59,
      feasible: false,
      requiredCommonPercent: null,
    });
  });

  it("holds all other unknown work at zero when solving one selected component", () => {
    const profile = definition([100]);
    const result = calculateStudyScenario(
      { definition: profile, values: {}, target: 70 },
      { selectedFieldId: "exam" },
    );
    expect(result.scenarioRange).toMatchObject({
      maximumFinal: 40,
      feasible: false,
    });
    expect(
      result.requiredComponents.find((item) => item.fieldId === "exam"),
    ).toMatchObject({ requiredPercent: 175, possible: false });
  });

  it("blocks a numerically reachable target when a verified attestation requirement fails", () => {
    const profile = definition([100]);
    profile.requirements = [
      {
        id: "att1-min",
        label: "ATT1 >= 25",
        kind: "period_minimum",
        period: "att1",
        minimumPercent: 25,
        verification: "verified",
        sourcePage: 3,
      },
    ];
    const result = calculateStudyScenario({
      definition: profile,
      values: {
        "att1-0": { earned: 20, max: 100, kind: "actual" },
        "att2-0": 100,
        exam: 100,
      },
      target: 70,
    });
    expect(result.finalScore).toBe(76);
    expect(result.numericTargetStatus).toBe("achieved");
    expect(result.eligibilityStatus).toBe("blocked");
    expect(result.targetStatus).toBe("impossible");
  });

  it("keeps unknown attendance pending and unverified policies advisory", () => {
    const profile = definition([100]);
    profile.requirements = [
      {
        id: "attendance",
        label: "Attendance >= 70",
        kind: "attendance_minimum",
        minimumPercent: 70,
        verification: "verified",
      },
    ];
    const values = { "att1-0": 100, "att2-0": 100, exam: 100 };
    const unknown = calculateStudyScenario({
      definition: profile,
      values,
      target: 70,
    });
    expect(unknown.numericTargetStatus).toBe("achieved");
    expect(unknown.targetStatus).toBe("possible");
    expect(unknown.eligibilityStatus).toBe("pending");
    expect(
      calculateStudyScenario({
        definition: profile,
        values,
        target: 70,
        attendancePercent: 69,
      }).targetStatus,
    ).toBe("impossible");
    expect(
      calculateStudyScenario({
        definition: profile,
        values,
        target: 70,
        attendancePercent: 70,
      }).targetStatus,
    ).toBe("achieved");
    profile.requirements[0]!.verification = "needs_review";
    expect(
      calculateStudyScenario({
        definition: profile,
        values,
        target: 70,
        attendancePercent: 0,
      }).eligibilityStatus,
    ).toBe("pending");
  });

  it("includes verified threshold requirements when solving unknown work", () => {
    const profile = definition([100]);
    profile.requirements = [
      {
        id: "att1-min",
        label: "ATT1 >=25",
        kind: "period_minimum",
        period: "att1",
        minimumPercent: 25,
        verification: "verified",
      },
    ];
    const result = calculateStudyScenario(
      { definition: profile, values: { "att2-0": 100, exam: 100 }, target: 70 },
      { selectedFieldId: "att1-0" },
    );
    expect(result.scenarioRange!.requiredCommonPercent).toBeCloseTo(25);
    expect(result.scenarioRange!.components[0]!.requiredPoints).toBe(25);
  });

  it.each([
    { earned: 15, max: 0 },
    { earned: 31, max: 30 },
    { earned: -1, max: 30 },
    { earned: 15, max: NaN },
    { earned: 15, max: 30, kind: "fake" },
  ])("rejects invalid raw points %j", (score) => {
    expect(
      validateStudyCalculatorValues({ exam: score }, definition([100])),
    ).toBe(false);
  });

  it("rejects missing schemes, foreign variable IDs and invalid ranges", () => {
    expect(() =>
      calculateStudyScenario({
        definition: null,
        values: {},
        target: 70,
      } as never),
    ).toThrow(RangeError);
    const state = { definition: definition([100]), values: {}, target: 70 };
    expect(() =>
      calculateStudyScenario(state, { selectedFieldId: "foreign" }),
    ).toThrow(RangeError);
    expect(() =>
      calculateStudyScenario(state, { unknownFieldIds: ["exam", "exam"] }),
    ).toThrow(RangeError);
    expect(() =>
      calculateStudyScenario(state, {
        selectedFieldId: "exam",
        ranges: { exam: { minPercent: 80, maxPercent: 70 } },
      }),
    ).toThrow(RangeError);
  });
});

describe("discrete score bounds and zero course weight", () => {
  it("does not claim a solution that exceeds a variable's point-grid upper bound", () => {
    const profile = definition([100]);
    profile.fields.find((field) => field.id === "exam")!.maxScore = 3;
    const result = calculateStudyScenario(
      { definition: profile, values: { "att1-0": 0, "att2-0": 0 }, target: 28 },
      {
        selectedFieldId: "exam",
        ranges: { exam: { minPercent: 0, maxPercent: 80 } },
      },
    );
    expect(result.scenarioRange!.feasible).toBe(false);
    expect(result.scenarioRange!.maximumFinal).toBeCloseTo(26.6666666667);
  });

  it("supports zero top-level weight without non-finite required score output", () => {
    const profile = {
      ...definition([100]),
      topLevelWeights: { att1: 0, att2: 0, exam: 100 },
    };
    const result = calculateStudyScenario({
      definition: profile,
      values: {},
      target: 70,
    });
    expect(
      result.requiredComponents.find((item) => item.fieldId === "att1-0"),
    ).toMatchObject({ requiredPercent: 101, possible: false });
    expect(
      result.requiredComponents.every(
        (item) =>
          Number.isFinite(item.requiredPercent) &&
          Number.isFinite(item.requiredPoints),
      ),
    ).toBe(true);
  });

  it("keeps actual zero separate from an omitted score and allows several final components", () => {
    const profile = definition([100]);
    profile.fields = profile.fields.filter((field) => field.period !== "exam");
    profile.fields.push(
      {
        id: "written",
        label: "Written final",
        period: "exam",
        weightPercent: 60,
      },
      { id: "oral", label: "Oral final", period: "exam", weightPercent: 40 },
    );
    expect(validateStudyCalculatorDefinition(profile)).toBe(true);
    const result = calculateStudyScenario(
      {
        definition: profile,
        values: {
          "att1-0": 100,
          "att2-0": 100,
          written: { earned: 0, max: 20, kind: "actual" },
        },
        target: 70,
      },
      { selectedFieldId: "oral" },
    );
    expect(result.unknownFieldIds).toEqual(["oral"]);
    expect(result.examScore).toBeNull();
    expect(result.scenarioRange!.requiredCommonPercent).toBeCloseTo(62.5);
  });
});

describe("persisted unknown-component denominators", () => {
  it("uses a scenario maximum even when the component's grade is unknown", () => {
    const profile = definition([100]);
    const state = {
      definition: profile,
      values: { "att1-0": 60, "att2-0": 80, exam: null },
      maxima: { exam: 30 },
      target: 70.1,
    };
    const result = calculateStudyScenario(state, { selectedFieldId: "exam" });
    expect(result.scenarioRange!.components[0]).toMatchObject({
      maxScore: 30,
      requiredPoints: 22,
    });
    expect(state.values.exam).toBeNull();
    const known = calculateStudyScenario({
      ...state,
      values: {
        ...state.values,
        exam: { earned: 15, max: 20, kind: "actual" as const },
      },
    });
    expect(
      known.fieldContributions.find((item) => item.id === "exam"),
    ).toMatchObject({ normalizedPercent: 75, maxScore: 20 });
  });

  it.each<Record<string, number>>([
    { exam: 0 },
    { exam: -1 },
    { exam: NaN },
    { foreign: 30 },
  ])("rejects invalid scenario maxima %j", (maxima) => {
    expect(() =>
      calculateStudyScenario({
        definition: definition([100]),
        values: {},
        target: 70,
        maxima,
      }),
    ).toThrow(RangeError);
  });
});

it("blocks a verified attestation minimum that remaining work can no longer attain", () => {
  const profile = definition([90, 10]);
  profile.requirements = [
    {
      id: "att1-min",
      label: "ATT1 >= 25",
      kind: "period_minimum",
      period: "att1",
      minimumPercent: 25,
      verification: "verified",
    },
  ];
  const result = calculateStudyScenario({
    definition: profile,
    values: {
      "att1-0": { earned: 0, max: 100, kind: "actual" },
      "att2-0": 100,
      "att2-1": 100,
      exam: 100,
    },
    target: 50,
  });
  expect(result.att1.score).toBeNull();
  expect(result.numericTargetStatus).toBe("achieved");
  expect(result.eligibilityStatus).toBe("blocked");
  expect(result.targetStatus).toBe("impossible");
});

it("recognizes an already secured attestation minimum without grading missing work as zero", () => {
  const profile = definition([60, 40]);
  profile.requirements = [
    {
      id: "att1-min",
      label: "ATT1 >=25",
      kind: "period_minimum",
      period: "att1",
      minimumPercent: 25,
      verification: "verified",
    },
  ];
  const result = calculateStudyScenario({
    definition: profile,
    values: { "att1-0": 50 },
    target: 70,
  });
  expect(result.att1.score).toBeNull();
  expect(result.requirementResults[0]!.status).toBe("passed");
  expect(result.unknownFieldIds).toContain("att1-1");
});
