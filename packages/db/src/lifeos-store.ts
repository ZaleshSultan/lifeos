import {
  applyModeToFocusScoring,
  calculateHealthIngestDaily,
  explainModeReason,
  getModeLabel,
  healthModeLabel,
  parseLifeMode,
  resolveHealthMode,
  resolveCurrentMode as resolveCoreCurrentMode,
  scoreFocus,
  type FocusScoringItem,
  type HealthIngestPayload,
  type HealthMode,
  type LifeMode,
  type LifeModeProjectSprint,
  type LifeModeRecord,
  type LifeModeResolution,
  type LifeSeasonRecord,
  type ModeAwareFocusItem,
} from "@lifeos/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Database,
  HealthSyncRunStatus,
  Json,
  LifeEntityType,
  ObsidianSyncStatus,
  StudyCourseStatus,
  WorkoutIntensity,
} from "./types.js";

type LifeOSSupabaseClient = SupabaseClient<Database>;
type WorkoutRow = Database["public"]["Tables"]["workouts"]["Row"];
type WorkoutSetRow = Database["public"]["Tables"]["workout_sets"]["Row"];
type FitnessExerciseRow =
  Database["public"]["Tables"]["fitness_exercises"]["Row"];
type HealthDailyRow = Database["public"]["Tables"]["health_daily"]["Row"];
type LifeModeRow = Database["public"]["Tables"]["life_modes"]["Row"];
type LifeSeasonRow = Database["public"]["Tables"]["life_seasons"]["Row"];
type ProjectRow = Database["public"]["Tables"]["projects"]["Row"];
type StudyCourseRow = Database["public"]["Tables"]["study_courses"]["Row"];

export interface TelegramUserRecord {
  userId: string;
  displayName: string | null;
  timezone: string;
}

export interface BootstrapTelegramUserInput {
  userId: string;
  telegramUserId: number;
  displayName?: string | null;
  timezone?: string;
  locale?: string;
}

export interface LifeEntityRecord {
  id: string;
  userId: string;
  entityType: LifeEntityType;
  domain?: string;
  status?: string;
  title: string;
  description?: string | null;
  body: string | null;
  source?: string;
  sourceCommand?: string | null;
  telegramChatId?: number | null;
  telegramMessageId?: number | null;
  dueAt: string | null;
  linkedTable: string | null;
  linkedId: string | null;
  metadata?: Json;
  rawPayloadJson?: Json;
  createdAt: string;
}

export interface CreateLifeEntityInput {
  userId: string;
  entityType: LifeEntityType;
  domain?: string;
  status?: string;
  title: string;
  description?: string | null;
  body?: string | null;
  occurredAt?: string;
  dueAt?: string | null;
  source?: string;
  sourceCommand?: string | null;
  telegramChatId?: number | null;
  telegramMessageId?: number | null;
  linkedTable?: string | null;
  linkedId?: string | null;
  metadata?: Json;
  rawPayloadJson?: Json;
}

export interface LifeCaptureRecord {
  id: string;
  userId: string;
  text: string;
  source: string;
  status: string;
  chatId: number | null;
  createdAt: string;
}

export interface CreateLifeCaptureInput {
  userId: string;
  text: string;
  source?: string;
  status?: string;
  chatId?: number | null;
  messageId?: number | null;
  metadata?: Json;
}

export interface CreateTaskInput {
  userId: string;
  title: string;
  notes?: string | null;
  dueAt?: string | null;
  source?: string | null;
  metadata?: Json;
}

export interface TaskRecord {
  id: string;
  title: string;
  dueAt: string | null;
}

export interface DailyLogRecord {
  moodScore: number | null;
  energyScore: number | null;
  focusScore: number | null;
  notes: string | null;
}

export interface WorkoutRecord {
  id: string;
  title: string | null;
  startedAt: string;
  created: boolean;
}

export interface SetManualModeInput {
  userId: string;
  mode: LifeMode;
  reason?: string | null;
  activeFrom?: string | null;
  activeUntil?: string | null;
  priorityJson?: Record<string, number>;
}

export type SetManualLifeModeInput = SetManualModeInput;

