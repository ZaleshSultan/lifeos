import {
  studyCalculatorStatesMatch,
  validateStudyCalculatorDefinition,
  type StudyCalculatorState,
} from "../../../../../packages/core/src/study.js";
import type { StudyWeekday, StudyWorkspaceCourse } from "../../api/study";

export const studyDays: { id: StudyWeekday; short: string; label: string }[] = [
  { id: "monday", short: "Пн", label: "Понедельник" },
  { id: "tuesday", short: "Вт", label: "Вторник" },
  { id: "wednesday", short: "Ср", label: "Среда" },
  { id: "thursday", short: "Чт", label: "Четверг" },
  { id: "friday", short: "Пт", label: "Пятница" },
  { id: "saturday", short: "Сб", label: "Суббота" },
  { id: "sunday", short: "Вс", label: "Воскресенье" },
];

export function studyWeekday(timezone: string, now = new Date()): StudyWeekday {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
  })
    .format(now)
    .toLowerCase() as StudyWeekday;
}

export function studyDaySessions(
  courses: StudyWorkspaceCourse[],
  day: StudyWeekday,
) {
  return courses
    .flatMap((course) =>
      course.schedules
        .filter((schedule) => schedule.dayOfWeek === day)
        .map((schedule) => ({ course, schedule })),
    )
    .sort((a, b) => a.schedule.startTime.localeCompare(b.schedule.startTime));
}

export interface StudyDraft {
  definition: StudyCalculatorState["definition"];
  inputs: Record<string, string>;
  target: string;
  saved: string;
}

export function isStudyDrafts(
  value: unknown,
): value is Record<string, StudyDraft> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length <= 100 &&
    entries.every(([id, entry]) => {
      if (
        !id ||
        ["__proto__", "constructor", "prototype"].includes(id) ||
        !entry ||
        typeof entry !== "object"
      )
        return false;
      const draft = entry as Record<string, unknown>;
      return (
        validateStudyCalculatorDefinition(draft.definition) &&
        typeof draft.target === "string" &&
        draft.target.length <= 12 &&
        typeof draft.saved === "string" &&
        draft.saved.length <= 20_000 &&
        draft.inputs !== null &&
        typeof draft.inputs === "object" &&
        !Array.isArray(draft.inputs) &&
        Object.entries(draft.inputs).length <= 100 &&
        Object.entries(draft.inputs).every(
          ([fieldId, score]) =>
            /^[a-z0-9][a-z0-9_-]{0,79}$/.test(fieldId) &&
            !["constructor", "prototype"].includes(fieldId) &&
            typeof score === "string" &&
            score.length <= 12,
        )
      );
    })
  );
}

function draftSignature(draft: Pick<StudyDraft, "inputs" | "target">): string {
  return JSON.stringify([
    Object.entries(draft.inputs).sort(([a], [b]) => a.localeCompare(b)),
    draft.target,
  ]);
}

export function createStudyDraft(state: StudyCalculatorState): StudyDraft {
  const draft = {
    definition: state.definition,
    inputs: Object.fromEntries(
      state.definition.fields.map((field) => [
        field.id,
        state.values[field.id] == null ? "" : String(state.values[field.id]),
      ]),
    ),
    target: String(state.target),
  };
  return { ...draft, saved: draftSignature(draft) };
}

export function studyDraftIsDirty(draft: StudyDraft): boolean {
  return draft.saved !== draftSignature(draft);
}

export function reconcileStudyDraft(
  draft: StudyDraft | undefined,
  remote: StudyCalculatorState,
): StudyDraft {
  const stored = createStudyDraft(remote);
  if (draft && studyDraftIsDirty(draft)) {
    if (
      [draft.target, ...Object.values(draft.inputs)].some((text) =>
        /[.,]$/.test(text.trim()),
      )
    )
      return draft;
    // A save can finish after this screen unmounts, leaving its recovery buffer
    // behind. Compare parsed values and the full formula before marking clean.
    const parsed = parseStudyDraft(draft).state;
    const parsedRemote = parseStudyDraft(stored).state;
    if (!parsed || !studyCalculatorStatesMatch(parsed, parsedRemote))
      return draft;
  }
  return stored;
}

export function parseStudyScore(input: string): number | null | "invalid" {
  const value = input.trim().replace(",", ".");
  if (value === "") return null;
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) return "invalid";
  const score = Number(value);
  return Number.isFinite(score) && score >= 0 && score <= 100
    ? score
    : "invalid";
}

export function parseStudyDraft(draft: StudyDraft): {
  state: StudyCalculatorState | null;
  invalidFields: string[];
  targetInvalid: boolean;
} {
  const values: Record<string, number | null> = {};
  const invalidFields: string[] = [];
  for (const field of draft.definition.fields) {
    const score = parseStudyScore(draft.inputs[field.id] ?? "");
    if (score === "invalid") invalidFields.push(field.id);
    else values[field.id] = score;
  }
  const target = parseStudyScore(draft.target);
  const targetInvalid = target === null || target === "invalid";
  return {
    state:
      invalidFields.length || targetInvalid
        ? null
        : { definition: draft.definition, values, target: target as number },
    invalidFields,
    targetInvalid,
  };
}

export function studyDateLabel(date: string): string {
  const [year, month, day] = date.split("-");
  return `${day}.${month}.${year}`;
}

const scoreFormatter = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 2,
});
export function studyScoreLabel(score: number | null): string {
  return score === null ? "—" : scoreFormatter.format(score);
}
