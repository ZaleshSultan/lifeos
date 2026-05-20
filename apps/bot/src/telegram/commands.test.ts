import { readFile } from "node:fs/promises";
import type { HealthIngestPayload } from "@lifeos/core";
import type {
  CreateLifeCaptureInput,
  CreateLifeEntityInput,
  CreateTaskInput,
  CurrentWorkoutSummary,
  DailyLogRecord,
  FinanceSummary,
  HealthSyncStatusSummary,
  HealthIngestResult,
  LifeEntityRecord,
  LifeOSStore,
  ObsidianSyncStatusSummary,
  TaskRecord,
  TelegramUserRecord,
  TmaFocusSummary,
  TmaHealthSummary,
  TmaHomeSummary,
  WorkoutRecord,
} from "@lifeos/db";
import { describe, expect, it } from "vitest";
import { handleTelegramUpdate } from "./commands.js";
import type {
  SendMessageInput,
  TelegramBotRuntime,
  TelegramUpdate,
} from "./types.js";

class FakeStore implements LifeOSStore {
  readonly tasks: CreateTaskInput[] = [];
  readonly captures: CreateLifeCaptureInput[] = [];
  readonly entities: LifeEntityRecord[] = [];
  readonly syncEntityIds: string[] = [];
  readonly syncJobs: Array<
    Parameters<LifeOSStore["enqueueObsidianSync"]>[0]
  > = [];

  user: TelegramUserRecord | null = {
    userId: "user-1",
    displayName: "User",
    timezone: "UTC",
  };

  workout: WorkoutRecord = {
    id: "workout-1",
    title: "Push day",
    startedAt: "2026-05-18T00:00:00.000Z",
    created: true,
  };

  async resolveTelegramUser(): Promise<TelegramUserRecord | null> {
    return this.user;
  }

  async linkDefaultTelegramUser(): Promise<TelegramUserRecord> {
    this.user = {
      userId: "user-1",
      displayName: "User",
      timezone: "UTC",
    };
    return this.user;
  }

  async createTask(input: CreateTaskInput): Promise<TaskRecord> {
    this.tasks.push(input);
    return {
      id: `task-${this.tasks.length}`,
      title: input.title,
      dueAt: input.dueAt ?? null,
    };
  }

  async createLifeCapture(input: CreateLifeCaptureInput) {
    this.captures.push(input);
    return {
      id: `capture-${this.captures.length}`,
      userId: input.userId,
      text: input.text,
      source: input.source ?? "telegram",
      status: input.status ?? "inbox",
      chatId: input.chatId ?? null,
      createdAt: "2026-05-18T00:00:00.000Z",
    };
  }

  async createLifeEntity(
    input: CreateLifeEntityInput,
  ): Promise<LifeEntityRecord> {
    const entity: LifeEntityRecord = {
      id: `entity-${this.entities.length + 1}`,
      userId: input.userId,
      entityType: input.entityType,
      domain: input.domain ?? "personal",
      status: input.status ?? "inbox",
      title: input.title,
      description: input.description ?? null,
      body: input.body ?? null,
      source: input.source ?? "telegram",
      sourceCommand: input.sourceCommand ?? null,
      telegramChatId: input.telegramChatId ?? null,
      telegramMessageId: input.telegramMessageId ?? null,
      dueAt: input.dueAt ?? null,
      linkedTable: input.linkedTable ?? null,
      linkedId: input.linkedId ?? null,
      metadata: input.metadata ?? {},
      rawPayloadJson: input.rawPayloadJson ?? {},
      createdAt: "2026-05-18T00:00:00.000Z",
    };
    this.entities.push(entity);
    return entity;
  }

  async enqueueObsidianSync(
    input: Parameters<LifeOSStore["enqueueObsidianSync"]>[0],
  ): Promise<void> {
    this.syncEntityIds.push(input.lifeEntityId);
    this.syncJobs.push(input);
  }

  async listTodayEntities(): Promise<LifeEntityRecord[]> {
    return this.entities;
  }

  async getLatestDailyLog(): Promise<DailyLogRecord | null> {
    return {
      moodScore: 8,
      energyScore: 7,
      focusScore: null,
      notes: null,
    };
  }

  async getObsidianSyncStatus(): Promise<ObsidianSyncStatusSummary> {
    return {
      counts: {
        pending: 2,
        failed: 1,
      },
    };
  }