export interface StudyCourseRecord {
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
  metadata: Json;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateStudyCourseProgressInput {
  userId: string;
  courseId?: string;
  code?: string;
  progressPercent: number;
  completedUnits?: number | null;
  totalUnits?: number | null;
  lastStudiedOn?: string | null;
  status?: StudyCourseStatus;
  metadata?: Json;
}

export interface FocusItemRecord extends FocusScoringItem {
  id: string;
  sourceType: "task" | "life_entity";
  title: string;
  dueAt: string | null;
  metadata: Record<string, unknown>;
}

export type ModeAwareFocusItemRecord = ModeAwareFocusItem<FocusItemRecord>;

export interface WorkoutSetSummary {
  id: string;
  index: number;
  targetReps: number | null;
  targetWeightKg: number | null;
  completed: boolean;
  completedAt: string | null;
}

export interface WorkoutExerciseSummary {
  id: string;
  name: string;
  note: string | null;
  sets: WorkoutSetSummary[];
}

export interface CurrentWorkoutSummary {
  id: string;
  title: string;
  mode: string;
  startedAt: string;
  progressPercent: number;
  completedSets: number;
  totalSets: number;
  restTimerEndsAt: string | null;
  exercises: WorkoutExerciseSummary[];
}

export interface ObsidianSyncStatusSummary {
  counts: Partial<Record<ObsidianSyncStatus, number>>;
}

export interface HealthSyncStatusSummary {
  counts: Partial<Record<HealthSyncRunStatus, number>>;
  runs: Array<{
    id: string;
    syncDate: string;
    syncReason: string;
    status: HealthSyncRunStatus;
    dataCompletenessScore: number | null;
    missingMetrics: Record<string, boolean>;
    completedAt: string | null;
    error: string | null;
  }>;
  latestRun: {
    id: string;
    syncDate: string;
    syncReason: string;
    status: HealthSyncRunStatus;
    dataCompletenessScore: number | null;
    missingMetrics: Record<string, boolean>;
    completedAt: string | null;
    error: string | null;
  } | null;
}

export interface FinanceSummary {
  capturedSpendCount: number;
  capturedSpendTotal: number | null;
}

export interface HealthIngestResult {
  healthDailyId: string;
  lifeEntityId: string;
  syncRunId: string;
  date: string;
  recoveryMode: string;
  dataCompletenessScore: number;
  workoutsUpserted: number;
  samplesInserted: number;
}

export interface TmaHomeSummary {
  displayName?: string;
  localDate: string;
  mode: LifeMode;
  modeLabel: string;
  modeReason: string;
  recoveryMode: HealthMode;
  focusScore: number | null;
  activeWorkout: {
    id: string;
    title: string;
    startedAt: string;
    progressPercent: number;
  } | null;
  healthCompletenessScore: number | null;
  pendingSyncCount: number;
}

export interface TmaHealthSummary {
  date: string;
  lifeMode: LifeMode;
  lifeModeLabel: string;
  recommendation: string;
  recoveryMode: HealthMode;
  dataCompletenessScore: number;
  sleepMinutes: number | null;
  deepSleepMinutes: number | null;
  remSleepMinutes: number | null;
  awakeMinutes: number | null;
  restingHeartRate: number | null;
  hrvMs: number | null;
  spo2Avg: number | null;
  steps: number | null;
  activeEnergyKcal: number | null;
  missingMetrics: Record<string, boolean>;
  samplesCount: number;
}

export interface TmaFocusSummary {
  score: number;
  band: "low" | "medium" | "high";
  mode: HealthMode;
  lifeMode: LifeMode;
  lifeModeLabel: string;
  lifeModeReason: string;
  reasons: string[];
  nextBestAction: string | null;
  openTaskCount: number;
  topItems: ModeAwareFocusItemRecord[];
  priorityWeights: Record<string, number>;
}

export interface LifeOSStore {
  resolveTelegramUser(
    telegramUserId: number,
  ): Promise<TelegramUserRecord | null>;
  linkDefaultTelegramUser(
    input: BootstrapTelegramUserInput,
  ): Promise<TelegramUserRecord>;
  createTask(input: CreateTaskInput): Promise<TaskRecord>;
  createLifeCapture(input: CreateLifeCaptureInput): Promise<LifeCaptureRecord>;
  createLifeEntity(input: CreateLifeEntityInput): Promise<LifeEntityRecord>;
  enqueueObsidianSync(input: {
    userId: string;
    lifeEntityId: string;
    entityType?: LifeEntityType;
    action?: string;
    targetPath?: string | null;
    payload?: Json;
    payloadJson?: Json;
  }): Promise<void>;
  listTodayEntities(input: {
    userId: string;
    dayStart: string;
    dayEnd: string;
  }): Promise<LifeEntityRecord[]>;
  getLatestDailyLog(userId: string): Promise<DailyLogRecord | null>;
  getObsidianSyncStatus(userId: string): Promise<ObsidianSyncStatusSummary>;
  getHealthSyncStatus(userId: string): Promise<HealthSyncStatusSummary>;
  getActiveManualMode(
    userId: string,
    now?: Date | string,
  ): Promise<LifeModeRecord | null>;
  getActiveSeason(
    userId: string,
    today?: Date | string,
  ): Promise<LifeSeasonRecord | null>;
  getActiveStudyCourse(
    userId: string,
    today?: Date | string,
  ): Promise<StudyCourseRecord | null>;
  updateStudyCourseProgress(
    input: UpdateStudyCourseProgressInput,
  ): Promise<StudyCourseRecord>;
  resolveCurrentMode(userId: string): Promise<LifeModeResolution>;
  setManualMode(input: SetManualModeInput): Promise<LifeModeResolution>;
  clearManualMode(userId: string): Promise<LifeModeResolution>;
  setManualLifeMode(input: SetManualLifeModeInput): Promise<LifeModeResolution>;
  clearManualLifeMode(userId: string): Promise<LifeModeResolution>;
  listModeAwareFocusItems(input: {
    userId: string;
    mode: LifeMode;
    limit?: number;
  }): Promise<ModeAwareFocusItemRecord[]>;
  getOrCreateCurrentWorkout(input: {
    userId: string;
    title?: string | null;
    now: string;
    lifeMode?: LifeMode;
  }): Promise<WorkoutRecord>;
  getCurrentWorkout(input: {
    userId: string;
    workoutId?: string;
  }): Promise<CurrentWorkoutSummary | null>;
  completeWorkoutSet(input: {
    userId: string;
    setId: string;
    completedAt: string;
  }): Promise<CurrentWorkoutSummary>;
  undoWorkoutSet(input: {
    userId: string;
    setId: string;
  }): Promise<CurrentWorkoutSummary>;
  completeWorkout(input: {
    userId: string;
    workoutId: string;
    completedAt: string;
  }): Promise<CurrentWorkoutSummary>;
  getTmaHomeSummary(user: TelegramUserRecord): Promise<TmaHomeSummary>;
  getTmaHealthSummary(userId: string): Promise<TmaHealthSummary>;
  getTmaFocusSummary(userId: string): Promise<TmaFocusSummary>;
  getFinanceSummary(input: {
    userId: string;
    since: string;
  }): Promise<FinanceSummary>;
  ingestHealthPayload(
    payload: HealthIngestPayload,
  ): Promise<HealthIngestResult>;
}

type WorkoutPlan = ReadonlyArray<{
  name: string;
  category: string;
  equipment: string;
  sets: ReadonlyArray<{
    reps: number;
    weightKg: number | null;
    restSeconds: number;
  }>;
}>;

const DEFAULT_WORKOUT_PLAN = [
  {
    name: "Push-up",
    category: "strength",
    equipment: "bodyweight",
    sets: [
      { reps: 10, weightKg: null, restSeconds: 90 },
      { reps: 10, weightKg: null, restSeconds: 90 },
      { reps: 8, weightKg: null, restSeconds: 90 },
    ],
  },
  {
    name: "Bodyweight Squat",
    category: "strength",
    equipment: "bodyweight",
    sets: [
      { reps: 12, weightKg: null, restSeconds: 90 },
      { reps: 12, weightKg: null, restSeconds: 90 },
      { reps: 12, weightKg: null, restSeconds: 90 },
    ],
  },
  {
    name: "Dumbbell Row",
    category: "strength",
    equipment: "dumbbell",
    sets: [
      { reps: 10, weightKg: 12, restSeconds: 90 },
      { reps: 10, weightKg: 12, restSeconds: 90 },
      { reps: 10, weightKg: 12, restSeconds: 90 },
    ],
  },
] as const;

const RECOVERY_WORKOUT_PLAN = [
  {
    name: "Mobility Flow",
    category: "mobility",
    equipment: "bodyweight",
    sets: [
      { reps: 8, weightKg: null, restSeconds: 45 },
      { reps: 8, weightKg: null, restSeconds: 45 },
    ],
  },
  {
    name: "Easy Walk",
    category: "cardio",
    equipment: "bodyweight",
    sets: [{ reps: 1, weightKg: null, restSeconds: 60 }],
  },
] as const satisfies WorkoutPlan;

const EXAM_WAR_WORKOUT_PLAN = [
  {
    name: "Push-up",
    category: "strength",
    equipment: "bodyweight",
    sets: [
      { reps: 8, weightKg: null, restSeconds: 60 },
      { reps: 8, weightKg: null, restSeconds: 60 },
    ],
  },
  {
    name: "Bodyweight Squat",
    category: "strength",
    equipment: "bodyweight",
    sets: [
      { reps: 10, weightKg: null, restSeconds: 60 },
      { reps: 10, weightKg: null, restSeconds: 60 },
    ],
  },
] as const satisfies WorkoutPlan;

function toLifeEntityRecord(
  row: Database["public"]["Tables"]["life_entities"]["Row"],
): LifeEntityRecord {
  return {
    id: row.id,
    userId: row.user_id,
    entityType: row.entity_type,
    domain: row.domain,
    status: row.status,
    title: row.title,
    description: row.description,
    body: row.body,
    source: row.source,
    sourceCommand: row.source_command,
    telegramChatId: row.telegram_chat_id,
    telegramMessageId: row.telegram_message_id,
    dueAt: row.due_at,
    linkedTable: row.linked_table,
    linkedId: row.linked_id,
    metadata: row.metadata,
    rawPayloadJson: row.raw_payload_json,
    createdAt: row.created_at,
  };
}

function toLifeModeRecord(row: LifeModeRow): LifeModeRecord {
  return {
    id: row.id,
    userId: row.user_id,
    mode: row.mode,
    source: row.source,
    reason: row.reason,
    activeFrom: row.active_from,
    activeUntil: row.active_until,
    isActive: row.is_active,
    priorityJson: jsonNumberRecord(row.priority_json),
    createdAt: row.created_at,
  };
}

function toLifeSeasonRecord(row: LifeSeasonRow): LifeSeasonRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    mode: row.mode,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    priorityJson: jsonNumberRecord(row.priority_json),
    createdAt: row.created_at,
  };
}

function toStudyCourseRecord(row: StudyCourseRow): StudyCourseRecord {
  return {
    id: row.id,
    userId: row.user_id,
    code: row.code,
    title: row.title,
    term: row.term,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    status: row.status,
    progressPercent: Number(row.progress_percent),
    completedUnits: row.completed_units,
    totalUnits: row.total_units,
    lastStudiedOn: row.last_studied_on,
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function throwSupabaseError(error: unknown, context: string): never {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String(error.message)
      : "Unknown Supabase error";

  throw new Error(`${context}: ${message}`);
}

function localDateFor(timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      dateStyle: "medium",
      timeZone: timezone,
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function numberOrNull(value: number | string | null): number | null {
  if (value === null) {
    return null;
  }

  return Number(value);
}

function jsonBooleanRecord(
  value: Json | null | undefined,
): Record<string, boolean> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, boolean] => {
      return typeof entry[1] === "boolean";
    }),
  );
}

