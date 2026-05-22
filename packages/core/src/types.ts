export type ISODateString = string;
export type ISODateTimeString = string;

export type LifeOSLayer = "kernel" | "health" | "fitness" | "finance";

export type Score10 = number;

export type HealthMode = "recovery" | "maintenance" | "baseline" | "growth";

export type LifeMode =
  | "exam_war"
  | "summer"
  | "trimester"
  | "recovery"
  | "project_sprint"
  | "maintenance";

export type LifeModeSource = "manual" | "auto" | "health" | "season" | "sprint";

export interface UserScopedEntity {
  id: string;
  userId: string;
  createdAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
}

export interface HealthSignals {
  sleepHours?: number;
  moodScore?: Score10;
  energyScore?: Score10;
  stressScore?: Score10;
  symptomSeverities?: Score10[];
}

export interface FocusScoreInput extends HealthSignals {
  openTaskCount?: number;
  healthMode?: HealthMode;
}

export interface FocusScoreResult {
  score: number;
  band: "low" | "medium" | "high";
  reasons: string[];
}

export interface ParsedDuration {
  minutes: number;
  raw: string;
}

export interface ParsedScore {
  value: Score10;
  raw: string;
}
