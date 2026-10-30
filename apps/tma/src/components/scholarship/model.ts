import {
  defaultScholarshipConfig,
  scholarshipConfigsMatch,
  validateScholarshipConfig,
  type ScholarshipConfig,
} from "../../../../../packages/core/src/scholarship.js";
const scoreFormatter = new Intl.NumberFormat("ru-RU", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
export const scholarshipScore = (score: number | null) =>
  score === null ? "Неизвестно" : scoreFormatter.format(score);
export const scenarioLabels = {
  pessimistic: "Пессимистичный",
  realistic: "Реалистичный",
  optimistic: "Оптимистичный",
};
export const kindLabels = {
  assignment: "Assignment / задание",
  quiz: "Quiz / Async",
  midterm: "Midterm",
  endterm: "Endterm",
  exam: "Final Exam",
  other: "Другие работы",
};
export const riskLabels = {
  unknown: "Недостаточно данных",
  impossible: "Порог математически недостижим",
  at_risk: "Есть риск",
  narrow: "Малый запас: 70–74",
  safe: "Запас: 75+",
};
export interface ScholarshipDraft {
  config: ScholarshipConfig;
  base: ScholarshipConfig | null;
  initial: ScholarshipConfig;
}
export function isScholarshipDraft(value: unknown): value is ScholarshipDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Record<string, unknown>;
  return (
    validateScholarshipConfig(draft.config) &&
    (draft.base === null || validateScholarshipConfig(draft.base)) &&
    validateScholarshipConfig(draft.initial)
  );
}
export function scholarshipDraftDirty(draft: ScholarshipDraft) {
  return !scholarshipConfigsMatch(draft.config, draft.initial);
}
export function reconcileScholarshipDraft(
  draft: ScholarshipDraft | undefined,
  remote: ScholarshipConfig | null,
  target = 70,
): ScholarshipDraft {
  return draft &&
    scholarshipDraftDirty(draft) &&
    !scholarshipConfigsMatch(draft.config, remote)
    ? draft
    : {
        config: remote ?? defaultScholarshipConfig(target),
        base: remote,
        initial: remote ?? defaultScholarshipConfig(target),
      };
}
