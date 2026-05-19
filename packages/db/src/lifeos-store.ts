import {
  calculateHealthIngestDaily,
  healthModeLabel,
  resolveHealthMode,
  scoreFocus,
  type HealthIngestPayload,
  type HealthMode,
} from "@lifeos/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Database,
  HealthSyncRunStatus,
  Json,
  LifeEntityType,
  ObsidianSyncStatus,
} from "./types.js";

type LifeOSSupabaseClient = SupabaseClient<Database>;
type WorkoutRow = Database["public"]["Tables"]["workouts"]["Row"];
type WorkoutSetRow = Database["public"]["Tables"]["workout_sets"]["Row"];
type FitnessExerciseRow =
  Database["public"]["Tables"]["fitness_exercises"]["Row"];
type HealthDailyRow = Database["public"]["Tables"]["health_daily"]["Row"];

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
  title: string;
  body: string | null;
  dueAt: string | null;
  linkedTable: string | null;
  linkedId: string | null;
  createdAt: string;
}

export interface CreateLifeEntityInput {
  userId: string;
  entityType: LifeEntityType;
  title: string;
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
  reasons: string[];
  nextBestAction: string | null;
  openTaskCount: number;
}

export interface LifeOSStore {
  resolveTelegramUser(
    telegramUserId: number,
  ): Promise<TelegramUserRecord | null>;
  linkDefaultTelegramUser(
    input: BootstrapTelegramUserInput,
  ): Promise<TelegramUserRecord>;
  createTask(input: CreateTaskInput): Promise<TaskRecord>;
  createLifeEntity(input: CreateLifeEntityInput): Promise<LifeEntityRecord>;
  enqueueObsidianSync(input: {
    userId: string;
    lifeEntityId: string;
    payload?: Json;
  }): Promise<void>;
  listTodayEntities(input: {
    userId: string;
    dayStart: string;
    dayEnd: string;
  }): Promise<LifeEntityRecord[]>;
  getLatestDailyLog(userId: string): Promise<DailyLogRecord | null>;
  getObsidianSyncStatus(userId: string): Promise<ObsidianSyncStatusSummary>;
  getHealthSyncStatus(userId: string): Promise<HealthSyncStatusSummary>;
  getOrCreateCurrentWorkout(input: {
    userId: string;
    title?: string | null;
    now: string;
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

function toLifeEntityRecord(
  row: Database["public"]["Tables"]["life_entities"]["Row"],
): LifeEntityRecord {
  return {
    id: row.id,
    userId: row.user_id,
    entityType: row.entity_type,
    title: row.title,
    body: row.body,
    dueAt: row.due_at,
    linkedTable: row.linked_table,
    linkedId: row.linked_id,
    createdAt: row.created_at,
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

function addSeconds(timestamp: string, seconds: number): string {
  return new Date(new Date(timestamp).getTime() + seconds * 1000).toISOString();
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

  async createLifeEntity(
    input: CreateLifeEntityInput,
  ): Promise<LifeEntityRecord> {
    const { data, error } = await this.client
      .from("life_entities")
      .insert({
        user_id: input.userId,
        entity_type: input.entityType,
        title: input.title,
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
    payload?: Json;
  }): Promise<void> {
    const { error } = await this.client.from("obsidian_sync_queue").insert({
      user_id: input.userId,
      life_entity_id: input.lifeEntityId,
      payload: input.payload ?? {},
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

  async getOrCreateCurrentWorkout(input: {
    userId: string;
    title?: string | null;
    now: string;
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
      await this.ensureDefaultWorkoutPlan(input.userId, existing.id);

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
        title: input.title ?? "Telegram workout",
        workout_type: "strength",
        started_at: input.now,
        metadata: {
          source: "telegram",
          template: "default_strength",
        },
      })
      .select("id, title, started_at")
      .single();

    if (error) {
      throwSupabaseError(error, "Failed to create workout");
    }

    await this.ensureDefaultWorkoutPlan(input.userId, data.id);

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
    const [health, focus, workout, obsidianStatus] = await Promise.all([
      this.getTmaHealthSummary(user.userId),
      this.getTmaFocusSummary(user.userId),
      this.getCurrentWorkout({ userId: user.userId }),
      this.getObsidianSyncStatus(user.userId),
    ]);

    return {
      displayName: user.displayName ?? undefined,
      localDate: localDateFor(user.timezone),
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
    const latest = await this.getLatestHealthDaily(userId);

    if (!latest) {
      return {
        date: new Date().toISOString().slice(0, 10),
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
    const [health, openTaskCount] = await Promise.all([
      this.getLatestHealthDaily(userId),
      this.getOpenTaskCount(userId),
    ]);
    const mode = health?.recovery_mode ?? "baseline";
    const result = scoreFocus({
      healthMode: mode,
      moodScore: health?.mood_score ?? undefined,
      energyScore: health?.energy_score ?? undefined,
      stressScore: health?.stress_score ?? undefined,
      sleepHours: health?.sleep_minutes
        ? Number(health.sleep_minutes) / 60
        : undefined,
      openTaskCount,
    });

    return {
      score: result.score,
      band: result.band,
      mode,
      reasons: result.reasons,
      nextBestAction:
        result.band === "low"
          ? "Pick one small task and protect recovery."
          : result.band === "medium"
            ? "Work the next concrete task before adding inputs."
            : "Use the strong window for deep work.",
      openTaskCount,
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

  private async ensureDefaultWorkoutPlan(
    userId: string,
    workoutId: string,
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

    for (const exercise of DEFAULT_WORKOUT_PLAN) {
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
