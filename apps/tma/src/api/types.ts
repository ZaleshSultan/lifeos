export type RecoveryMode = "recovery" | "maintenance" | "baseline" | "growth";

export type LifeMode =
  | "exam_war"
  | "summer"
  | "trimester"
  | "recovery"
  | "project_sprint"
  | "maintenance";

export type LifeModeSource =
  | "manual"
  | "auto"
  | "health"
  | "season"
  | "sprint"
  | "default";

export const recoveryModeLabels: Record<RecoveryMode, string> = {
  recovery: "Recovery Mode",
  maintenance: "Normal-Light",
  baseline: "Normal",
  growth: "High Performance",
};

export interface ApiEnvelope<T> {
  data: T;
}

export interface HomeSummary {
  displayName?: string;
  localDate: string;
  mode: LifeMode;
  modeLabel: string;
  modeReason: string;
  recoveryMode: RecoveryMode;
  focusScore: number | null;
  activeWorkout?: {
    id: string;
    title: string;
    startedAt: string;
    progressPercent: number;
  } | null;
  healthCompletenessScore?: number | null;
  pendingSyncCount?: number;
}

export interface WorkoutSet {
  id: string;
  index: number;
  targetReps?: number | null;
  targetWeightKg?: number | null;
  completed: boolean;
  completedAt?: string | null;
}

export interface WorkoutExercise {
  id: string;
  name: string;
  note?: string | null;
  sets: WorkoutSet[];
}

export interface CurrentWorkout {
  id: string;
  title: string;
  mode: string;
  startedAt: string;
  progressPercent: number;
  completedSets: number;
  totalSets: number;
  restTimerEndsAt?: string | null;
  exercises: WorkoutExercise[];
}

export interface HealthSummary {
  date: string;
  lifeMode: LifeMode;
  lifeModeLabel: string;
  recommendation: string;
  recoveryMode: RecoveryMode;
  dataCompletenessScore: number;
  sleepMinutes?: number | null;
  deepSleepMinutes?: number | null;
  remSleepMinutes?: number | null;
  awakeMinutes?: number | null;
  restingHeartRate?: number | null;
  hrvMs?: number | null;
  spo2Avg?: number | null;
  steps?: number | null;
  activeEnergyKcal?: number | null;
  missingMetrics?: Record<string, boolean>;
  samplesCount?: number;
}

export interface FocusSummary {
  score: number;
  band: "low" | "medium" | "high";
  mode: RecoveryMode;
  lifeMode: LifeMode;
  lifeModeLabel: string;
  lifeModeReason: string;
  reasons: string[];
  nextBestAction?: string | null;
  openTaskCount?: number;
  topItems?: Array<{
    id: string;
    title: string;
    modeScore: number;
    modePriorityDelta: number;
    modePriorityMatches: string[];
  }>;
  priorityWeights?: Record<string, number>;
}

export interface ModeSummary {
  userId: string;
  mode: LifeMode;
  label: string;
  source: LifeModeSource;
  reason: string;
  activeUntil: string | null;
  priorityWeights: Record<string, number>;
  resolvedAt: string;
}

export interface SaveModeInput {
  mode: LifeMode | "auto";
  duration?: "today" | "7_days" | "until_date" | "permanent";
  untilDate?: string;
}
