/** Private, calendar-based experiment. Defaults describe plans, never observations. */
export const IDEAL_HUMAN_START = "2026-11-03";
export const IDEAL_HUMAN_END = "2026-12-02";
export const IDEAL_HUMAN_LENGTH = 30;
export const IDEAL_HUMAN_TIMEZONE = "Asia/Almaty";
export const IDEAL_HUMAN_CONFIG = {
  startDate: IDEAL_HUMAN_START,
  endDate: IDEAL_HUMAN_END,
  length: IDEAL_HUMAN_LENGTH,
  timezone: IDEAL_HUMAN_TIMEZONE,
} as const;

export type IdealHumanTraining = "gym" | "recovery" | "other" | "none";
export interface IdealHumanMeal {
  id: string;
  label: string;
  caloriesKcal: number | null;
  proteinG: number | null;
  estimated: boolean;
  fatG?: number | null;
  carbsG?: number | null;
  mealTime?: string | null;
  portion?: string;
  analysisSource?:
    | "manual"
    | "gemini"
    | "agata"
    | "openrouter"
    | "openai"
    | "anthropic"
    | "chatgpt_plan";
  corrected?: boolean;
}
export interface IdealHumanFootage {
  id: string;
  label: string;
  kind: "a_roll" | "b_roll" | "reflection" | "other";
  capturedAt: string | null;
  filename: string;
  location: string;
  notes: string;
  backupStatus: "not_backed_up" | "user_confirmed";
  editingStatus: "not_started" | "in_progress" | "done";
  storyBeat: string;
}
export interface IdealHumanLearningSession {
  id: string;
  category: "programming" | "english" | "cybersecurity" | "science" | "other";
  topic: string;
  minutes: number | null;
  resource: string;
  notes: string;
  completed: boolean | null;
}
export interface IdealHumanPlanTask {
  id: string;
  title: string;
  completed: boolean | null;
}
export interface IdealHumanPlanBlock {
  id: string;
  title: string;
  notes: string;
  time: string | null;
  kind: "morning" | "university" | "gym" | "social" | "evening" | "flexible";
  tasks: IdealHumanPlanTask[];
}
export interface IdealHumanDay {
  date: string;
  /** Server revision; zero means no dedicated row has been saved yet. */
  revision: number;
  weightKg: number | null;
  baselineHeightCm: number | null;
  sleepMinutes: number | null;
  bedtime: string | null;
  wakeTime: string | null;
  caloriesKcal: number | null;
  proteinG: number | null;
  meals: IdealHumanMeal[];
  training: IdealHumanTraining | null;
  workoutEffort: number | null;
  workoutNotes: string;
  recoveryNotes: string;
  scienceMinutes: number | null;
  scienceTopic: string;
  scienceTakeaway: string;
  englishMinutes: number | null;
  codingMinutes: number | null;
  learningSessions: IdealHumanLearningSession[];
  studyPriorities: string;
  filmingMinutes: number | null;
  footageCaptured: boolean | null;
  aRoll: boolean | null;
  bRoll: boolean | null;
  footageBackedUp: boolean | null;
  editingStatus: "not_started" | "in_progress" | "done" | null;
  videoReflection: string;
  energy: number | null;
  mood: number | null;
  highlights: string;
  notes: string;
  whatWorked: string;
  whatDidNotWork: string;
  tomorrowPlan: string;
  plan: IdealHumanPlanBlock[];
  footage?: IdealHumanFootage[];
  storyboard?: string;
}

export class IdealHumanInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdealHumanInputError";
  }
}
export class IdealHumanConflictError extends Error {
  constructor() {
    super(
      "This day changed on another device. Reload the saved version before trying again.",
    );
    this.name = "IdealHumanConflictError";
  }
}

