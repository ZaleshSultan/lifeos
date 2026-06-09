import { readFile } from "node:fs/promises";
import { normalizeFinanceCategory } from "@lifeos/core";
import type {
  HealthIngestPayload,
  HealthMetricsIngestPayload,
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
  Json,
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
  readonly healthMetricPayloads: HealthMetricsIngestPayload[] = [];
  readonly financeTransactions: Array<
    Awaited<ReturnType<LifeOSStore["createFinanceTransaction"]>>
  > = [];
  readonly financeParseRuns: Array<
    Parameters<LifeOSStore["recordFinanceParseRun"]>[0]
  > = [];
  readonly monthlyReviews: Array<
    Awaited<ReturnType<LifeOSStore["generateMonthlyReview"]>>
  > = [];
  reminderMode: "chill" | "normal" | "duolingo" | "war" = "normal";
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
  healthSummary: TmaHealthSummary = {
    date: "2026-05-18",
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
      stress_score: true,
    },
    samplesCount: 4,
    hasMetrics: true,
    sourceLabel: "Xiaomi Watch / Health Connect",
    latestSource: "xiaomi_health_connect",
    averageHeartRate: null,
    totalEnergyKcal: null,
    workoutMinutes: 45,
    distanceM: null,
    weightKg: null,
    sleepScore: null,
    stressScore: null,
    moodScore: 7,
    energyScore: 6,
    weekly: {
      startDate: "2026-05-12",
      endDate: "2026-05-18",
      avgSteps: 7500,
      avgSleepMinutes: 420,
      avgRestingHeartRate: 61,
      totalWorkoutMinutes: 120,
      missingDays: ["2026-05-14"],
    },
    trends: [],
    sources: [
      {
        source: "manual",
        label: "Manual",
        latestMetricAt: null,
      },
      {
        source: "xiaomi_health_connect",
        label: "Xiaomi Watch / Health Connect",
        latestMetricAt: "2026-05-18T12:00:00.000Z",
      },
      {
        source: "import_json",
        label: "JSON import",
        latestMetricAt: null,
      },
    ],
  };

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
    return this.healthSummary;
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

  async snoozeReminder(
    _userId: string,
    reminderId: string,
    remindAt: string,
  ): Promise<ReminderRecord> {
    const reminder = this.reminders.find((item) => item.id === reminderId);
    if (!reminder) {
      throw new Error("not found");
    }
    reminder.remindAt = remindAt;
    return reminder;
  }

  async getReminderMode(): Promise<"chill" | "normal" | "duolingo" | "war"> {
    return this.reminderMode;
  }

  async setReminderMode(
    _userId: string,
    mode: "chill" | "normal" | "duolingo" | "war",
  ): Promise<"chill" | "normal" | "duolingo" | "war"> {
    this.reminderMode = mode;
    return mode;
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

  async getFinanceSummary(
    input: Parameters<LifeOSStore["getFinanceSummary"]>[0],
  ): Promise<FinanceSummary> {
    expect(input.userId).toBe("user-1");
    expect(typeof input.since).toBe("string");

    return {
      capturedSpendCount: 2,
      capturedSpendTotal: 4200,
    };
  }

  async createFinanceTransaction(
    input: Parameters<LifeOSStore["createFinanceTransaction"]>[0],
  ): Promise<Awaited<ReturnType<LifeOSStore["createFinanceTransaction"]>>> {
    const sequence = this.financeTransactions.length + 1;
    const id = `f000000${sequence}-0000-0000-0000-000000000000`;
    const transaction = {
      id,
      shortId: id.slice(0, 8),
      userId: input.userId,
      accountId: "account-1",
      categoryId: `category-${input.category ?? "Other"}`,
      categoryName:
        input.category ??
        (input.transactionType === "income" ? "Income" : "Other"),
      transactionType: input.transactionType,
      status: input.status ?? "confirmed",
      occurredOn: input.occurredOn,
      amount: input.amount,
      currency: input.currency ?? "KZT",
      baseAmount: input.amount,
      baseCurrency: "KZT",
      exchangeRate: 1,
      exchangeRateDate: input.occurredOn,
      merchant: input.merchant ?? null,
      description: input.description ?? null,
      tags: input.tags ?? [],
      receiptId: input.receiptId ?? null,
      rawText: input.rawText ?? null,
      confidence: input.confidence ?? null,
      source: input.source ?? "manual",
      createdAt: "2026-05-18T12:00:00.000Z",
      updatedAt: "2026-05-18T12:00:00.000Z",
    } satisfies Awaited<ReturnType<LifeOSStore["createFinanceTransaction"]>>;
    this.financeTransactions.push(transaction);
    return transaction;
  }

  async updateFinanceTransaction(
    input: Parameters<LifeOSStore["updateFinanceTransaction"]>[0],
  ): Promise<Awaited<ReturnType<LifeOSStore["updateFinanceTransaction"]>>> {
    const transaction = this.financeTransactions.find((item) =>
      item.id.startsWith(input.shortId),
    );

    if (!transaction) {
      throw new Error("Finance transaction not found");
    }

    if (input.amount !== undefined) transaction.amount = input.amount;
    if (input.category !== undefined) {
      transaction.categoryName =
        normalizeFinanceCategory(input.category) ?? input.category;
    }
    if (input.status !== undefined) transaction.status = input.status;
    if (input.merchant !== undefined) transaction.merchant = input.merchant;
    if (input.description !== undefined) {
      transaction.description = input.description;
    }
    if (input.tags !== undefined) transaction.tags = input.tags;
    return transaction;
  }

  async listFinanceCategories(): Promise<
    Awaited<ReturnType<LifeOSStore["listFinanceCategories"]>>
  > {
    return [
      { id: "food", name: "Food", transactionType: "expense" },
      { id: "transport", name: "Transport", transactionType: "expense" },
      { id: "income", name: "Income", transactionType: "income" },
      { id: "other", name: "Other", transactionType: "expense" },
    ];
  }

  async getTmaFinanceSummary(): Promise<
    Awaited<ReturnType<LifeOSStore["getTmaFinanceSummary"]>>
  > {
    const confirmedExpenses = this.financeTransactions.filter(
      (item) =>
        item.transactionType === "expense" && item.status === "confirmed",
    );
    const amount = confirmedExpenses.reduce(
      (total, item) => total + item.amount,
      0,
    );
    return {
      currency: "KZT",
      baseCurrency: "KZT",
      today: { amount, count: confirmedExpenses.length },
      week: { amount, count: confirmedExpenses.length },
      month: { amount, count: confirmedExpenses.length },
      monthlySummary: {
        income: this.financeTransactions
          .filter(
            (item) =>
              item.transactionType === "income" && item.status === "confirmed",
          )
          .reduce((total, item) => total + item.amount, 0),
        expense: amount,
        net:
          this.financeTransactions
            .filter((item) => item.status === "confirmed")
            .reduce(
              (total, item) =>
                total +
                (item.transactionType === "income"
                  ? item.amount
                  : -item.amount),
              0,
            ),
      },
      topCategories: [],
      budgets: [],
      recentTransactions: this.financeTransactions.filter(
        (item) => item.status === "confirmed",
      ),
      recentExpenses: confirmedExpenses,
      recentIncome: this.financeTransactions.filter(
        (item) =>
          item.transactionType === "income" && item.status === "confirmed",
      ),
      recentReceipts: [],
      anomalies: [],
      recommendations: [],
      drafts: this.financeTransactions.filter(
        (item) => item.status === "draft",
      ),
    };
  }

  async recordFinanceParseRun(
    input: Parameters<LifeOSStore["recordFinanceParseRun"]>[0],
  ): Promise<void> {
    this.financeParseRuns.push(input);
  }

  async createBudget(): Promise<
    Awaited<ReturnType<LifeOSStore["createBudget"]>>
  > {
    throw new Error("not used");
  }

  async updateBudget(): Promise<
    Awaited<ReturnType<LifeOSStore["updateBudget"]>>
  > {
    throw new Error("not used");
  }

  async deleteBudget(): Promise<void> {}

  async archiveBudget(): Promise<
    Awaited<ReturnType<LifeOSStore["archiveBudget"]>>
  > {
    throw new Error("not used");
  }

  async listBudgets(): Promise<
    Awaited<ReturnType<LifeOSStore["listBudgets"]>>
  > {
    return [];
  }

  async getBudgetSummary(): Promise<
    Awaited<ReturnType<LifeOSStore["getBudgetSummary"]>>
  > {
    return [];
  }

  async createRecurringRule(): Promise<
    Awaited<ReturnType<LifeOSStore["createRecurringRule"]>>
  > {
    throw new Error("not used");
  }

  async updateRecurringRule(): Promise<
    Awaited<ReturnType<LifeOSStore["updateRecurringRule"]>>
  > {
    throw new Error("not used");
  }

  async deleteRecurringRule(): Promise<void> {}

  async listRecurringRules(): Promise<
    Awaited<ReturnType<LifeOSStore["listRecurringRules"]>>
  > {
    return [];
  }

  async processDueRecurringRules(): Promise<
    Awaited<ReturnType<LifeOSStore["processDueRecurringRules"]>>
  > {
    return [];
  }

  async createTag(): Promise<Awaited<ReturnType<LifeOSStore["createTag"]>>> {
    throw new Error("not used");
  }

  async listTags(): Promise<Awaited<ReturnType<LifeOSStore["listTags"]>>> {
    return [];
  }

  async deleteTag(): Promise<void> {}

  async addTransactionTags(): Promise<void> {}

  async removeTransactionTags(): Promise<void> {}

  async createReimbursement(): Promise<
    Awaited<ReturnType<LifeOSStore["createReimbursement"]>>
  > {
    throw new Error("not used");
  }

  async listReimbursements(): Promise<
    Awaited<ReturnType<LifeOSStore["listReimbursements"]>>
  > {
    return [];
  }

  async createReceipt(): Promise<
    Awaited<ReturnType<LifeOSStore["createReceipt"]>>
  > {
    throw new Error("not used");
  }

  async uploadReceiptImage(): Promise<
    Awaited<ReturnType<LifeOSStore["uploadReceiptImage"]>>
  > {
    throw new Error("not used");
  }

  async processReceiptImage(): Promise<
    Awaited<ReturnType<LifeOSStore["processReceiptImage"]>>
  > {
    throw new Error("not used");
  }

  async processReceiptOcrText(): Promise<
    Awaited<ReturnType<LifeOSStore["processReceiptOcrText"]>>
  > {
    throw new Error("not used");
  }

  async listReceipts(): Promise<
    Awaited<ReturnType<LifeOSStore["listReceipts"]>>
  > {
    return [];
  }

  async getReceipt(
    _userId: string,
    _receiptId: string,
  ): Promise<Awaited<ReturnType<LifeOSStore["getReceipt"]>>> {
    return null;
  }

  async downloadReceiptImage(
    _userId: string,
    _receiptId: string,
  ): Promise<Awaited<ReturnType<LifeOSStore["downloadReceiptImage"]>>> {
    return { bytes: Buffer.from("dummy"), mimeType: "image/jpeg" };
  }

  async reviewFinanceReceipt(
    _input: Parameters<LifeOSStore["reviewFinanceReceipt"]>[0],
  ): Promise<Awaited<ReturnType<LifeOSStore["reviewFinanceReceipt"]>>> {
    throw new Error("not used");
  }

  async getTelegramUserId(
    _userId: string,
  ): Promise<Awaited<ReturnType<LifeOSStore["getTelegramUserId"]>>> {
    return 123456789;
  }

  async processFinanceAlerts(
    _userId: string,
    _today: string,
  ): Promise<Awaited<ReturnType<LifeOSStore["processFinanceAlerts"]>>> {
    return [];
  }

  async backfillFinanceBaseAmounts(
    _input?: Parameters<LifeOSStore["backfillFinanceBaseAmounts"]>[0],
  ): Promise<Awaited<ReturnType<LifeOSStore["backfillFinanceBaseAmounts"]>>> {
    return 0;
  }

  async getFinanceBaseCurrency(): Promise<string> {
    return "KZT";
  }

  async setFinanceBaseCurrency(_userId: string, currency: string): Promise<string> {
    return currency;
  }

  async syncFinanceExchangeRates(): Promise<number> {
    return 0;
  }

  async detectFinanceAnomaliesForUser(): Promise<
    Awaited<ReturnType<LifeOSStore["detectFinanceAnomaliesForUser"]>>
  > {
    return [];
  }

  async buildFinanceAssistantContext(): Promise<
    Awaited<ReturnType<LifeOSStore["buildFinanceAssistantContext"]>>
  > {
    throw new Error("not used");
  }

  async askFinanceAssistant(input: {
    question: string;
  }): Promise<Awaited<ReturnType<LifeOSStore["askFinanceAssistant"]>>> {
    return {
      answer: input.question,
      recommendations: [],
      risks: [],
      model: null,
      usedAi: false,
    };
  }

  async getFinanceReport(): Promise<
    Awaited<ReturnType<LifeOSStore["getFinanceReport"]>>
  > {
    throw new Error("not used");
  }

  async answerFinanceQuestion(): Promise<
    Awaited<ReturnType<LifeOSStore["answerFinanceQuestion"]>>
  > {
    throw new Error("not used");
  }

  async recordFinanceAiAnalysisRun(): Promise<
    Awaited<ReturnType<LifeOSStore["recordFinanceAiAnalysisRun"]>>
  > {
    throw new Error("not used");
  }

  async exportFinanceReport(): Promise<
    Awaited<ReturnType<LifeOSStore["exportFinanceReport"]>>
  > {
    throw new Error("not used");
  }

  async generateMonthlyReview(
    input: Parameters<LifeOSStore["generateMonthlyReview"]>[0],
  ): Promise<Awaited<ReturnType<LifeOSStore["generateMonthlyReview"]>>> {
    const existing = this.monthlyReviews.find(
      (review) => review.periodMonth === input.periodMonth,
    );

    if (existing && !input.regenerate) {
      return existing;
    }

    const review = {
      id: `monthly-review-${this.monthlyReviews.length + 1}`,
      userId: input.userId,
      periodMonth: input.periodMonth,
      status: "generated" as const,
      reportTitle: `LifeOS Monthly Review — ${input.periodMonth}`,
      reportMarkdown: [
        `# LifeOS Monthly Review — ${input.periodMonth}`,
        "",
        "## 1. Краткий вывод",
        "- Финансы: расходы 1200 KZT.",
        "- Здоровье: средние шаги 7000.",
        "- Reminders: sent 3.",
        "- Drafts: 0.",
        "- План понятен.",
      ].join("\n"),
      aiModel: null,
      aiInputJson: {},
      aiOutputJson: { fallback: true },
      statsJson: {
        finance: { netCashflow: -1200 },
        health: { avgSteps: 7000 },
      } as Json,
      obsidianPath: `Reviews/Monthly/${input.periodMonth}-LifeOS-Review.md`,
      generatedAt: "2026-06-07T12:00:00.000Z",
      errorMessage: null,
      createdAt: "2026-06-07T12:00:00.000Z",
      updatedAt: "2026-06-07T12:00:00.000Z",
    } satisfies Awaited<ReturnType<LifeOSStore["generateMonthlyReview"]>>;

    if (existing) {
      Object.assign(existing, review);
      return existing;
    }

    this.monthlyReviews.push(review);
    return review;
  }

  async getMonthlyReview(
    _userId: string,
    periodMonth: string,
  ): Promise<Awaited<ReturnType<LifeOSStore["getMonthlyReview"]>>> {
    return (
      this.monthlyReviews.find(
        (review) => review.periodMonth === periodMonth,
      ) ?? null
    );
  }

  async getLatestMonthlyReview(): Promise<
    Awaited<ReturnType<LifeOSStore["getLatestMonthlyReview"]>>
  > {
    return this.monthlyReviews.at(-1) ?? null;
  }

  async getTmaMonthlyReviewSummary(): Promise<
    Awaited<ReturnType<LifeOSStore["getTmaMonthlyReviewSummary"]>>
  > {
    return {
      latest: this.monthlyReviews.at(-1) ?? null,
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

  async upsertHealthMetrics(
    payload: HealthMetricsIngestPayload,
  ): Promise<Awaited<ReturnType<LifeOSStore["upsertHealthMetrics"]>>> {
    this.healthMetricPayloads.push(payload);
    return {
      date: payload.date,
      source: payload.source,
      created: payload.metrics.length,
      updated: 0,
      metrics: payload.metrics.map((metric, index) => ({
        id: `health-metric-${index + 1}`,
        userId: payload.userId,
        metricDate: payload.date,
        metricType: metric.type,
        value: metric.value,
        unit: metric.unit ?? null,
        source: payload.source,
        confidence: metric.confidence ?? null,
        rawJson: (metric.rawJson ?? {}) as Json,
        createdAt: "2026-05-18T12:00:00.000Z",
        updatedAt: "2026-05-18T12:00:00.000Z",
      })),
    };
  }

  async getHealthMetricDay(): Promise<
    Awaited<ReturnType<LifeOSStore["getHealthMetricDay"]>>
  > {
    return {
      date: this.healthSummary.date,
      metrics: {},
      sources: [],
      sourceLabel: this.healthSummary.sourceLabel,
      latestSource: this.healthSummary.latestSource,
      missingMetrics: this.healthSummary.missingMetrics,
      records: [],
    };
  }

  async getHealthMetricWeek(): Promise<
    Awaited<ReturnType<LifeOSStore["getHealthMetricWeek"]>>
  > {
    return {
      ...this.healthSummary.weekly,
      trends: this.healthSummary.trends,
    };
  }

  async getHealthMetricSources(): Promise<
    Awaited<ReturnType<LifeOSStore["getHealthMetricSources"]>>
  > {
    return this.healthSummary.sources;
  }

  async listUnmatchedBankLines(): Promise<
    Awaited<ReturnType<LifeOSStore["listUnmatchedBankLines"]>>
  > {
    return [];
  }

  async reconcileBankLine(): Promise<void> {}

  async getActiveBudgetsWithPeriods(): Promise<
    Awaited<ReturnType<LifeOSStore["getActiveBudgetsWithPeriods"]>>
  > {
    return [];
  }

  async createReceiptScanJob(): Promise<
    Awaited<ReturnType<LifeOSStore["createReceiptScanJob"]>>
  > {
    return {
      id: "receipt-scan-1",
      userId: "user-1",
      storagePath: "receipts/scan.jpg",
      status: "processing" as const,
      extractedAmount: null,
      extractedCurrency: null,
      extractedCategory: null,
      matchedEntityId: null,
      fileName: null,
      mimeType: null,
      createdAt: "2026-06-09T00:00:00.000Z",
    };
  }

  async updateBudgetLimit(): Promise<void> {}
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
      async getFileUrl() {
        return "https://api.telegram.org/file/bot/test";
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

  it("creates an expense with /spend", async () => {
    const context = runtime();

    await handleTelegramUpdate(update("/spend 1200 шаурма"), context);

    expect(context.store.financeTransactions).toMatchObject([
      {
        amount: 1200,
        currency: "KZT",
        transactionType: "expense",
        categoryName: "Food",
        status: "confirmed",
      },
    ]);
    expect(context.store.entities.at(-1)).toMatchObject({
      entityType: "finance",
      linkedTable: "finance_transactions",
    });
  });

  it("prefers the currency-adjacent amount in complex /spend text", async () => {
    const context = runtime();

    await handleTelegramUpdate(
      update("/spend обед на 2 человек за 4500 KZT"),
      context,
    );

    expect(context.store.financeTransactions.at(-1)).toMatchObject({
      amount: 4500,
      currency: "KZT",
      transactionType: "expense",
      categoryName: "Food",
      status: "confirmed",
    });
  });

  it("creates income with /income", async () => {
    const context = runtime();

    await handleTelegramUpdate(update("/income 20000 долг вернули"), context);

    expect(context.store.financeTransactions.at(-1)).toMatchObject({
      amount: 20000,
      currency: "KZT",
      transactionType: "income",
      categoryName: "Income",
      status: "confirmed",
    });
  });

  it("creates, fixes, confirms, and cancels finance drafts", async () => {
    const context = runtime();

    await handleTelegramUpdate(update("/finance_ai потратил 3500"), context);
    const first = context.store.financeTransactions.at(-1)!;
    expect(first.status).toBe("draft");
    expect(context.store.financeParseRuns.at(-1)?.parser).toBe("rules");

    await handleTelegramUpdate(
      update(`/finance_fix ${first.shortId} amount:1500 category:Еда`),
      context,
    );
    expect(first).toMatchObject({ amount: 1500, categoryName: "Food" });

    await handleTelegramUpdate(
      update(`/finance_confirm ${first.shortId}`),
      context,
    );
    expect(first.status).toBe("confirmed");

    await handleTelegramUpdate(update("/finance_ai потратил 900"), context);
    const second = context.store.financeTransactions.at(-1)!;
    await handleTelegramUpdate(
      update(`/finance_cancel ${second.shortId}`),
      context,
    );
    expect(second.status).toBe("cancelled");
  });

  it("answers finance questions through /finance_ask", async () => {
    const context = runtime();

    await handleTelegramUpdate(
      update("/finance_ask На что ушли деньги в этом месяце?"),
      context,
    );

    expect(context.sent.at(-1)?.text).toContain(
      "На что ушли деньги в этом месяце?",
    );
  });

  it("generates a monthly review from Telegram", async () => {
    const context = runtime();

    await handleTelegramUpdate(update("/monthly_review 2026-06"), context);

    expect(context.store.monthlyReviews.at(-1)).toMatchObject({
      periodMonth: "2026-06",
      status: "generated",
      obsidianPath: "Reviews/Monthly/2026-06-LifeOS-Review.md",
    });
    expect(context.sent.at(-1)?.text).toContain("Monthly review");
    expect(context.sent.at(-1)?.text).toContain("Финансы");
  });

  it("shows monthly review empty state", async () => {
    const context = runtime();

    await handleTelegramUpdate(update("/monthly_review_status"), context);

    expect(context.sent.at(-1)?.text).toBe("No monthly reviews generated yet.");
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

  it("opens mode settings from TMA_URL", async () => {
    const context = runtime();

    await handleTelegramUpdate(update("/mode"), context);

    const button = context.sent.at(-1)?.replyMarkup?.inline_keyboard[0]?.[0];

    expect(button?.web_app?.url).toBe("https://lifeos.example/tma?screen=mode");
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

  it("logs manual health metrics with /health_log", async () => {
    const context = runtime();

    await handleTelegramUpdate(
      update(
        "/health_log steps:8000 sleep:7h rhr:62 weight:70.5 mood:7 energy:6",
      ),
      context,
    );

    expect(context.store.healthMetricPayloads).toHaveLength(1);
    expect(context.store.healthMetricPayloads[0]).toMatchObject({
      userId: "user-1",
      date: "2026-05-18",
      source: "telegram",
      metrics: [
        { type: "steps", value: 8000, unit: "steps" },
        { type: "sleep_minutes", value: 420, unit: "min" },
        { type: "resting_heart_rate", value: 62, unit: "bpm" },
        { type: "weight_kg", value: 70.5, unit: "kg" },
        { type: "mood_score", value: 7, unit: "score" },
        { type: "energy_score", value: 6, unit: "score" },
      ],
    });
    expect(context.sent.at(-1)?.text).toContain("Health metrics logged");
  });

  it("shows an honest health empty state", async () => {
    const context = runtime();
    context.store.healthSummary = {
      ...context.store.healthSummary,
      hasMetrics: false,
      steps: null,
      sleepMinutes: null,
      restingHeartRate: null,
      activeEnergyKcal: null,
      workoutMinutes: null,
      stressScore: null,
      moodScore: null,
      energyScore: null,
      sourceLabel: null,
      latestSource: null,
      sources: [],
    };

    await handleTelegramUpdate(update("/health"), context);

    expect(context.sent.at(-1)?.text).toContain("No Xiaomi Watch data yet");
    expect(context.sent.at(-1)?.text).toContain("/health_log");
  });

  it("shows health week with missing days", async () => {
    const context = runtime();

    await handleTelegramUpdate(update("/health_week"), context);

    expect(context.sent.at(-1)?.text).toContain("Health week");
    expect(context.sent.at(-1)?.text).toContain("Missing days: <b>1</b>");
    expect(context.sent.at(-1)?.text).toContain("2026-05-14");
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

  it("parses relative reminder shortcuts", async () => {
    const context = runtime();

    await handleTelegramUpdate(
      update("/remind Review graph theory in:30m"),
      context,
    );
    await handleTelegramUpdate(update("/remind Stretch in:2h"), context);

    expect(
      context.store.reminders.map((reminder) => reminder.remindAt),
    ).toEqual(["2026-05-18T12:30:00.000Z", "2026-05-18T14:00:00.000Z"]);
  });

  it("parses explicit reminder times in Asia/Qyzylorda", async () => {
    const context = runtime();
    context.store.user = {
      userId: "user-1",
      displayName: "User",
      timezone: "Asia/Qyzylorda",
    };

    await handleTelegramUpdate(
      update("/remind Review graph theory at:2026-07-06 08:00"),
      context,
    );

    expect(context.store.reminders.at(-1)?.remindAt).toBe(
      "2026-07-06T03:00:00.000Z",
    );
  });

  it("parses tomorrow reminder times in Asia/Qyzylorda", async () => {
    const context = runtime();
    context.store.user = {
      userId: "user-1",
      displayName: "User",
      timezone: "Asia/Qyzylorda",
    };

    await handleTelegramUpdate(
      update("/remind Review graph theory tomorrow 19:00"),
      context,
    );

    expect(context.store.reminders.at(-1)?.remindAt).toBe(
      "2026-05-19T14:00:00.000Z",
    );
  });

  it("rejects reminder times in the past", async () => {
    const context = runtime();

    await handleTelegramUpdate(
      update("/remind Review graph theory at:2026-05-17 08:00"),
      context,
    );

    expect(context.store.reminders).toHaveLength(0);
    expect(context.sent.at(-1)?.text).toContain("must be in the future");
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

  it("sets reminder mode with /reminder_mode", async () => {
    const context = runtime();

    await handleTelegramUpdate(update("/reminder_mode duolingo"), context);
    expect(context.store.reminderMode).toBe("duolingo");
    expect(context.sent.at(-1)?.text).toContain("Reminder mode set");

    await handleTelegramUpdate(update("/reminder_mode"), context);
    expect(context.sent.at(-1)?.text).toContain("duolingo");
  });

  it("cancels and snoozes reminders by short id", async () => {
    const context = runtime();

    await handleTelegramUpdate(
      update("/remind Review graph theory in:30m"),
      context,
    );
    const shortId = context.store.reminders[0]!.id.slice(0, 8);

    await handleTelegramUpdate(
      update(`/reminder snooze ${shortId} 10m`),
      context,
    );
    expect(context.store.reminders[0]!.remindAt).toBe(
      "2026-05-18T12:10:00.000Z",
    );
    expect(context.sent.at(-1)?.text).toContain("Snoozed reminder");

    await handleTelegramUpdate(update(`/reminder cancel ${shortId}`), context);
    expect(context.sent.at(-1)?.text).toContain("Cancelled reminder");
  });

  it("shows Google and ICS sync source statuses", async () => {
    const context = runtime();
    context.store.sources.push(
      {
        id: "source-google-calendar",
        userId: "user-1",
        sourceKey: "google_calendar",
        sourceType: "google",
        displayName: "Google Calendar",
        status: "connected",
        configJson: {},
        lastSyncAt: "2026-05-18T12:00:00.000Z",
        createdAt: "2026-05-18T00:00:00.000Z",
        updatedAt: "2026-05-18T00:00:00.000Z",
      },
      {
        id: "source-moodle",
        userId: "user-1",
        sourceKey: "moodle_ics",
        sourceType: "ics",
        displayName: "Moodle ICS",
        status: "connected",
        configJson: {},
        lastSyncAt: "2026-05-18T12:05:00.000Z",
        createdAt: "2026-05-18T00:00:00.000Z",
        updatedAt: "2026-05-18T00:00:00.000Z",
      },
    );

    await handleTelegramUpdate(update("/google_sync"), context);
    expect(context.sent.at(-1)?.text).toContain("Google Calendar");

    await handleTelegramUpdate(update("/ics_sync"), context);
    expect(context.sent.at(-1)?.text).toContain("Moodle ICS");
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

  it("treats slash-prefixed file paths as implicit captures", async () => {
    const context = runtime();

    await handleTelegramUpdate(update("/usr/bin/local"), context);

    expect(context.store.entities.at(-1)).toMatchObject({
      entityType: "capture",
      title: "/usr/bin/local",
      body: "/usr/bin/local",
      sourceCommand: "/cap",
    });
    expect(context.sent.at(-1)?.text).toContain("Saved <b>capture</b>");
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
