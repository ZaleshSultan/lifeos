import { validateScholarshipConfig } from "../../../packages/core/src/scholarship.js";
import {
  validateStudyCalculatorDefinition,
  validateStudyCalculatorValues,
  type StudyCalculatorDefinition,
} from "../../../packages/core/src/study.js";

export const studyCourseMutation =
  /^study\/courses\/[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}\/(scholarship|syllabus)$/;

function onlyKeys(
  value: unknown,
  keys: string[],
): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => keys.includes(key))
  );
}

function percent(value: unknown): boolean {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100
  );
}

function definition(value: unknown): value is StudyCalculatorDefinition {
  return (
    validateStudyCalculatorDefinition(value) &&
    onlyKeys(value, [
      "version",
      "sourceName",
      "attestationThreshold",
      "fields",
    ]) &&
    value.fields.every((field) =>
      onlyKeys(field, ["id", "label", "period", "weightPercent"]),
    )
  );
}

function validBaseline(value: unknown): boolean {
  return (
    value === null ||
    (onlyKeys(value, ["target", "definition", "values"]) &&
      percent(value.target) &&
      definition(value.definition) &&
      validateStudyCalculatorValues(value.values, value.definition))
  );
}

export function studyMutationBodyError(
  path: string,
  payload: unknown,
): string | null {
  const resource = studyCourseMutation.exec(path)?.[1];
  if (!resource) return null;
  if (resource === "scholarship") {
    const valid =
      onlyKeys(payload, ["config", "expectedConfig"]) &&
      validateScholarshipConfig(payload.config) &&
      (payload.expectedConfig === null ||
        validateScholarshipConfig(payload.expectedConfig));
    return valid ? null : "invalid_scholarship_plan";
  }
  const valid =
    onlyKeys(payload, ["definition", "target", "values", "expectedState"]) &&
    definition(payload.definition) &&
    validBaseline(payload.expectedState) &&
    (!Object.hasOwn(payload, "target") || percent(payload.target)) &&
    (!Object.hasOwn(payload, "values") ||
      validateStudyCalculatorValues(payload.values, payload.definition));
  return valid ? null : "invalid_study_calculator";
}