export function idealHumanDayNumber(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const time = Date.parse(date + "T00:00:00.000Z");
  if (
    !Number.isFinite(time) ||
    new Date(time).toISOString().slice(0, 10) !== date
  )
    return null;
  const day =
    Math.round(
      (time - Date.parse(IDEAL_HUMAN_START + "T00:00:00.000Z")) / 86_400_000,
    ) + 1;
  return day >= 1 && day <= IDEAL_HUMAN_LENGTH ? day : null;
}
export function idealHumanDate(day: number): string {
  if (!Number.isInteger(day) || day < 1 || day > IDEAL_HUMAN_LENGTH)
    throw new IdealHumanInputError("Day must be 1–30");
  return new Date(
    Date.parse(IDEAL_HUMAN_START + "T00:00:00.000Z") + (day - 1) * 86_400_000,
  )
    .toISOString()
    .slice(0, 10);
}
const idealHumanDateFormatter = new Intl.DateTimeFormat("sv-SE", {
  timeZone: IDEAL_HUMAN_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
export function idealHumanLocalDate(now: Date): string {
  if (!Number.isFinite(now.getTime()))
    throw new IdealHumanInputError("Invalid current date");
  return idealHumanDateFormatter.format(now);
}
export function idealHumanExperimentStatus(date: string) {
  if (!validIsoDate(date))
    throw new IdealHumanInputError("Invalid current date");
  const day = idealHumanDayNumber(date);
  return {
    phase:
      date < IDEAL_HUMAN_START
        ? ("upcoming" as const)
        : date > IDEAL_HUMAN_END
          ? ("complete" as const)
          : ("active" as const),
    day,
    daysRemaining: date < IDEAL_HUMAN_START ? 30 : day === null ? 0 : 30 - day,
  };
}
function validIsoDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const time = Date.parse(date + "T00:00:00.000Z");
  return (
    Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date
  );
}

export function defaultIdealHumanPlan(date: string): IdealHumanPlanBlock[] {
  if (!idealHumanDayNumber(date))
    throw new IdealHumanInputError("Date outside experiment");
  const block = (
    id: string,
    title: string,
    kind: IdealHumanPlanBlock["kind"],
    titles: string[],
    notes = "",
  ): IdealHumanPlanBlock => ({
    id,
    title,
    kind,
    notes,
    time: null,
    tasks: titles.map((title, index) => ({
      id: `${id}-${index + 1}`,
      title,
      completed: null,
    })),
  });
  const morning = block("morning", "Утро", "morning", [
    "Проснуться и записать продолжительность сна",
    "Измерить утренний вес",
    "Позавтракать",
    "Записать первое видео дня",
    "Проверить фактическое расписание университета",
  ]);
  const evening = block(
    "evening",
    "Гибкий вечер",
    "evening",
    [
      "Записать приёмы пищи",
      "Короткая учёба, если остаются силы",
      "Отметить энергию и настроение",
      "Записать рефлексию дня",
      "Проверить резервную копию отснятого материала",
      "Просмотреть план на завтра",
      "Подготовиться ко сну",
    ],
    "Время гибкое. Отдых и общение — часть нормальной жизни.",
  );
  if (date !== IDEAL_HUMAN_START)
    return [
      morning,
      block(
        "flexible",
        "Планы дня",
        "flexible",
        [],
        "Добавьте реальные занятия и события.",
      ),
      evening,
    ];
  return [
    morning,
    block(
      "university",
      "Университет",
      "university",
      [
        "Посетить занятия по реальному расписанию",
        "Выбрать учебные приоритеты",
        "При желании снять документальные кадры",
      ],
      "Пары и задания показываются только из существующей синхронизации AITU.",
    ),
    block(
      "gym",
      "Underground GYM с Алинуром",
      "gym",
      [
        "Выбрать посильную тренировку и размяться",
        "Записать упражнения, подходы, повторы и вес",
        "Отметить усилие и самочувствие после тренировки",
      ],
      "После университета; точное время неизвестно. Умеренная нагрузка, знакомые упражнения, без максимальных весов.",
    ),
    block(
      "mafia",
      "Спортивная Мафия",
      "social",
      ["Поиграть в Мафию"],
      "После зала. Общение — часть дня, а не провал продуктивности.",
    ),
    evening,
  ];
}

export function emptyIdealHumanDay(date: string): IdealHumanDay {
  if (!idealHumanDayNumber(date))
    throw new IdealHumanInputError("Date outside experiment");
  return {
    date,
    revision: 0,
    weightKg: null,
    baselineHeightCm: null,
    sleepMinutes: null,
    bedtime: null,
    wakeTime: null,
    caloriesKcal: null,
    proteinG: null,
    meals: [],
    training: null,
    workoutEffort: null,
    workoutNotes: "",
    recoveryNotes: "",
    scienceMinutes: null,
    scienceTopic: "",
    scienceTakeaway: "",
    englishMinutes: null,
    codingMinutes: null,
    learningSessions: [],
    studyPriorities: "",
    filmingMinutes: null,
    footageCaptured: null,
    aRoll: null,
    bRoll: null,
    footageBackedUp: null,
    editingStatus: null,
    videoReflection: "",
    energy: null,
    mood: null,
    highlights: "",
    notes: "",
    whatWorked: "",
    whatDidNotWork: "",
    tomorrowPlan: "",
    plan: defaultIdealHumanPlan(date),
  };
}

function object(
  value: unknown,
  keys: readonly string[],
  field: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new IdealHumanInputError("Invalid " + field);
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some((key) => !keys.includes(key)))
    throw new IdealHumanInputError("Unexpected field in " + field);
  return v;
}
function numeric(
  value: unknown,
  field: string,
  min: number,
  max: number,
  integer = true,
): number | null {
  if (value == null) return null;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  )
    throw new IdealHumanInputError("Invalid " + field);
  return value;
}
function textValue(value: unknown, field: string, max: number): string {
  if (value == null) return "";
  if (typeof value !== "string" || value.length > max)
    throw new IdealHumanInputError("Invalid " + field);
  return value.trim();
}
function flag(value: unknown, field: string): boolean | null {
  if (value == null) return null;
  if (typeof value !== "boolean")
    throw new IdealHumanInputError("Invalid " + field);
  return value;
}
function enumeration<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): T | null {
  if (value == null) return null;
  if (typeof value !== "string" || !allowed.includes(value as T))
    throw new IdealHumanInputError("Invalid " + field);
  return value as T;
}
function timeValue(value: unknown, field: string): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value))
    throw new IdealHumanInputError("Invalid " + field);
  return value;
}
function list<T>(
  value: unknown,
  field: string,
  max: number,
  parse: (value: unknown) => T,
): T[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > max)
    throw new IdealHumanInputError("Invalid " + field);
  return value.map(parse);
}
function identifier(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(value))
    throw new IdealHumanInputError("Invalid item id");
  return value;
}
function uniqueIds(items: { id: string }[], field: string): void {
  if (new Set(items.map((item) => item.id)).size !== items.length)
    throw new IdealHumanInputError("Duplicate " + field + " id");
}

