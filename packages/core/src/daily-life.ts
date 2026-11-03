import {
  IDEAL_HUMAN_TIMEZONE,
  defaultIdealHumanPlan,
  idealHumanDayNumber,
  idealHumanLocalDate,
  idealHumanStudyMinutes,
  type IdealHumanDay,
} from "./ideal-human.js";

export class DailyLifeInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DailyLifeInputError";
  }
}
export class DailyLifeConflictError extends Error {
  constructor() {
    super("The saved record changed. Reload before editing.");
    this.name = "DailyLifeConflictError";
  }
}
export interface HydrationEntry {
  id: string;
  amountMl: number;
  occurredAt: string;
  source: "telegram" | "tma" | "web";
  undoneAt: string | null;
}
export interface HydrationSummary {
  date: string;
  timezone: string;
  totalMl: number;
  entries: HydrationEntry[];
  truncated: boolean;
}
export interface TaskWorkspaceItem {
  id: string;
  title: string;
  notes: string;
  dueAt: string | null;
  priority?: number;
  status: "inbox" | "next" | "scheduled" | "waiting" | "done" | "cancelled";
  updatedAt: string;
  completedAt: string | null;
}
export interface TaskWorkspace {
  tasks: TaskWorkspaceItem[];
  truncated: boolean;
}
export interface DailyLifePreferences {
  revision: number;
  morningEnabled: boolean;
  morningTime: string;
  eveningEnabled: boolean;
  eveningTime: string;
  quietStart: string;
  quietEnd: string;
  hydrationRemindersEnabled: boolean;
  includeHealth: boolean;
  includeFilming: boolean;
}
export const DEFAULT_DAILY_LIFE_PREFERENCES: DailyLifePreferences = {
  revision: 0,
  morningEnabled: false,
  morningTime: "08:00",
  eveningEnabled: false,
  eveningTime: "21:00",
  quietStart: "22:00",
  quietEnd: "07:00",
  hydrationRemindersEnabled: false,
  includeHealth: false,
  includeFilming: true,
};
export function dailyLifeObject(
  input: unknown,
  allowed: readonly string[],
): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new DailyLifeInputError("Expected an object");
  const v = input as Record<string, unknown>;
  if (Object.keys(v).some((key) => !allowed.includes(key)))
    throw new DailyLifeInputError("Unexpected field");
  return v;
}
export function dailyLifeDate(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.startsWith("0000-") ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  )
    throw new DailyLifeInputError("Invalid date");
  const parsed = new Date(value + "T00:00:00Z");
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  )
    throw new DailyLifeInputError("Invalid date");
  return value;
}
export function dailyLifeRequestId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9:_-]{8,120}$/.test(value))
    throw new DailyLifeInputError("Invalid request ID");
  return value;
}
export function parseHydrationInput(input: unknown): {
  amountMl: number;
  requestId: string;
} {
  const v = dailyLifeObject(input, ["amountMl", "requestId"]);
  if (
    typeof v.amountMl !== "number" ||
    !Number.isInteger(v.amountMl) ||
    v.amountMl < 1 ||
    v.amountMl > 5000
  )
    throw new DailyLifeInputError("Water amount must be 1–5000 ml per entry");
  return { amountMl: v.amountMl, requestId: dailyLifeRequestId(v.requestId) };
}
export function parseDailyLifePreferences(
  input: unknown,
): DailyLifePreferences {
  const v = dailyLifeObject(input, Object.keys(DEFAULT_DAILY_LIFE_PREFERENCES));
  const result = { ...DEFAULT_DAILY_LIFE_PREFERENCES };
  for (const key of [
    "morningEnabled",
    "eveningEnabled",
    "hydrationRemindersEnabled",
    "includeHealth",
    "includeFilming",
  ] as const) {
    if (typeof v[key] !== "boolean")
      throw new DailyLifeInputError(
        "Choose notification and privacy preferences explicitly",
      );
    result[key] = v[key];
  }
  for (const key of [
    "morningTime",
    "eveningTime",
    "quietStart",
    "quietEnd",
  ] as const) {
    if (
      typeof v[key] !== "string" ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v[key] as string)
    )
      throw new DailyLifeInputError("Use HH:MM local time");
    result[key] = v[key] as string;
  }
  if (
    !Number.isSafeInteger(v.revision) ||
    (v.revision as number) < 0 ||
    (v.revision as number) > 2147483647
  )
    throw new DailyLifeInputError("Invalid revision");
  result.revision = v.revision as number;
  return result;
}
export interface MeasurementView {
  value: number;
  unit: string;
  source: string;
  updatedAt: string | null;
  confidence: number | null;
  stale: boolean;
}
export interface HealthProjection {
  sleepMinutes: MeasurementView | null;
  weightKg: MeasurementView | null;
  steps: MeasurementView | null;
  workoutMinutes: MeasurementView | null;
  lastSyncAt: string | null;
  sourceLabels: string[];
  missing: string[];
  devicePermissions: "not_reported";
  warnings: string[];
}
export function projectDailyHealth(input: {
  date: string;
  manual: IdealHumanDay | null;
  metrics: Partial<
    Record<"sleep_minutes" | "weight_kg" | "steps" | "workout_minutes", number>
  >;
  records: Array<{
    metricType: string;
    value: number;
    source: string;
    updatedAt: string;
    confidence: number | null;
  }>;
  now: Date;
}): HealthProjection {
  const date = dailyLifeDate(input.date);
  const measurement = (
    key: "sleep_minutes" | "weight_kg" | "steps" | "workout_minutes",
    manual: number | null,
    unit: string,
  ): MeasurementView | null => {
    if (manual !== null)
      return {
        value: manual,
        unit,
        source: "manual_journal",
        updatedAt: null,
        confidence: null,
        stale: false,
      };
    const value = input.metrics[key];
    if (value === undefined || !Number.isFinite(value)) return null;
    const record = input.records.find(
      (row) => row.metricType === key && row.value === value,
    );
    return {
      value,
      unit,
      source: record?.source ?? "recorded_health",
      updatedAt: record?.updatedAt ?? null,
      confidence: record?.confidence ?? null,
      stale:
        !record ||
        !Number.isFinite(Date.parse(record.updatedAt)) ||
        input.now.getTime() - Date.parse(record.updatedAt) > 48 * 3600000,
    };
  };
  const values = {
    sleepMinutes: measurement(
      "sleep_minutes",
      input.manual?.sleepMinutes ?? null,
      "minutes",
    ),
    weightKg: measurement("weight_kg", input.manual?.weightKg ?? null, "kg"),
    steps: measurement("steps", null, "steps"),
    workoutMinutes: measurement("workout_minutes", null, "minutes"),
  };
  const dates = input.records
    .map((r) => r.updatedAt)
    .filter((v) => Number.isFinite(Date.parse(v)))
    .sort();
  const warnings: string[] = [];
  if (Object.values(values).some((v) => v?.stale))
    warnings.push(
      "Recorded source measurements are stale; manual entries remain authoritative.",
    );
  if (input.date > idealHumanLocalDate(input.now))
    warnings.push("Future date: no health measurement is inferred.");
  return {
    ...values,
    lastSyncAt: dates.at(-1) ?? null,
    sourceLabels: [...new Set(input.records.map((r) => r.source))],
    missing: Object.entries(values)
      .filter(([, v]) => v === null)
      .map(([k]) => k),
    devicePermissions: "not_reported",
    warnings,
  };
}
export interface DocumentaryShot {
  kind: "a_roll" | "b_roll" | "reflection";
  title: string;
  reason: string;
}
export function documentaryPrompts(
  day: IdealHumanDay | null,
  date: string,
): DocumentaryShot[] {
  dailyLifeDate(date);
  const result: DocumentaryShot[] = [
    {
      kind: "a_roll",
      title: "Короткий видео-дневник: как начинаешь день",
      reason: "Предложение, а не запись о снятом материале",
    },
  ];
  const plan = day?.plan ?? [];
  for (const block of plan
    .filter((b) => ["university", "gym", "social"].includes(b.kind))
    .slice(0, 4))
    result.push({
      kind: "b_roll",
      title: block.title,
      reason:
        "Из твоего редактируемого плана; снимай только если событие состоится и съёмка уместна",
    });
  result.push({
    kind: "reflection",
    title: "Что получилось и что было трудно?",
    reason: "Честная вечерняя рефлексия; не требует идеального дня",
  });
  return result;
}
export interface BriefingView {
  title: string;
  facts: string[];
  suggestions: string[];
  warnings: string[];
  questions: string[];
  tomorrowOrder: string[];
}
export interface DailyLifeSummary {
  date: string;
  timezone: string;
  dayNumber: number | null;
  health: HealthProjection;
  /** Status from existing authenticated ingest runs; absent for older API deployments. */
  healthSync?: {
    available: boolean;
    latestStatus: "success" | "failed" | null;
    latestCompletedAt: string | null;
    recentSuccessAt: string | null;
    historyLimit: 5;
  };
  hydration: HydrationSummary | null;
  nutrition: {
    mealCount: number;
    caloriesKcal: number | null;
    proteinG: number | null;
    fatG: number | null;
    carbsG: number | null;
    estimated: boolean;
    incomplete: boolean;
  };
  morning: BriefingView;
  evening: BriefingView;
  documentary: {
    shots: DocumentaryShot[];
    filmingDays: number;
    backupConfirmedDays: number;
    weeklyReflection: string[];
  };
  sourceWarnings: string[];
  generatedBy: "deterministic";
}
export function buildDailyBriefings(input: {
  date: string;
  day: IdealHumanDay | null;
  health: HealthProjection;
  classes: Array<{ title: string; startTime: string; endTime: string }>;
  deadlines: Array<{ title: string; dueAt: string | null }>;
  tasks: TaskWorkspaceItem[];
  workouts: Array<{ title: string | null; startedAt: string; endedAt: string }>;
  lmsStale: boolean;
  sourceAvailability?: { tasks: boolean; workouts: boolean; journal?: boolean };
  deliveryPrivacy?: { includeHealth: boolean; includeFilming: boolean };
}): { morning: BriefingView; evening: BriefingView } {
  const warnings = input.lmsStale
    ? [
        "Данные AITU сохранены ранее; проверь актуальность расписания и дедлайнов.",
      ]
    : [];
  const morning: BriefingView = {
    title: "Утренний обзор",
    facts: [],
    suggestions: [],
    warnings: [...warnings],
    questions: [],
    tomorrowOrder: [],
  };
  if (input.classes.length)
    morning.facts.push(
      ...input.classes.map(
        (c) => `Сохранённое занятие: ${c.title} · ${c.startTime}–${c.endTime}`,
      ),
    );
  else
    morning.warnings.push(
      "Подтверждённых занятий в доступных данных нет; это не означает свободный день.",
    );
  morning.facts.push(
    ...input.deadlines
      .slice(0, 5)
      .map(
        (d) =>
          `Дедлайн: ${d.title}${d.dueAt ? ` · ${d.dueAt}` : " · дата неизвестна"}`,
      ),
  );
  const tasks = input.sourceAvailability?.tasks === false ? [] : input.tasks;
  const available = tasks
    .filter((t) => !["done", "cancelled"].includes(t.status))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  morning.facts.push(
    ...available.slice(0, 3).map((t) => `Открытая задача: ${t.title}`),
  );
  const plans = (
    input.day?.plan ??
    (idealHumanDayNumber(input.date) ? defaultIdealHumanPlan(input.date) : [])
  )
    .filter(
      (b) =>
        b.kind !== "morning" &&
        b.kind !== "evening" &&
        (input.deliveryPrivacy?.includeHealth !== false || b.kind !== "gym"),
    )
    .map((b) => b.title);
  if (plans.length)
    morning.facts.push("Порядок из твоего плана: " + plans.join(" → "));
  morning.suggestions.push("Выбери один посильный учебный приоритет.");
  if (input.deliveryPrivacy?.includeFilming !== false)
    morning.suggestions.push(
      "Если удобно, сними короткий дневник и уместные кадры реального дня.",
    );
  const evening: BriefingView = {
    title: "Вечерний обзор",
    facts: [],
    suggestions: [
      "Просмотри открытые задачи и реши, что перенести. Изменения не сохранены автоматически.",
    ],
    warnings: [...warnings],
    questions: [
      "Что получилось?",
      "Что было трудно?",
      "Что немного изменить завтра?",
    ],
    tomorrowOrder: available.slice(0, 5).map((t) => t.title),
  };
  if (input.sourceAvailability?.tasks === false) {
    morning.warnings.push(
      "Источник задач недоступен; приоритеты задач неизвестны.",
    );
    evening.warnings.push(
      "Источник задач недоступен; завершения и порядок на завтра неизвестны.",
    );
  }
  if (input.deliveryPrivacy?.includeHealth !== false) {
    const sleep = input.health.sleepMinutes;
    const recoveryNote = input.day?.recoveryNotes.trim() ?? "";
    const recoveryCharacters = Array.from(recoveryNote.replace(/\s+/g, " "));
    for (const view of [morning, evening]) {
      view.warnings.push(...input.health.warnings);
      if (sleep)
        view.facts.push(
          `Записанный сон: ${sleep.value} мин · ${sleep.source}${sleep.stale ? " · устаревшая запись" : ""}`,
        );
      else
        view.warnings.push(
          "Записанный сон недоступен в этом обзоре; оценка восстановления не выдумывается.",
        );
      if (recoveryNote)
        view.facts.push(
          `Твоя запись о восстановлении: ${recoveryCharacters.slice(0, 240).join("")}${recoveryCharacters.length > 240 ? "…" : ""} · manual_journal`,
        );
      else
        view.warnings.push(
          "Ручная запись о восстановлении недоступна в этом обзоре; оценка не выдумывается.",
        );
    }
  }
  const completed = tasks.filter(
    (t) =>
      t.completedAt &&
      idealHumanLocalDate(new Date(t.completedAt)) === input.date,
  );
  if (input.sourceAvailability?.tasks !== false)
    evening.facts.push(
      `Задач с фактической отметкой завершения сегодня: ${completed.length}.`,
    );
  if (
    input.deliveryPrivacy?.includeHealth !== false &&
    input.sourceAvailability?.workouts === false
  )
    evening.warnings.push(
      "Источник тренировок недоступен; число завершённых тренировок неизвестно.",
    );
  else if (
    input.deliveryPrivacy?.includeHealth !== false &&
    input.workouts.length
  )
    evening.facts.push(
      `Завершённых тренировок LifeOS: ${input.workouts.length}.`,
    );
  else if (input.deliveryPrivacy?.includeHealth !== false)
    evening.warnings.push(
      "Завершённая тренировка на эту дату не зарегистрирована.",
    );
  if (input.day) {
    const minutes = idealHumanStudyMinutes(input.day);
    if (minutes !== null) evening.facts.push(`Записано учёбы: ${minutes} мин.`);
    if (
      input.deliveryPrivacy?.includeHealth !== false &&
      input.day.meals.length
    )
      evening.facts.push(`Приёмов пищи записано: ${input.day.meals.length}.`);
    if (
      input.deliveryPrivacy?.includeFilming !== false &&
      (input.day.footageCaptured === true ||
        input.day.aRoll === true ||
        input.day.bRoll === true ||
        (input.day.footage?.length ?? 0) > 0)
    )
      evening.facts.push("Есть твоя отметка отснятого материала.");
    if (
      input.deliveryPrivacy?.includeFilming !== false &&
      input.day.footageBackedUp === true
    )
      evening.facts.push(
        "Резервная копия подтверждена тобой; LifeOS не проверял файлы.",
      );
  }
  if (!input.day)
    evening.warnings.push(
      input.sourceAvailability?.journal === false
        ? "Источник дневника недоступен; записи и достижения неизвестны."
        : "Дневник дня пока не сохранён; достижения не предполагаются.",
    );
  return { morning, evening };
}
export const DAILY_LIFE_TIMEZONE = IDEAL_HUMAN_TIMEZONE;
export const dailyLifeDayNumber = idealHumanDayNumber;