function jsonNumberRecord(
  value: Json | null | undefined,
): Record<string, number> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, number] => {
      return typeof entry[1] === "number";
    }),
  );
}

function jsonObject(value: Json | null | undefined): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function addSeconds(timestamp: string, seconds: number): string {
  return new Date(new Date(timestamp).getTime() + seconds * 1000).toISOString();
}

function isoDateTimeFromInput(value: Date | string | undefined): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string") {
    return value;
  }

  return new Date().toISOString();
}

function isoDateFromInput(value: Date | string | undefined): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "string") {
    return value.includes("T") ? value.slice(0, 10) : value;
  }

  return new Date().toISOString().slice(0, 10);
}

function defaultWorkoutTitle(mode: LifeMode): string {
  switch (mode) {
    case "recovery":
      return "Recovery workout";
    case "exam_war":
      return "Short exam workout";
    case "summer":
      return "Fitness workout";
    default:
      return "Telegram workout";
  }
}

function workoutTypeForMode(mode: LifeMode | undefined): string {
  switch (mode) {
    case "recovery":
      return "mobility";
    case "summer":
      return "fitness";
    default:
      return "strength";
  }
}

function workoutIntensityForMode(
  mode: LifeMode | undefined,
): WorkoutIntensity | null {
  switch (mode) {
    case "recovery":
      return "easy";
    case "exam_war":
      return "moderate";
    case "summer":
      return "hard";
    default:
      return null;
  }
}

function workoutTemplateForMode(mode: LifeMode | undefined): string {
  switch (mode) {
    case "recovery":
      return "recovery_mobility";
    case "exam_war":
      return "exam_war_short";
    case "summer":
      return "summer_fitness";
    default:
      return "default_strength";
  }
}

function healthRecommendationForMode(mode: LifeMode): string {
  switch (mode) {
    case "recovery":
      return "Protect sleep, reduce load, and keep movement easy.";
    case "exam_war":
      return "Keep workouts short and preserve sleep for study retention.";
    case "practice":
      return "Bias the day toward timed practice, review, and steady recovery.";
    case "recovery_setup":
      return "Use the reset window for sleep, admin, and light planning.";
    case "summer_term":
      return "Protect course work blocks while keeping health anchors stable.";
    case "summer":
      return "Use the wider runway for fitness, recovery, and consistency.";
    case "project_sprint":
      return "Keep health anchors stable while the sprint gets priority.";
    case "maintenance":
      return "Maintain sleep, food, and money routines before adding load.";
    case "trimester":
      return "Balance study blocks with health and finance basics.";
  }
}

function workoutPlanForMode(mode: LifeMode | undefined): WorkoutPlan {
  switch (mode) {
    case "recovery":
      return RECOVERY_WORKOUT_PLAN;
    case "exam_war":
      return EXAM_WAR_WORKOUT_PLAN;
    default:
      return DEFAULT_WORKOUT_PLAN;
  }
}

function dueDateScore(dueAt: string | null): number {
  if (!dueAt) {
    return 0;
  }

  const diffMs = new Date(dueAt).getTime() - Date.now();
  const diffDays = diffMs / 86_400_000;

  if (diffDays < 0) {
    return 40;
  }

  if (diffDays <= 1) {
    return 30;
  }

  if (diffDays <= 3) {
    return 20;
  }

  return 10;
}

function projectSprintFromProject(
  project: ProjectRow,
): LifeModeProjectSprint | null {
  const metadata = jsonObject(project.metadata);
  const configuredMode =
    typeof metadata.life_mode === "string"
      ? parseLifeMode(metadata.life_mode)
      : typeof metadata.mode === "string"
        ? parseLifeMode(metadata.mode)
        : null;
  const configuredSprint =
    metadata.project_sprint === true ||
    metadata.projectSprint === true ||
    metadata.sprint === true ||
    configuredMode === "project_sprint";

  if (!configuredSprint) {
    return null;
  }

  const rawPriorityJson =
    typeof metadata.priority_json === "object" && metadata.priority_json
      ? (metadata.priority_json as Json)
      : typeof metadata.priorityJson === "object" && metadata.priorityJson
        ? (metadata.priorityJson as Json)
        : null;

  return {
    id: project.id,
    userId: project.user_id,
    name: project.name,
    startsOn: project.starts_on,
    endsOn: project.due_on,
    priorityJson: jsonNumberRecord(rawPriorityJson),
  };
}

function workoutBody(summary: CurrentWorkoutSummary): string {
  const exerciseLines = summary.exercises.flatMap((exercise) => {
    const sets = exercise.sets
      .map((set) => {
        const target = [
          set.targetReps ? `${set.targetReps} reps` : null,
          set.targetWeightKg ? `${set.targetWeightKg} kg` : null,
        ]
          .filter(Boolean)
          .join(", ");
        return `  - Set ${set.index}: ${set.completed ? "done" : "open"}${
          target ? ` (${target})` : ""
        }`;
      })
      .join("\n");
    return [`- ${exercise.name}`, sets];
  });

  return [
    `Progress: ${summary.completedSets}/${summary.totalSets} sets`,
    `Started: ${summary.startedAt}`,
    "",
    ...exerciseLines,
  ].join("\n");
}

export class SupabaseLifeOSStore implements LifeOSStore {
  constructor(private readonly client: LifeOSSupabaseClient) {}

  async resolveTelegramUser(
    telegramUserId: number,
  ): Promise<TelegramUserRecord | null> {
    const { data, error } = await this.client
      .from("profiles")
      .select("user_id, display_name, timezone")
      .eq("telegram_user_id", telegramUserId)
      .maybeSingle();

    if (error) {
      throwSupabaseError(error, "Failed to resolve Telegram user");
    }

    if (!data) {
      return null;
    }

    return {
      userId: data.user_id,
      displayName: data.display_name,
      timezone: data.timezone,
    };
  }

  async linkDefaultTelegramUser(
    input: BootstrapTelegramUserInput,
  ): Promise<TelegramUserRecord> {
    const { data, error } = await this.client
      .from("profiles")
      .upsert(
        {
          user_id: input.userId,
          display_name: input.displayName ?? null,
          timezone: input.timezone ?? "UTC",
          locale: input.locale ?? "en",
          telegram_user_id: input.telegramUserId,
          metadata: {
            bootstrap: true,
            linkedBy: "telegram_start",
          },
        },
        {
          onConflict: "user_id",
        },
      )
      .select("user_id, display_name, timezone")
      .single();

    if (error) {
      throwSupabaseError(error, "Failed to link default Telegram user");
    }

    return {
      userId: data.user_id,
      displayName: data.display_name,
      timezone: data.timezone,
    };
  }

  async createTask(input: CreateTaskInput): Promise<TaskRecord> {
    const { data, error } = await this.client
      .from("tasks")
      .insert({
        user_id: input.userId,
        title: input.title,
        notes: input.notes,
        due_at: input.dueAt,
        source: input.source ?? "telegram",
        metadata: input.metadata ?? {},
      })
      .select("id, title, due_at")
      .single();

    if (error) {
      throwSupabaseError(error, "Failed to create task");
    }

    return {
      id: data.id,
      title: data.title,
      dueAt: data.due_at,
    };
  }

  async createLifeCapture(
    input: CreateLifeCaptureInput,
  ): Promise<LifeCaptureRecord> {
    const { data, error } = await this.client
      .from("life_captures")
      .insert({
        user_id: input.userId,
        text: input.text,
        source: input.source ?? "telegram",
        status: input.status ?? "inbox",
        chat_id: input.chatId,
        message_id: input.messageId,
        metadata: input.metadata ?? {},
      })
      .select("id, user_id, text, source, status, chat_id, created_at")
      .single();

    if (error) {
      throwSupabaseError(error, "Failed to create life capture");
    }

    return {
      id: data.id,
      userId: data.user_id,
      text: data.text,
      source: data.source,
      status: data.status,
      chatId: data.chat_id,
      createdAt: data.created_at,
    };
  }