  async getHealthSyncStatus(): Promise<HealthSyncStatusSummary> {
    return {
      counts: {
        success: 2,
        failed: 1,
      },
      runs: [
        {
          id: "sync-1",
          syncDate: "2026-05-17",
          syncReason: "nightly_00_01",
          status: "success",
          dataCompletenessScore: 85,
          missingMetrics: {
            stress: true,
          },
          completedAt: "2026-05-18T00:01:00.000Z",
          error: null,
        },
      ],
      latestRun: {
        id: "sync-1",
        syncDate: "2026-05-17",
        syncReason: "nightly_00_01",
        status: "success",
        dataCompletenessScore: 85,
        missingMetrics: {
          stress: true,
        },
        completedAt: "2026-05-18T00:01:00.000Z",
        error: null,
      },
    };
  }

  async getOrCreateCurrentWorkout(): Promise<WorkoutRecord> {
    return this.workout;
  }

  async getCurrentWorkout(): Promise<CurrentWorkoutSummary> {
    return {
      id: this.workout.id,
      title: this.workout.title ?? "Workout",
      mode: "active",
      startedAt: this.workout.startedAt,
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
    };
  }

  async completeWorkoutSet(): Promise<CurrentWorkoutSummary> {
    return this.getCurrentWorkout();
  }

  async undoWorkoutSet(): Promise<CurrentWorkoutSummary> {
    return this.getCurrentWorkout();
  }

  async completeWorkout(): Promise<CurrentWorkoutSummary> {
    return {
      ...(await this.getCurrentWorkout()),
      mode: "completed",
      progressPercent: 100,
      completedSets: 1,
    };
  }

  async getTmaHomeSummary(): Promise<TmaHomeSummary> {
    return {
      displayName: "User",
      localDate: "May 18, 2026",
      recoveryMode: "baseline",
      focusScore: 80,
      activeWorkout: null,
      healthCompletenessScore: 50,
      pendingSyncCount: 2,
    };
  }

  async getTmaHealthSummary(): Promise<TmaHealthSummary> {
    return {
      date: "2026-05-17",
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
      missingMetrics: {
        stress: true,
      },
      samplesCount: 4,
    };
  }

  async getTmaFocusSummary(): Promise<TmaFocusSummary> {
    return {
      score: 80,
      band: "high",
      mode: "baseline",
      reasons: [],
      nextBestAction: "Deep work",
      openTaskCount: 2,
    };
  }

  async getFinanceSummary(): Promise<FinanceSummary> {
    return {
      capturedSpendCount: 2,
      capturedSpendTotal: 4200,
    };
  }

  async ingestHealthPayload(
    payload: HealthIngestPayload,
  ): Promise<HealthIngestResult> {
    return {
      healthDailyId: "health-daily-1",
      lifeEntityId: "life-entity-1",
      syncRunId: "sync-run-1",
      date: payload.date,
      recoveryMode: "growth",
      dataCompletenessScore: 90,
      workoutsUpserted: payload.workouts.length,
      samplesInserted: payload.samples.length,
    };
  }
}

function update(text: string): TelegramUpdate {
  return {
    update_id: 1,
    message: {
      message_id: 10,
      text,
      chat: {
        id: 20,
        type: "private",
      },
      from: {
        id: 30,
        first_name: "Test",
      },
    },
  };
}

function runtime(store = new FakeStore()): TelegramBotRuntime & {
  sent: SendMessageInput[];
  store: FakeStore;
} {
  const sent: SendMessageInput[] = [];

  return {
    sent,
    store,
    tmaUrl: "https://lifeos.example/tma",
    now: () => new Date("2026-05-18T12:00:00.000Z"),
    telegram: {
      async sendMessage(input) {
        sent.push(input);
      },
    },
  };
}

