import type { AddressInfo } from "node:net";
import { createHmac } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  HealthIngestPayload,
  HealthMetricsIngestPayload,
  LifeMode,
  LifeModeResolution,
} from "@lifeos/core";
import type {
  CreateLifeCaptureInput,
  CreateLifeEntityInput,
  CurrentWorkoutSummary,
  HealthIngestResult,
  Json,
  LifeEntityRecord,
  LifeOSStore,
  ReminderRecord,
  SourceEventRecord,
  SourceRecord,
  StudyCourseRecord,
  SyncRunRecord,
  TelegramProfileRecord,
  TelegramUserRecord,
  TmaAcademicSummary,
  TmaHealthSummary,
  TmaSourcesSummary,
} from "@lifeos/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadBotConfig } from "./config.js";
import { createBotServer, type BotServerOptions } from "./server.js";
import type { SendMessageInput, TelegramClient } from "./telegram/types.js";

const servers: ReturnType<typeof createBotServer>[] = [];
const tempDirectories: string[] = [];

function activeTelegramUser(
  overrides: Partial<TelegramUserRecord> = {},
): TelegramUserRecord {
  return {
    userId: "user-1",
    telegramUserId: 30,
    displayName: "Test",
    username: "test",
    timezone: "UTC",
    status: "active",
    role: "user",
    ...overrides,
  };
}

export async function listen(
  server: ReturnType<typeof createBotServer>,
): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

async function createTmaStaticDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "lifeos-tma-"));
  tempDirectories.push(directory);
  await mkdir(join(directory, "assets"));
  await writeFile(
    join(directory, "index.html"),
    '<!doctype html><script type="module" src="/tma/assets/app.js"></script>',
  );
  await writeFile(join(directory, "assets", "app.js"), "window.lifeos = true;");
  return directory;
}

async function rawGet(
  port: number,
  path: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "GET",
      },
      (response) => {
        const chunks: Buffer[] = [];

        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );

    request.on("error", reject);
    request.end();
  });
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