  async createLifeEntity(
    input: CreateLifeEntityInput,
  ): Promise<LifeEntityRecord> {
    const { data, error } = await this.client
      .from("life_entities")
      .insert({
        user_id: input.userId,
        entity_type: input.entityType,
        domain: input.domain ?? "personal",
        status: input.status ?? "inbox",
        title: input.title,
        description: input.description,
        body: input.body,
        occurred_at: input.occurredAt,
        due_at: input.dueAt,
        source: input.source ?? "telegram",
        source_command: input.sourceCommand,
        telegram_chat_id: input.telegramChatId,
        telegram_message_id: input.telegramMessageId,
        linked_table: input.linkedTable,
        linked_id: input.linkedId,
        metadata: input.metadata ?? {},
        raw_payload_json: input.rawPayloadJson ?? {},
      })
      .select("*")
      .single();

    if (error) {
      throwSupabaseError(error, "Failed to create life entity");
    }

    return toLifeEntityRecord(data);
  }

  async enqueueObsidianSync(input: {
    userId: string;
    lifeEntityId: string;
    entityType?: LifeEntityType;
    action?: string;
    targetPath?: string | null;
    payload?: Json;
    payloadJson?: Json;
  }): Promise<void> {
    const payloadJson = input.payloadJson ?? input.payload ?? {};
    const { error } = await this.client.from("obsidian_sync_queue").insert({
      user_id: input.userId,
      life_entity_id: input.lifeEntityId,
      operation: input.action ?? "upsert_note",
      entity_type: input.entityType,
      action: input.action ?? "upsert",
      target_path: input.targetPath,
      payload: payloadJson,
      payload_json: payloadJson,
    });

    if (error) {
      throwSupabaseError(error, "Failed to enqueue Obsidian sync");
    }
  }

  async listTodayEntities(input: {
    userId: string;
    dayStart: string;
    dayEnd: string;
  }): Promise<LifeEntityRecord[]> {
    const { data, error } = await this.client
      .from("life_entities")
      .select("*")
      .eq("user_id", input.userId)
      .gte("occurred_at", input.dayStart)
      .lt("occurred_at", input.dayEnd)
      .order("occurred_at", { ascending: true })
      .limit(10);

    if (error) {
      throwSupabaseError(error, "Failed to list today's entities");
    }

    return data.map(toLifeEntityRecord);
  }

  async getLatestDailyLog(userId: string): Promise<DailyLogRecord | null> {
    const { data, error } = await this.client
      .from("daily_logs")
      .select("mood_score, energy_score, focus_score, notes")
      .eq("user_id", userId)
      .order("log_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throwSupabaseError(error, "Failed to load daily log");
    }

    if (!data) {
      return null;
    }

    return {
      moodScore: data.mood_score,
      energyScore: data.energy_score,
      focusScore: data.focus_score,
      notes: data.notes,
    };
  }

  async getObsidianSyncStatus(
    userId: string,
  ): Promise<ObsidianSyncStatusSummary> {
    const { data, error } = await this.client
      .from("obsidian_sync_queue")
      .select("status")
      .eq("user_id", userId);

    if (error) {
      throwSupabaseError(error, "Failed to load Obsidian sync status");
    }

    const counts: Partial<Record<ObsidianSyncStatus, number>> = {};

    for (const item of data) {
      counts[item.status] = (counts[item.status] ?? 0) + 1;
    }

    return { counts };
  }

  async getHealthSyncStatus(userId: string): Promise<HealthSyncStatusSummary> {
    const { data, error } = await this.client
      .from("health_sync_runs")
      .select(
        "id, sync_date, sync_reason, status, data_completeness_score, missing_metrics, completed_at, error",
      )
      .eq("user_id", userId)
      .order("started_at", { ascending: false })
      .limit(5);

    if (error) {
      throwSupabaseError(error, "Failed to load health sync status");
    }

    const counts: Partial<Record<HealthSyncRunStatus, number>> = {};

    for (const item of data) {
      counts[item.status] = (counts[item.status] ?? 0) + 1;
    }

    const runs = data.map((run) => ({
      id: run.id,
      syncDate: run.sync_date,
      syncReason: run.sync_reason,
      status: run.status,
      dataCompletenessScore:
        run.data_completeness_score === null
          ? null
          : Number(run.data_completeness_score),
      missingMetrics: jsonBooleanRecord(run.missing_metrics),
      completedAt: run.completed_at,
      error: run.error,
    }));
    const latest = runs.at(0);

    return {
      counts,
      runs,
      latestRun: latest ?? null,
    };
  }

  async getActiveManualMode(
    userId: string,
    now: Date | string = new Date(),
  ): Promise<LifeModeRecord | null> {
    const modes = await this.listActiveLifeModes({
      userId,
      source: "manual",
      now: isoDateTimeFromInput(now),
    });

    return modes.at(0) ?? null;
  }

  async getActiveSeason(
    userId: string,
    today: Date | string = new Date(),
  ): Promise<LifeSeasonRecord | null> {
    const seasons = await this.listActiveLifeSeasons({
      userId,
      today: isoDateFromInput(today),
    });

    return seasons.at(0) ?? null;
  }

  async getActiveStudyCourse(
    userId: string,
    today: Date | string = new Date(),
  ): Promise<StudyCourseRecord | null> {
    const activeDate = isoDateFromInput(today);
    const { data, error } = await this.client
      .from("study_courses")
      .select("*")
      .eq("user_id", userId)
      .in("status", ["planned", "active"])
      .or(`starts_on.is.null,starts_on.lte.${activeDate}`)
      .or(`ends_on.is.null,ends_on.gte.${activeDate}`)
      .order("starts_on", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throwSupabaseError(error, "Failed to load active study course");
    }

    return data ? toStudyCourseRecord(data) : null;
  }

  async updateStudyCourseProgress(
    input: UpdateStudyCourseProgressInput,
  ): Promise<StudyCourseRecord> {
    if (!input.courseId && !input.code) {
      throw new Error("Study course id or code is required");
    }

    if (input.progressPercent < 0 || input.progressPercent > 100) {
      throw new Error("Study course progress must be between 0 and 100");
    }

    const update: Database["public"]["Tables"]["study_courses"]["Update"] = {
      progress_percent: input.progressPercent,
    };

    if (input.completedUnits !== undefined) {
      update.completed_units = input.completedUnits ?? 0;
    }

    if (input.totalUnits !== undefined) {
      update.total_units = input.totalUnits;
    }

    if (input.lastStudiedOn !== undefined) {
      update.last_studied_on = input.lastStudiedOn;
    }

    if (input.status !== undefined) {
      update.status = input.status;
    }

    if (input.metadata !== undefined) {
      update.metadata = input.metadata;
    }

    const query = this.client
      .from("study_courses")
      .update(update)
      .eq("user_id", input.userId);
    const scopedQuery = input.courseId
      ? query.eq("id", input.courseId)
      : query.eq("code", input.code as string);
    const { data, error } = await scopedQuery.select("*").single();

    if (error) {
      throwSupabaseError(error, "Failed to update study course progress");
    }

    return toStudyCourseRecord(data);
  }

  async resolveCurrentMode(userId: string): Promise<LifeModeResolution> {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const [manualMode, latestHealthDaily, season, sprintMode, sprintProject] =
      await Promise.all([
        this.getActiveManualMode(userId, now),
        this.getLatestHealthDaily(userId),
        this.getActiveSeason(userId, today),
        this.getConfiguredSprintMode({ userId, now: now.toISOString() }),
        this.getConfiguredProjectSprint({ userId, today }),
      ]);

    return resolveCoreCurrentMode(userId, {
      now,
      manualOverrides: manualMode ? [manualMode] : [],
      latestHealthDaily: latestHealthDaily
        ? {
            userId,
            sleepMinutes: latestHealthDaily.sleep_minutes,
            recoveryMode: latestHealthDaily.recovery_mode,
            logDate: latestHealthDaily.log_date,
          }
        : null,
      seasons: season ? [season] : [],
      projectSprint: sprintMode ?? sprintProject,
    });
  }