export function dailyLifeTimestamp(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,6})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(
      value,
    ) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new DailyLifeInputError("Use a valid date/time including timezone");
  dailyLifeDate(value.slice(0, 10));
  return value;
}
export function dailyLifeRecordId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new DailyLifeInputError("Invalid record ID");
  return value;
}

export function parseTaskMutation(
  input: unknown,
  update: boolean,
): {
  patch: Record<string, unknown>;
  requestId: string | null;
  expectedUpdatedAt: string | null;
} {
  const v = dailyLifeObject(input, [
    "title",
    "notes",
    "dueAt",
    ...(update ? ["status", "expectedUpdatedAt"] : ["requestId"]),
  ]);
  const patch: Record<string, unknown> = {};
  if (!update || v.title !== undefined) {
    if (typeof v.title !== "string" || !v.title.trim() || v.title.length > 500)
      throw new DailyLifeInputError("Task title must be 1–500 characters");
    patch.title = v.title.trim();
  }
  if (!update || v.notes !== undefined) {
    if (
      v.notes !== undefined &&
      (typeof v.notes !== "string" || v.notes.length > 5000)
    )
      throw new DailyLifeInputError("Invalid task notes");
    patch.notes = v.notes ?? "";
  }
  if (!update || v.dueAt !== undefined) {
    if (v.dueAt !== null && v.dueAt !== undefined) {
      dailyLifeTimestamp(v.dueAt);
    }
    patch.dueAt = v.dueAt ?? null;
  }
  if (v.status !== undefined) {
    if (
      typeof v.status !== "string" ||
      !["inbox", "next", "scheduled", "waiting", "done", "cancelled"].includes(
        v.status,
      )
    )
      throw new DailyLifeInputError("Invalid task status");
    patch.status = v.status;
  }
  if (update) dailyLifeTimestamp(v.expectedUpdatedAt);
  if (update && !Object.keys(patch).length)
    throw new DailyLifeInputError("No task changes supplied");
  return {
    patch,
    requestId: update ? null : dailyLifeRequestId(v.requestId),
    expectedUpdatedAt: update ? (v.expectedUpdatedAt as string) : null,
  };
}
