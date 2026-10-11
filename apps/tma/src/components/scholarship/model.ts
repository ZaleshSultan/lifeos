import {
  defaultScholarshipConfig,
  scholarshipConfigsMatch,
  type ScholarshipConfig,
} from "../../../../../packages/core/src/scholarship.js";
export const scholarshipScore = (score: number | null) =>
  score === null
    ? "Неизвестно"
    : new Intl.NumberFormat("ru-RU", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(score);
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
export function scholarshipDraftDirty(draft: ScholarshipDraft) {
  return !scholarshipConfigsMatch(draft.config, draft.initial);
}
export function reconcileScholarshipDraft(
  draft: ScholarshipDraft | undefined,
  remote: ScholarshipConfig | null,
  target = 70,
): ScholarshipDraft {
  return draft && scholarshipDraftDirty(draft)
    ? draft
    : {
        config: remote ?? defaultScholarshipConfig(target),
        base: remote,
        initial: remote ?? defaultScholarshipConfig(target),
      };
}