function planSignature(plan: IdealHumanPlanBlock[]): string {
  return JSON.stringify(
    plan.map((b) => [
      b.id,
      b.title,
      b.notes,
      b.time,
      b.kind,
      b.tasks.map((t) => [t.id, t.title, t.completed]),
    ]),
  );
}

/** Full-day replacement; missing old fields are defaulted for legacy compatibility. CAS protects edits. */
export function parseIdealHumanDay(input: unknown): IdealHumanDay {
  return parseDay(input, false);
}

/** Trusted persisted rows can be empty after an explicit reflection clear.
 * Never use this parser for ordinary client day writes. A revision is not
 * evidence of persistence; callers must first read the owner-scoped row. */
export function parseStoredIdealHumanDay(input: unknown): IdealHumanDay {
  const day = parseDay(input, true);
  if (day.revision < 1)
    throw new IdealHumanInputError("Invalid stored revision");
  return day;
}

function parseDay(input: unknown, allowEmpty: boolean): IdealHumanDay {
  const v = object(
    input,
    [
      ...Object.keys(emptyIdealHumanDay(IDEAL_HUMAN_START)),
      "footage",
      "storyboard",
    ],
    "day",
  );
  if (typeof v.date !== "string" || idealHumanDayNumber(v.date) === null)
    throw new IdealHumanInputError("Invalid experiment date");
  const day = emptyIdealHumanDay(v.date);
  day.revision = numeric(v.revision, "revision", 0, 2_147_483_647) ?? 0;
  day.weightKg = numeric(v.weightKg, "weightKg", 25, 300, false);
  day.baselineHeightCm = numeric(
    v.baselineHeightCm,
    "baselineHeightCm",
    80,
    250,
    false,
  );
  day.sleepMinutes = numeric(v.sleepMinutes, "sleepMinutes", 0, 1440);
  day.bedtime = timeValue(v.bedtime, "bedtime");
  day.wakeTime = timeValue(v.wakeTime, "wakeTime");
  day.caloriesKcal = numeric(v.caloriesKcal, "caloriesKcal", 0, 10000);
  day.proteinG = numeric(v.proteinG, "proteinG", 0, 400, false);
  day.training = enumeration(v.training, "training", [
    "gym",
    "recovery",
    "other",
    "none",
  ]);
  day.workoutEffort = numeric(v.workoutEffort, "workoutEffort", 1, 10);
  for (const field of [
    "scienceMinutes",
    "englishMinutes",
    "codingMinutes",
    "filmingMinutes",
  ] as const)
    day[field] = numeric(v[field], field, 0, 900);
  for (const field of ["energy", "mood"] as const)
    day[field] = numeric(v[field], field, 1, 5);
  for (const field of [
    "footageBackedUp",
    "footageCaptured",
    "aRoll",
    "bRoll",
  ] as const)
    day[field] = flag(v[field], field);
  day.editingStatus = enumeration(v.editingStatus, "editingStatus", [
    "not_started",
    "in_progress",
    "done",
  ]);
  day.scienceTopic = textValue(v.scienceTopic, "scienceTopic", 160);
  day.scienceTakeaway = textValue(v.scienceTakeaway, "scienceTakeaway", 1500);
  day.highlights = textValue(v.highlights, "highlights", 500);
  for (const field of [
    "notes",
    "whatWorked",
    "whatDidNotWork",
    "tomorrowPlan",
    "recoveryNotes",
    "workoutNotes",
    "studyPriorities",
    "videoReflection",
  ] as const)
    day[field] = textValue(v[field], field, 2000);
  day.meals = list(v.meals, "meals", 30, (entry) => {
    const m = object(
      entry,
      [
        "id",
        "label",
        "caloriesKcal",
        "proteinG",
        "estimated",
        "fatG",
        "carbsG",
        "mealTime",
        "portion",
        "analysisSource",
        "corrected",
      ],
      "meal",
    );
    const label = textValue(m.label, "meal label", 240);
    if (!label) throw new IdealHumanInputError("Meal needs a description");
    return {
      id: identifier(m.id),
      label,
      caloriesKcal: numeric(m.caloriesKcal, "meal calories", 0, 10000),
      proteinG: numeric(m.proteinG, "meal protein", 0, 400, false),
      estimated: flag(m.estimated, "estimated") ?? true,
      ...(m.fatG !== undefined
        ? { fatG: numeric(m.fatG, "meal fat", 0, 1000, false) }
        : {}),
      ...(m.carbsG !== undefined
        ? { carbsG: numeric(m.carbsG, "meal carbs", 0, 2000, false) }
        : {}),
      ...(m.mealTime !== undefined
        ? { mealTime: timeValue(m.mealTime, "meal time") }
        : {}),
      ...(m.portion !== undefined
        ? { portion: textValue(m.portion, "portion", 240) }
        : {}),
      ...(m.analysisSource !== undefined
        ? {
            analysisSource:
              enumeration(m.analysisSource, "analysis source", [
                "manual",
                "gemini",
                "agata",
                "openrouter",
                "openai",
                "anthropic",
                "chatgpt_plan",
              ] as const) ?? ("manual" as const),
          }
        : {}),
      ...(m.corrected !== undefined
        ? { corrected: flag(m.corrected, "corrected") ?? false }
        : {}),
    };
  });
  uniqueIds(day.meals, "meal");
  if (v.storyboard !== undefined)
    day.storyboard = textValue(v.storyboard, "storyboard", 4000);
  if (v.footage !== undefined) {
    day.footage = list(v.footage, "footage", 80, (item) => {
      const f = object(
        item,
        [
          "id",
          "label",
          "kind",
          "capturedAt",
          "filename",
          "location",
          "notes",
          "backupStatus",
          "editingStatus",
          "storyBeat",
        ],
        "footage",
      );
      const label = textValue(f.label, "footage label", 240);
      const kind = enumeration(f.kind, "footage kind", [
        "a_roll",
        "b_roll",
        "reflection",
        "other",
      ] as const);
      const backupStatus = enumeration(f.backupStatus, "backup status", [
        "not_backed_up",
        "user_confirmed",
      ] as const);
      const editingStatus = enumeration(f.editingStatus, "editing status", [
        "not_started",
        "in_progress",
        "done",
      ] as const);
      if (!label || !kind || !backupStatus || !editingStatus)
        throw new IdealHumanInputError("Invalid footage metadata");
      let capturedAt: string | null = null;
      if (f.capturedAt != null) {
        if (
          typeof f.capturedAt !== "string" ||
          !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(f.capturedAt) ||
          !Number.isFinite(Date.parse(f.capturedAt)) ||
          !validIsoDate(f.capturedAt.slice(0, 10))
        )
          throw new IdealHumanInputError("Invalid capture time");
        capturedAt = f.capturedAt;
      }
      return {
        id: identifier(f.id),
        label,
        kind,
        backupStatus,
        editingStatus,
        capturedAt,
        filename: textValue(f.filename, "filename", 240),
        location: textValue(f.location, "location", 1000),
        notes: textValue(f.notes, "footage notes", 2000),
        storyBeat: textValue(f.storyBeat, "story beat", 1000),
      };
    });
    uniqueIds(day.footage, "footage");
  }

  day.learningSessions = list(
    v.learningSessions,
    "learningSessions",
    40,
    (entry) => {
      const l = object(
        entry,
        [
          "id",
          "category",
          "topic",
          "minutes",
          "resource",
          "notes",
          "completed",
        ],
        "learning session",
      );
      const category = enumeration(l.category, "learning category", [
        "programming",
        "english",
        "cybersecurity",
        "science",
        "other",
      ]);
      if (!category)
        throw new IdealHumanInputError("Learning session needs a category");
      return {
        id: identifier(l.id),
        category,
        topic: textValue(l.topic, "learning topic", 240),
        minutes: numeric(l.minutes, "learning minutes", 0, 900),
        resource: textValue(l.resource, "resource", 1000),
        notes: textValue(l.notes, "learning notes", 2000),
        completed: flag(l.completed, "learning completion"),
      };
    },
  );
  uniqueIds(day.learningSessions, "learning session");
  if (v.plan !== undefined) {
    day.plan = list(v.plan, "plan", 20, (entry) => {
      const b = object(
        entry,
        ["id", "title", "notes", "time", "kind", "tasks"],
        "plan block",
      );
      const kind = enumeration(b.kind, "block kind", [
        "morning",
        "university",
        "gym",
        "social",
        "evening",
        "flexible",
      ]);
      const title = textValue(b.title, "block title", 240);
      if (!kind || !title)
        throw new IdealHumanInputError("Plan block needs a title and kind");
      const tasks = list(b.tasks, "tasks", 30, (item) => {
        const t = object(item, ["id", "title", "completed"], "plan task");
        const title = textValue(t.title, "task title", 240);
        if (!title) throw new IdealHumanInputError("Task needs a title");
        return {
          id: identifier(t.id),
          title,
          completed: flag(t.completed, "task completion"),
        };
      });
      uniqueIds(tasks, "task");
      return {
        id: identifier(b.id),
        title,
        notes: textValue(b.notes, "block notes", 2000),
        time: timeValue(b.time, "block time"),
        kind,
        tasks,
      };
    });
    uniqueIds(day.plan, "plan block");
  }
  const configured =
    day.studyPriorities ||
    day.tomorrowPlan ||
    day.baselineHeightCm !== null ||
    Boolean(day.storyboard) ||
    planSignature(day.plan) !== planSignature(defaultIdealHumanPlan(day.date));
  if (!allowEmpty && !hasIdealHumanObservation(day) && !configured)
    throw new IdealHumanInputError(
      "Record at least one observation, reflection, or plan change",
    );
  if (new TextEncoder().encode(JSON.stringify(day)).length > 131072)
    throw new IdealHumanInputError(
      "Day entry is too large; shorten notes or export them separately",
    );
  return day;
}

