import { WorkoutInputError } from "./workout.js";

export const loadLabels = {
  smith: "Суммарный вес блинов, без грифа",
  dumbbells: "Вес одной гантели · 2 гантели",
  stack: "Указанный вес тренажёра",
  sled: "Нагрузка без веса платформы",
} as const;
export type LoadMode = keyof typeof loadLabels;
export const volumeCaption =
  "Тоннаж по указанным весам, без учёта грифа Смита и платформы жима ногами";

export interface SetPlan {
  slot: string;
  weightKg: number;
  reps: number;
  warmup: boolean;
}
export interface Lift {
  key: string;
  name: string;
  variant: string;
  mode: LoadMode;
  baseKg: number | null;
  step: number;
}
export interface PlannedLift extends Lift {
  sets: SetPlan[];
}
export interface PersonalTemplate {
  exercises: PlannedLift[];
  revision: number;
}
export interface PriorSet extends SetPlan {
  index: number;
  performedAt?: string;
}
export interface LiftSnapshot extends Lift {
  previous: PriorSet[];
  order: number;
}
export interface SetSnapshot {
  slot: string;
  warmup: boolean;
}
export type DraftChange =
  | {
      kind: "set";
      id: string;
      weightKg: number;
      reps: number;
      completed: boolean;
      warmup: boolean;
    }
  | {
      kind: "add";
      id: string;
      exercise: string;
      weightKg: number;
      reps: number;
      warmup: boolean;
    }
  | { kind: "remove"; id: string }
  | { kind: "step"; exercise: string; step: number }
  | { kind: "note"; text: string }
  | { kind: "finish" };

function lift(
  key: string,
  name: string,
  mode: LoadMode,
  step: number,
  values: number[][],
): PlannedLift {
  return {
    key,
    name,
    mode,
    step,
    variant: "",
    baseKg: null,
    sets: values.map(([weightKg, reps], i) => ({
      slot: "s" + (i + 1),
      weightKg,
      reps,
      warmup: false,
    })),
  };
}
export function fullBodyTemplate(): PlannedLift[] {
  return [
    lift("smith-squat", "Приседания в Смите", "smith", 5, [
      [20, 20],
      [40, 15],
      [50, 15],
    ]),
    lift("smith-bench", "Жим лёжа в Смите", "smith", 2.5, [
      [10, 20],
      [20, 8],
    ]),
    lift("incline-db", "Жим гантелей на наклонной", "dumbbells", 1, [
      [9, 12],
      [9, 12],
    ]),
    lift("pulldown", "Тяга верхнего блока", "stack", 5, [
      [35, 12],
      [35, 8],
      [30, 10],
      [25, 12],
    ]),
    lift("leg-press", "Жим ногами", "sled", 5, [
      [70, 12],
      [90, 12],
      [110, 12],
    ]),
    lift("lateral-db", "Махи гантелями в стороны", "dumbbells", 1, [
      [6, 12],
      [6, 12],
    ]),
  ];
}
function invalid(): never {
  throw new WorkoutInputError(
    "Проверь значения, названия и количество подходов.",
  );
}
function row(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : invalid();
}
function str(v: unknown, max: number, empty = false): string {
  return typeof v === "string" && v.trim().length <= max && (empty || v.trim())
    ? v.trim()
    : invalid();
}
function key(v: unknown): string {
  return typeof v === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(v)
    ? v
    : invalid();
}
function uuid(v: unknown): string {
  return typeof v === "string" &&
    /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(v)
    ? v
    : invalid();
}
function bool(v: unknown): boolean {
  return typeof v === "boolean" ? v : invalid();
}
function num(v: unknown, min: number, max: number, integer = false): number {
  if (
    typeof v !== "number" ||
    !Number.isFinite(v) ||
    v < min ||
    v > max ||
    (integer
      ? !Number.isInteger(v)
      : Math.abs(v * 100 - Math.round(v * 100)) > 0.000001)
  )
    invalid();
  return v;
}
function uniqueList<T>(
  v: unknown,
  max: number,
  parse: (v: unknown) => T,
  id: (t: T) => string,
): T[] {
  if (!Array.isArray(v) || !v.length || v.length > max) invalid();
  const items = v.map(parse);
  if (new Set(items.map(id)).size !== items.length) invalid();
  return items;
}
function values(r: Record<string, unknown>) {
  return {
    weightKg: num(r.weightKg, 0, 2000),
    reps: num(r.reps, 1, 1000, true),
    warmup: bool(r.warmup),
  };
}
export function parsePersonalTemplate(v: unknown): PersonalTemplate {
  const t = row(v);
  const exercises = uniqueList(
    t.exercises,
    30,
    (raw) => {
      const e = row(raw);
      if (typeof e.mode !== "string" || !Object.hasOwn(loadLabels, e.mode))
        invalid();
      return {
        key: key(e.key),
        name: str(e.name, 120),
        variant: str(e.variant, 120, true),
        mode: e.mode as LoadMode,
        baseKg: e.baseKg === null ? null : num(e.baseKg, 0, 2000),
        step: num(e.step, 0.01, 2000),
        sets: uniqueList(
          e.sets,
          30,
          (x) => {
            const r = row(x);
            return { slot: key(r.slot), ...values(r) };
          },
          (s) => s.slot,
        ),
      };
    },
    (e) => e.key,
  );
  return { exercises, revision: num(t.revision, 0, 2147483646, true) };
}
export function parseDraftCommand(v: unknown) {
  const r = row(v);
  let change: DraftChange;
  switch (r.kind) {
    case "set":
      change = {
        kind: r.kind,
        id: uuid(r.id),
        ...values(r),
        completed: bool(r.completed),
      };
      break;
    case "add":
      change = {
        kind: r.kind,
        id: uuid(r.id),
        exercise: key(r.exercise),
        ...values(r),
      };
      break;
    case "remove":
      change = { kind: r.kind, id: uuid(r.id) };
      break;
    case "step":
      change = {
        kind: r.kind,
        exercise: key(r.exercise),
        step: num(r.step, 0.01, 2000),
      };
      break;
    case "note":
      change = { kind: r.kind, text: str(r.text, 500, true) };
      break;
    case "finish":
      change = { kind: r.kind };
      break;
    default:
      invalid();
  }
  return {
    change,
    revision: num(r.revision, 0, 2147483646, true),
    requestId: uuid(r.requestId),
  };
}
export function comparableLift(lift: Lift): string {
  return JSON.stringify([
    lift.key,
    lift.name,
    lift.variant,
    lift.mode,
    lift.baseKg,
  ]);
}
interface CountedSet {
  completed: boolean;
  targetWeightKg?: number | null;
  targetReps?: number | null;
}
export function countedTotals(
  exercises: ReadonlyArray<{ load?: Lift; sets: ReadonlyArray<CountedSet> }>,
) {
  let sets = 0,
    reps = 0,
    hundredths = 0;
  for (const ex of exercises)
    for (const set of ex.sets) {
      if (!set.completed) continue;
      sets++;
      reps += set.targetReps ?? 0;
      hundredths +=
        Math.round((set.targetWeightKg ?? 0) * 100) *
        (set.targetReps ?? 0) *
        (ex.load?.mode === "dumbbells" ? 2 : 1);
    }
  return { sets, reps, volumeKg: hundredths / 100 };
}
