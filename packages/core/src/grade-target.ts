import { calculateGrade } from "./grade-engine.js";
import {
  calculateStudyScenario,
  calculateStudyTargetPlan,
  validateStudyCalculatorDefinition,
  type StudyCalculatorDefinition,
  type StudyCalculatorState,
  type StudyTargetPlan,
} from "./study.js";
import type { ScholarshipBinding } from "./scholarship.js";
import { studyEvidenceIsMocked, studyEvidencePercent, type StudyGradeEvidence } from "./study-evidence.js";

/** An owner review applies to one exact course, definition and set of bindings. */
export interface GradePolicyReview {
  version: 1;
  externalCourseKey: string;
  definitionKey: string;
  bindingsKey: string;
  reviewedAt: string;
  sourceRef: string;
  supportedPolicy: "linear-30-30-40";
}
export type GradeTargetBindings = Record<string, ScholarshipBinding>;
export function gradeTargetDefinitionKey(definition: StudyCalculatorDefinition): string {
  return JSON.stringify({
    version: definition.version,
    sourceName: definition.sourceName,
    attestationThreshold: definition.attestationThreshold,
    fields: [...definition.fields].sort((a, b) => a.id.localeCompare(b.id)).map(
      ({ id, label, period, weightPercent }) => ({ id, label, period, weightPercent }),
    ),
  });
}
export function gradeTargetBindingsKey(bindings: GradeTargetBindings): string {
  return JSON.stringify(Object.entries(bindings).sort(([a], [b]) => a.localeCompare(b)).map(
    ([id, binding]) => [id, binding.mode, binding.ruleConfirmed,
      [...binding.entries].sort((a, b) => a.recordId.localeCompare(b.recordId)).map(
        ({ recordId, weight }) => [recordId, weight],
      )],
  ));
}
export interface CourseGradeTargetInput {
  courseId: string;
  externalCourseKey: string | null;
  calculator: StudyCalculatorState | null;
  records: StudyGradeEvidence[];
  bindings: GradeTargetBindings;
  review?: GradePolicyReview | null;
  /** Explicit clock: core has no I/O, ambient clock or external services. */
  now: string;
  maxAgeHours?: number;
  /** Policies with bonuses, drops, nonlinear rules or extra exam minima are not modeled. */
  unsupportedRules?: string[];
}
export interface GradeTargetObservation {
  fieldId: string;
  label: string;
  score: number | null;
  observedAt: string | null;
  status: "observed" | "unknown" | "stale" | "ambiguous" | "unsupported";
}
export interface CourseGradeTarget {
  courseId: string;
  status: "unconfigured" | "conditional" | "confirmed" | "unsupported";
  actualState: StudyCalculatorState | null;
  plan: StudyTargetPlan | null;
  completedWeight: number;
  assessedAverage: number | null;
  observations: GradeTargetObservation[];
  warnings: string[];
  scenarios: Array<{ remainingScore: number; final: number; attestationWarning: boolean }>;
}

/** Identity is checked independently of titles and profile-name heuristics. */
export function gradeEvidenceIdentity(record: StudyGradeEvidence): { course: string; item: string } | null {
  const raw = record.rawJson;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const data = raw as Record<string, unknown>;
  const id = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? String(value) : typeof value === "string" && /^[1-9]\d{0,15}$/.test(value) ? value : null;
  const course = id(data.moodle_course_id);
  // Moodle grade item IDs may include a stable type prefix, as stored by the sync adapter.
  const item = typeof data.moodle_item_id === "string" &&
    /^(?:[1-9]\d{0,15}|mod-[a-z][a-z0-9_]*-[1-9]\d{0,15})$/.test(data.moodle_item_id)
    ? data.moodle_item_id : id(data.moodle_item_id);
  return course && item ? { course, item } : null;
}