function healthMetricsStore(
  seen: HealthMetricsIngestPayload[],
): Pick<LifeOSStore, "upsertHealthMetrics"> {
  const existing = new Set<string>();

  return {
    async upsertHealthMetrics(payload) {
      seen.push(payload);
      let created = 0;
      let updated = 0;

      for (const metric of payload.metrics) {
        const key = `${payload.userId}:${payload.date}:${metric.type}:${payload.source}`;

        if (existing.has(key)) {
          updated += 1;
        } else {
          existing.add(key);
          created += 1;
        }
      }

      return {
        date: payload.date,
        source: payload.source,
        created,
        updated,
        metrics: payload.metrics.map((metric, index) => ({
          id: `metric-${index + 1}`,
          userId: payload.userId,
          metricDate: payload.date,
          metricType: metric.type,
          value: metric.value,
          unit: metric.unit ?? null,
          source: payload.source,
          confidence: metric.confidence ?? null,
          rawJson: (metric.rawJson ?? {}) as Json,
          createdAt: "2026-06-07T00:00:00.000Z",
          updatedAt: "2026-06-07T00:00:00.000Z",
        })),
      };
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

export function tmaStore(events: string[] = []): LifeOSStore {
  let mode: LifeMode = "trimester";
  let reminderMode: "chill" | "normal" | "duolingo" | "war" = "normal";
  let reminders: ReminderRecord[] = [];
  let monthlyReview: Awaited<
    ReturnType<LifeOSStore["generateMonthlyReview"]>
  > | null = null;
  const sources: SourceRecord[] = [
    {
      id: "source-manual",
      userId: "user-1",
      sourceKey: "manual",
      sourceType: "manual",
      displayName: "Manual",
      status: "connected",
      configJson: {},
      lastSyncAt: null,
      createdAt: "2026-05-18T10:00:00.000Z",
      updatedAt: "2026-05-18T10:00:00.000Z",
    },
  ];
  const sourceEvents: SourceEventRecord[] = [
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
      createdAt: "2026-05-18T10:00:00.000Z",
      updatedAt: "2026-05-18T10:00:00.000Z",
    },
  ];
  const syncRuns: SyncRunRecord[] = [
    {
      id: "sync-run-1",
      userId: "user-1",
      sourceId: "source-manual",
      sourceKey: "manual",
      status: "success",
      startedAt: "2026-05-18T10:00:00.000Z",
      finishedAt: "2026-05-18T10:01:00.000Z",
      recordsSeen: 1,
      recordsCreated: 1,
      recordsUpdated: 0,
      errorMessage: null,
      metadataJson: {},
    },
  ];
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
    instructorName: null,
    instructorEmail: null,
    room: null,
    externalCourseKey: null,
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
      return activeTelegramUser({ displayName: "User" });
    },
    async createPendingTelegramUser() {
      return activeTelegramUser({
        userId: "pending-user",
        telegramUserId: 456,
        status: "pending",
      });
    },
    async listPendingUsers(): Promise<TelegramProfileRecord[]> {
      return [];
    },
    async listTelegramUsers(): Promise<TelegramProfileRecord[]> {
      return [];
    },
    async approveTelegramUser() {
      return activeTelegramUser();
    },
    async blockTelegramUser() {
      return activeTelegramUser({ status: "blocked" });
    },
    async isAdminTelegramUser() {
      return false;
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
    async createLifeEntityWithSync() {
      throw new Error("not used");
    },
    async recordFitnessLogs() {
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
    async getUserObsidianSettings() {
      return null;
    },
    async upsertUserObsidianSettings() {
      throw new Error("not used");
    },
    async isObsidianEnabledForUser() {
      return false;
    },
    async getUserOAuthConnection() {
      return null;
    },
    async getSafeUserOAuthConnection() {
      return null;
    },
    async upsertUserOAuthConnection() {
      throw new Error("not used");
    },
    async deleteUserOAuthConnection() {},
    async storeGoogleOAuthStateNonce() {},
    async consumeGoogleOAuthStateNonce() {
      return true;
    },
    async listConnectedOAuthUsers() {
      return [];
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
        obsidianStatus: {
          enabled: true,
          status: "connected",
          mode: "local_vault",
          configured: true,
          updatedAt: "2026-05-18T10:00:00.000Z",
          pendingSyncCount: 0,
        },
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
        moodScore: null,
        energyScore: null,
        weekly: {
          startDate: "2026-05-11",
          endDate: "2026-05-17",
          avgSteps: 9000,
          avgSleepMinutes: 480,
          avgRestingHeartRate: 58,
          totalWorkoutMinutes: 45,
          missingDays: [],
        },
        trends: [],
        sources: [],
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
    async getTmaSourcesSummary() {
      events.push("getTmaSourcesSummary");
      return {
        sources,
        sourceEvents,
        reminders,
        syncRuns: [],
      } satisfies TmaSourcesSummary;
    },
    async getTmaAcademicSummary() {
      return {
        currentMode: modeResolution(),
        nextAcademicEvent: sourceEvents[0] ?? null,
        finals: sourceEvents,
        examfx: [],
        activeCourse: course,
        summerCourse: course,
        nextTransition: null,
        academicRecords: [],
      } satisfies TmaAcademicSummary;
    },
    async upsertExternalSource(userId, source) {
      return {
        id: `source-${source.sourceKey}`,
        userId,
        sourceKey: source.sourceKey,
        sourceType: source.sourceType,
        displayName: source.displayName,
        status: source.status ?? "disabled",
        configJson: source.configJson ?? {},
        lastSyncAt: source.lastSyncAt ?? null,
        createdAt: "2026-05-18T10:00:00.000Z",
        updatedAt: "2026-05-18T10:00:00.000Z",
      };
    },
    async listExternalSources() {
      return sources;
    },
    async createSyncRun(userId, sourceKey) {
      return {
        id: "sync-run-created",
        userId,
        sourceId: null,
        sourceKey,
        status: "running",
        startedAt: "2026-05-18T10:00:00.000Z",
        finishedAt: null,
        recordsSeen: 0,
        recordsCreated: 0,
        recordsUpdated: 0,
        errorMessage: null,
        metadataJson: {},
      };
    },
    async finishSyncRun(syncRunId, status) {
      return {
        ...syncRuns[0],
        id: syncRunId,
        status,
        finishedAt: "2026-05-18T10:01:00.000Z",
      };
    },
    async upsertSourceEvent(input) {
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
        createdAt: "2026-05-18T10:00:00.000Z",
        updatedAt: "2026-05-18T10:00:00.000Z",
      };
    },
    async listSourceEvents() {
      return sourceEvents;
    },
    async normalizeSourceEvent() {
      throw new Error("not used");
    },
    async createReminder(input) {
      events.push("createReminder");
      const reminder = {
        id: `reminder-${reminders.length + 1}`,
        userId: input.userId,
        lifeEntityId: input.lifeEntityId ?? null,
        sourceEventId: input.sourceEventId ?? null,
        channel: input.channel ?? "telegram",
        remindAt: input.remindAt,
        status: "pending",
        message: input.message,
        metadataJson: input.metadataJson ?? {},
        sentAt: null,
        createdAt: "2026-05-18T10:00:00.000Z",
        updatedAt: "2026-05-18T10:00:00.000Z",
      } satisfies ReminderRecord;
      reminders = [...reminders, reminder];
      return reminder;
    },
    async listPendingReminders() {
      return reminders;
    },
    async listUpcomingReminders() {
      events.push("listUpcomingReminders");
      return reminders;
    },
    async markReminderSent(reminderId) {
      const reminder = reminders.find((item) => item.id === reminderId);

      if (!reminder) {
        throw new Error("not found");
      }

      return {
        ...reminder,
        status: "sent",
        sentAt: "2026-05-18T10:01:00.000Z",
      };
    },
    async cancelReminder(_userId, reminderId) {
      events.push("cancelReminder");
      const reminder = reminders.find((item) => item.id === reminderId);

      if (!reminder) {
        throw new Error("not found");
      }

      return {
        ...reminder,
        status: "cancelled",
      };
    },
    async snoozeReminder(_userId, reminderId, remindAt) {
      const reminder = reminders.find((item) => item.id === reminderId);
      if (!reminder) {
        throw new Error("not found");
      }
      reminder.remindAt = remindAt;
      return reminder;
    },
    async getReminderMode() {
      return reminderMode;
    },
    async setReminderMode(_userId, nextMode) {
      reminderMode = nextMode;
      return reminderMode;
    },
    async listAcademicRecords() {
      return [];
    },
    async upsertAcademicRecord(input) {
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
        createdAt: "2026-05-18T10:00:00.000Z",
        updatedAt: "2026-05-18T10:00:00.000Z",
      };
    },
    async findStudyCourseByExternalKey(userId, externalKey) {
      if (
        course.userId === userId &&
        course.externalCourseKey?.toLowerCase() ===
          externalKey.trim().toLowerCase()
      ) {
        return course;
      }
      return null;
    },
    async createCourseSchedule(input) {
      return {
        id: "schedule-1",
        studyCourseId: input.studyCourseId,
        dayOfWeek: input.dayOfWeek,
        startTime: input.startTime,
        endTime: input.endTime,
        room: input.room ?? null,
        sessionType: input.sessionType ?? null,
        createdAt: "2026-05-18T10:00:00.000Z",
      };
    },
    async listCourseSchedules() {
      return [];
    },
    async deleteCourseSchedule() {},
    async createAssessmentItem(input) {
      return {
        id: "assessment-1",
        studyCourseId: input.studyCourseId,
        title: input.title,
        assessmentType: input.assessmentType ?? null,
        weightPercent: input.weightPercent ?? null,
        maxScore: input.maxScore ?? null,
        actualScore: input.actualScore ?? null,
        dueAt: input.dueAt ?? null,
        dueSource: input.dueSource ?? null,
        syllabusDueAt: input.syllabusDueAt ?? null,
        status: input.status ?? "pending",
        notes: input.notes ?? null,
        createdAt: "2026-05-18T10:00:00.000Z",
        updatedAt: "2026-05-18T10:00:00.000Z",
      };
    },
    async updateAssessmentItem(id, input) {
      return {
        id,
        studyCourseId: "course-1",
        title: input.title ?? "Assignment",
        assessmentType: input.assessmentType ?? null,
        weightPercent: input.weightPercent ?? null,
        maxScore: input.maxScore ?? null,
        actualScore: input.actualScore ?? null,
        dueAt: input.dueAt ?? null,
        dueSource: input.dueSource ?? null,
        syllabusDueAt: input.syllabusDueAt ?? null,
        status: input.status ?? "pending",
        notes: input.notes ?? null,
        createdAt: "2026-05-18T10:00:00.000Z",
        updatedAt: "2026-05-18T10:00:00.000Z",
      };
    },
    async listAssessmentItems() {
      return [];
    },
    async getFinanceSummary() {
      return {
        capturedSpendCount: 0,
        capturedSpendTotal: null,
      };
    },
    async createFinanceTransaction() {
      throw new Error("not used");
    },
    async updateFinanceTransaction() {
      throw new Error("not used");
    },
    async listFinanceCategories() {
      return [];
    },
    async getTmaFinanceSummary() {
      return {
        currency: "KZT",
        baseCurrency: "KZT",
        today: { amount: 1200, count: 1 },
        week: { amount: 1200, count: 1 },
        month: { amount: 1200, count: 1 },
        monthlySummary: { income: 0, expense: 1200, net: -1200 },
        topCategories: [{ category: "Еда", amount: 1200, count: 1 }],
        recentExpenses: [],
        recentIncome: [],
        recentReceipts: [],
        anomalies: [],
        recommendations: [],
        recentTransactions: [
          {
            id: "f0000001-0000-0000-0000-000000000000",
            shortId: "f0000001",
            userId: "user-1",
            accountId: "account-1",
            categoryId: "food",
            categoryName: "Еда",
            transactionType: "expense",
            status: "confirmed",
            occurredOn: "2026-05-18",
            amount: 1200,
            currency: "KZT",
            baseAmount: 1200,
            baseCurrency: "KZT",
            exchangeRate: 1,
            exchangeRateDate: "2026-05-18",
            merchant: null,
            description: "шаурма",
            tags: [],
            receiptId: null,
            rawText: "1200 шаурма",
            confidence: 1,
            source: "telegram",
            createdAt: "2026-05-18T10:00:00.000Z",
            updatedAt: "2026-05-18T10:00:00.000Z",
          },
        ],
        budgets: [],
        drafts: [],
      };
    },
    async recordFinanceParseRun() {},
    async createBudget() {
      throw new Error("not used");
    },
    async updateBudget() {
      throw new Error("not used");
    },
    async deleteBudget() {},
    async archiveBudget() {
      throw new Error("not used");
    },
    async listBudgets() {
      return [];
    },
    async getBudgetSummary() {
      return [];
    },
    async createRecurringRule() {
      throw new Error("not used");
    },
    async updateRecurringRule() {
      throw new Error("not used");
    },
    async deleteRecurringRule() {},
    async listRecurringRules() {
      return [];
    },
    async processDueRecurringRules() {
      return [];
    },
    async createTag() {
      throw new Error("not used");
    },
    async listTags() {
      return [];
    },
    async deleteTag() {},
    async addTransactionTags() {},
    async removeTransactionTags() {},
    async createReimbursement() {
      throw new Error("not used");
    },
    async listReimbursements() {
      return [];
    },
    async createReceipt() {
      throw new Error("not used");
    },
    async uploadReceiptImage() {
      throw new Error("not used");
    },
    async processReceiptImage() {
      throw new Error("not used");
    },
    async processReceiptOcrText() {
      throw new Error("not used");
    },
    async listReceipts() {
      return [];
    },
    async getReceipt(userId, receiptId) {
      if (receiptId === "needs-review-id") {
        return {
          id: "needs-review-id",
          userId,
          storagePath: "receipts/test.jpg",
          fileName: "test.jpg",
          mimeType: "image/jpeg",
          ocrJson: {},
          parsedJson: {
            amount: 1500,
            currency: "USD",
            merchant: "Walmart",
            date: "2026-06-08",
            category: "Other",
          },
          ocrText: "Walmart\nTotal: $15.00",
          openRouterModel: null,
          status: "needs_review",
          transactionId: null,
          errorMessage: "Low OCR confidence",
          items: [],
          createdAt: "2026-06-08T00:00:00.000Z",
          processedAt: "2026-06-08T00:00:00.000Z",
        };
      }
      return null;
    },
    async downloadReceiptImage() {
      return { bytes: Buffer.from("dummy"), mimeType: "image/jpeg" };
    },
    async reviewFinanceReceipt(input) {
      return {
        id: input.receiptId,
        userId: input.userId,
        storagePath: "receipts/test.jpg",
        fileName: "test.jpg",
        mimeType: "image/jpeg",
        ocrJson: {},
        parsedJson: {
          amount: input.amount,
          currency: input.currency,
          merchant: input.merchant,
          date: input.date,
          category: input.category,
        },
        ocrText: "Walmart\nTotal: $15.00",
        openRouterModel: null,
        status: "linked",
        transactionId: "tx-linked-1",
        errorMessage: null,
        items: [],
        createdAt: "2026-06-08T00:00:00.000Z",
        processedAt: new Date().toISOString(),
      };
    },
    async getTelegramUserId() {
      return 123456789;
    },
    async processFinanceAlerts() {
      return [];
    },
    async backfillFinanceBaseAmounts() {
      return 0;
    },
    async getFinanceBaseCurrency() {
      return "KZT";
    },
    async setFinanceBaseCurrency(_userId: string, currency: string) {
      return currency;
    },
    async syncFinanceExchangeRates() {
      return 0;
    },
    async detectFinanceAnomaliesForUser() {
      return [];
    },
    async buildFinanceAssistantContext() {
      return {
        report: {
          period: "monthly" as const,
          startDate: "2026-06-01",
          endDate: "2026-06-30",
          currency: "KZT",
          totalIncome: 0,
          totalExpense: 1200,
          netFlow: -1200,
          categoryBreakdown: [],
          dailyTrend: [],
          topMerchants: [],
          periodComparison: null,
          overspentBudgets: [],
          recommendations: [],
        },
        budgets: [],
        recentTransactions: [],
        anomalies: [],
      };
    },
    async askFinanceAssistant(input: { question: string }) {
      return {
        answer: input.question,
        recommendations: [],
        risks: [],
        model: null,
        usedAi: false,
      };
    },
    async getFinanceReport() {
      throw new Error("not used");
    },
    async answerFinanceQuestion() {
      throw new Error("not used");
    },
    async recordFinanceAiAnalysisRun() {
      throw new Error("not used");
    },
    async exportFinanceReport() {
      throw new Error("not used");
    },
    async generateMonthlyReview(input) {
      monthlyReview = {
        id: "monthly-review-1",
        userId: input.userId,
        periodMonth: input.periodMonth,
        status: "generated",
        reportTitle: `LifeOS Monthly Review — ${input.periodMonth}`,
        reportMarkdown: `# LifeOS Monthly Review — ${input.periodMonth}\n\n- Finance ok`,
        aiModel: null,
        aiInputJson: {},
        aiOutputJson: { fallback: true },
        statsJson: {
          finance: { netCashflow: -1200 },
          health: { avgSteps: 7000 },
        },
        obsidianPath: `Reviews/Monthly/${input.periodMonth}-LifeOS-Review.md`,
        generatedAt: "2026-06-07T10:00:00.000Z",
        errorMessage: null,
        createdAt: "2026-06-07T10:00:00.000Z",
        updatedAt: "2026-06-07T10:00:00.000Z",
      };
      return monthlyReview;
    },
    async getMonthlyReview() {
      return monthlyReview;
    },
    async getLatestMonthlyReview() {
      return monthlyReview;
    },
    async getTmaMonthlyReviewSummary() {
      return {
        latest: monthlyReview,
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
    async upsertHealthMetrics(payload) {
      return {
        date: payload.date,
        source: payload.source,
        created: payload.metrics.length,
        updated: 0,
        metrics: [],
      };
    },
    async getHealthMetricDay() {
      return {
        date: "2026-05-17",
        metrics: {},
        sources: [],
        sourceLabel: null,
        latestSource: null,
        missingMetrics: {},
        records: [],
      };
    },
    async getHealthMetricWeek() {
      return {
        startDate: "2026-05-11",
        endDate: "2026-05-17",
        avgSteps: 9000,
        avgSleepMinutes: 480,
        avgRestingHeartRate: 58,
        totalWorkoutMinutes: 45,
        missingDays: [],
        trends: [],
      };
    },
    async getHealthMetricSources() {
      return [];
    },
    async listUnmatchedBankLines() {
      return [];
    },
    async reconcileBankLine() {},
    async getActiveBudgetsWithPeriods() {
      return [];
    },
    async createReceiptScanJob() {
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
    },
    async updateBudgetLimit() {},
  };
}

function signedHealthIngestToken(
  secret = "health-secret",
  userId = "user-1",
  telegramUserId: number | null = 30,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  const payload = {
    userId,
    telegramUserId,
    scope: "health_ingest",
    nonce: "test-nonce",
    issuedAt: nowSeconds,
    expiresAt: nowSeconds + 30 * 24 * 60 * 60,
  };
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
    "utf8",
  ).toString("base64url");
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const signingInput = `${header}.${encoded}`;
  const signature = createHmac("sha256", secret)
    .update(signingInput)
    .digest("base64url");
  return `${signingInput}.${signature}`;
}

export function signedInitData(
  botToken: string,
  telegramUserId: number,
  authDate = Math.floor(Date.now() / 1000),
): string {
  const params = new URLSearchParams({
    auth_date: String(authDate),
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

async function startWebhookServer(
  options: {
    config?: BotServerOptions["config"];
    store?: LifeOSStore;
    telegram?: TelegramClient;
  } = {},
): Promise<{ port: number; sent: SendMessageInput[] }> {
  const sent: SendMessageInput[] = [];
  const server = createBotServer({
    config: {
      telegramWebhookPath: "/telegram/webhook",
      telegramWebhookSecret: "secret",
      ...options.config,
    },
    store: options.store,
    telegram:
      options.telegram ??
      ({
        async sendMessage(input) {
          sent.push(input);
        },
        async getFileUrl() {
          return "https://api.telegram.org/file/bot/test";
        },
      } satisfies TelegramClient),
    dependencies: {
      telegramConfigured: true,
    },
  });
  servers.push(server);

  return {
    port: await listen(server),
    sent,
  };
}

async function postTelegramWebhook(
  port: number,
  body: unknown,
): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/telegram/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": "secret",
    },
    body: JSON.stringify(body),
  });
}

function telegramMessageUpdate(text: string): unknown {
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

function webhookCommandStore(overrides: Partial<LifeOSStore> = {}): {
  store: LifeOSStore;
  captures: CreateLifeCaptureInput[];
  entities: LifeEntityRecord[];
  syncJobs: Array<Parameters<LifeOSStore["enqueueObsidianSync"]>[0]>;
} {
  const captures: CreateLifeCaptureInput[] = [];
  const entities: LifeEntityRecord[] = [];
  const syncJobs: Array<Parameters<LifeOSStore["enqueueObsidianSync"]>[0]> = [];
  const store = {
    async resolveTelegramUser() {
      return activeTelegramUser({ displayName: "User" });
    },
    async linkDefaultTelegramUser() {
      return activeTelegramUser({ displayName: "User", role: "admin" });
    },
    async createPendingTelegramUser() {
      return activeTelegramUser({
        userId: "pending-user",
        telegramUserId: 456,
        status: "pending",
      });
    },
    async listPendingUsers(): Promise<TelegramProfileRecord[]> {
      return [];
    },
    async listTelegramUsers(): Promise<TelegramProfileRecord[]> {
      return [];
    },
    async approveTelegramUser() {
      return activeTelegramUser();
    },
    async blockTelegramUser() {
      return activeTelegramUser({ status: "blocked" });
    },
    async isAdminTelegramUser() {
      return false;
    },
    async createLifeCapture(input: CreateLifeCaptureInput) {
      captures.push(input);
      return {
        id: `capture-${captures.length}`,
        userId: input.userId,
        text: input.text,
        source: input.source ?? "telegram",
        status: input.status ?? "inbox",
        chatId: input.chatId ?? null,
        createdAt: "2026-05-18T00:00:00.000Z",
      };
    },
    async createLifeEntity(input: CreateLifeEntityInput) {
      const entity: LifeEntityRecord = {
        id: `entity-${entities.length + 1}`,
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
      entities.push(entity);
      return entity;
    },
    async createLifeEntityWithSync(
      input: CreateLifeEntityInput,
      sync: Parameters<LifeOSStore["createLifeEntityWithSync"]>[1] = {},
    ) {
      const entity: LifeEntityRecord = {
        id: `entity-${entities.length + 1}`,
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
      entities.push(entity);
      syncJobs.push({
        userId: input.userId,
        lifeEntityId: entity.id,
        entityType: sync.entityType ?? input.entityType,
        action: sync.action ?? "upsert",
        targetPath: sync.targetPath ?? null,
        payloadJson: sync.payloadJson ?? sync.payload ?? {},
      } as Parameters<LifeOSStore["enqueueObsidianSync"]>[0]);
      return entity;
    },
    async enqueueObsidianSync(
      input: Parameters<LifeOSStore["enqueueObsidianSync"]>[0],
    ) {
      syncJobs.push(input);
    },
    async resolveCurrentMode() {
      return {
        userId: "user-1",
        mode: "trimester" as const,
        label: "Trimester Mode",
        source: "default" as const,
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
    },
    ...overrides,
  } as unknown as LifeOSStore;

  return { store, captures, entities, syncJobs };
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
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
  vi.restoreAllMocks();
});

describe("bot server", () => {
  it("rejects unsafe TMA dev auth in production config", () => {
    expect(() =>
      loadBotConfig({
        NODE_ENV: "production",
        ALLOW_UNSAFE_TMA_DEV_AUTH: "true",
      }),
    ).toThrow(/ALLOW_UNSAFE_TMA_DEV_AUTH/);
  });

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

  it("serves the TMA index, assets, and SPA fallback", async () => {
    const tmaStaticDir = await createTmaStaticDirectory();
    const server = createBotServer({
      config: {
        tmaStaticDir,
      },
    });
    servers.push(server);

    const port = await listen(server);
    const indexResponse = await fetch(`http://127.0.0.1:${port}/tma/`);
    const assetResponse = await fetch(
      `http://127.0.0.1:${port}/tma/assets/app.js`,
    );
    const fallbackResponse = await fetch(
      `http://127.0.0.1:${port}/tma/mode/settings`,
    );

    expect(indexResponse.status).toBe(200);
    expect(indexResponse.headers.get("content-type")).toBe("text/html");
    expect(indexResponse.headers.get("cache-control")).toBe("no-cache");
    await expect(indexResponse.text()).resolves.toContain("/tma/assets/app.js");

    expect(assetResponse.status).toBe(200);
    expect(assetResponse.headers.get("content-type")).toBe(
      "application/javascript",
    );
    expect(assetResponse.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    await expect(assetResponse.text()).resolves.toBe("window.lifeos = true;");

    expect(fallbackResponse.status).toBe(200);
    expect(fallbackResponse.headers.get("content-type")).toBe("text/html");
    await expect(fallbackResponse.text()).resolves.toContain(
      "/tma/assets/app.js",
    );
  });

  it("blocks TMA path traversal", async () => {
    const parentDirectory = await mkdtemp(join(tmpdir(), "lifeos-tma-parent-"));
    tempDirectories.push(parentDirectory);
    const tmaStaticDir = join(parentDirectory, "dist");
    await mkdir(tmaStaticDir);
    await writeFile(join(tmaStaticDir, "index.html"), "<!doctype html>");
    await writeFile(join(parentDirectory, "secret.txt"), "do-not-serve");

    const server = createBotServer({
      config: {
        tmaStaticDir,
      },
    });
    servers.push(server);

    const port = await listen(server);
    for (const path of ["/tma/%2e%2e/secret.txt", "/tma/%2fetc%2fpasswd"]) {
      const response = await rawGet(port, path);

      expect(response.status).toBe(400);
      expect(response.body).not.toContain("do-not-serve");
    }
  });

  it("accepts Telegram webhook updates when the secret matches", async () => {
    const sent: SendMessageInput[] = [];
    const telegram: TelegramClient = {
      async sendMessage(input) {
        sent.push(input);
      },
      async getFileUrl() {
        return "https://api.telegram.org/file/bot/test";
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

  it.each([
    [
      "my_chat_member",
      {
        update_id: 101,
        my_chat_member: {
          chat: {
            id: 20,
            type: "private",
          },
          from: {
            id: 30,
            first_name: "Test",
          },
          date: 1_779_120_000,
          old_chat_member: {
            status: "member",
          },
          new_chat_member: {
            status: "kicked",
          },
        },
      },
    ],
    [
      "edited_message without text",
      {
        update_id: 102,
        edited_message: {
          message_id: 10,
          chat: {
            id: 20,
            type: "private",
          },
          date: 1_779_120_000,
        },
      },
    ],
    [
      "message without text",
      {
        update_id: 103,
        message: {
          message_id: 10,
          chat: {
            id: 20,
            type: "private",
          },
          photo: [],
        },
      },
    ],
    [
      "message text without chat",
      {
        update_id: 107,
        message: {
          message_id: 10,
          text: "/status",
          from: {
            id: 30,
            first_name: "Test",
          },
        },
      },
    ],
    [
      "callback_query",
      {
        update_id: 104,
        callback_query: {
          id: "callback-1",
          from: {
            id: 30,
            first_name: "Test",
          },
          data: "noop",
        },
      },
    ],
    [
      "web_app_data",
      {
        update_id: 105,
        message: {
          message_id: 10,
          chat: {
            id: 20,
            type: "private",
          },
          from: {
            id: 30,
            first_name: "Test",
          },
          web_app_data: {
            data: "{}",
            button_text: "Save",
          },
        },
      },
    ],
    [
      "unknown update shape",
      {
        update_id: 106,
        poll: {
          id: "poll-1",
        },
      },
    ],
  ])("ignores %s and returns 200", async (_name, body) => {
    const { port, sent } = await startWebhookServer();

    const response = await postTelegramWebhook(port, body);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(sent).toHaveLength(0);
  });

  it("returns 200 for malformed Telegram webhook JSON", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { port, sent } = await startWebhookServer();

    const response = await fetch(`http://127.0.0.1:${port}/telegram/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": "secret",
      },
      body: "{not-json",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(sent).toHaveLength(0);
  });

  it("keeps /mode replying through the Telegram webhook", async () => {
    const { store } = webhookCommandStore();
    const { port, sent } = await startWebhookServer({ store });

    const response = await postTelegramWebhook(
      port,
      telegramMessageUpdate("/mode"),
    );

    expect(response.status).toBe(200);
    expect(sent.at(-1)?.text).toContain("Mode: <b>Trimester Mode</b>");
  });

  it("keeps /status replying through the Telegram webhook", async () => {
    const { port, sent } = await startWebhookServer();

    const response = await postTelegramWebhook(
      port,
      telegramMessageUpdate("/status"),
    );

    expect(response.status).toBe(200);
    expect(sent.at(-1)?.text).toContain("LifeOS bot status");
  });

  it("keeps /log creating capture, entity, and queue rows through the webhook", async () => {
    const { store, captures, entities, syncJobs } = webhookCommandStore();
    const { port, sent } = await startWebhookServer({ store });

    const response = await postTelegramWebhook(
      port,
      telegramMessageUpdate("/log Проверить inbox pipeline"),
    );

    expect(response.status).toBe(200);
    expect(sent.at(-1)?.text).toBe("✅ Добавил в Inbox.");
    expect(captures).toHaveLength(1);
    expect(entities).toHaveLength(1);
    expect(syncJobs).toHaveLength(1);
    expect(syncJobs.at(0)?.targetPath).toMatch(/\.md$/);
  });

  it("returns 200 and replies with the /log failure message when DB writes fail", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const { store } = webhookCommandStore({
      async createLifeCapture() {
        throw new Error("insert failed secret bot-token");
      },
    });
    const { port, sent } = await startWebhookServer({
      config: {
        telegramBotToken: "bot-token",
      },
      store,
    });

    const response = await postTelegramWebhook(
      port,
      telegramMessageUpdate("/log Сломанный insert"),
    );

    expect(response.status).toBe(200);
    expect(sent.at(-1)?.text).toBe("❌ Не смог добавить в Inbox.");
    const logged = JSON.stringify(consoleError.mock.calls);
    expect(logged).toContain("telegram_webhook_error");
    expect(logged).toContain('"update_id":1');
    expect(logged).toContain('"update_type":"message"');
    expect(logged).toContain('"command":"/log"');
    expect(logged).toContain("[redacted]");
    expect(logged).not.toContain("bot-token");
    expect(logged).not.toContain("secret");
  });

  it("returns 200 and replies with a generic command error when command processing throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { store } = webhookCommandStore({
      async resolveCurrentMode() {
        throw new Error("mode resolver failed");
      },
    });
    const { port, sent } = await startWebhookServer({ store });

    const response = await postTelegramWebhook(
      port,
      telegramMessageUpdate("/mode"),
    );

    expect(response.status).toBe(200);
    expect(sent.at(-1)?.text).toBe("❌ Ошибка обработки команды.");
  });

  it("rejects Telegram webhook updates with the wrong secret", async () => {
    const server = createBotServer({
      config: {
        telegramWebhookPath: "/telegram/webhook",
        telegramWebhookSecret: "secret",
      },
      telegram: {
        async sendMessage() {},
        async getFileUrl() {
          return "https://api.telegram.org/file/bot/test";
        },
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

  it("rejects health ingest requests with an invalid Bearer token", async () => {
    const server = createBotServer({
      config: {
        lifeosHealthIngestJwtSecret: "health-secret",
      },
      store: healthIngestStore([]) as LifeOSStore,
    });
    servers.push(server);

    const port = await listen(server);
    const response = await fetch(`http://127.0.0.1:${port}/health/ingest`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer wrong",
      },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(401);
  });

  it("rejects health metric ingest requests with a missing Bearer token", async () => {
    const server = createBotServer({
      config: {
        lifeosHealthIngestJwtSecret: "health-secret",
        lifeosDefaultUserId: "user-1",
      },
      store: healthMetricsStore([]) as LifeOSStore,
    });
    servers.push(server);

    const port = await listen(server);
    const response = await fetch(`http://127.0.0.1:${port}/api/health/ingest`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        date: "2026-06-07",
        source: "xiaomi_health_connect",
        metrics: [{ type: "steps", value: 8200, unit: "steps" }],
      }),
    });

    expect(response.status).toBe(401);
  });

  it("accepts health metric ingest payloads with a signed health Bearer token", async () => {
    const seen: HealthMetricsIngestPayload[] = [];
    const server = createBotServer({
      config: {
        lifeosHealthIngestJwtSecret: "health-secret",
        lifeosDefaultUserId: "user-1",
      },
      store: healthMetricsStore(seen) as LifeOSStore,
    });
    servers.push(server);

    const port = await listen(server);
    const response = await fetch(`http://127.0.0.1:${port}/api/health/ingest`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${signedHealthIngestToken()}`,
      },
      body: JSON.stringify({
        date: "2026-06-07",
        source: "xiaomi_health_connect",
        device: "Xiaomi Watch 4",
        metrics: [
          { type: "steps", value: 8200, unit: "steps" },
          { type: "sleep_minutes", value: 420, unit: "min" },
        ],
        raw: {},
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      result: {
        created: 2,
        updated: 0,
        source: "xiaomi_health_connect",
      },
    });
    expect(seen.at(0)?.userId).toBe("user-1");
    expect(seen.at(0)?.metrics).toHaveLength(2);
  });

  it("reports idempotent health metric upserts", async () => {
    const seen: HealthMetricsIngestPayload[] = [];
    const store = healthMetricsStore(seen) as LifeOSStore;
    const server = createBotServer({
      config: {
        lifeosHealthIngestJwtSecret: "health-secret",
        lifeosDefaultUserId: "user-1",
      },
      store,
    });
    servers.push(server);

    const port = await listen(server);
    const body = {
      date: "2026-06-07",
      source: "xiaomi_health_connect",
      metrics: [{ type: "steps", value: 8200, unit: "steps" }],
    };

    await fetch(`http://127.0.0.1:${port}/api/health/ingest`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${signedHealthIngestToken()}`,
      },
      body: JSON.stringify(body),
    });
    const response = await fetch(`http://127.0.0.1:${port}/api/health/ingest`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${signedHealthIngestToken()}`,
      },
      body: JSON.stringify(body),
    });

    await expect(response.json()).resolves.toMatchObject({
      result: {
        created: 0,
        updated: 1,
      },
    });
  });

  it("accepts previous-day health ingest payloads", async () => {
    const seen: HealthIngestPayload[] = [];
    const server = createBotServer({
      config: {
        lifeosHealthIngestJwtSecret: "health-secret",
      },
      store: healthIngestStore(seen) as LifeOSStore,
    });
    servers.push(server);

    const port = await listen(server);
    const response = await fetch(`http://127.0.0.1:${port}/health/ingest`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${signedHealthIngestToken()}`,
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
    expect(seen.at(0)?.userId).toBe("user-1");
  });

  it("rejects health ingest payloads whose body user_id does not match the signed token", async () => {
    const seen: HealthIngestPayload[] = [];
    const server = createBotServer({
      config: {
        lifeosHealthIngestJwtSecret: "health-secret",
      },
      store: healthIngestStore(seen) as LifeOSStore,
    });
    servers.push(server);

    const port = await listen(server);
    const response = await fetch(`http://127.0.0.1:${port}/health/ingest`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${signedHealthIngestToken()}`,
      },
      body: JSON.stringify({
        user_id: "attacker-user",
        date: "2026-05-17",
        sync_reason: "nightly_00_01",
        source: "healthkit",
        metrics: {
          sleep_minutes: 480,
          resting_heart_rate: 58,
          hrv_ms: 45,
          steps: 9200,
        },
      }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "health_ingest_user_mismatch",
    });
    expect(seen).toHaveLength(0);
  });

  it("rejects invalid health ingest payloads", async () => {
    const server = createBotServer({
      config: {
        lifeosHealthIngestJwtSecret: "health-secret",
      },
      store: healthIngestStore([]) as LifeOSStore,
    });
    servers.push(server);

    const port = await listen(server);
    const response = await fetch(`http://127.0.0.1:${port}/health/ingest`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${signedHealthIngestToken()}`,
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
    store.resolveTelegramUser = async () => activeTelegramUser();
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
        obsidianStatus: {
          enabled: true,
          status: "connected",
          mode: "local_vault",
          configured: true,
        },
      },
    });
  });

  it("returns an unregistered TMA session for an unknown Telegram user", async () => {
    const store = tmaStore();
    store.resolveTelegramUser = async () => null;
    const server = createBotServer({
      config: {
        telegramBotToken: "bot-token",
      },
      store,
    });
    servers.push(server);

    const port = await listen(server);
    const response = await fetch(`http://127.0.0.1:${port}/api/tma/session`, {
      headers: {
        "x-telegram-init-data": signedInitData("bot-token", 777),
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        state: "unregistered",
        telegramUserId: 777,
        profile: null,
        integrations: {
          telegram: { connected: false },
          obsidian: {
            connected: false,
            enabled: false,
            configured: false,
            status: null,
            mode: null,
          },
          google: { connected: false, status: "not_configured" },
          health: { connected: false, status: "not_configured" },
        },
      },
    });
  });

  it("returns a pending TMA session without allowing protected data", async () => {
    const store = tmaStore();
    store.resolveTelegramUser = async () =>
      activeTelegramUser({ status: "pending" });
    const server = createBotServer({
      config: {
        telegramBotToken: "bot-token",
      },
      store,
    });
    servers.push(server);

    const port = await listen(server);
    const sessionResponse = await fetch(
      `http://127.0.0.1:${port}/api/tma/session`,
      {
        headers: {
          "x-telegram-init-data": signedInitData("bot-token", 30),
        },
      },
    );
    const homeResponse = await fetch(`http://127.0.0.1:${port}/api/tma/home`, {
      headers: {
        "x-telegram-init-data": signedInitData("bot-token", 30),
      },
    });

    expect(sessionResponse.status).toBe(200);
    await expect(sessionResponse.json()).resolves.toMatchObject({
      data: {
        state: "pending",
        profile: { status: "pending", role: "user" },
      },
    });
    expect(homeResponse.status).toBe(403);
    await expect(homeResponse.json()).resolves.toMatchObject({
      error: "telegram_user_pending",
    });
  });

  it("returns a blocked TMA session without technical details", async () => {
    const store = tmaStore();
    store.resolveTelegramUser = async () =>
      activeTelegramUser({ status: "blocked" });
    const server = createBotServer({
      config: {
        telegramBotToken: "bot-token",
      },
      store,
    });
    servers.push(server);

    const port = await listen(server);
    const response = await fetch(`http://127.0.0.1:${port}/api/tma/session`, {
      headers: {
        "x-telegram-init-data": signedInitData("bot-token", 30),
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        state: "blocked",
        profile: { status: "blocked", role: "user" },
        integrations: {
          telegram: { connected: true },
          obsidian: {
            connected: false,
            enabled: false,
            configured: false,
            status: null,
            mode: null,
          },
        },
      },
    });
  });

  it("returns active TMA session integrations without leaking vault paths", async () => {
    const store = tmaStore();
    store.resolveTelegramUser = async () => activeTelegramUser();
    store.getUserObsidianSettings = async () => ({
      userId: "user-1",
      enabled: true,
      mode: "local_vault",
      vaultPath: "/srv/lifeos-vaults/user-a",
      syncthingFolderId: null,
      isActive: true,
      status: "connected",
      metadata: {},
      createdAt: "2026-06-15T10:00:00.000Z",
      updatedAt: "2026-06-15T10:10:00.000Z",
    });
    store.getObsidianSyncStatus = async () => ({ counts: { pending: 2 } });
    const server = createBotServer({
      config: {
        telegramBotToken: "bot-token",
      },
      store,
    });
    servers.push(server);

    const port = await listen(server);
    const response = await fetch(`http://127.0.0.1:${port}/api/tma/session`, {
      headers: {
        "x-telegram-init-data": signedInitData("bot-token", 30),
      },
    });
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).not.toContain("vault_path");
    expect(text).not.toContain("/srv/lifeos-vaults");
    expect(JSON.parse(text)).toMatchObject({
      data: {
        state: "active",
        profile: { status: "active", role: "user" },
        integrations: {
          telegram: { connected: true },
          obsidian: {
            connected: true,
            enabled: true,
            configured: true,
            status: "connected",
            mode: "local_vault",
            pendingSyncCount: 2,
          },
          google: { connected: false, status: "not_configured" },
          health: { connected: false, status: "not_configured" },
        },
      },
    });
  });

  it("returns Google connection status in TMA session without leaking tokens", async () => {
    const store = tmaStore();
    store.resolveTelegramUser = async () => activeTelegramUser();
    store.getSafeUserOAuthConnection = async (userId, provider) =>
      ({
        id: "oauth-google",
        userId,
        provider,
        providerAccountEmail: "person@example.com",
        expiresAt: "2026-06-15T11:00:00.000Z",
        scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
        status: "connected",
        metadata: {},
        createdAt: "2026-06-15T10:00:00.000Z",
        updatedAt: "2026-06-15T10:10:00.000Z",
        accessToken: "access-secret",
        refreshToken: "refresh-secret",
      }) as never;
    const server = createBotServer({
      config: {
        telegramBotToken: "bot-token",
      },
      store,
    });
    servers.push(server);

    const port = await listen(server);
    const response = await fetch(`http://127.0.0.1:${port}/api/tma/session`, {
      headers: {
        "x-telegram-init-data": signedInitData("bot-token", 30),
      },
    });
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).toContain("person@example.com");
    expect(text).not.toContain("access-secret");
    expect(text).not.toContain("refresh-secret");
    expect(JSON.parse(text)).toMatchObject({
      data: {
        integrations: {
          google: {
            connected: true,
            status: "connected",
            accountEmail: "person@example.com",
          },
        },
      },
    });
  });

  it("rejects pending and blocked users from Google OAuth start", async () => {
    for (const status of ["pending", "blocked"] as const) {
      const store = tmaStore();
      store.resolveTelegramUser = async () => activeTelegramUser({ status });
      const server = createBotServer({
        config: {
          telegramBotToken: "bot-token",
          googleOAuthClientId: "google-client-id",
          googleOAuthClientSecret: "google-client-secret",
          googleOAuthRedirectUri:
            "https://lifeos.example/api/oauth/google/callback",
          googleOAuthStateSecret: "google-state-secret",
        },
        store,
      });
      servers.push(server);

      const port = await listen(server);
      const response = await fetch(
        `http://127.0.0.1:${port}/api/tma/integrations/google/start`,
        {
          headers: {
            "x-telegram-init-data": signedInitData("bot-token", 30),
          },
        },
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        error:
          status === "pending"
            ? "telegram_user_pending"
            : "telegram_user_blocked",
      });
    }
  });

  it("returns a signed Google OAuth start URL for an active user", async () => {
    const store = tmaStore();
    store.resolveTelegramUser = async () => activeTelegramUser();
    const server = createBotServer({
      config: {
        telegramBotToken: "bot-token",
        googleOAuthClientId: "google-client-id",
        googleOAuthClientSecret: "google-client-secret",
        googleOAuthRedirectUri:
          "https://lifeos.example/api/oauth/google/callback",
        googleOAuthStateSecret: "google-state-secret",
      },
      store,
    });
    servers.push(server);

    const port = await listen(server);
    const response = await fetch(
      `http://127.0.0.1:${port}/api/tma/integrations/google/start`,
      {
        headers: {
          "x-telegram-init-data": signedInitData("bot-token", 30),
        },
      },
    );
    const body = await response.json();
    const url = new URL(body.data.url);

    expect(response.status).toBe(200);
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("client_id")).toBe("google-client-id");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toMatch(/\./);
    expect(url.searchParams.get("scope")).toContain(
      "https://www.googleapis.com/auth/calendar.readonly",
    );
    expect(JSON.stringify(body)).not.toContain("google-client-secret");
    expect(JSON.stringify(body)).not.toContain("google-state-secret");
  });

  it("rejects Google OAuth callback with invalid state", async () => {
    const server = createBotServer({
      config: {
        googleOAuthClientId: "google-client-id",
        googleOAuthClientSecret: "google-client-secret",
        googleOAuthRedirectUri:
          "https://lifeos.example/api/oauth/google/callback",
        googleOAuthStateSecret: "google-state-secret",
      },
      store: tmaStore(),
    });
    servers.push(server);

    const port = await listen(server);
    const response = await rawGet(
      port,
      "/api/oauth/google/callback?code=auth-code&state=invalid",
    );

    expect(response.status).toBe(400);
    expect(response.body).toContain("OAuth state was invalid");
    expect(response.body).not.toContain("auth-code");
  });

  it("stores Google OAuth callback tokens for the signed state user only", async () => {
    const store = tmaStore();
    let stored: {
      userId: string;
      input: Parameters<LifeOSStore["upsertUserOAuthConnection"]>[1];
    } | null = null;
    store.resolveTelegramUser = async () => activeTelegramUser();
    store.upsertUserOAuthConnection = async (userId, input) => {
      stored = { userId, input };
      return {
        id: "oauth-google",
        userId,
        provider: input.provider,
        providerAccountEmail: input.providerAccountEmail ?? null,
        accessToken: input.accessToken ?? null,
        refreshToken: input.refreshToken ?? null,
        expiresAt: input.expiresAt ?? null,
        scopes: input.scopes ?? [],
        status: input.status ?? "connected",
        metadata: input.metadata ?? {},
        createdAt: "2026-06-15T10:00:00.000Z",
        updatedAt: "2026-06-15T10:00:00.000Z",
      };
    };
    const server = createBotServer({
      config: {
        telegramBotToken: "bot-token",
        tmaUrl: "https://lifeos.example/tma/",
        googleOAuthClientId: "google-client-id",
        googleOAuthClientSecret: "google-client-secret",
        googleOAuthRedirectUri:
          "https://lifeos.example/api/oauth/google/callback",
        googleOAuthStateSecret: "google-state-secret",
      },
      store,
    });
    servers.push(server);

    const port = await listen(server);
    const startResponse = await fetch(
      `http://127.0.0.1:${port}/api/tma/integrations/google/start`,
      {
        headers: {
          "x-telegram-init-data": signedInitData("bot-token", 30),
        },
      },
    );
    const startBody = await startResponse.json();
    const state = new URL(startBody.data.url).searchParams.get("state");

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input: Parameters<typeof fetch>[0]) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (url === "https://oauth2.googleapis.com/token") {
          return new Response(
            JSON.stringify({
              access_token: "access-secret",
              refresh_token: "refresh-secret",
              expires_in: 3600,
              scope:
                "https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/tasks.readonly",
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }

        if (url === "https://www.googleapis.com/oauth2/v2/userinfo") {
          return new Response(JSON.stringify({ email: "person@example.com" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }

        throw new Error(`Unexpected fetch: ${url}`);
      });

    try {
      const response = await rawGet(
        port,
        `/api/oauth/google/callback?code=auth-code&state=${encodeURIComponent(
          state ?? "",
        )}`,
      );

      expect(response.status).toBe(302);
      expect(stored).toMatchObject({
        userId: "user-1",
        input: {
          provider: "google",
          providerAccountEmail: "person@example.com",
          accessToken: "access-secret",
          refreshToken: "refresh-secret",
          status: "connected",
        },
      });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("disconnects Google OAuth only for the current TMA user", async () => {
    const store = tmaStore();
    let connected = true;
    let deleted: { userId: string; provider: string } | null = null;
    store.resolveTelegramUser = async () => activeTelegramUser();
    store.getSafeUserOAuthConnection = async (userId, provider) =>
      connected
        ? {
            id: "oauth-google",
            userId,
            provider,
            providerAccountEmail: "person@example.com",
            expiresAt: null,
            scopes: [],
            status: "connected",
            metadata: {},
            createdAt: "2026-06-15T10:00:00.000Z",
            updatedAt: "2026-06-15T10:00:00.000Z",
          }
        : null;
    store.deleteUserOAuthConnection = async (userId, provider) => {
      deleted = { userId, provider };
      connected = false;
    };
    const server = createBotServer({
      config: {
        telegramBotToken: "bot-token",
      },
      store,
    });
    servers.push(server);

    const port = await listen(server);
    const response = await fetch(
      `http://127.0.0.1:${port}/api/tma/integrations/google/disconnect`,
      {
        method: "POST",
        headers: {
          "x-telegram-init-data": signedInitData("bot-token", 30),
        },
      },
    );

    expect(response.status).toBe(200);
    expect(deleted).toEqual({ userId: "user-1", provider: "google" });
    await expect(response.json()).resolves.toMatchObject({
      data: {
        integrations: {
          google: { connected: false, status: "not_configured" },
        },
      },
    });
  });

  it("creates a pending profile from TMA registration for unknown users", async () => {
    const store = tmaStore();
    let createdTelegramId: number | null = null;
    store.resolveTelegramUser = async () => null;
    store.createPendingTelegramUser = async (input) => {
      createdTelegramId = input.telegramUserId;
      return activeTelegramUser({
        userId: "pending-user",
        telegramUserId: input.telegramUserId,
        displayName: input.displayName ?? "Pending",
        username: input.username ?? null,
        status: "pending",
      });
    };
    const server = createBotServer({
      config: {
        telegramBotToken: "bot-token",
      },
      store,
    });
    servers.push(server);

    const port = await listen(server);
    const response = await fetch(`http://127.0.0.1:${port}/api/tma/register`, {
      method: "POST",
      headers: {
        "x-telegram-init-data": signedInitData("bot-token", 777),
      },
    });

    expect(response.status).toBe(200);
    expect(createdTelegramId).toBe(777);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        state: "pending",
        telegramUserId: 777,
        profile: { status: "pending", role: "user" },
      },
    });
  });

  it("does not re-register blocked TMA users", async () => {
    const store = tmaStore();
    let createCalled = false;
    store.resolveTelegramUser = async () =>
      activeTelegramUser({ status: "blocked" });
    store.createPendingTelegramUser = async () => {
      createCalled = true;
      return activeTelegramUser({ status: "pending" });
    };
    const server = createBotServer({
      config: {
        telegramBotToken: "bot-token",
      },
      store,
    });
    servers.push(server);

    const port = await listen(server);
    const response = await fetch(`http://127.0.0.1:${port}/api/tma/register`, {
      method: "POST",
      headers: {
        "x-telegram-init-data": signedInitData("bot-token", 30),
      },
    });

    expect(response.status).toBe(200);
    expect(createCalled).toBe(false);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        state: "blocked",
        profile: { status: "blocked" },
      },
    });
  });

  it("rejects expired Telegram initData for TMA requests", async () => {
    const store = tmaStore();
    store.resolveTelegramUser = async () => activeTelegramUser();
    const server = createBotServer({
      config: {
        telegramBotToken: "bot-token",
      },
      store,
    });
    servers.push(server);

    const port = await listen(server);
    const expiredAuthDate = Math.floor(Date.now() / 1000) - 86_400 - 1;
    const response = await fetch(`http://127.0.0.1:${port}/api/tma/home`, {
      headers: {
        "x-telegram-init-data": signedInitData(
          "bot-token",
          30,
          expiredAuthDate,
        ),
      },
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_telegram_init_data",
    });
  });

  it("rejects pending Telegram profiles for TMA requests", async () => {
    const store = tmaStore();
    store.resolveTelegramUser = async () =>
      activeTelegramUser({ status: "pending" });
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

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "telegram_user_pending",
    });
  });

  it("rejects blocked Telegram profiles for TMA requests", async () => {
    const store = tmaStore();
    store.resolveTelegramUser = async () =>
      activeTelegramUser({ status: "blocked" });
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

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "telegram_user_blocked",
    });
  });

  it("serves live finance data to the TMA", async () => {
    const store = tmaStore();
    store.resolveTelegramUser = async () => activeTelegramUser();
    const server = createBotServer({
      config: {
        telegramBotToken: "bot-token",
      },
      store,
    });
    servers.push(server);

    const port = await listen(server);
    const response = await fetch(`http://127.0.0.1:${port}/api/tma/finance`, {
      headers: {
        "x-telegram-init-data": signedInitData("bot-token", 30),
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        currency: "KZT",
        today: { amount: 1200 },
        recentTransactions: [{ description: "шаурма" }],
      },
    });
  });

  it("handles receipt details, image retrieval, review, and backfill via TMA API", async () => {
    const store = tmaStore();
    store.resolveTelegramUser = async () => activeTelegramUser();
    const server = createBotServer({
      config: {
        telegramBotToken: "bot-token",
      },
      store,
    });
    servers.push(server);

    const port = await listen(server);

    // 1. Get receipt details
    const receiptRes = await fetch(
      `http://127.0.0.1:${port}/api/tma/finance/receipts/needs-review-id`,
      {
        headers: {
          "x-telegram-init-data": signedInitData("bot-token", 30),
        },
      },
    );
    expect(receiptRes.status).toBe(200);
    const receiptData = await receiptRes.json();
    expect(receiptData.data).toMatchObject({
      id: "needs-review-id",
      status: "needs_review",
      ocrText: "Walmart\nTotal: $15.00",
    });

    // 2. Get receipt image
    const imageRes = await fetch(
      `http://127.0.0.1:${port}/api/tma/finance/receipts/needs-review-id/image`,
      {
        headers: {
          "x-telegram-init-data": signedInitData("bot-token", 30),
        },
      },
    );
    expect(imageRes.status).toBe(200);
    expect(imageRes.headers.get("content-type")).toBe("image/jpeg");
    const imageText = await imageRes.text();
    expect(imageText).toBe("dummy");

    // 3. Review receipt
    const reviewRes = await fetch(
      `http://127.0.0.1:${port}/api/tma/finance/receipts/needs-review-id/review`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-init-data": signedInitData("bot-token", 30),
        },
        body: JSON.stringify({
          amount: 25.5,
          currency: "USD",
          merchant: "Target",
          date: "2026-06-09",
          category: "Groceries",
        }),
      },
    );
    expect(reviewRes.status).toBe(200);
    const reviewData = await reviewRes.json();
    expect(reviewData.data).toMatchObject({
      id: "needs-review-id",
      status: "linked",
      parsedJson: {
        amount: 25.5,
        currency: "USD",
        merchant: "Target",
        date: "2026-06-09",
        category: "Groceries",
      },
    });

    // 4. Backfill legacy amounts
    const backfillRes = await fetch(
      `http://127.0.0.1:${port}/api/tma/finance/backfill`,
      {
        method: "POST",
        headers: {
          "x-telegram-init-data": signedInitData("bot-token", 30),
        },
      },
    );
    expect(backfillRes.status).toBe(200);
    const backfillData = await backfillRes.json();
    expect(backfillData.data).toEqual({ updatedCount: 0 });
  });

  it("serves and generates monthly review data to the TMA", async () => {
    const store = tmaStore();
    store.resolveTelegramUser = async () => activeTelegramUser();
    const server = createBotServer({
      config: {
        telegramBotToken: "bot-token",
      },
      store,
    });
    servers.push(server);

    const port = await listen(server);
    const getResponse = await fetch(
      `http://127.0.0.1:${port}/api/tma/monthly-review`,
      {
        headers: {
          "x-telegram-init-data": signedInitData("bot-token", 30),
        },
      },
    );
    const postResponse = await fetch(
      `http://127.0.0.1:${port}/api/tma/monthly-review`,
      {
        method: "POST",
        headers: {
          "x-telegram-init-data": signedInitData("bot-token", 30),
        },
      },
    );

    expect(getResponse.status).toBe(200);
    await expect(getResponse.json()).resolves.toMatchObject({
      data: { latest: null },
    });
    expect(postResponse.status).toBe(200);
    await expect(postResponse.json()).resolves.toMatchObject({
      data: {
        latest: {
          status: "generated",
          obsidianPath: expect.stringContaining("Reviews/Monthly/"),
        },
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
      "getActiveStudyCourse",
      "updateStudyCourseProgress",
    ]);
  });

  it("serves sources and creates reminders through TMA routes", async () => {
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
    const futureRemindAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const getResponse = await fetch(`http://127.0.0.1:${port}/api/tma/sources`);
    const createResponse = await fetch(
      `http://127.0.0.1:${port}/api/tma/reminders`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          message: "Review graph theory",
          remindAt: futureRemindAt,
        }),
      },
    );
    const listResponse = await fetch(
      `http://127.0.0.1:${port}/api/tma/reminders`,
    );
    const cancelResponse = await fetch(
      `http://127.0.0.1:${port}/api/tma/reminders/reminder-1`,
      {
        method: "DELETE",
      },
    );

    expect(getResponse.status).toBe(200);
    await expect(getResponse.json()).resolves.toMatchObject({
      data: {
        sources: [
          {
            sourceKey: "manual",
            status: "connected",
          },
        ],
        sourceEvents: [
          {
            title: "Calculus 2 final",
          },
        ],
        reminders: [],
      },
    });
    expect(createResponse.status).toBe(200);
    await expect(createResponse.json()).resolves.toMatchObject({
      data: {
        reminders: [
          {
            message: "Review graph theory",
            remindAt: futureRemindAt,
          },
        ],
      },
    });
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({
      data: {
        reminders: [
          {
            message: "Review graph theory",
            remindAt: futureRemindAt,
            status: "pending",
            channel: "telegram",
          },
        ],
      },
    });
    expect(cancelResponse.status).toBe(200);
    await expect(cancelResponse.json()).resolves.toMatchObject({
      data: {
        id: "reminder-1",
        status: "cancelled",
      },
    });
    expect(events).toEqual([
      "getTmaSourcesSummary",
      "createReminder",
      "getTmaSourcesSummary",
      "listUpcomingReminders",
      "cancelReminder",
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
    expect(events).toEqual(["getCurrentWorkout"]);
  });

  it("returns empty current workout without creating one", async () => {
    const events: string[] = [];
    const store = {
      ...tmaStore(events),
      async getCurrentWorkout() {
        events.push("getCurrentWorkout");
        return null;
      },
    } as LifeOSStore;
    const server = createBotServer({
      config: {
        lifeosDefaultUserId: "user-1",
        allowUnsafeTmaDevAuth: true,
      },
      store,
    });
    servers.push(server);

    const port = await listen(server);
    const response = await fetch(
      `http://127.0.0.1:${port}/api/tma/workout/current`,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: null });
    expect(events).toEqual(["getCurrentWorkout"]);
  });

  it("starts a workout only from the start endpoint", async () => {
    const events: string[] = [];
    let currentWorkout: CurrentWorkoutSummary | null = null;
    const store = {
      ...tmaStore(events),
      async getOrCreateCurrentWorkout() {
        events.push("getOrCreateCurrentWorkout");
        currentWorkout = workoutSummary();
        return {
          id: "workout-1",
          title: "Push day",
          startedAt: "2026-05-18T10:00:00.000Z",
          created: true,
        };
      },
      async getCurrentWorkout() {
        events.push("getCurrentWorkout");
        return currentWorkout;
      },
    } as LifeOSStore;
    const server = createBotServer({
      config: {
        lifeosDefaultUserId: "user-1",
        allowUnsafeTmaDevAuth: true,
      },
      store,
    });
    servers.push(server);

    const port = await listen(server);
    const response = await fetch(
      `http://127.0.0.1:${port}/api/tma/workout/start`,
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        id: "workout-1",
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

  it("completes full lifecycle: budget creation -> receipt upload -> telegram alert", async () => {
    const store = tmaStore();
    store.resolveTelegramUser = async () => activeTelegramUser();
    store.processFinanceAlerts = async () => {
      return ["⚠️ Внимание: Бюджет превышен для 'Groceries E2E'"];
    };
    store.createBudget = async () => ({}) as any;

    let sentMessageText = "";
    const telegramMock = {
      async sendMessage(params: any) {
        sentMessageText = params.text;
      },
      async editMessageText() {},
      async editMessageReplyMarkup() {},
      async deleteMessage() {},
      async answerCallbackQuery() {},
      async sendChatAction() {},
      async getFile() {
        return { filePath: "test" };
      },
      async getFileUrl() {
        return "https://api.telegram.org/file/bot/test";
      },
    };

    const server = createBotServer({
      config: {
        telegramBotToken: "bot-token",
        telegramWebhookSecret: "secret",
        telegramWebhookPath: "/telegram/webhook",
      },
      store,
      telegram: telegramMock,
    });
    servers.push(server);

    const port = await listen(server);

    const budgetRes = await fetch(
      `http://127.0.0.1:${port}/api/tma/finance/budgets`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-init-data": signedInitData("bot-token", 30),
        },
        body: JSON.stringify({
          name: "Groceries E2E",
          amount: 50,
          period: "monthly",
          periodStart: "2026-06-01",
          categoryId: "cat-1",
        }),
      },
    );
    if (budgetRes.status !== 200) {
      console.error(await budgetRes.text());
    }
    expect(budgetRes.status).toBe(200);

    const reviewRes = await fetch(
      `http://127.0.0.1:${port}/api/tma/finance/receipts/test-receipt-id/review`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-init-data": signedInitData("bot-token", 30),
        },
        body: JSON.stringify({
          amount: 60.5,
          currency: "USD",
          merchant: "Walmart E2E",
          date: "2026-06-09",
          category: "Groceries",
        }),
      },
    );
    expect(reviewRes.status).toBe(200);

    expect(sentMessageText).toContain("⚠️ Внимание: Бюджет превышен");
    expect(sentMessageText).toContain("Groceries E2E");
  });
});
