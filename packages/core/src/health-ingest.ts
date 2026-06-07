import { resolveHealthMode } from "./health.js";
import type { HealthMode } from "./types.js";

export const HEALTH_SYNC_REASONS = [
  "nightly_00_01",
  "retry_00_15",
  "morning_reconcile_06_00",
  "manual",
  "backfill",
] as const;

export type HealthSyncReason = (typeof HEALTH_SYNC_REASONS)[number];

export interface HealthIngestMetrics {
  sleepMinutes?: number;
  sleepScore?: number;
  deepSleepMinutes?: number;
  remSleepMinutes?: number;
  awakeMinutes?: number;
  restingHeartRate?: number;
  hrvMs?: number;
  spo2Avg?: number;
  steps?: number;
  caloriesBurned?: number;
  activeEnergyKcal?: number;
  workoutMinutes?: number;
  weightKg?: number;
  moodScore?: number;
  energyScore?: number;
  stressScore?: number;
}

export interface HealthIngestWorkout {
  externalId?: string;
  startedAt: string;
  endedAt?: string;
  workoutType?: string;
  title?: string;
  durationMinutes?: number;
  caloriesKcal?: number;
  distanceMeters?: number;
  source?: string;
  metadata?: Record<string, unknown>;
}

export interface HealthIngestSample {
  sampleType: string;
  sampledAt: string;
  value: number;
  unit: string;
  source?: string;
  metadata?: Record<string, unknown>;
}

export interface HealthIngestPayload {
  userId: string;
  date: string;
  syncReason: HealthSyncReason;
  source?: string;
  timezone?: string;
  metrics: HealthIngestMetrics;
  workouts: HealthIngestWorkout[];
  samples: HealthIngestSample[];
  missing: Record<string, boolean>;
  raw?: Record<string, unknown>;
}

export interface HealthIngestComputedDaily {
  recoveryMode: HealthMode;
  dataCompletenessScore: number;
}

export const HEALTH_METRIC_TYPES = [
  "steps",
  "sleep_minutes",
  "sleep_score",
  "resting_heart_rate",
  "average_heart_rate",
  "active_energy_kcal",
  "total_energy_kcal",
  "workout_minutes",
  "distance_m",
  "weight_kg",
  "spo2_percent",
  "stress_score",
  "mood_score",
  "energy_score",
] as const;

export type HealthMetricType = (typeof HEALTH_METRIC_TYPES)[number];

export const HEALTH_METRIC_SOURCES = [
  "manual",
  "telegram",
  "tma",
  "xiaomi_health_connect",
  "import_json",
  "import_csv",
  "api",
] as const;

export type HealthMetricSource = (typeof HEALTH_METRIC_SOURCES)[number];

export interface HealthMetricInput {
  type: HealthMetricType;
  value: number;
  unit?: string | null;
  confidence?: number | null;
  rawJson?: Record<string, unknown>;
}

export interface HealthMetricsIngestPayload {
  userId: string;
  date: string;
  source: HealthMetricSource;
  device?: string | null;
  timezone?: string | null;
  metrics: HealthMetricInput[];
  raw?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberField(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = record[key];

  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  return value;
}

function optionalMetadata(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function booleanRecord(value: unknown): Record<string, boolean> {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, boolean] => {
        return typeof entry[1] === "boolean";
      })
      .map(([key, present]) => [key, present]),
  );
}