describe("Telegram commands", () => {
  it("returns /log usage when text is missing", async () => {
    const context = runtime();

    await handleTelegramUpdate(update("/log"), context);

    expect(context.sent.at(-1)?.text).toBe(
      "/log текст — быстро добавить запись в Obsidian Inbox",
    );
    expect(context.store.captures).toHaveLength(0);
    expect(context.store.entities).toHaveLength(0);
    expect(context.store.syncJobs).toHaveLength(0);
  });

  it("creates capture, entity, and Obsidian queue rows for /log", async () => {
    const context = runtime();
    const text = "Записать идею про утренний фокус и короткую прогулку";

    await handleTelegramUpdate(update(`/log ${text}`), context);

    expect(context.store.captures).toMatchObject([
      {
        userId: "user-1",
        text,
        source: "telegram",
        status: "inbox",
        chatId: 20,
        messageId: 10,
        metadata: {
          telegram_user_id: 30,
          chat_id: 20,
          message_id: 10,
          command: "/log",
        },
      },
    ]);
    expect(context.store.entities).toMatchObject([
      {
        entityType: "capture",
        domain: "personal",
        status: "inbox",
        source: "telegram",
        title: text.slice(0, 80),
        description: text,
        body: text,
        linkedTable: "life_captures",
        linkedId: "capture-1",
        rawPayloadJson: {
          telegram_user_id: 30,
          chat_id: 20,
          message_id: 10,
          command: "/log",
        },
      },
    ]);
    expect(context.store.syncJobs).toMatchObject([
      {
        userId: "user-1",
        lifeEntityId: "entity-1",
        entityType: "capture",
        action: "upsert",
        targetPath: "00_Dashboard/Inbox/2026-05-18-120000-log.md",
        payloadJson: {
          originalText: text,
          capture: {
            id: "capture-1",
            text,
          },
          entity: {
            id: "entity-1",
            entityType: "capture",
          },
        },
      },
    ]);
    expect(context.sent.at(-1)?.text).toBe("✅ Добавил в Inbox.");
  });

  it("keeps /log filesystem access out of Telegram command handlers", async () => {
    const source = await readFile(new URL("./commands.ts", import.meta.url), {
      encoding: "utf8",
    });

    expect(source).not.toContain("OBSIDIAN_VAULT_PATH");
    expect(source).not.toMatch(/from\s+["'](?:node:)?fs(?:\/promises)?["']/);
    expect(source).not.toMatch(/from\s+["'](?:node:)?path["']/);
  });

  it("creates a task, life entity, and Obsidian sync job", async () => {
    const context = runtime();

    await handleTelegramUpdate(update("/task Buy milk"), context);

    expect(context.store.tasks).toMatchObject([
      {
        title: "Buy milk",
        source: "telegram",
      },
    ]);
    expect(context.store.entities).toMatchObject([
      {
        entityType: "task",
        title: "Buy milk",
        linkedTable: "tasks",
        linkedId: "task-1",
      },
    ]);
    expect(context.store.syncEntityIds).toEqual(["entity-1"]);
    expect(context.sent.at(-1)?.text).toContain("Saved");
  });

  it("creates a deadline task with a due date", async () => {
    const context = runtime();

    await handleTelegramUpdate(
      update("/deadline tomorrow Submit report"),
      context,
    );

    expect(context.store.tasks.at(0)).toMatchObject({
      title: "Submit report",
      dueAt: "2026-05-19T23:59:00.000Z",
    });
    expect(context.store.entities.at(0)).toMatchObject({
      entityType: "deadline",
      dueAt: "2026-05-19T23:59:00.000Z",
    });
  });

  it("opens the workout TMA with only the workout id in the URL", async () => {
    const context = runtime();

    await handleTelegramUpdate(update("/workout Push day"), context);

    const button = context.sent.at(-1)?.replyMarkup?.inline_keyboard[0]?.[0];

    expect(button?.web_app?.url).toBe(
      "https://lifeos.example/tma?workoutId=workout-1",
    );
    expect(button?.web_app?.url).not.toContain("Push");
  });

  it("reports health sync status", async () => {
    const context = runtime();

    await handleTelegramUpdate(update("/healthsync_status"), context);

    expect(context.sent.at(-1)?.text).toContain("Health sync runs");
    expect(context.sent.at(-1)?.text).toContain("Success: <b>2</b>");
    expect(context.sent.at(-1)?.text).toContain("Failed: <b>1</b>");
    expect(context.sent.at(-1)?.text).toContain("score=85");
    expect(context.sent.at(-1)?.text).toContain("missing=stress");
  });

  it("does not create records for unlinked Telegram users", async () => {
    const store = new FakeStore();
    store.user = null;
    const context = runtime(store);

    await handleTelegramUpdate(update("/cap private note"), context);

    expect(context.store.entities).toHaveLength(0);
    expect(context.sent.at(-1)?.text).toContain("not linked");
  });
});
