import { readFile } from "node:fs/promises";
import type {
  HealthIngestPayload,
  LifeMode,
  LifeModeResolution,
} from "@lifeos/core";
import type {
  CreateLifeCaptureInput,
  CreateLifeEntityInput,
  CreateTaskInput,
  CurrentWorkoutSummary,
  DailyLogRecord,
  FinanceSummary,
  HealthIngestResult,
  HealthSyncStatusSummary,
  LifeEntityRecord,
  LifeOSStore,
  ObsidianSyncStatusSummary,
  ReminderRecord,
  SourceEventRecord,
  SourceRecord,
  StudyCourseRecord,
  SyncRunRecord,
  TaskRecord,
  TelegramUserRecord,
  TmaAcademicSummary,
  TmaFocusSummary,
  TmaHealthSummary,
  TmaHomeSummary,
  TmaSourcesSummary,
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
  readonly syncJobs: Array<Parameters<LifeOSStore["enqueueObsidianSync"]>[0]> =
    [];
  readonly reminders: ReminderRecord[] = [];
  readonly sources: SourceRecord[] = [
    {
      id: "source-manual",
      userId: "user-1",
      sourceKey: "manual",
      sourceType: "manual",
      displayName: "Manual",
      status: "connected",
      configJson: {},
      lastSyncAt: null,
      createdAt: "2026-05-18T00:00:00.000Z",
      updatedAt: "2026-05-18T00:00:00.000Z",
    },
  ];
  readonly sourceEvents: SourceEventRecord[] = [
    {
      id: "source-event-1",
      userId: "user-1",
      sourceKey: "manual",
      externalId: "academic:final:test",
      eventType: "academic_event",
      title: "Calculus 2 final",
      description: "Final exam.",
      location: null,
      startsAt: "2026-05-26T09:00:00.000Z",
      endsAt: null,
      dueAt: null,
      status: "active",
      rawJson: {},
      normalizedEntityId: null,
      createdAt: "2026-05-18T00:00:00.000Z",
      updatedAt: "2026-05-18T00:00:00.000Z",
    },
  ];
  readonly syncRuns: SyncRunRecord[] = [
    {
      id: "sync-run-1",
      userId: "user-1",
      sourceId: "source-manual",
      sourceKey: "manual",
      status: "success",
      startedAt: "2026-05-18T00:00:00.000Z",
      finishedAt: "2026-05-18T00:01:00.000Z",
      recordsSeen: 1,
      recordsCreated: 1,
      recordsUpdated: 0,
      errorMessage: null,
      metadataJson: {},
    },
  ];
  readonly clearedModes: string[] = [];
  readonly setModes: Array<{
    mode: LifeMode;
    activeUntil: string | null | undefined;
  }> = [];
  readonly courseProgressUpdates: Array<
    Parameters<LifeOSStore["updateStudyCourseProgress"]>[0]
  > = [];
  focusItems = [
    {
      id: "focus-study",
      sourceType: "task" as const,
      entityType: "task",
      title: "Study for exam deadline",
      dueAt: "2026-05-19T00:00:00.000Z",
      metadata: { priorityKey: "study" },
      modeScore: 110,
      modePriorityDelta: 100,
      modePriorityMatches: ["study"],
    },
  ];

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

  course: StudyCourseRecord | null = {
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
    createdAt: "2026-05-18T00:00:00.000Z",
    updatedAt: "2026-05-18T00:00:00.000Z",
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

  async getActiveManualMode() {
    return null;
  }

  async getActiveSeason() {
    return null;
  }

  async getActiveStudyCourse() {
    return this.course;
  }

  async updateStudyCourseProgress(
    input: Parameters<LifeOSStore["updateStudyCourseProgress"]>[0],
  ): Promise<StudyCourseRecord> {
    this.courseProgressUpdates.push(input);

    if (!this.course) {
      throw new Error("not used");
    }

    this.course = {
      ...this.course,
      progressPercent: input.progressPercent,
      completedUnits: input.completedUnits ?? this.course.completedUnits,
      totalUnits:
        input.totalUnits === undefined
          ? this.course.totalUnits
          : input.totalUnits,
      lastStudiedOn: input.lastStudiedOn ?? this.course.lastStudiedOn,
      status: input.status ?? this.course.status,
      metadata: input.metadata ?? this.course.metadata,
      updatedAt: "2026-05-18T12:00:00.000Z",
    };

    return this.course;
  }

  async resolveCurrentMode(): Promise<LifeModeResolution> {
    return {
      userId: "user-1",
      mode: "trimester",
      label: "Trimester Mode",
      source: "default",
      reason:
        "No manual override, recovery signal, season, or sprint is active.",
      activeUntil: null,
      priorityWeights: {
        study: 70,
        health: 40,
        finance: 30,
        projects: 30,
      },
      resolvedAt: "2026-05-18T12:00:00.000Z",
    };
  }

  async setManualMode(
    input: Parameters<LifeOSStore["setManualMode"]>[0],
  ): Promise<LifeModeResolution> {
    return this.setManualLifeMode(input);
  }

  async clearManualMode(userId: string): Promise<LifeModeResolution> {
    return this.clearManualLifeMode(userId);
  }

  async setManualLifeMode(
    input: Parameters<LifeOSStore["setManualLifeMode"]>[0],
  ): Promise<LifeModeResolution> {
    this.setModes.push({
      mode: input.mode,
      activeUntil: input.activeUntil,
    });

    return {
      ...(await this.resolveCurrentMode()),
      mode: input.mode,
      label: input.mode === "summer" ? "Summer Mode" : "Recovery Mode",
      source: "manual",
      reason: input.reason ?? "Manual override.",
      activeUntil: input.activeUntil ?? null,
    };
  }

  async clearManualLifeMode(userId: string): Promise<LifeModeResolution> {
    this.clearedModes.push(userId);
    return this.resolveCurrentMode();
  }

  async listModeAwareFocusItems(): Promise<
    Awaited<ReturnType<LifeOSStore["listModeAwareFocusItems"]>>
  > {
    return this.focusItems;
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
      mode: "trimester",
      modeLabel: "Trimester Mode",
      modeReason: "Trimester Mode is active from default.",
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
      lifeMode: "trimester",
      lifeModeLabel: "Trimester Mode",
      lifeModeReason: "Trimester Mode is active from default.",
      reasons: [],
      nextBestAction: "Deep work",
      openTaskCount: 2,
      topItems: [],
      priorityWeights: {},
    };
  }

  async getTmaSourcesSummary(): Promise<TmaSourcesSummary> {
    return {
      sources: this.sources,
      sourceEvents: this.sourceEvents,
      reminders: this.reminders,
      syncRuns: this.syncRuns,
    };
  }

  async getTmaAcademicSummary(): Promise<TmaAcademicSummary> {
    return {
      currentMode: await this.resolveCurrentMode(),
      nextAcademicEvent: this.sourceEvents[0] ?? null,
      finals: this.sourceEvents,
      examfx: [],
      activeCourse: this.course,
      summerCourse: this.course,
      nextTransition: null,
      academicRecords: [],
    };
  }

  async upsertExternalSource(
    userId: string,
    source: Parameters<LifeOSStore["upsertExternalSource"]>[1],
  ): Promise<SourceRecord> {
    return {
      id: `source-${source.sourceKey}`,
      userId,
      sourceKey: source.sourceKey,
      sourceType: source.sourceType,
      displayName: source.displayName,
      status: source.status ?? "disabled",
      configJson: source.configJson ?? {},
      lastSyncAt: source.lastSyncAt ?? null,
      createdAt: "2026-05-18T00:00:00.000Z",
      updatedAt: "2026-05-18T00:00:00.000Z",
    };
  }

  async listExternalSources(): Promise<SourceRecord[]> {
    return this.sources;
  }

  async createSyncRun(
    userId: string,
    sourceKey: string,
  ): Promise<SyncRunRecord> {
    return {
      id: "sync-run-created",
      userId,
      sourceId: null,
      sourceKey,
      status: "running",
      startedAt: "2026-05-18T00:00:00.000Z",
      finishedAt: null,
      recordsSeen: 0,
      recordsCreated: 0,
      recordsUpdated: 0,
      errorMessage: null,
      metadataJson: {},
    };
  }

  async finishSyncRun(
    syncRunId: string,
    status: Parameters<LifeOSStore["finishSyncRun"]>[1],
  ): Promise<SyncRunRecord> {
    return {
      ...this.syncRuns[0],
      id: syncRunId,
      status,
      finishedAt: "2026-05-18T00:01:00.000Z",
    };
  }

  async upsertSourceEvent(
    input: Parameters<LifeOSStore["upsertSourceEvent"]>[0],
  ): Promise<SourceEventRecord> {
    return {
      id: "source-event-created",
      userId: input.userId,
      sourceKey: input.sourceKey,
      externalId: input.externalId ?? null,
      eventType: input.eventType,
      title: input.title ?? null,
      description: input.description ?? null,
      location: input.location ?? null,
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
      dueAt: input.dueAt ?? null,
      status: input.status ?? "active",
      rawJson: input.rawJson ?? {},
      normalizedEntityId: input.normalizedEntityId ?? null,
      createdAt: "2026-05-18T00:00:00.000Z",
      updatedAt: "2026-05-18T00:00:00.000Z",
    };
  }

  async listSourceEvents(): Promise<SourceEventRecord[]> {
    return this.sourceEvents;
  }

  async normalizeSourceEvent(): Promise<LifeEntityRecord> {
    throw new Error("not used");
  }

  async createReminder(
    input: Parameters<LifeOSStore["createReminder"]>[0],
  ): Promise<ReminderRecord> {
    const reminder: ReminderRecord = {
      id: `reminder-${this.reminders.length + 1}`,
      userId: input.userId,
      lifeEntityId: input.lifeEntityId ?? null,
      sourceEventId: input.sourceEventId ?? null,
      channel: input.channel ?? "telegram",
      remindAt: input.remindAt,
      status: "pending",
      message: input.message,
      metadataJson: input.metadataJson ?? {},
      sentAt: null,
      createdAt: "2026-05-18T00:00:00.000Z",
      updatedAt: "2026-05-18T00:00:00.000Z",
    };
    this.reminders.push(reminder);
    return reminder;
  }

  async listPendingReminders(): Promise<ReminderRecord[]> {
    return this.reminders;
  }

  async listUpcomingReminders(): Promise<ReminderRecord[]> {
    return this.reminders;
  }

  async markReminderSent(reminderId: string): Promise<ReminderRecord> {
    const reminder = this.reminders.find((item) => item.id === reminderId);

    if (!reminder) {
      throw new Error("not found");
    }

    return {
      ...reminder,
      status: "sent",
      sentAt: "2026-05-18T00:00:00.000Z",
    };
  }

  async cancelReminder(
    _userId: string,
    reminderId: string,
  ): Promise<ReminderRecord> {
    const reminder = this.reminders.find((item) => item.id === reminderId);

    if (!reminder) {
      throw new Error("not found");
    }

    return {
      ...reminder,
      status: "cancelled",
    };
  }

  async listAcademicRecords(): Promise<[]> {
    return [];
  }

  async upsertAcademicRecord(
    input: Parameters<LifeOSStore["upsertAcademicRecord"]>[0],
  ): Promise<Awaited<ReturnType<LifeOSStore["upsertAcademicRecord"]>>> {
    return {
      id: "academic-record-1",
      userId: input.userId,
      sourceEventId: input.sourceEventId ?? null,
      courseTitle: input.courseTitle,
      recordType: input.recordType,
      title: input.title,
      valueText: input.valueText ?? null,
      score: input.score ?? null,
      maxScore: input.maxScore ?? null,
      percentage: input.percentage ?? null,
      occursAt: input.occursAt ?? null,
      dueAt: input.dueAt ?? null,
      rawJson: input.rawJson ?? {},
      createdAt: "2026-05-18T00:00:00.000Z",
      updatedAt: "2026-05-18T00:00:00.000Z",
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

  it("aliases /hepl to /help", async () => {
    const context = runtime();

    await handleTelegramUpdate(update("/hepl"), context);

    expect(context.sent.at(-1)?.text).toContain("LifeOS bot commands");
    expect(context.sent.at(-1)?.text).toContain("/remind");
  });

  it("replies to /help", async () => {
    const context = runtime();

    await handleTelegramUpdate(update("/help"), context);

    expect(context.sent.at(-1)?.text).toContain("LifeOS bot commands");
    expect(context.sent.at(-1)?.text).toContain("/sources");
  });

  it("reports bot health from /healthz without requiring user data", async () => {
    const context = runtime();
    context.store.user = null;

    await handleTelegramUpdate(update("/healthz"), context);

    expect(context.sent.at(-1)?.text).toContain("healthz is an HTTP endpoint");
    expect(context.sent.at(-1)?.text).toContain("/status");
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

  it("creates a reminder and queues notification metadata", async () => {
    const context = runtime();

    await handleTelegramUpdate(
      update("/remind Review graph theory at:2026-07-06 08:00"),
      context,
    );

    expect(context.store.reminders).toMatchObject([
      {
        userId: "user-1",
        message: "Review graph theory",
        remindAt: "2026-07-06T08:00:00.000Z",
        channel: "telegram",
        status: "pending",
        metadataJson: {
          source: "telegram",
          command: "/remind",
          telegram_user_id: 30,
          chat_id: 20,
          message_id: 10,
        },
      },
    ]);
    expect(context.sent.at(-1)?.text).toContain("Reminder scheduled.");
  });

  it("rejects invalid reminder syntax with examples", async () => {
    const context = runtime();

    await handleTelegramUpdate(update("/remind someday maybe"), context);

    expect(context.sent.at(-1)?.text).toContain("Usage:");
    expect(context.sent.at(-1)?.text).toContain("in:30m");
  });

  it("shows sources and upcoming reminders", async () => {
    const context = runtime();
    await handleTelegramUpdate(
      update("/remind Review graph theory in:30m"),
      context,
    );

    await handleTelegramUpdate(update("/sources"), context);
    expect(context.sent.at(-1)?.text).toContain("Obsidian Config");
    expect(context.sent.at(-1)?.text).toContain("Manual");
    expect(context.sent.at(-1)?.text).toContain("connected");

    await handleTelegramUpdate(update("/reminders"), context);
    expect(context.sent.at(-1)?.text).toContain("Upcoming reminders");
    expect(context.sent.at(-1)?.text).toContain("Review graph theory");
  });

  it("shows sync help and health sync status", async () => {
    const context = runtime();

    await handleTelegramUpdate(update("/sync"), context);
    expect(context.sent.at(-1)?.text).toContain("/sync health");

    await handleTelegramUpdate(update("/sync obsidian"), context);
    expect(context.sent.at(-1)?.text).toBe(
      "Obsidian config sync is planned for local Arch worker.",
    );

    await handleTelegramUpdate(update("/sync health"), context);
    expect(context.sent.at(-1)?.text).toContain("Health sync:");
    expect(context.sent.at(-1)?.text).toContain("Latest health bridge run");
  });

  it("sets manual mode from /mode set", async () => {
    const context = runtime();

    await handleTelegramUpdate(update("/mode set summer"), context);

    expect(context.store.setModes).toEqual([
      {
        mode: "summer",
        activeUntil: null,
      },
    ]);
    expect(context.sent.at(-1)?.text).toContain("Summer Mode");
    expect(context.sent.at(-1)?.text).toContain("Source: <b>manual</b>");
  });

  it("sets manual mode for today", async () => {
    const context = runtime();

    await handleTelegramUpdate(update("/mode set practice today"), context);

    expect(context.store.setModes).toEqual([
      {
        mode: "practice",
        activeUntil: "2026-05-19T00:00:00.000Z",
      },
    ]);
  });

  it("sets manual mode until a date", async () => {
    const context = runtime();

    await handleTelegramUpdate(
      update("/mode set summer_term until:2026-08-15"),
      context,
    );

    expect(context.store.setModes).toEqual([
      {
        mode: "summer_term",
        activeUntil: "2026-08-15T00:00:00.000Z",
      },
    ]);
  });

  it("clears manual mode from /mode auto", async () => {
    const context = runtime();

    await handleTelegramUpdate(update("/mode auto"), context);

    expect(context.store.clearedModes).toEqual(["user-1"]);
    expect(context.sent.at(-1)?.text).toContain(
      "Manual mode override cleared.",
    );
  });

  it("clears manual mode from /mode clear", async () => {
    const context = runtime();

    await handleTelegramUpdate(update("/mode clear"), context);

    expect(context.store.clearedModes).toEqual(["user-1"]);
    expect(context.sent.at(-1)?.text).toContain(
      "Manual mode override cleared.",
    );
  });

  it("shows the active study course", async () => {
    const context = runtime();

    await handleTelegramUpdate(update("/course"), context);

    expect(context.sent.at(-1)?.text).toContain("Discrete Mathematics");
    expect(context.sent.at(-1)?.text).toContain("DISCRETE-MATH-SUMMER-2026");
    expect(context.sent.at(-1)?.text).toContain("Progress: <b>0%</b>");
  });

  it("updates active study course progress", async () => {
    const context = runtime();

    await handleTelegramUpdate(update("/course progress 42"), context);

    expect(context.store.courseProgressUpdates).toMatchObject([
      {
        userId: "user-1",
        courseId: "course-1",
        progressPercent: 42,
        lastStudiedOn: "2026-05-18",
      },
    ]);
    expect(context.sent.at(-1)?.text).toContain("Course progress updated.");
    expect(context.sent.at(-1)?.text).toContain("Progress: <b>42%</b>");
  });

  it("records an active study course topic", async () => {
    const context = runtime();

    await handleTelegramUpdate(update("/course topic Graph coloring"), context);

    expect(context.store.entities).toMatchObject([
      {
        entityType: "review",
        domain: "study",
        status: "inbox",
        title: "Discrete Mathematics: Graph coloring",
        body: "Graph coloring",
        sourceCommand: "/course topic",
        linkedTable: "study_courses",
        linkedId: "course-1",
        metadata: {
          courseId: "course-1",
          courseCode: "DISCRETE-MATH-SUMMER-2026",
          priorityKey: "coursework",
          topic: "Graph coloring",
        },
      },
    ]);
    expect(context.store.syncEntityIds).toEqual(["entity-1"]);
    expect(context.sent.at(-1)?.text).toContain("Course topic saved.");
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