/** Explicitly scoped evening history; plans and other domain notes are retained. */
export function hasIdealHumanReflection(day: IdealHumanDay): boolean {
  return (
    day.energy !== null ||
    day.mood !== null ||
    [day.whatWorked, day.whatDidNotWork, day.highlights, day.notes].some(
      Boolean,
    )
  );
}

export function clearIdealHumanReflection(day: IdealHumanDay): IdealHumanDay {
  return {
    ...day,
    energy: null,
    mood: null,
    whatWorked: "",
    whatDidNotWork: "",
    highlights: "",
    notes: "",
  };
}

export function parseIdealHumanReflectionClear(input: unknown): {
  date: string;
  expectedRevision: number;
  confirmed: true;
} {
  const value = object(
    input,
    ["date", "expectedRevision", "confirmed"],
    "reflection clear",
  );
  if (
    typeof value.date !== "string" ||
    idealHumanDayNumber(value.date) === null
  )
    throw new IdealHumanInputError("Invalid experiment date");
  if (
    typeof value.expectedRevision !== "number" ||
    !Number.isSafeInteger(value.expectedRevision) ||
    value.expectedRevision < 1 ||
    value.expectedRevision >= 2_147_483_647
  )
    throw new IdealHumanInputError(
      "Reload the saved day before clearing reflection",
    );
  if (value.confirmed !== true)
    throw new IdealHumanInputError("Confirm clearing the evening reflection");
  return {
    date: value.date,
    expectedRevision: value.expectedRevision,
    confirmed: true,
  };
}