  async setManualMode(input: SetManualModeInput): Promise<LifeModeResolution> {
    const { error: clearError } = await this.client
      .from("life_modes")
      .update({ is_active: false })
      .eq("user_id", input.userId)
      .eq("source", "manual")
      .eq("is_active", true);

    if (clearError) {
      throwSupabaseError(clearError, "Failed to clear active manual modes");
    }

    const manualModeInsert: Database["public"]["Tables"]["life_modes"]["Insert"] =
      {
        user_id: input.userId,
        mode: input.mode,
        source: "manual",
        reason: input.reason ?? "Manual override from LifeOS.",
        active_until: input.activeUntil ?? null,
        priority_json: (input.priorityJson ?? {}) as Json,
      };

    if (input.activeFrom) {
      manualModeInsert.active_from = input.activeFrom;
    }

    const { error } = await this.client
      .from("life_modes")
      .insert(manualModeInsert);

    if (error) {
      throwSupabaseError(error, "Failed to set manual mode");
    }

    return this.resolveCurrentMode(input.userId);
  }

  async clearManualMode(userId: string): Promise<LifeModeResolution> {
    const { error } = await this.client
      .from("life_modes")
      .update({ is_active: false })
      .eq("user_id", userId)
      .eq("source", "manual")
      .eq("is_active", true);

    if (error) {
      throwSupabaseError(error, "Failed to clear manual modes");
    }

    return this.resolveCurrentMode(userId);
  }

  async setManualLifeMode(
    input: SetManualLifeModeInput,
  ): Promise<LifeModeResolution> {
    return this.setManualMode(input);
  }

  async clearManualLifeMode(userId: string): Promise<LifeModeResolution> {
    return this.clearManualMode(userId);
  }

  async listModeAwareFocusItems(input: {
    userId: string;
    mode: LifeMode;
    limit?: number;
  }): Promise<ModeAwareFocusItemRecord[]> {
    const { data, error } = await this.client
      .from("tasks")
      .select("id, title, due_at, priority, metadata")
      .eq("user_id", input.userId)
      .not("status", "in", "(done,cancelled)")
      .order("due_at", { ascending: true, nullsFirst: false })
      .order("priority", { ascending: false })
      .limit(Math.max(input.limit ?? 8, 20));

    if (error) {
      throwSupabaseError(error, "Failed to load focus items");
    }

    const items: FocusItemRecord[] = data.map((task) => ({
      id: task.id,
      sourceType: "task",
      entityType: "task",
      title: task.title,
      dueAt: task.due_at,
      priority: task.priority,
      score: task.priority + dueDateScore(task.due_at),
      metadata: jsonObject(task.metadata),
    }));

    return applyModeToFocusScoring(items, input.mode).slice(
      0,
      input.limit ?? 8,
    );
  }

  async getOrCreateCurrentWorkout(input: {
    userId: string;
    title?: string | null;
    now: string;
    lifeMode?: LifeMode;
  }): Promise<WorkoutRecord> {
    const { data: existing, error: existingError } = await this.client
      .from("workouts")
      .select("id, title, started_at")
      .eq("user_id", input.userId)
      .is("ended_at", null)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingError) {
      throwSupabaseError(existingError, "Failed to load current workout");
    }

    if (existing) {
      await this.ensureDefaultWorkoutPlan(
        input.userId,
        existing.id,
        input.lifeMode,
      );

      return {
        id: existing.id,
        title: existing.title,
        startedAt: existing.started_at,
        created: false,
      };
    }

    const { data, error } = await this.client
      .from("workouts")
      .insert({
        user_id: input.userId,
        title:
          input.title ??
          (input.lifeMode
            ? defaultWorkoutTitle(input.lifeMode)
            : "Telegram workout"),
        workout_type: workoutTypeForMode(input.lifeMode),
        intensity: workoutIntensityForMode(input.lifeMode),
        started_at: input.now,
        metadata: {
          source: "telegram",
          template: workoutTemplateForMode(input.lifeMode),
          lifeMode: input.lifeMode ?? "trimester",
        },
      })
      .select("id, title, started_at")
      .single();

    if (error) {
      throwSupabaseError(error, "Failed to create workout");
    }

    await this.ensureDefaultWorkoutPlan(input.userId, data.id, input.lifeMode);

