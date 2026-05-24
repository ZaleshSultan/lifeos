import type { AddressInfo } from "node:net";
import { createHmac } from "node:crypto";
import type {
  HealthIngestPayload,
  LifeMode,
  LifeModeResolution,
} from "@lifeos/core";
import type {
  CurrentWorkoutSummary,
  HealthIngestResult,
  LifeOSStore,
  StudyCourseRecord,
} from "@lifeos/db";
import { afterEach, describe, expect, it } from "vitest";
import { createBotServer } from "./server.js";
import type { SendMessageInput, TelegramClient } from "./telegram/types.js";

const servers: ReturnType<typeof createBotServer>[] = [];

async function listen(
  server: ReturnType<typeof createBotServer>,
): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

function healthIngestStore(
  seen: HealthIngestPayload[],
): Pick<LifeOSStore, "ingestHealthPayload"> {
  return {
    async ingestHealthPayload(payload) {
      seen.push(payload);
      return {
        healthDailyId: "health-daily-1",
        lifeEntityId: "life-entity-1",
        syncRunId: "sync-run-1",
        date: payload.date,
        recoveryMode: "growth",
        dataCompletenessScore: 85,
        workoutsUpserted: payload.workouts.length,
        samplesInserted: payload.samples.length,
      } satisfies HealthIngestResult;
    },
  };
}

function workoutSummary(overrides: Partial<CurrentWorkoutSummary> = {}) {
  return {
    id: "workout-1",
    title: "Push day",
    mode: "active",
    startedAt: "2026-05-18T10:00:00.000Z",
    progressPercent: 0,
    completedSets: 0,
    totalSets: 1,
    restTimerEndsAt: null,
    exercises: [
      {
        id: "exercise-1",
        name: "Push-up",
        note: "strength",
        sets: [
          {
            id: "set-1",
            index: 1,
            targetReps: 10,
            targetWeightKg: null,
            completed: false,
            completedAt: null,
          },
        ],
      },
    ],
    ...overrides,
  } satisfies CurrentWorkoutSummary;
}

