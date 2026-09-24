import { describe, expect, it } from "vitest";
import {
  calculateHealthIngestDaily,
  healthIngestMetricInputs,
  parseHealthIngestPayload,
  parseHealthMetricsIngestPayload,
} from "./health-ingest.js";

describe("health ingest", () => {
  it("parses previous-day sync payloads with snake_case fields", () => {
    const payload = parseHealthIngestPayload({
      user_id: "user-1",
      date: "2026-05-17",
      sync_reason: "nightly_00_01",
      metrics: {
        sleep_minutes: 480,
        deep_sleep_minutes: 90,
        rem_sleep_minutes: 80,
        awake_minutes: 20,
        resting_heart_rate: 58,
        average_heart_rate: 74,
        distance_meters: 3200,
        spo2_avg: 97,
      },
      workouts: [
        {
          external_id: "w1",
          started_at: "2026-05-17T10:00:00.000Z",
        },
      ],
      samples: [
        {
          sample_type: "heart_rate",
          sampled_at: "2026-05-17T10:15:00.000Z",
          value: 110,
          unit: "bpm",
        },
      ],
      missing: {
        stress: true,
        sleep_stages: false,
      },
    });

    expect(payload.userId).toBe("user-1");
    expect(payload.syncReason).toBe("nightly_00_01");
    expect(payload.metrics.sleepMinutes).toBe(480);
    expect(payload.metrics.deepSleepMinutes).toBe(90);
    expect(payload.metrics.spo2Avg).toBe(97);
    expect(payload.metrics.averageHeartRate).toBe(74);
    expect(payload.metrics.distanceMeters).toBe(3200);
    expect(payload.missing).toEqual({
      stress: true,
      sleep_stages: false,
    });
    expect(payload.workouts).toHaveLength(1);
    expect(payload.samples).toHaveLength(1);
  });

  it("parses camelCase health payloads with missing metric flags", () => {
    const payload = parseHealthIngestPayload({
      userId: "user-1",
      date: "2026-05-17",
      syncReason: "manual",
      timezone: "Asia/Qyzylorda",
      source: "health_connect",
      metrics: {
        sleepMinutes: 420,
        deepSleepMinutes: 80,
        remSleepMinutes: 70,
        awakeMinutes: 15,
        restingHeartRate: 60,
        averageHeartRate: 75,
        distanceMeters: 0,
        hrvMs: 42,
        spo2Avg: 96,
        activeEnergyKcal: 500,
      },
      workouts: [],
      samples: [],
      missing: {
        stress: true,
        sleep_stages: false,
      },
      raw: {
        provider: "test",
      },
    });

    expect(payload.userId).toBe("user-1");
    expect(payload.syncReason).toBe("manual");
    expect(payload.metrics.deepSleepMinutes).toBe(80);
    expect(payload.metrics.remSleepMinutes).toBe(70);
    expect(payload.metrics.awakeMinutes).toBe(15);
    expect(payload.metrics.spo2Avg).toBe(96);
    expect(payload.metrics.averageHeartRate).toBe(75);
    expect(payload.metrics.distanceMeters).toBe(0);
    expect(payload.missing.stress).toBe(true);
    expect(payload.raw).toEqual({ provider: "test" });
  });

  it("rejects unsupported sync reasons", () => {
    expect(() =>
      parseHealthIngestPayload({
        user_id: "user-1",
        date: "2026-05-17",
        sync_reason: "unknown",
      }),
    ).toThrow("sync_reason");
  });

  it("mirrors only measured scalar metrics and retains real zeros", () => {
    expect(
      healthIngestMetricInputs({
        steps: 0,
        averageHeartRate: 76,
        restingHeartRate: undefined,
        hrvMs: 42,
        deepSleepMinutes: 50,
        distanceMeters: Number.NaN,
      }),
    ).toEqual([
      { type: "steps", value: 0, unit: "steps" },
      { type: "average_heart_rate", value: 76, unit: "bpm" },
    ]);
  });

  it("calculates recovery mode and completeness", () => {
    const computed = calculateHealthIngestDaily({
      metrics: {
        sleepMinutes: 210,
        restingHeartRate: 60,
        hrvMs: 40,
        steps: 9000,
        moodScore: 4,
      },
      workouts: [],
      samples: [],
      missing: {},
    });

    expect(computed.recoveryMode).toBe("recovery");
    expect(computed.dataCompletenessScore).toBe(55);
  });

  it("parses normalized Xiaomi Health Connect metrics", () => {
    const payload = parseHealthMetricsIngestPayload(
      {
        date: "2026-06-07",
        source: "xiaomi_health_connect",
        device: "Xiaomi Watch 4",
        metrics: [
          { type: "steps", value: 8200, unit: "steps" },
          { type: "sleep_minutes", value: 420, unit: "min" },
        ],
      },
      "user-1",
    );

    expect(payload.userId).toBe("user-1");
    expect(payload.source).toBe("xiaomi_health_connect");
    expect(payload.metrics).toHaveLength(2);
  });

  it("rejects unsupported normalized metric types", () => {
    expect(() =>
      parseHealthMetricsIngestPayload(
        {
          date: "2026-06-07",
          source: "xiaomi_health_connect",
          metrics: [{ type: "unknown_metric", value: 1 }],
        },
        "user-1",
      ),
    ).toThrow("metrics[0].type");
  });
});
