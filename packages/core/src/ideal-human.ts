/** The 30 actual calendar days of the 2026 Ideal Human documentary experiment. */
export const IDEAL_HUMAN_START = "2026-11-03";
export const IDEAL_HUMAN_END = "2026-12-02";
export const IDEAL_HUMAN_LENGTH = 30;

export type IdealHumanTraining = "gym" | "recovery" | "other" | "none";

export interface IdealHumanDay {
  date: string;
  weightKg: number | null;
  sleepMinutes: number | null;
  caloriesKcal: number | null;
  proteinG: number | null;
  training: IdealHumanTraining | null;
  scienceMinutes: number | null;
  scienceTopic: string;
  scienceTakeaway: string;
  englishMinutes: number | null;
  codingMinutes: number | null;
  filmingMinutes: number | null;
  footageBackedUp: boolean | null;
  energy: number | null;
  highlights: string;
  notes: string;
}

export class IdealHumanInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdealHumanInputError";
  }
}

export function idealHumanDayNumber(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const time = Date.parse(date + "T00:00:00.000Z");
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date) return null;
  const day = Math.round((time - Date.parse(IDEAL_HUMAN_START + "T00:00:00.000Z")) / 86_400_000) + 1;
  return day >= 1 && day <= IDEAL_HUMAN_LENGTH ? day : null;
}

export function idealHumanDate(day: number): string {
  if (!Number.isInteger(day) || day < 1 || day > 30) throw new IdealHumanInputError("Day must be 1–30");
  return new Date(Date.parse(IDEAL_HUMAN_START + "T00:00:00.000Z") + (day - 1) * 86_400_000)
    .toISOString().slice(0, 10);
}

export function emptyIdealHumanDay(date: string): IdealHumanDay {
  if (!idealHumanDayNumber(date)) throw new IdealHumanInputError("Date outside experiment");
  return {
    date, weightKg: null, sleepMinutes: null, caloriesKcal: null, proteinG: null,
    training: null, scienceMinutes: null, scienceTopic: "", scienceTakeaway: "",
    englishMinutes: null, codingMinutes: null, filmingMinutes: null,
    footageBackedUp: null, energy: null, highlights: "", notes: "",
  };
}

export function parseIdealHumanDay(input: unknown): IdealHumanDay {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new IdealHumanInputError("Expected an object");
  const v = input as Record<string, unknown>;
  const allowed = new Set<keyof IdealHumanDay>([
    "date", "weightKg", "sleepMinutes", "caloriesKcal", "proteinG", "training",
    "scienceMinutes", "scienceTopic", "scienceTakeaway", "englishMinutes",
    "codingMinutes", "filmingMinutes", "footageBackedUp", "energy", "highlights", "notes",
  ]);
  for (const key of Object.keys(v)) {
    if (!allowed.has(key as keyof IdealHumanDay)) throw new IdealHumanInputError("Unexpected field");
  }
  if (typeof v.date !== "string" || idealHumanDayNumber(v.date) === null)
    throw new IdealHumanInputError("Invalid experiment date");
  const number = (field: keyof IdealHumanDay, min: number, max: number, integer = true): number | null => {
    const value = v[field];
    if (value === undefined || value === null) return null;
    if (typeof value !== "number" || !Number.isFinite(value) ||
        value < min || value > max || (integer && !Number.isInteger(value)))
      throw new IdealHumanInputError("Invalid " + field);
    return value;
  };
  const str = (field: keyof IdealHumanDay, max: number): string => {
    const value = v[field];
    if (value === undefined || value === null) return "";
    if (typeof value !== "string" || value.length > max)
      throw new IdealHumanInputError("Invalid " + field);
    return value.trim();
  };
  if (v.training !== null && v.training !== undefined &&
      !["gym", "recovery", "other", "none"].includes(String(v.training)))
    throw new IdealHumanInputError("Invalid training");
  if (v.footageBackedUp !== null && v.footageBackedUp !== undefined &&
      typeof v.footageBackedUp !== "boolean")
    throw new IdealHumanInputError("Invalid footageBackedUp");
  const day: IdealHumanDay = {
    date: v.date,
    weightKg: number("weightKg", 25, 300, false),
    sleepMinutes: number("sleepMinutes", 0, 1440),
    caloriesKcal: number("caloriesKcal", 0, 10000),
    proteinG: number("proteinG", 0, 400, false),
    training: v.training == null ? null : v.training as IdealHumanTraining,
    scienceMinutes: number("scienceMinutes", 0, 900),
    scienceTopic: str("scienceTopic", 160),
    scienceTakeaway: str("scienceTakeaway", 1500),
    englishMinutes: number("englishMinutes", 0, 900),
    codingMinutes: number("codingMinutes", 0, 900),
    filmingMinutes: number("filmingMinutes", 0, 900),
    footageBackedUp: v.footageBackedUp == null ? null : v.footageBackedUp as boolean,
    energy: number("energy", 1, 5),
    highlights: str("highlights", 500),
    notes: str("notes", 2000),
  };
  if (Object.entries(day).every(([key,value]) => key === "date" || value === null || value === ""))
    throw new IdealHumanInputError("Record at least one actual observation or reflection");
  return day;
}

export function idealHumanStats(days: readonly IdealHumanDay[]) {
  const mean = (values: number[]): number | null =>
    values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const measured = (field: "weightKg" | "sleepMinutes") =>
    days.map(day => day[field]).filter((v): v is number => v !== null);
  return {
    checkins: days.length,
    gymDays: days.filter(day => day.training === "gym").length,
    scienceMinutes: days.reduce((sum, d) => sum + (d.scienceMinutes ?? 0), 0),
    englishMinutes: days.reduce((sum, d) => sum + (d.englishMinutes ?? 0), 0),
    codingMinutes: days.reduce((sum, d) => sum + (d.codingMinutes ?? 0), 0),
    filmedDays: days.filter(day => (day.filmingMinutes ?? 0) > 0).length,
    avgWeightKg: mean(measured("weightKg")),
    avgSleepMinutes: mean(measured("sleepMinutes")),
  };
}