function tmaStore(events: string[] = []): LifeOSStore {
  let mode: LifeMode = "trimester";
  let course: StudyCourseRecord = {
    id: "course-1",
    userId: "user-1",
    code: "DISCRETE-MATH-SUMMER-2026",
    title: "Discrete Mathematics",
    term: "Summer 2026",
    startsOn: "2026-07-06",
    endsOn: "2026-08-15",
    status: "active",
    progressPercent: 0,
    completedUnits: 0,
    totalUnits: null,
    lastStudiedOn: null,
    metadata: {},
    createdAt: "2026-05-18T10:00:00.000Z",
    updatedAt: "2026-05-18T10:00:00.000Z",
  };
  const modeResolution = (): LifeModeResolution => ({
    userId: "user-1",
    mode,
    label: mode === "summer" ? "Summer Mode" : "Trimester Mode",
    source: mode === "trimester" ? "default" : "manual",
    reason:
      mode === "trimester"
        ? "No manual override, recovery signal, season, or sprint is active."
        : "TMA override until cleared.",
    activeUntil: null,
    priorityWeights:
      mode === "summer"
        ? { projects: 90, cybersecurity: 80, health: 70 }
        : { study: 70, health: 40, finance: 30, projects: 30 },
    resolvedAt: "2026-05-18T10:00:00.000Z",
  });

  return {
    async resolveTelegramUser() {
      return null;
    },
    async linkDefaultTelegramUser() {
      return {
        userId: "user-1",
        displayName: "User",
        timezone: "UTC",
      };
    },
    async createTask() {
      throw new Error("not used");
    },
    async createLifeCapture() {
      throw new Error("not used");
    },
    async createLifeEntity() {
      throw new Error("not used");
    },
    async enqueueObsidianSync() {},
    async listTodayEntities() {
      return [];
    },
    async getLatestDailyLog() {
      return null;
    },
    async getObsidianSyncStatus() {
      return { counts: {} };
    },
    async getHealthSyncStatus() {
      return { counts: {}, runs: [], latestRun: null };
    },
    async getActiveManualMode() {
      return null;
    },
    async getActiveSeason() {
      return null;
    },
    async getActiveStudyCourse() {
      events.push("getActiveStudyCourse");
      return course;
    },
    async updateStudyCourseProgress(input) {
      events.push("updateStudyCourseProgress");
      course = {
        ...course,
        progressPercent: input.progressPercent,
        lastStudiedOn: input.lastStudiedOn ?? course.lastStudiedOn,
        updatedAt: "2026-05-18T10:05:00.000Z",
      };
      return course;
    },
    async resolveCurrentMode() {
      events.push("resolveCurrentMode");
      return modeResolution();
    },
    async setManualMode(input) {
      events.push("setManualMode");
      mode = input.mode;
      return modeResolution();
    },
    async clearManualMode() {
      events.push("clearManualMode");
      mode = "trimester";
      return modeResolution();
    },
    async setManualLifeMode(input) {
      events.push("setManualLifeMode");
      mode = input.mode;
      return modeResolution();
    },
    async clearManualLifeMode() {
      events.push("clearManualLifeMode");
      mode = "trimester";
      return modeResolution();
    },
    async listModeAwareFocusItems() {
      return [];
    },
    async getOrCreateCurrentWorkout() {
      events.push("getOrCreateCurrentWorkout");
      return {
        id: "workout-1",
        title: "Push day",
        startedAt: "2026-05-18T10:00:00.000Z",
        created: false,
      };
    },
    async getCurrentWorkout() {
      events.push("getCurrentWorkout");
      return workoutSummary();
    },
    async completeWorkoutSet() {
      events.push("completeWorkoutSet");
      return workoutSummary({
        progressPercent: 100,
        completedSets: 1,
        exercises: [
          {
            id: "exercise-1",
            name: "Push-up",
            note: "strength",
            sets: [
              {
                id: "set-1",
                index: 1,
                targetReps: 10,
                targetWeightKg: null,
                completed: true,
                completedAt: "2026-05-18T10:05:00.000Z",
              },
            ],
          },
        ],
      });
    },
    async undoWorkoutSet() {
      events.push("undoWorkoutSet");
      return workoutSummary();
    },
    async completeWorkout() {
      events.push("completeWorkout");
      return workoutSummary({
        mode: "completed",
        progressPercent: 100,
        completedSets: 1,
      });
    },
    async getTmaHomeSummary() {
      return {
        displayName: "Dev user",
        localDate: "May 18, 2026",
        mode: "trimester",
        modeLabel: "Trimester Mode",
        modeReason: "Trimester Mode is active from default.",
        recoveryMode: "baseline",
        focusScore: 80,
        activeWorkout: {
          id: "workout-1",
          title: "Push day",
          startedAt: "2026-05-18T10:00:00.000Z",
          progressPercent: 0,
        },
        healthCompletenessScore: 50,
        pendingSyncCount: 0,
      };
    },
    async getTmaHealthSummary() {
      return {
        date: "2026-05-17",
        lifeMode: "trimester",
        lifeModeLabel: "Trimester Mode",
        recommendation: "Balance study blocks with health and finance basics.",
        recoveryMode: "baseline",
        dataCompletenessScore: 50,
        sleepMinutes: 480,
        deepSleepMinutes: 90,
        remSleepMinutes: 80,
        awakeMinutes: 20,
        restingHeartRate: 58,
        hrvMs: 45,
        spo2Avg: 97,
        steps: 9000,
        activeEnergyKcal: 600,
        missingMetrics: {},
        samplesCount: 4,
      };
    },
    async getTmaFocusSummary() {
      return {
        score: 80,
        band: "high",
        mode: "baseline",
        lifeMode: "trimester",
        lifeModeLabel: "Trimester Mode",
        lifeModeReason: "Trimester Mode is active from default.",
        reasons: [],
        nextBestAction: "Deep work",
        openTaskCount: 2,
        topItems: [],
        priorityWeights: {},
      };
    },
    async getFinanceSummary() {
      return {
        capturedSpendCount: 0,
        capturedSpendTotal: null,
      };
    },
    async ingestHealthPayload(payload) {
      return {
        healthDailyId: "health-daily-1",
        lifeEntityId: "life-entity-1",
        syncRunId: "sync-run-1",
        date: payload.date,
        recoveryMode: "growth",
        dataCompletenessScore: 85,
        workoutsUpserted: payload.workouts.length,
        samplesInserted: payload.samples.length,
      };
    },
  };
}

function signedInitData(botToken: string, telegramUserId: number): string {
  const params = new URLSearchParams({
    auth_date: "1779120000",
    query_id: "test-query",
    user: JSON.stringify({
      id: telegramUserId,
      first_name: "Test",
    }),
  });
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secret)
    .update(dataCheckString)
    .digest("hex");
  params.set("hash", hash);
  return params.toString();
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }

            resolve();
          });
        }),
    ),
  );
});

