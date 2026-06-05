export type RecoveryMode = "recovery" | "maintenance" | "baseline" | "growth";

export type LifeMode =
  | "exam_war"
  | "practice"
  | "recovery_setup"
  | "summer_term"
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

export interface SourceRecord {
  id: string;
  userId: string;
  sourceKey: string;
  sourceType: string;
  displayName: string;
  status: "disabled" | "connected" | "error";
  configJson?: Record<string, unknown>;
  lastSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SourceEventRecord {
  id: string;
  userId: string;
  sourceKey: string;
  externalId: string | null;
  eventType: string;
  title: string | null;
  description: string | null;
  location: string | null;
  startsAt: string | null;
  endsAt: string | null;
  dueAt: string | null;
  status: string;
  rawJson?: Record<string, unknown>;
  normalizedEntityId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReminderRecord {
  id: string;
  userId: string;
  lifeEntityId: string | null;
  sourceEventId: string | null;
  channel: string;
  remindAt: string;
  status: "pending" | "sent" | "cancelled" | "failed";
  message: string;
  metadataJson?: Record<string, unknown>;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SyncRunRecord {
  id: string;
  userId: string;
  sourceId: string | null;
  sourceKey: string;
  status: "running" | "success" | "partial" | "failed";
  startedAt: string;
  finishedAt: string | null;
  recordsSeen: number;
  recordsCreated: number;
  recordsUpdated: number;
  errorMessage: string | null;
  metadataJson?: Record<string, unknown>;
}

export interface SourcesSummary {
  sources: SourceRecord[];
  sourceEvents: SourceEventRecord[];
  reminders: ReminderRecord[];
  syncRuns: SyncRunRecord[];
}

export interface ReminderListItem {
  id: string;
  message: string;
  remind_at: string;
  status: ReminderRecord["status"];
  channel: string;
}

export interface RemindersResponse {
  reminders: ReminderListItem[];
}

export interface AcademicRecord {
  id: string;
  userId: string;
  sourceEventId: string | null;
  courseTitle: string;
  recordType: string;
  title: string;
  valueText: string | null;
  score: number | null;
  maxScore: number | null;
  percentage: number | null;
  occursAt: string | null;
  dueAt: string | null;
  rawJson?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface AcademicSummary {
  currentMode: ModeSummary;
  nextAcademicEvent: SourceEventRecord | null;
  finals: SourceEventRecord[];
  examfx: SourceEventRecord[];
  activeCourse: StudyCourse | null;
  summerCourse: StudyCourse | null;
  nextTransition: {
    id?: string;
    userId: string;
    name: string;
    mode: LifeMode;
    startsOn: string;
    endsOn: string;
    priorityJson?: Record<string, number>;
    createdAt?: string | null;
  } | null;
  academicRecords: AcademicRecord[];
}

export interface CreateReminderInput {
  message: string;
  remindAt: string;
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

export type StudyCourseStatus =
  | "planned"
  | "active"
  | "paused"
  | "completed"
  | "archived";

export interface StudyCourse {
  id: string;
  userId: string;
  code: string;
  title: string;
  term: string | null;
  startsOn: string | null;
  endsOn: string | null;
  status: StudyCourseStatus;
  progressPercent: number;
  completedUnits: number;
  totalUnits: number | null;
  lastStudiedOn: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateCourseProgressInput {
  progressPercent: number;
}

export interface SaveModeInput {
  mode: LifeMode | "auto";
  duration?: "today" | "7_days" | "until_date" | "permanent";
  untilDate?: string;
}
