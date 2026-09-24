import { calculateGrade, type GradeAssessmentInput } from "./grade-engine.js";

export interface StudyCalculatorField {
  id: string;
  label: string;
  period: "att1" | "att2" | "exam";
  /** Percentage within this period, not within the final course grade. */
  weightPercent: number;
}

export interface StudyCalculatorDefinition {
  version: 1;
  sourceName: string;
  /** A threshold supplied by the imported profile, not an institutional policy. */
  attestationThreshold: number;
  fields: StudyCalculatorField[];
}

export interface StudyCalculatorState {
  definition: StudyCalculatorDefinition;
  values: Record<string, number | null>;
  target: number;
}

export interface StudyPeriodResult {
  score: number | null;
  earned: number;
  complete: boolean;
}

export interface StudyScenarioResult {
  att1: StudyPeriodResult;
  att2: StudyPeriodResult;
  examScore: number | null;
  finalScore: number | null;
  minimumFinal: number;
  maximumFinal: number;
  requiredExamScore: number | null;
  belowThreshold: boolean | null;
  targetStatus: "achieved" | "possible" | "impossible";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPercent(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

export function validateStudyCalculatorDefinition(
  value: unknown,
): value is StudyCalculatorDefinition {
  if (!isObject(value) || value.version !== 1 ||
    typeof value.sourceName !== "string" || !value.sourceName.trim() || value.sourceName.length > 200 ||
    !isPercent(value.attestationThreshold) || !Array.isArray(value.fields) ||
    value.fields.length < 3 || value.fields.length > 100) return false;

  const ids = new Set<string>();
  const weights = { att1: 0, att2: 0, exam: 0 };
  let examCount = 0;
  for (const field of value.fields) {
    if (!isObject(field) || typeof field.id !== "string" ||
      !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(field.id) ||
      ["constructor", "prototype"].includes(field.id) || ids.has(field.id) ||
      typeof field.label !== "string" || !field.label.trim() || field.label.length > 300 ||
      (field.period !== "att1" && field.period !== "att2" && field.period !== "exam") ||
      !isPercent(field.weightPercent) || field.weightPercent === 0) return false;
    ids.add(field.id);
    weights[field.period] += field.weightPercent;
    if (field.period === "exam") examCount += 1;
  }
  return examCount === 1 && Object.values(weights).every((weight) => Math.abs(weight - 100) < 1e-7);
}

export function validateStudyCalculatorValues(
  value: unknown,
  definition: StudyCalculatorDefinition,
): value is Record<string, number | null> {
  if (!isObject(value) || !validateStudyCalculatorDefinition(definition)) return false;
  const ids = new Set(definition.fields.map((field) => field.id));
  return Object.entries(value).every(([id, score]) => ids.has(id) && (score === null || isPercent(score)));
}

/** A manual what-if scenario; this never changes or infers an LMS grade. */
export function calculateStudyScenario(state: StudyCalculatorState): StudyScenarioResult {
  if (!state || !validateStudyCalculatorDefinition(state.definition) ||
    !validateStudyCalculatorValues(state.values, state.definition) || !isPercent(state.target)) {
    throw new RangeError("Invalid study calculator state");
  }

  const { fields, attestationThreshold } = state.definition;
  const scoreFor = (field: StudyCalculatorField): number | null =>
    Object.hasOwn(state.values, field.id) ? state.values[field.id] ?? null : null;
  const asAssessment = (field: StudyCalculatorField, factor = 1): GradeAssessmentInput => {
    const score = scoreFor(field);
    return {
      weightPercent: field.weightPercent * factor,
      maxScore: 100,
      actualScore: score,
      status: score === null ? "pending" : "graded",
    };
  };
  const period = (name: "att1" | "att2"): StudyPeriodResult => {
    const items = fields.filter((field) => field.period === name);
    const calculation = calculateGrade(items.map((field) => asAssessment(field)));
    const complete = items.every((field) => scoreFor(field) !== null);
    return {
      score: complete ? calculation.earnedWeightedPercent : null,
      earned: calculation.earnedWeightedPercent,
      complete,
    };
  };

  const att1 = period("att1");
  const att2 = period("att2");
  const examScore = scoreFor(fields.find((field) => field.period === "exam")!);
  const final = calculateGrade(fields.map((field) => asAssessment(field, field.period === "exam" ? 0.4 : 0.3)));
  // Normalize floating point artifacts without rounding the user's inputs.
  const stable = (score: number): number => Math.round(score * 1e10) / 1e10;
  const minimumFinal = stable(final.earnedWeightedPercent);
  const maximumFinal = stable(final.earnedWeightedPercent + final.remainingWeightPercent);
  const attestationsComplete = att1.score !== null && att2.score !== null;
  const belowThreshold = (att1.score !== null && att1.score < attestationThreshold) ||
    (att2.score !== null && att2.score < attestationThreshold)
    ? true : attestationsComplete ? false : null;

  return {
    att1,
    att2,
    examScore,
    finalScore: attestationsComplete && examScore !== null ? minimumFinal : null,
    minimumFinal,
    maximumFinal,
    requiredExamScore: attestationsComplete
      ? stable(Math.max(0, (state.target - 0.3 * att1.score! - 0.3 * att2.score!) / 0.4))
      : null,
    belowThreshold,
    targetStatus: minimumFinal >= state.target ? "achieved" : maximumFinal < state.target ? "impossible" : "possible",
  };
}