describe("bot server", () => {
  it("serves healthz", async () => {
    const server = createBotServer({
      startedAt: new Date(),
      version: "test",
      dependencies: {
        supabaseConfigured: true,
      },
    });
    servers.push(server);

    const port = await listen(server);
    const response = await fetch(`http://127.0.0.1:${port}/healthz`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      service: "lifeos-bot",
      version: "test",
      dependencies: {
        supabaseConfigured: true,
      },
    });
  });

  it("accepts Telegram webhook updates when the secret matches", async () => {
    const sent: SendMessageInput[] = [];
    const telegram: TelegramClient = {
      async sendMessage(input) {
        sent.push(input);
      },
    };
    const server = createBotServer({
      config: {
        telegramWebhookPath: "/telegram/webhook",
        telegramWebhookSecret: "secret",
      },
      telegram,
      dependencies: {
        telegramConfigured: true,
      },
    });
    servers.push(server);

    const port = await listen(server);
    const response = await fetch(`http://127.0.0.1:${port}/telegram/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": "secret",
      },
      body: JSON.stringify({
        update_id: 1,
        message: {
          message_id: 10,
          text: "/start",
          chat: {
            id: 20,
            type: "private",
          },
          from: {
            id: 30,
            first_name: "Test",
          },
        },
      }),
    });

    expect(response.status).toBe(200);
    expect(sent.at(0)?.text).toContain("LifeOS bot is online");
  });

  it("rejects Telegram webhook updates with the wrong secret", async () => {
    const server = createBotServer({
      config: {
        telegramWebhookPath: "/telegram/webhook",
        telegramWebhookSecret: "secret",
      },
      telegram: {
        async sendMessage() {},
      },
    });
    servers.push(server);

    const port = await listen(server);
    const response = await fetch(`http://127.0.0.1:${port}/telegram/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": "wrong",
      },
      body: JSON.stringify({ update_id: 1 }),
    });

    expect(response.status).toBe(401);
  });

  it("rejects health ingest requests with a wrong secret", async () => {
    const server = createBotServer({
      config: {
        lifeosIngestSecret: "ingest-secret",
      },
      store: healthIngestStore([]) as LifeOSStore,
    });
    servers.push(server);

    const port = await listen(server);
    const response = await fetch(`http://127.0.0.1:${port}/health/ingest`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-lifeos-ingest-secret": "wrong",
      },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(401);
  });

  it("accepts previous-day health ingest payloads", async () => {
    const seen: HealthIngestPayload[] = [];
    const server = createBotServer({
      config: {
        lifeosIngestSecret: "ingest-secret",
      },
      store: healthIngestStore(seen) as LifeOSStore,
    });
    servers.push(server);

    const port = await listen(server);
    const response = await fetch(`http://127.0.0.1:${port}/health/ingest`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-lifeos-ingest-secret": "ingest-secret",
      },
      body: JSON.stringify({
        user_id: "user-1",
        date: "2026-05-17",
        sync_reason: "nightly_00_01",
        source: "healthkit",
        metrics: {
          sleep_minutes: 480,
          resting_heart_rate: 58,
          hrv_ms: 45,
          steps: 9200,
        },
        workouts: [
          {
            external_id: "workout-1",
            started_at: "2026-05-17T10:00:00.000Z",
            duration_minutes: 45,
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
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      result: {
        healthDailyId: "health-daily-1",
        date: "2026-05-17",
        workoutsUpserted: 1,
        samplesInserted: 1,
      },
    });
    expect(seen.at(0)?.syncReason).toBe("nightly_00_01");
  });

  it("rejects invalid health ingest payloads", async () => {
    const server = createBotServer({
      config: {
        lifeosIngestSecret: "ingest-secret",
      },
      store: healthIngestStore([]) as LifeOSStore,
    });
    servers.push(server);

    const port = await listen(server);
    const response = await fetch(`http://127.0.0.1:${port}/health/ingest`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-lifeos-ingest-secret": "ingest-secret",
      },
      body: JSON.stringify({
        user_id: "user-1",
        date: "2026-05-17",
        sync_reason: "wrong",
      }),
    });

    expect(response.status).toBe(400);
  });

  it("rejects TMA requests without Telegram auth by default", async () => {
    const server = createBotServer({
      store: tmaStore(),
    });
    servers.push(server);

    const port = await listen(server);
    const response = await fetch(`http://127.0.0.1:${port}/api/tma/home`);

    expect(response.status).toBe(401);
  });

  it("accepts valid Telegram initData for TMA requests", async () => {
    const store = tmaStore();
    store.resolveTelegramUser = async () => ({
      userId: "user-1",
      displayName: "Test",
      timezone: "UTC",
    });
    const server = createBotServer({
      config: {
        telegramBotToken: "bot-token",
      },
      store,
    });
    servers.push(server);

    const port = await listen(server);
    const response = await fetch(`http://127.0.0.1:${port}/api/tma/home`, {
      headers: {
        "x-telegram-init-data": signedInitData("bot-token", 30),
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        displayName: "Dev user",
      },
    });
  });

  it("serves and updates mode through TMA routes", async () => {
    const events: string[] = [];
    const server = createBotServer({
      config: {
        lifeosDefaultUserId: "user-1",
        allowUnsafeTmaDevAuth: true,
      },
      store: tmaStore(events),
    });
    servers.push(server);

    const port = await listen(server);
    const getResponse = await fetch(`http://127.0.0.1:${port}/api/tma/mode`);
    const setResponse = await fetch(`http://127.0.0.1:${port}/api/tma/mode`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        mode: "summer",
        duration: "permanent",
      }),
    });
    const clearResponse = await fetch(`http://127.0.0.1:${port}/api/tma/mode`, {
      method: "DELETE",
    });

    expect(getResponse.status).toBe(200);
    await expect(setResponse.json()).resolves.toMatchObject({
      data: {
        mode: "summer",
      },
    });
    expect(clearResponse.status).toBe(200);
    expect(events).toEqual([
      "resolveCurrentMode",
      "setManualLifeMode",
      "clearManualLifeMode",
    ]);
  });

  it("serves and updates the discrete mathematics course through TMA routes", async () => {
    const events: string[] = [];
    const server = createBotServer({
      config: {
        lifeosDefaultUserId: "user-1",
        allowUnsafeTmaDevAuth: true,
      },
      store: tmaStore(events),
    });
    servers.push(server);

    const port = await listen(server);
    const getResponse = await fetch(
      `http://127.0.0.1:${port}/api/tma/course/discrete-math-summer-term`,
    );
    const updateResponse = await fetch(
      `http://127.0.0.1:${port}/api/tma/course/discrete-math-summer-term/progress`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          progressPercent: 37,
        }),
      },
    );

    expect(getResponse.status).toBe(200);
    await expect(getResponse.json()).resolves.toMatchObject({
      data: {
        title: "Discrete Mathematics",
        progressPercent: 0,
      },
    });
    expect(updateResponse.status).toBe(200);
    await expect(updateResponse.json()).resolves.toMatchObject({
      data: {
        code: "DISCRETE-MATH-SUMMER-2026",
        progressPercent: 37,
      },
    });
    expect(events).toEqual([
      "getActiveStudyCourse",
      "updateStudyCourseProgress",
    ]);
  });

  it("serves current workout through the dev-only TMA fallback", async () => {
    const events: string[] = [];
    const server = createBotServer({
      config: {
        lifeosDefaultUserId: "user-1",
        allowUnsafeTmaDevAuth: true,
      },
      store: tmaStore(events),
    });
    servers.push(server);

    const port = await listen(server);
    const response = await fetch(
      `http://127.0.0.1:${port}/api/tma/workout/current`,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        id: "workout-1",
        exercises: [
          {
            sets: [
              {
                id: "set-1",
                completed: false,
              },
            ],
          },
        ],
      },
    });
    expect(events).toEqual([
      "resolveCurrentMode",
      "getOrCreateCurrentWorkout",
      "getCurrentWorkout",
    ]);
  });

  it("completes and undoes workout sets through TMA routes", async () => {
    const events: string[] = [];
    const server = createBotServer({
      config: {
        lifeosDefaultUserId: "user-1",
        allowUnsafeTmaDevAuth: true,
      },
      store: tmaStore(events),
    });
    servers.push(server);

    const port = await listen(server);
    const completeResponse = await fetch(
      `http://127.0.0.1:${port}/api/tma/workout/sets/set-1/complete`,
      { method: "POST" },
    );
    const undoResponse = await fetch(
      `http://127.0.0.1:${port}/api/tma/workout/sets/set-1/undo`,
      { method: "POST" },
    );
    const workoutResponse = await fetch(
      `http://127.0.0.1:${port}/api/tma/workout/workout-1/complete`,
      { method: "POST" },
    );

    expect(completeResponse.status).toBe(200);
    expect(undoResponse.status).toBe(200);
    expect(workoutResponse.status).toBe(200);
    expect(events).toEqual([
      "completeWorkoutSet",
      "undoWorkoutSet",
      "completeWorkout",
    ]);
  });
});
