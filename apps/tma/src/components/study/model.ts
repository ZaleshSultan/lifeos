import type { StudyCalculatorState } from "../../../../../packages/core/src/study.js";
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
    timeZone: studyTimezone(timezone),
    weekday: "long",
  })
    .format(now)
    .toLowerCase() as StudyWeekday;
}

export function studyTimezone(timezone?: string | null): string {
  try {
    if (!timezone) return "Asia/Almaty";
    new Intl.DateTimeFormat("ru", { timeZone: timezone });
    return timezone;
  } catch {
    return "Asia/Almaty";
  }
}

export function studyLocalDate(value: string | Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: studyTimezone(timezone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

export function studyLocalTime(value: string, timezone: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: studyTimezone(timezone),
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

/** Converts the profile's local wall clock, independently of the browser timezone. */
export function studyWallTimeToIso(
  value: string,
  timezone: string,
): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const target = Date.UTC(
    ...([
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
    ] as [number, number, number, number, number]),
  );
  let instant = target;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: studyTimezone(timezone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(
      formatter
        .formatToParts(new Date(instant))
        .map((part) => [part.type, part.value]),
    );
    const represented = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
    );
    instant += target - represented;
  }
  return new Date(instant).toISOString();
}

export function studyIsoToWallTime(
  value: string | null,
  timezone: string,
): string {
  if (!value) return "";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: studyTimezone(timezone),
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(value))
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function studySessionIsOnline(session: {
  room: string | null;
  sessionType: string | null;
}): boolean {
  return /online|remote|zoom|teams|онлайн|дистанц/i.test(
    `${session.sessionType ?? ""} ${session.room ?? ""}`,
  );
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
  maxima?: Record<string, string>;
  kinds?: Record<string, "actual" | "assumed">;
  pointValues?: Record<string, boolean>;
  sources?: Record<string, string>;
  attendance?: string;
  target: string;
  saved: string;
}

function draftSignature(
  draft: Pick<
    StudyDraft,
    "inputs" | "target" | "maxima" | "kinds" | "pointValues" | "attendance"
  >,
): string {
  return JSON.stringify([
    Object.entries(draft.inputs).sort(([a], [b]) => a.localeCompare(b)),
    draft.target,
    draft.maxima,
    draft.kinds,
    draft.pointValues,
    draft.attendance,
  ]);
}

export function createStudyDraft(state: StudyCalculatorState): StudyDraft {
  const draft = {
    definition: state.definition,
    inputs: Object.fromEntries(
      state.definition.fields.map((field) => [
        field.id,
        state.values[field.id] == null
          ? ""
          : typeof state.values[field.id] === "number"
            ? String(state.values[field.id])
            : String((state.values[field.id] as { earned: number }).earned),
      ]),
    ),
    maxima: Object.fromEntries(
      state.definition.fields.map((field) => {
        const value = state.values[field.id];
        return [
          field.id,
          typeof value === "object" && value
            ? String(value.max)
            : String(state.maxima?.[field.id] ?? field.maxScore ?? 100),
        ];
      }),
    ),
    kinds: Object.fromEntries(
      state.definition.fields.map((field) => {
        const value = state.values[field.id];
        return [
          field.id,
          typeof value === "object" && value
            ? ((value as { kind?: "actual" | "assumed" }).kind ?? "assumed")
            : "assumed",
        ];
      }),
    ) as Record<string, "actual" | "assumed">,
    pointValues: Object.fromEntries(
      state.definition.fields.map((field) => [
        field.id,
        (typeof state.values[field.id] === "object" &&
          state.values[field.id] !== null) ||
          (state.values[field.id] == null &&
            (field.maxScore !== undefined ||
              state.maxima?.[field.id] !== undefined)),
      ]),
    ),
    sources: Object.fromEntries(
      state.definition.fields.map((field) => [
        field.id,
        typeof state.values[field.id] === "object" && state.values[field.id]
          ? ((state.values[field.id] as { source?: string }).source ?? "")
          : "",
      ]),
    ),
    target: String(state.target),
    attendance:
      state.attendancePercent == null ? "" : String(state.attendancePercent),
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
  return draft && studyDraftIsDirty(draft) ? draft : createStudyDraft(remote);
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
  const values: StudyCalculatorState["values"] = {};
  const maxima: Record<string, number> = {};
  const invalidFields: string[] = [];
  for (const field of draft.definition.fields) {
    const input = (draft.inputs[field.id] ?? "").trim().replace(",", ".");
    const max = Number((draft.maxima?.[field.id] ?? "100").replace(",", "."));
    if (draft.pointValues?.[field.id] && (!Number.isFinite(max) || max <= 0)) {
      invalidFields.push(field.id);
      continue;
    }
    const score = draft.pointValues?.[field.id]
      ? input === ""
        ? null
        : !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(input) ||
            !Number.isFinite(max) ||
            max <= 0 ||
            Number(input) > max
          ? "invalid"
          : Number(input)
      : parseStudyScore(input);
    if (score === "invalid") invalidFields.push(field.id);
    else {
      values[field.id] =
        score === null || !draft.pointValues?.[field.id]
          ? score
          : ({
              earned: score,
              max,
              kind: draft.kinds?.[field.id] ?? "assumed",
              ...(draft.sources?.[field.id]
                ? { source: draft.sources[field.id] }
                : {}),
            } as StudyCalculatorState["values"][string]);
      if (
        score === null &&
        draft.pointValues?.[field.id] &&
        max !== (field.maxScore ?? 100)
      )
        maxima[field.id] = max;
    }
  }
  const target = parseStudyScore(draft.target);
  const targetInvalid = target === null || target === "invalid";
  const attendance = parseStudyScore(draft.attendance ?? "");
  if (attendance === "invalid") invalidFields.push("attendance");
  return {
    state:
      invalidFields.length || targetInvalid
        ? null
        : {
            definition: draft.definition,
            values,
            target: target as number,
            ...(Object.keys(maxima).length ? { maxima } : {}),
            ...(attendance === null
              ? {}
              : { attendancePercent: attendance as number }),
          },
    invalidFields,
    targetInvalid,
  };
}

export function studyDateLabel(date: string): string {
  const [year, month, day] = date.split("-");
  return `${day}.${month}.${year}`;
}

const studyScoreFormatter = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 1,
});

export function studyScoreLabel(score: number | null): string {
  return score === null ? "—" : studyScoreFormatter.format(score);
}

export function studyProvenanceLabel(source: string): string {
  return (
    (
      {
        manual_confirmed: "Реальная оценка, введена вручную",
        manual_scenario: "Ручное допущение",
        manual_override: "Ручной override",
        manual: "LifeOS: ручной ввод",
      } as Record<string, string>
    )[source] ?? source
  );
}
