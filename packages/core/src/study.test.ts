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
      ...(["att1", "att2"] as const).flatMap((period) => weights.map((weightPercent, index) => ({
        id: `${period}-${index}`, label: `Assessment ${index + 1}`, period, weightPercent,
      }))),
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
  ] as const)("reproduces %s attestation and 30/30/40 coefficients", (_name, weights) => {
    const profile = definition([...weights]);
    expect(validateStudyCalculatorDefinition(profile)).toBe(true);
    const values = Object.fromEntries(profile.fields.map((field) => [field.id,
      field.period === "att1" ? 80 : field.period === "att2" ? 60 : 90]));
    const result = calculateStudyScenario({ definition: profile, values, target: 78 });
    expect(result.att1.score).toBeCloseTo(80);
    expect(result.att2.score).toBeCloseTo(60);
    expect(result.finalScore).toBe(78);
    expect(result.requiredExamScore).toBe(90);
    expect(result.targetStatus).toBe("achieved");
  });

  it("applies unequal weights within a period", () => {
    const profile = definition([20, 20, 20, 10, 30]);
    const values = { "att1-0": 100, "att1-1": 80, "att1-2": 50, "att1-3": 0, "att1-4": 90 };
    const result = calculateStudyScenario({ definition: profile, values, target: 70 });
    expect(result.att1.score).toBe(73);
    expect(result.att2.score).toBeNull();
    expect(result.minimumFinal).toBe(21.9);
    expect(result.maximumFinal).toBe(91.9);
  });

  it("does not treat unknown scores as failed attestations or a completed final", () => {
    const profile = definition([60, 40]);
    const result = calculateStudyScenario({ definition: profile, values: {}, target: 70 });
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
    const result = calculateStudyScenario({ definition: profile, values: { "att1-0": 0, "att1-1": 0, exam: null }, target: 80 });
    expect(result.att1).toEqual({ score: 0, earned: 0, complete: true });
    expect(result.belowThreshold).toBe(true);
    expect(result.maximumFinal).toBe(70);
    expect(result.targetStatus).toBe("impossible");
  });

  it("keeps the exact threshold boundary and reports an impossible required exam", () => {
    const profile = definition([100]);
    const result = calculateStudyScenario({ definition: profile, values: { "att1-0": 25, "att2-0": 25 }, target: 70 });
    expect(result.belowThreshold).toBe(false);
    expect(result.requiredExamScore).toBe(137.5);
    expect(result.targetStatus).toBe("impossible");
    expect(result.finalScore).toBeNull();
  });

  it("reports achieved targets and requires no negative exam score", () => {
    const profile = definition([100]);
    const result = calculateStudyScenario({ definition: profile, values: { "att1-0": 100, "att2-0": 100 }, target: 50 });
    expect(result.requiredExamScore).toBe(0);
    expect(result.targetStatus).toBe("achieved");
    expect(result.finalScore).toBeNull();
  });

  it.each([NaN, Infinity, -1, 101, "80", undefined, true])("rejects invalid numeric input %s", (badScore) => {
    const profile = definition([100]);
    expect(validateStudyCalculatorValues({ exam: badScore }, profile)).toBe(false);
  });

  it("rejects foreign fields, duplicate identifiers, bad weights and invalid targets", () => {
    const profile = definition([100]);
    expect(validateStudyCalculatorValues({ "other-course": 50 }, profile)).toBe(false);
    expect(validateStudyCalculatorDefinition({ ...profile, fields: [...profile.fields, profile.fields[0]] })).toBe(false);
    expect(validateStudyCalculatorDefinition(definition([60, 50]))).toBe(false);
    expect(validateStudyCalculatorDefinition({ ...profile, attestationThreshold: -1 })).toBe(false);
    expect(() => calculateStudyScenario({ definition: profile, values: {}, target: Infinity })).toThrow(RangeError);
    expect(() => calculateStudyScenario({ definition: profile, values: { exam: 200 }, target: 70 })).toThrow(RangeError);
  });
});