    return {
      id: data.id,
      title: data.title,
      startedAt: data.started_at,
      created: true,
    };
  }

  async getCurrentWorkout(input: {
    userId: string;
    workoutId?: string;
  }): Promise<CurrentWorkoutSummary | null> {
    let query = this.client
      .from("workouts")
      .select("*")
      .eq("user_id", input.userId)
      .order("started_at", { ascending: false })
      .limit(1);

    if (input.workoutId) {
      query = query.eq("id", input.workoutId);
    } else {
      query = query.is("ended_at", null);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      throwSupabaseError(error, "Failed to load workout");
    }

    if (!data) {
      return null;
    }

    return this.buildWorkoutSummary(data);
  }

  async completeWorkoutSet(input: {
    userId: string;
    setId: string;
    completedAt: string;
  }): Promise<CurrentWorkoutSummary> {
    const { data, error } = await this.client
      .from("workout_sets")
      .update({
        completed: true,
        completed_at: input.completedAt,
      })
      .eq("user_id", input.userId)
      .eq("id", input.setId)
      .select("workout_id")
      .single();

    if (error) {
      throwSupabaseError(error, "Failed to complete workout set");
    }

    const workout = await this.getCurrentWorkout({
      userId: input.userId,
      workoutId: data.workout_id,
    });

    if (!workout) {
      throw new Error("Workout not found after set completion");
    }

    return workout;
  }

  async undoWorkoutSet(input: {
    userId: string;
    setId: string;
  }): Promise<CurrentWorkoutSummary> {
    const { data, error } = await this.client
      .from("workout_sets")
      .update({
        completed: false,
        completed_at: null,
      })
      .eq("user_id", input.userId)
      .eq("id", input.setId)
      .select("workout_id")
      .single();

    if (error) {
      throwSupabaseError(error, "Failed to undo workout set");
    }

    const workout = await this.getCurrentWorkout({
      userId: input.userId,
      workoutId: data.workout_id,
    });

    if (!workout) {
      throw new Error("Workout not found after set undo");
    }

    return workout;
  }

  async completeWorkout(input: {
    userId: string;
    workoutId: string;
    completedAt: string;
  }): Promise<CurrentWorkoutSummary> {
    const { data: existing, error: existingError } = await this.client
      .from("workouts")
      .select("id, started_at")
      .eq("user_id", input.userId)
      .eq("id", input.workoutId)
      .single();

    if (existingError) {
      throwSupabaseError(
        existingError,
        "Failed to load workout for completion",
      );
    }

    const durationMinutes = Math.max(
      1,
      Math.ceil(
        (new Date(input.completedAt).getTime() -
          new Date(existing.started_at).getTime()) /
          60000,
      ),
    );

    const { error } = await this.client
      .from("workouts")
      .update({
        ended_at: input.completedAt,
        duration_minutes: durationMinutes,
      })
      .eq("user_id", input.userId)
      .eq("id", input.workoutId);

    if (error) {
      throwSupabaseError(error, "Failed to complete workout");
    }

    const workout = await this.getCurrentWorkout({
      userId: input.userId,
      workoutId: input.workoutId,
    });

    if (!workout) {
      throw new Error("Workout not found after completion");
    }

    const entity = await this.upsertWorkoutLifeEntity({
      userId: input.userId,
      workout,
      completedAt: input.completedAt,
    });

    await this.enqueueObsidianSync({
      userId: input.userId,
      lifeEntityId: entity.id,
      payload: {
        entityType: "workout",
        workoutId: workout.id,
        completedAt: input.completedAt,
      },
    });

    return workout;
  }

  async getTmaHomeSummary(user: TelegramUserRecord): Promise<TmaHomeSummary> {
    const [mode, health, focus, workout, obsidianStatus] = await Promise.all([
      this.resolveCurrentMode(user.userId),
      this.getTmaHealthSummary(user.userId),
      this.getTmaFocusSummary(user.userId),
      this.getCurrentWorkout({ userId: user.userId }),
      this.getObsidianSyncStatus(user.userId),
    ]);

    return {
      displayName: user.displayName ?? undefined,
      localDate: localDateFor(user.timezone),
      mode: mode.mode,
      modeLabel: mode.label,
      modeReason: explainModeReason(mode),
      recoveryMode: health.recoveryMode,
      focusScore: focus.score,
      activeWorkout: workout
        ? {
            id: workout.id,
            title: workout.title,
            startedAt: workout.startedAt,
            progressPercent: workout.progressPercent,
          }
        : null,
      healthCompletenessScore: health.dataCompletenessScore,
      pendingSyncCount: obsidianStatus.counts.pending ?? 0,
    };
  }

  async getTmaHealthSummary(userId: string): Promise<TmaHealthSummary> {
    const [mode, latest] = await Promise.all([
      this.resolveCurrentMode(userId),
      this.getLatestHealthDaily(userId),
    ]);

    if (!latest) {
      return {
        date: new Date().toISOString().slice(0, 10),
        lifeMode: mode.mode,
        lifeModeLabel: mode.label,
        recommendation: healthRecommendationForMode(mode.mode),
        recoveryMode: "baseline",
        dataCompletenessScore: 0,
        sleepMinutes: null,
        deepSleepMinutes: null,
        remSleepMinutes: null,
        awakeMinutes: null,
        restingHeartRate: null,
        hrvMs: null,
        spo2Avg: null,
        steps: null,
        activeEnergyKcal: null,
        missingMetrics: {},
        samplesCount: 0,
      };
    }

    const samplesCount = await this.getHealthSampleCount(latest.id);

    return {
      date: latest.log_date,
      lifeMode: mode.mode,
      lifeModeLabel: mode.label,
      recommendation: healthRecommendationForMode(mode.mode),
      recoveryMode: latest.recovery_mode,
      dataCompletenessScore: Number(latest.data_completeness_score),
      sleepMinutes: latest.sleep_minutes,
      deepSleepMinutes: latest.deep_sleep_minutes,
      remSleepMinutes: latest.rem_sleep_minutes,
      awakeMinutes: latest.awake_minutes,
      restingHeartRate: numberOrNull(latest.resting_heart_rate),
      hrvMs: numberOrNull(latest.hrv_ms),
      spo2Avg: numberOrNull(latest.spo2_avg),
      steps: latest.steps,
      activeEnergyKcal: numberOrNull(latest.active_energy_kcal),
      missingMetrics: jsonBooleanRecord(latest.missing_metrics),
      samplesCount,
    };
  }

  async getTmaFocusSummary(userId: string): Promise<TmaFocusSummary> {
    const [mode, health, openTaskCount] = await Promise.all([
      this.resolveCurrentMode(userId),
      this.getLatestHealthDaily(userId),
      this.getOpenTaskCount(userId),
    ]);
    const healthMode = health?.recovery_mode ?? "baseline";
    const result = scoreFocus({
      healthMode: mode.mode === "recovery" ? "recovery" : healthMode,
      moodScore: health?.mood_score ?? undefined,
      energyScore: health?.energy_score ?? undefined,
      stressScore: health?.stress_score ?? undefined,
      sleepHours: health?.sleep_minutes
        ? Number(health.sleep_minutes) / 60
        : undefined,
      openTaskCount,
    });
    const topItems = await this.listModeAwareFocusItems({
      userId,
      mode: mode.mode,
      limit: 5,
    });

    return {
      score: result.score,
      band: result.band,
      mode: healthMode,
      lifeMode: mode.mode,
      lifeModeLabel: mode.label,
      lifeModeReason: explainModeReason(mode),
      reasons: [...new Set([...result.reasons, `life-mode:${mode.mode}`])],
      nextBestAction:
        topItems.at(0)?.title ??
        (result.band === "low"
          ? "Pick one small task and protect recovery."
          : result.band === "medium"
            ? "Work the next concrete task before adding inputs."
            : "Use the strong window for deep work."),
      openTaskCount,
      topItems,
      priorityWeights: mode.priorityWeights,
    };
  }

  async getFinanceSummary(input: {
    userId: string;
    since: string;
  }): Promise<FinanceSummary> {
    const { data, error } = await this.client
      .from("life_entities")
      .select("metadata")
      .eq("user_id", input.userId)
      .eq("entity_type", "spend")
      .gte("occurred_at", input.since);

    if (error) {
      throwSupabaseError(error, "Failed to load finance summary");
    }

    let capturedSpendTotal = 0;
    let hasAmounts = false;

    for (const item of data) {
      if (
        typeof item.metadata === "object" &&
        item.metadata !== null &&
        !Array.isArray(item.metadata) &&
        typeof item.metadata.amount === "number"
      ) {
        hasAmounts = true;
        capturedSpendTotal += item.metadata.amount;
      }
    }

    return {
      capturedSpendCount: data.length,
      capturedSpendTotal: hasAmounts ? capturedSpendTotal : null,
    };
  }

  async ingestHealthPayload(
    payload: HealthIngestPayload,
  ): Promise<HealthIngestResult> {
    const startedAt = new Date().toISOString();
    const computed = calculateHealthIngestDaily(payload);
    const metrics = payload.metrics;
    const rawPayload = (payload.raw ?? {
      metrics: payload.metrics,
      workouts: payload.workouts,
      samples: payload.samples,
      missing: payload.missing,
    }) as Json;
    const missingMetrics = payload.missing as Json;

    const { data: healthDaily, error: healthDailyError } = await this.client
      .from("health_daily")
      .upsert(
        {
          user_id: payload.userId,
          log_date: payload.date,
          sync_reason: payload.syncReason,
          recovery_mode: computed.recoveryMode,
          data_completeness_score: computed.dataCompletenessScore,
          sleep_minutes: metrics.sleepMinutes,
          sleep_score: metrics.sleepScore,
          deep_sleep_minutes: metrics.deepSleepMinutes,
          rem_sleep_minutes: metrics.remSleepMinutes,
          awake_minutes: metrics.awakeMinutes,
          resting_heart_rate: metrics.restingHeartRate,
          hrv_ms: metrics.hrvMs,
          spo2_avg: metrics.spo2Avg,
          steps: metrics.steps,
          calories_burned: metrics.caloriesBurned,
          active_energy_kcal: metrics.activeEnergyKcal,
          workout_minutes: metrics.workoutMinutes,
          weight_kg: metrics.weightKg,
          mood_score: metrics.moodScore,
          energy_score: metrics.energyScore,
          stress_score: metrics.stressScore,
          source: payload.source,
          timezone: payload.timezone,
          missing_metrics: missingMetrics,
          metadata: {
            syncReason: payload.syncReason,
            workoutsCount: payload.workouts.length,
            samplesCount: payload.samples.length,
            missing: payload.missing,
          },
          raw_payload: rawPayload,
        },
        {
          onConflict: "user_id,log_date",
        },
      )
      .select("id")
      .single();

    if (healthDailyError) {
      throwSupabaseError(healthDailyError, "Failed to upsert health daily");
    }

    const workoutRows = payload.workouts.map((workout) => ({
      user_id: payload.userId,
      health_daily_id: healthDaily.id,
      external_id: workout.externalId,
      workout_date: payload.date,
      started_at: workout.startedAt,
      ended_at: workout.endedAt,
      workout_type: workout.workoutType,
      title: workout.title,
      duration_minutes: workout.durationMinutes,
      calories_kcal: workout.caloriesKcal,
      distance_meters: workout.distanceMeters,
      source: workout.source ?? payload.source ?? "health_ingest",
      metadata: (workout.metadata ?? {}) as Json,
    }));
    const workoutsWithExternalId = workoutRows.filter((row) => row.external_id);
    const workoutsWithoutExternalId = workoutRows.filter(
      (row) => !row.external_id,
    );

    if (workoutsWithExternalId.length > 0) {
      const { error } = await this.client
        .from("health_workouts")
        .upsert(workoutsWithExternalId, {
          onConflict: "user_id,source,external_id",
        });

      if (error) {
        throwSupabaseError(error, "Failed to upsert health workouts");
      }
    }

    if (workoutsWithoutExternalId.length > 0) {
      const { error } = await this.client
        .from("health_workouts")
        .insert(workoutsWithoutExternalId);

      if (error) {
        throwSupabaseError(error, "Failed to insert health workouts");
      }
    }

    if (payload.samples.length > 0) {
      const { error } = await this.client.from("health_samples").insert(
        payload.samples.map((sample) => ({
          user_id: payload.userId,
          health_daily_id: healthDaily.id,
          sample_type: sample.sampleType,
          sampled_at: sample.sampledAt,
          value: sample.value,
          unit: sample.unit,
          source: sample.source ?? payload.source ?? "health_ingest",
          metadata: (sample.metadata ?? {}) as Json,
        })),
      );

      if (error) {
        throwSupabaseError(error, "Failed to insert health samples");
      }
    }

    const lifeEntity = await this.upsertHealthDailyLifeEntity({
      userId: payload.userId,
      healthDailyId: healthDaily.id,
      date: payload.date,
      source: payload.source ?? "health_ingest",
      syncReason: payload.syncReason,
      recoveryMode: computed.recoveryMode,
      dataCompletenessScore: computed.dataCompletenessScore,
      workoutsCount: payload.workouts.length,
      samplesCount: payload.samples.length,
      missingMetrics: payload.missing,
    });

    await this.enqueueObsidianSync({
      userId: payload.userId,
      lifeEntityId: lifeEntity.id,
      payload: {
        entityType: "health_daily",
        date: payload.date,
        recoveryMode: computed.recoveryMode,
        dataCompletenessScore: computed.dataCompletenessScore,
        missingMetrics: payload.missing,
      },
    });

    const { data: syncRun, error: syncRunError } = await this.client
      .from("health_sync_runs")
      .insert({
        user_id: payload.userId,
        health_daily_id: healthDaily.id,
        life_entity_id: lifeEntity.id,
        sync_date: payload.date,
        sync_reason: payload.syncReason,
        status: "success",
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        workouts_upserted: payload.workouts.length,
        samples_inserted: payload.samples.length,
        data_completeness_score: computed.dataCompletenessScore,
        recovery_mode: computed.recoveryMode,
        source: payload.source ?? "health_ingest",
        missing_metrics: missingMetrics,
        metadata: {
          timezone: payload.timezone,
          missing: payload.missing,
        },
      })
      .select("id")
      .single();

    if (syncRunError) {
      throwSupabaseError(syncRunError, "Failed to insert health sync run");
    }

    return {
      healthDailyId: healthDaily.id,
      lifeEntityId: lifeEntity.id,
      syncRunId: syncRun.id,
      date: payload.date,
      recoveryMode: computed.recoveryMode,
      dataCompletenessScore: computed.dataCompletenessScore,
      workoutsUpserted: payload.workouts.length,
      samplesInserted: payload.samples.length,
    };
  }

  private async listActiveLifeModes(input: {
    userId: string;
    source: LifeModeRecord["source"];
    now: string;
  }): Promise<LifeModeRecord[]> {
    const { data, error } = await this.client
      .from("life_modes")
      .select("*")
      .eq("user_id", input.userId)
      .eq("source", input.source)
      .eq("is_active", true)
      .lte("active_from", input.now)
      .or(`active_until.is.null,active_until.gt.${input.now}`)
      .order("active_from", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(10);

    if (error) {
      throwSupabaseError(error, "Failed to load active life modes");
    }

    return data.map(toLifeModeRecord);
  }

  private async listActiveLifeSeasons(input: {
    userId: string;
    today: string;
  }): Promise<LifeSeasonRecord[]> {
    const { data, error } = await this.client
      .from("life_seasons")
      .select("*")
      .eq("user_id", input.userId)
      .lte("starts_on", input.today)
      .gte("ends_on", input.today)
      .order("starts_on", { ascending: false })
      .limit(10);

    if (error) {
      throwSupabaseError(error, "Failed to load active life seasons");
    }

    return data.map(toLifeSeasonRecord);
  }

  private async getConfiguredSprintMode(input: {
    userId: string;
    now: string;
  }): Promise<LifeModeProjectSprint | null> {
    const sprintModes = await this.listActiveLifeModes({
      userId: input.userId,
      source: "sprint",
      now: input.now,
    });
    const sprint = sprintModes.at(0);

    if (!sprint) {
      return null;
    }

    return {
      id: sprint.id,
      userId: sprint.userId,
      name: sprint.reason ?? getModeLabel("project_sprint"),
      startsOn: sprint.activeFrom?.slice(0, 10) ?? null,
      endsOn: sprint.activeUntil?.slice(0, 10) ?? null,
      priorityJson: sprint.priorityJson,
    };
  }

  private async getConfiguredProjectSprint(input: {
    userId: string;
    today: string;
  }): Promise<LifeModeProjectSprint | null> {
    const { data, error } = await this.client
      .from("projects")
      .select("*")
      .eq("user_id", input.userId)
      .eq("status", "active")
      .or(`starts_on.is.null,starts_on.lte.${input.today}`)
      .or(`due_on.is.null,due_on.gte.${input.today}`)
      .order("starts_on", { ascending: false, nullsFirst: false })
      .limit(20);

    if (error) {
      throwSupabaseError(error, "Failed to load project sprint");
    }

    return (
      data
        .map((project) => projectSprintFromProject(project))
        .find((project): project is LifeModeProjectSprint =>
          Boolean(project),
        ) ?? null
    );
  }

  private async ensureDefaultWorkoutPlan(
    userId: string,
    workoutId: string,
    mode?: LifeMode,
  ): Promise<void> {
    const { count, error: countError } = await this.client
      .from("workout_sets")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("workout_id", workoutId);

    if (countError) {
      throwSupabaseError(countError, "Failed to count workout sets");
    }

    if ((count ?? 0) > 0) {
      return;
    }

    for (const exercise of workoutPlanForMode(mode)) {
      const exerciseId = await this.getOrCreateExercise({
        userId,
        name: exercise.name,
        category: exercise.category,
        equipment: exercise.equipment,
      });

      const { error } = await this.client.from("workout_sets").insert(
        exercise.sets.map((set, index) => ({
          user_id: userId,
          workout_id: workoutId,
          exercise_id: exerciseId,
          set_index: index + 1,
          reps: set.reps,
          weight_kg: set.weightKg,
          rest_seconds: set.restSeconds,
          completed: false,
          completed_at: null,
          metadata: {
            source: "default_strength_template",
          },
        })),
      );

      if (error) {
        throwSupabaseError(error, "Failed to create default workout sets");
      }
    }
  }

  private async getOrCreateExercise(input: {
    userId: string;
    name: string;
    category: string;
    equipment: string;
  }): Promise<string> {
    const { data: existing, error: existingError } = await this.client
      .from("fitness_exercises")
      .select("id")
      .eq("user_id", input.userId)
      .eq("name", input.name)
      .limit(1)
      .maybeSingle();

    if (existingError) {
      throwSupabaseError(existingError, "Failed to load exercise");
    }

    if (existing) {
      return existing.id;
    }

    const { data, error } = await this.client
      .from("fitness_exercises")
      .insert({
        user_id: input.userId,
        name: input.name,
        category: input.category,
        equipment: input.equipment,
        metadata: {
          source: "default_strength_template",
        },
      })
      .select("id")
      .single();

    if (error) {
      throwSupabaseError(error, "Failed to create exercise");
    }

    return data.id;
  }

  private async buildWorkoutSummary(
    workout: WorkoutRow,
  ): Promise<CurrentWorkoutSummary> {
    const { data: sets, error: setsError } = await this.client
      .from("workout_sets")
      .select("*")
      .eq("user_id", workout.user_id)
      .eq("workout_id", workout.id)
      .order("created_at", { ascending: true })
      .order("set_index", { ascending: true });

    if (setsError) {
      throwSupabaseError(setsError, "Failed to load workout sets");
    }

    const exerciseIds = [
      ...new Set(sets.map((set) => set.exercise_id).filter(Boolean)),
    ] as string[];
    const exerciseById = await this.loadExercises(exerciseIds);
    const grouped = new Map<string, WorkoutExerciseSummary>();

    for (const set of sets) {
      const exercise = set.exercise_id
        ? exerciseById.get(set.exercise_id)
        : null;
      const exerciseKey = set.exercise_id ?? "unassigned";
      const existing = grouped.get(exerciseKey);
      const summarySet: WorkoutSetSummary = {
        id: set.id,
        index: set.set_index,
        targetReps: set.reps,
        targetWeightKg: numberOrNull(set.weight_kg),
        completed: set.completed,
        completedAt: set.completed_at,
      };

      if (existing) {
        existing.sets.push(summarySet);
      } else {
        grouped.set(exerciseKey, {
          id: exerciseKey,
          name: exercise?.name ?? "Exercise",
          note: exercise?.category ?? null,
          sets: [summarySet],
        });
      }
    }

    const totalSets = sets.length;
    const completedSets = sets.filter((set) => set.completed).length;
    const latestCompleted = sets
      .filter((set) => set.completed_at && set.rest_seconds)
      .sort((a, b) =>
        String(b.completed_at).localeCompare(String(a.completed_at)),
      )
      .at(0);

    return {
      id: workout.id,
      title: workout.title ?? "Workout",
      mode: workout.ended_at ? "completed" : "active",
      startedAt: workout.started_at,
      progressPercent: totalSets
        ? Math.round((completedSets / totalSets) * 100)
        : 0,
      completedSets,
      totalSets,
      restTimerEndsAt:
        latestCompleted?.completed_at && latestCompleted.rest_seconds
          ? addSeconds(
              latestCompleted.completed_at,
              latestCompleted.rest_seconds,
            )
          : null,
      exercises: [...grouped.values()],
    };
  }

  private async loadExercises(
    exerciseIds: string[],
  ): Promise<Map<string, FitnessExerciseRow>> {
    if (exerciseIds.length === 0) {
      return new Map();
    }

    const { data, error } = await this.client
      .from("fitness_exercises")
      .select("*")
      .in("id", exerciseIds);

    if (error) {
      throwSupabaseError(error, "Failed to load exercises");
    }

    return new Map(data.map((exercise) => [exercise.id, exercise]));
  }

  private async getLatestHealthDaily(
    userId: string,
  ): Promise<HealthDailyRow | null> {
    const { data, error } = await this.client
      .from("health_daily")
      .select("*")
      .eq("user_id", userId)
      .order("log_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throwSupabaseError(error, "Failed to load latest health daily");
    }

    return data;
  }

  private async getHealthSampleCount(healthDailyId: string): Promise<number> {
    const { count, error } = await this.client
      .from("health_samples")
      .select("id", { count: "exact", head: true })
      .eq("health_daily_id", healthDailyId);

    if (error) {
      throwSupabaseError(error, "Failed to count health samples");
    }

    return count ?? 0;
  }

  private async getOpenTaskCount(userId: string): Promise<number> {
    const { count, error } = await this.client
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .not("status", "in", "(done,cancelled)");

    if (error) {
      throwSupabaseError(error, "Failed to count open tasks");
    }

    return count ?? 0;
  }

  private async upsertWorkoutLifeEntity(input: {
    userId: string;
    workout: CurrentWorkoutSummary;
    completedAt: string;
  }): Promise<LifeEntityRecord> {
    const metadata = {
      workoutId: input.workout.id,
      mode: input.workout.mode,
      completedAt: input.completedAt,
      progressPercent: input.workout.progressPercent,
      completedSets: input.workout.completedSets,
      totalSets: input.workout.totalSets,
      exercises: input.workout.exercises,
    } as unknown as Json;
    const body = workoutBody(input.workout);
    const { data: existing, error: existingError } = await this.client
      .from("life_entities")
      .select("id")
      .eq("user_id", input.userId)
      .eq("entity_type", "workout")
      .eq("linked_table", "workouts")
      .eq("linked_id", input.workout.id)
      .maybeSingle();

    if (existingError) {
      throwSupabaseError(existingError, "Failed to load workout life entity");
    }

    if (existing) {
      const { data, error } = await this.client
        .from("life_entities")
        .update({
          title: input.workout.title,
          body,
          source: "tma",
          source_command: "POST /api/tma/workout/:workoutId/complete",
          metadata,
        })
        .eq("id", existing.id)
        .select("*")
        .single();

      if (error) {
        throwSupabaseError(error, "Failed to update workout life entity");
      }

      return toLifeEntityRecord(data);
    }

    const { data, error } = await this.client
      .from("life_entities")
      .insert({
        user_id: input.userId,
        entity_type: "workout",
        title: input.workout.title,
        body,
        source: "tma",
        source_command: "POST /api/tma/workout/:workoutId/complete",
        linked_table: "workouts",
        linked_id: input.workout.id,
        metadata,
      })
      .select("*")
      .single();

    if (error) {
      throwSupabaseError(error, "Failed to create workout life entity");
    }

    return toLifeEntityRecord(data);
  }

  private async upsertHealthDailyLifeEntity(input: {
    userId: string;
    healthDailyId: string;
    date: string;
    source: string;
    syncReason: string;
    recoveryMode: string;
    dataCompletenessScore: number;
    workoutsCount: number;
    samplesCount: number;
    missingMetrics: Record<string, boolean>;
  }): Promise<LifeEntityRecord> {
    const missingMetricNames = Object.entries(input.missingMetrics)
      .filter(([, missing]) => missing)
      .map(([name]) => name);
    const metadata = {
      date: input.date,
      syncReason: input.syncReason,
      recoveryMode: input.recoveryMode,
      recoveryModeLabel: healthModeLabel(input.recoveryMode as HealthMode),
      dataCompletenessScore: input.dataCompletenessScore,
      workoutsCount: input.workoutsCount,
      samplesCount: input.samplesCount,
      missingMetrics: input.missingMetrics,
    };
    const title = `Health daily ${input.date}`;
    const body = [
      `Recovery mode: ${healthModeLabel(input.recoveryMode as HealthMode)}`,
      `Data completeness: ${input.dataCompletenessScore}`,
      `Workouts: ${input.workoutsCount}`,
      `Samples: ${input.samplesCount}`,
      `Missing metrics: ${missingMetricNames.length ? missingMetricNames.join(", ") : "none"}`,
    ].join("\n");
    const { data: existing, error: existingError } = await this.client
      .from("life_entities")
      .select("id")
      .eq("user_id", input.userId)
      .eq("entity_type", "health_daily")
      .eq("linked_table", "health_daily")
      .eq("linked_id", input.healthDailyId)
      .maybeSingle();

    if (existingError) {
      throwSupabaseError(
        existingError,
        "Failed to load health daily life entity",
      );
    }

    if (existing) {
      const { data, error } = await this.client
        .from("life_entities")
        .update({
          title,
          body,
          source: input.source,
          source_command: "POST /health/ingest",
          metadata,
        })
        .eq("id", existing.id)
        .select("*")
        .single();

      if (error) {
        throwSupabaseError(error, "Failed to update health daily life entity");
      }

      return toLifeEntityRecord(data);
    }

    const { data, error } = await this.client
      .from("life_entities")
      .insert({
        user_id: input.userId,
        entity_type: "health_daily",
        title,
        body,
        source: input.source,
        source_command: "POST /health/ingest",
        linked_table: "health_daily",
        linked_id: input.healthDailyId,
        metadata,
      })
      .select("*")
      .single();

    if (error) {
      throwSupabaseError(error, "Failed to create health daily life entity");
    }

    return toLifeEntityRecord(data);
  }
}
