export type RecoveryMode = "recovery" | "maintenance" | "baseline" | "growth";

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
  reasons: string[];
  nextBestAction?: string | null;
  openTaskCount?: number;
}