/** Planning ahead does not create an observed check-in or a completed journal. */
export function hasIdealHumanObservation(day: IdealHumanDay): boolean {
  return (
    [
      day.weightKg,
      day.sleepMinutes,
      day.bedtime,
      day.wakeTime,
      day.caloriesKcal,
      day.proteinG,
      day.training,
      day.workoutEffort,
      day.scienceMinutes,
      day.englishMinutes,
      day.codingMinutes,
      day.filmingMinutes,
      day.footageCaptured,
      day.aRoll,
      day.bRoll,
      day.footageBackedUp,
      day.editingStatus,
      day.energy,
      day.mood,
    ].some((v) => v !== null) ||
    [
      day.scienceTopic,
      day.scienceTakeaway,
      day.workoutNotes,
      day.recoveryNotes,
      day.videoReflection,
      day.highlights,
      day.notes,
      day.whatWorked,
      day.whatDidNotWork,
    ].some(Boolean) ||
    day.meals.length > 0 ||
    (day.footage?.length ?? 0) > 0 ||
    day.learningSessions.some(
      (l) => l.minutes !== null || l.completed !== null || Boolean(l.notes),
    ) ||
    day.plan.some((b) => b.tasks.some((t) => t.completed !== null))
  );
}
export function idealHumanStudyMinutes(day: IdealHumanDay): number | null {
  const categories = [
    "science",
    "english",
    "programming",
    "cybersecurity",
    "other",
  ] as const;
  const legacy = {
    science: day.scienceMinutes,
    english: day.englishMinutes,
    programming: day.codingMinutes,
    cybersecurity: null,
    other: null,
  };
  const values = categories
    .map((category) => {
      const logged = day.learningSessions
        .filter((l) => l.category === category && l.minutes !== null)
        .map((l) => l.minutes!);
      return logged.length
        ? logged.reduce((a, b) => a + b, 0)
        : legacy[category];
    })
    .filter((v): v is number => v !== null);
  return values.length ? values.reduce((a, b) => a + b, 0) : null;
}
export function idealHumanAdherence(day: IdealHumanDay): number | null {
  const answered = day.plan
    .flatMap((b) => b.tasks)
    .filter((t) => t.completed !== null);
  return answered.length
    ? answered.filter((t) => t.completed === true).length / answered.length
    : null;
}
export function idealHumanStats(
  days: readonly IdealHumanDay[],
  workoutDates?: readonly string[],
) {
  const uniqueDays = [...new Map(days.map((day) => [day.date, day])).values()]
    .filter((day) => idealHumanDayNumber(day.date) !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
  const observed = uniqueDays.filter(hasIdealHumanObservation);
  const mean = (values: number[]): number | null =>
    values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : null;
  const measured = (field: "weightKg" | "sleepMinutes") =>
    uniqueDays.map((day) => day[field]).filter((v): v is number => v !== null);
  const trainingDates = new Set(
    (
      workoutDates ??
      uniqueDays.filter((d) => d.training === "gym").map((d) => d.date)
    ).filter((date) => idealHumanDayNumber(date) !== null),
  );
  const sleep = measured("sleepMinutes");
  const study = uniqueDays
    .map(idealHumanStudyMinutes)
    .filter((v): v is number => v !== null);
  const weekly = Array.from({ length: 5 }, (_, index) => {
    const week = uniqueDays.filter(
      (day) => Math.floor((idealHumanDayNumber(day.date)! - 1) / 7) === index,
    );
    const weekStudy = week
      .map(idealHumanStudyMinutes)
      .filter((v): v is number => v !== null);
    return {
      week: index + 1,
      recordedDays: week.filter(hasIdealHumanObservation).length,
      totalDays: index === 4 ? 2 : 7,
      avgSleepMinutes: mean(
        week.map((d) => d.sleepMinutes).filter((v): v is number => v !== null),
      ),
      avgWeightKg: mean(
        week.map((d) => d.weightKg).filter((v): v is number => v !== null),
      ),
      studyMinutes: weekStudy.length
        ? weekStudy.reduce((a, b) => a + b, 0)
        : null,
      adherence: mean(
        week.map(idealHumanAdherence).filter((v): v is number => v !== null),
      ),
    };
  });
  return {
    checkins: observed.length,
    journalDays: uniqueDays.filter((d) =>
      [d.notes, d.whatWorked, d.whatDidNotWork, d.videoReflection].some(
        Boolean,
      ),
    ).length,
    gymDays: trainingDates.size,
    scienceMinutes: uniqueDays.reduce(
      (sum, d) =>
        sum +
        (d.learningSessions.some(
          (l) => l.category === "science" && l.minutes !== null,
        )
          ? d.learningSessions
              .filter((l) => l.category === "science")
              .reduce((s, l) => s + (l.minutes ?? 0), 0)
          : (d.scienceMinutes ?? 0)),
      0,
    ),
    englishMinutes: uniqueDays.reduce(
      (sum, d) =>
        sum +
        (d.learningSessions.some(
          (l) => l.category === "english" && l.minutes !== null,
        )
          ? d.learningSessions
              .filter((l) => l.category === "english")
              .reduce((s, l) => s + (l.minutes ?? 0), 0)
          : (d.englishMinutes ?? 0)),
      0,
    ),
    codingMinutes: uniqueDays.reduce(
      (sum, d) =>
        sum +
        (d.learningSessions.some(
          (l) => l.category === "programming" && l.minutes !== null,
        )
          ? d.learningSessions
              .filter((l) => l.category === "programming")
              .reduce((s, l) => s + (l.minutes ?? 0), 0)
          : (d.codingMinutes ?? 0)),
      0,
    ),
    studyMinutes: study.length ? study.reduce((a, b) => a + b, 0) : null,
    filmedDays: uniqueDays.filter(
      (d) =>
        d.footageCaptured === true ||
        d.aRoll === true ||
        d.bRoll === true ||
        (d.filmingMinutes ?? 0) > 0 ||
        (d.footage?.length ?? 0) > 0,
    ).length,
    avgWeightKg: mean(measured("weightKg")),
    avgSleepMinutes: mean(sleep),
    sleepVariationMinutes:
      sleep.length > 1
        ? Math.sqrt(
            sleep.reduce((sum, n) => sum + (n - mean(sleep)!) ** 2, 0) /
              sleep.length,
          )
        : null,
    adherence: mean(
      uniqueDays
        .map(idealHumanAdherence)
        .filter((v): v is number => v !== null),
    ),
    weekly,
    weightTrend: uniqueDays
      .filter((d) => d.weightKg !== null)
      .map((d) => ({ date: d.date, value: d.weightKg! })),
    sleepTrend: uniqueDays
      .filter((d) => d.sleepMinutes !== null)
      .map((d) => ({ date: d.date, value: d.sleepMinutes! })),
  };
}