function assertDateString(value: string, field: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${field} must be YYYY-MM-DD`);
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);

  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`${field} must be a valid calendar date`);
  }

  return value;
}

function assertDateTimeString(value: string, field: string): string {
  if (Number.isNaN(new Date(value).getTime())) {
    throw new Error(`${field} must be an ISO datetime`);
  }

  return value;
}

export function isHealthSyncReason(value: string): value is HealthSyncReason {
  return HEALTH_SYNC_REASONS.includes(value as HealthSyncReason);
}

export function isHealthMetricType(value: string): value is HealthMetricType {
  return HEALTH_METRIC_TYPES.includes(value as HealthMetricType);
}

export function isHealthMetricSource(
  value: string,
): value is HealthMetricSource {
  return HEALTH_METRIC_SOURCES.includes(value as HealthMetricSource);
}

export function parseHealthIngestPayload(input: unknown): HealthIngestPayload {
  if (!isRecord(input)) {
    throw new Error("Health ingest payload must be an object");
  }

  const userId = stringField(input, "user_id") ?? stringField(input, "userId");
  const date = stringField(input, "date");
  const syncReason =
    stringField(input, "sync_reason") ?? stringField(input, "syncReason");

  if (!userId) {
    throw new Error("user_id is required");
  }

  if (!date) {
    throw new Error("date is required");
  }

  if (!syncReason || !isHealthSyncReason(syncReason)) {
    throw new Error(
      `sync_reason must be one of: ${HEALTH_SYNC_REASONS.join(", ")}`,
    );
  }

  const metricsRecord = isRecord(input.metrics) ? input.metrics : {};
  const workouts = Array.isArray(input.workouts) ? input.workouts : [];
  const samples = Array.isArray(input.samples) ? input.samples : [];
  const missingRecord = isRecord(input.missing)
    ? input.missing
    : isRecord(metricsRecord.missing)
      ? metricsRecord.missing
      : undefined;

  return {
    userId,
    date: assertDateString(date, "date"),
    syncReason,
    source: stringField(input, "source"),
    timezone: stringField(input, "timezone"),
    metrics: {
      sleepMinutes:
        numberField(metricsRecord, "sleep_minutes") ??
        numberField(metricsRecord, "sleepMinutes"),
      sleepScore:
        numberField(metricsRecord, "sleep_score") ??
        numberField(metricsRecord, "sleepScore"),
      deepSleepMinutes:
        numberField(metricsRecord, "deep_sleep_minutes") ??
        numberField(metricsRecord, "deepSleepMinutes"),
      remSleepMinutes:
        numberField(metricsRecord, "rem_sleep_minutes") ??
        numberField(metricsRecord, "remSleepMinutes"),
      awakeMinutes:
        numberField(metricsRecord, "awake_minutes") ??
        numberField(metricsRecord, "awakeMinutes"),
      restingHeartRate:
        numberField(metricsRecord, "resting_heart_rate") ??
        numberField(metricsRecord, "restingHeartRate"),
      hrvMs:
        numberField(metricsRecord, "hrv_ms") ??
        numberField(metricsRecord, "hrvMs"),
      spo2Avg:
        numberField(metricsRecord, "spo2_avg") ??
        numberField(metricsRecord, "spo2Avg"),
      steps: numberField(metricsRecord, "steps"),
      caloriesBurned:
        numberField(metricsRecord, "calories_burned") ??
        numberField(metricsRecord, "caloriesBurned"),
      activeEnergyKcal:
        numberField(metricsRecord, "active_energy_kcal") ??
        numberField(metricsRecord, "activeEnergyKcal"),
      workoutMinutes:
        numberField(metricsRecord, "workout_minutes") ??
        numberField(metricsRecord, "workoutMinutes"),
      weightKg:
        numberField(metricsRecord, "weight_kg") ??
        numberField(metricsRecord, "weightKg"),
      moodScore:
        numberField(metricsRecord, "mood_score") ??
        numberField(metricsRecord, "moodScore"),
      energyScore:
        numberField(metricsRecord, "energy_score") ??
        numberField(metricsRecord, "energyScore"),
      stressScore:
        numberField(metricsRecord, "stress_score") ??
        numberField(metricsRecord, "stressScore"),
    },
    workouts: workouts.map((item, index) => {
      if (!isRecord(item)) {
        throw new Error(`workouts[${index}] must be an object`);
      }

      const startedAt =
        stringField(item, "started_at") ?? stringField(item, "startedAt");

      if (!startedAt) {
        throw new Error(`workouts[${index}].started_at is required`);
      }

      return {
        externalId:
          stringField(item, "external_id") ?? stringField(item, "externalId"),
        startedAt: assertDateTimeString(
          startedAt,
          `workouts[${index}].started_at`,
        ),
        endedAt: stringField(item, "ended_at")
          ? assertDateTimeString(
              stringField(item, "ended_at") ?? "",
              `workouts[${index}].ended_at`,
            )
          : stringField(item, "endedAt")
            ? assertDateTimeString(
                stringField(item, "endedAt") ?? "",
                `workouts[${index}].endedAt`,
              )
            : undefined,
        workoutType:
          stringField(item, "workout_type") ?? stringField(item, "workoutType"),
        title: stringField(item, "title"),
        durationMinutes:
          numberField(item, "duration_minutes") ??
          numberField(item, "durationMinutes"),
        caloriesKcal:
          numberField(item, "calories_kcal") ??
          numberField(item, "caloriesKcal"),
        distanceMeters:
          numberField(item, "distance_meters") ??
          numberField(item, "distanceMeters"),
        source: stringField(item, "source"),
        metadata: optionalMetadata(item.metadata),
      };
    }),
    samples: samples.map((item, index) => {
      if (!isRecord(item)) {
        throw new Error(`samples[${index}] must be an object`);
      }

      const sampleType =
        stringField(item, "sample_type") ?? stringField(item, "sampleType");
      const sampledAt =
        stringField(item, "sampled_at") ?? stringField(item, "sampledAt");
      const unit = stringField(item, "unit");
      const value = numberField(item, "value");

      if (!sampleType) {
        throw new Error(`samples[${index}].sample_type is required`);
      }

      if (!sampledAt) {
        throw new Error(`samples[${index}].sampled_at is required`);
      }

      if (value === undefined) {
        throw new Error(`samples[${index}].value is required`);
      }

      if (!unit) {
        throw new Error(`samples[${index}].unit is required`);
      }

      return {
        sampleType,
        sampledAt: assertDateTimeString(
          sampledAt,
          `samples[${index}].sampled_at`,
        ),
        value,
        unit,
        source: stringField(item, "source"),
        metadata: optionalMetadata(item.metadata),
      };
    }),
    missing: booleanRecord(missingRecord),
    raw: optionalMetadata(input.raw),
  };
}

export function parseHealthMetricsIngestPayload(
  input: unknown,
  defaultUserId?: string,
): HealthMetricsIngestPayload {
  if (!isRecord(input)) {
    throw new Error("Health metrics ingest payload must be an object");
  }

  const userId =
    stringField(input, "user_id") ??
    stringField(input, "userId") ??
    defaultUserId;
  const date = stringField(input, "date");
  const source = stringField(input, "source") ?? "api";

  if (!userId) {
    throw new Error("user_id is required");
  }

  if (!date) {
    throw new Error("date is required");
  }

  if (!isHealthMetricSource(source)) {
    throw new Error(
      `source must be one of: ${HEALTH_METRIC_SOURCES.join(", ")}`,
    );
  }

  if (!Array.isArray(input.metrics) || input.metrics.length === 0) {
    throw new Error("metrics must be a non-empty array");
  }

  return {
    userId,
    date: assertDateString(date, "date"),
    source,
    device: stringField(input, "device") ?? null,
    timezone: stringField(input, "timezone") ?? null,
    metrics: input.metrics.map((item, index) => {
      if (!isRecord(item)) {
        throw new Error(`metrics[${index}] must be an object`);
      }

      const type = stringField(item, "type");
      const value = numberField(item, "value");

      if (!type || !isHealthMetricType(type)) {
        throw new Error(
          `metrics[${index}].type must be one of: ${HEALTH_METRIC_TYPES.join(", ")}`,
        );
      }

      if (value === undefined) {
        throw new Error(`metrics[${index}].value is required`);
      }

      const confidence = numberField(item, "confidence");

      return {
        type,
        value,
        unit: stringField(item, "unit") ?? null,
        confidence: confidence ?? null,
        rawJson:
          optionalMetadata(item.raw_json) ??
          optionalMetadata(item.rawJson) ??
          undefined,
      };
    }),
    raw: optionalMetadata(input.raw),
  };
}

export function calculateDataCompletenessScore(
  payload: Pick<
    HealthIngestPayload,
    "metrics" | "workouts" | "samples" | "missing"
  >,
): number {
  const hasSleepStages =
    payload.metrics.deepSleepMinutes !== undefined ||
    payload.metrics.remSleepMinutes !== undefined ||
    payload.metrics.awakeMinutes !== undefined;
  const weightedChecks: Array<[boolean, number]> = [
    [payload.metrics.sleepMinutes !== undefined, 15],
    [hasSleepStages, 10],
    [payload.metrics.restingHeartRate !== undefined, 10],
    [payload.metrics.hrvMs !== undefined, 10],
    [payload.metrics.steps !== undefined, 10],
    [
      payload.metrics.activeEnergyKcal !== undefined ||
        payload.metrics.caloriesBurned !== undefined,
      10,
    ],
    [payload.metrics.spo2Avg !== undefined, 5],
    [
      payload.metrics.moodScore !== undefined ||
        payload.metrics.energyScore !== undefined ||
        payload.metrics.stressScore !== undefined,
      10,
    ],
    [payload.workouts.length > 0, 10],
    [payload.samples.length > 0, 10],
  ];
  const score = weightedChecks.reduce((total, [present, weight]) => {
    return present ? total + weight : total;
  }, 0);

  return Math.min(100, score);
}

export function calculateHealthIngestDaily(
  payload: Pick<
    HealthIngestPayload,
    "metrics" | "workouts" | "samples" | "missing"
  >,
): HealthIngestComputedDaily {
  return {
    recoveryMode: resolveHealthMode({
      sleepHours:
        payload.metrics.sleepMinutes === undefined
          ? undefined
          : payload.metrics.sleepMinutes / 60,
      moodScore: payload.metrics.moodScore,
      energyScore: payload.metrics.energyScore,
      stressScore: payload.metrics.stressScore,
    }),
    dataCompletenessScore: calculateDataCompletenessScore(payload),
  };
}