/** Actual observations never use saved scenario values. All forecasts use the existing engine. */
export function calculateCourseGradeTarget(input: CourseGradeTargetInput): CourseGradeTarget {
  const result: CourseGradeTarget = {
    courseId: input.courseId, status: "unconfigured", actualState: null, plan: null,
    completedWeight: 0, assessedAverage: null, observations: [], warnings: [], scenarios: [],
  };
  const state = input.calculator;
  if (!state || !validateStudyCalculatorDefinition(state.definition) ||
      !Number.isFinite(state.target) || state.target < 0 || state.target > 100) {
    result.warnings.push("Нет проверенной структуры весов: выбери и проверь силабус курса.");
    return result;
  }
  result.status = "conditional";
  if (input.unsupportedRules?.length) {
    result.status = "unsupported";
    result.warnings.push("Бонусы, исключение работ, нелинейная формула или дополнительные пороги требуют отдельной модели.");
    return result;
  }
  const now = Date.parse(input.now);
  const hours = input.maxAgeHours ?? 48;
  if (!Number.isFinite(now) || !Number.isFinite(hours) || hours <= 0 || hours > 720) {
    result.warnings.push("Не удалось проверить время наблюдения оценок.");
    return result;
  }
  const course = /^moodle:([1-9]\d{0,15})$/.exec(input.externalCourseKey ?? "")?.[1];
  const records = input.records.filter(row => gradeEvidenceIdentity(row)?.course === course && course !== undefined);
  const identities = new Map<string, number>();
  const ids = new Map<string, number>();
  for (const row of records) {
    const item = gradeEvidenceIdentity(row)!.item;
    identities.set(item, (identities.get(item) ?? 0) + 1);
    ids.set(row.id, (ids.get(row.id) ?? 0) + 1);
  }
  const useCounts = new Map<string, number>();
  for (const binding of Object.values(input.bindings))
    for (const entry of binding.entries)
      useCounts.set(entry.recordId, (useCounts.get(entry.recordId) ?? 0) + 1);
  const values: Record<string, number | null> = {};
  for (const field of state.definition.fields) {
    const observation: GradeTargetObservation = {
      fieldId: field.id, label: field.label, score: null, observedAt: null, status: "unknown",
    };
    const binding = input.bindings[field.id];
    if (course && binding) {
      const valid = binding.ruleConfirmed === true &&
        (binding.mode === "aggregate" || binding.mode === "weighted") &&
        binding.entries.length > 0 && binding.entries.length <= 40 &&
        (binding.mode !== "aggregate" || binding.entries.length === 1) &&
        // Splitting the single exam requires a different reviewed definition.
        (field.period !== "exam" || binding.mode === "aggregate") &&
        binding.entries.every(e => Number.isFinite(e.weight) && e.weight > 0 && e.weight <= 100) &&
        Math.abs(binding.entries.reduce((sum, e) => sum + e.weight, 0) - 100) < 1e-7;
      if (!valid) observation.status = "unsupported";
      else {
        let score = 0;
        let oldest = Infinity;
        for (const entry of binding.entries) {
          const row = records.find(row => row.id === entry.recordId);
          const identity = row && gradeEvidenceIdentity(row);
          if ((useCounts.get(entry.recordId) ?? 0) > 1 || (ids.get(entry.recordId) ?? 0) > 1 ||
              (identity && (identities.get(identity.item) ?? 0) > 1)) {
            observation.status = "ambiguous";
            break;
          }
          if (!row || studyEvidenceIsMocked(row)) break;
          const percent = studyEvidencePercent(row);
          if (percent === null) {
            if (row.score !== null && row.maxScore !== null && row.score > row.maxScore)
              observation.status = "unsupported";
            break;
          }
          const at = Date.parse(row.updatedAt);
          if (!Number.isFinite(at) || at > now || now - at > hours * 3_600_000) {
            observation.status = "stale";
            break;
          }
          oldest = Math.min(oldest, at);
          score += percent * entry.weight / 100;
          // Only the complete binding establishes a score; partial work stays unknown.
          if (entry === binding.entries[binding.entries.length - 1]) {
            observation.status = "observed";
            observation.score = score;
            observation.observedAt = new Date(oldest).toISOString();
          }
        }
      }
    }
    values[field.id] = observation.score;
    result.observations.push(observation);
  }
  if (!course) result.warnings.push("Нет стабильной связи с Moodle: совпадение названия не подтверждает курс.");
  if (result.observations.some(row => row.status === "unknown"))
    result.warnings.push("Неоценённые работы, неизвестный максимум и несопоставленные компоненты остаются неизвестными, а не нулями.");
  if (result.observations.some(row => row.status === "stale"))
    result.warnings.push("Старые или некорректные даты наблюдений исключены. Синхронизируй Moodle и проверь источник.");
  if (result.observations.some(row => row.status === "ambiguous" || row.status === "unsupported"))
    result.warnings.push("Повторные сопоставления, бонусные баллы или неподдерживаемое правило исключены из расчёта.");
  const review = input.review;
  const reviewed = course && review?.version === 1 && review.supportedPolicy === "linear-30-30-40" &&
    review.externalCourseKey === input.externalCourseKey &&
    review.definitionKey === gradeTargetDefinitionKey(state.definition) &&
    review.bindingsKey === gradeTargetBindingsKey(input.bindings) &&
    review.sourceRef.trim().length > 0 && review.sourceRef.length <= 500 &&
    Number.isFinite(Date.parse(review.reviewedAt)) && Date.parse(review.reviewedAt) <= now;
  if (!reviewed) result.warnings.push("Условный расчёт 30/30/40: требуется проверка силабуса текущего курса и сопоставлений владельцем.");
  else if (!result.observations.some(row => ["stale", "ambiguous", "unsupported"].includes(row.status)))
    result.status = "confirmed";
  result.actualState = { definition: state.definition, values, target: state.target };
  result.plan = calculateStudyTargetPlan(result.actualState);
  const assessed = calculateGrade(state.definition.fields.map(field => ({
    weightPercent: field.weightPercent * (field.period === "exam" ? 0.4 : 0.3),
    actualScore: values[field.id], maxScore: null,
    status: values[field.id] === null ? "pending" : "graded",
  })), state.target);
  result.completedWeight = assessed.completedWeightPercent;
  result.assessedAverage = assessed.currentGrade;
  result.scenarios = [70, 85, 100].map(remainingScore => {
    const scenario = calculateStudyScenario({ ...result.actualState!, values: Object.fromEntries(
      Object.entries(values).map(([id, value]) => [id, value ?? remainingScore]),
    ) });
    return { remainingScore, final: scenario.finalScore!, attestationWarning: scenario.belowThreshold };
  });
  return result;
}
