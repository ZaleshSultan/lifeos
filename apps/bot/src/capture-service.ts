import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import {
  CAPTURE_ACTION_KINDS,
  CAPTURE_MAX_TEXT,
  CAPTURE_MAX_VOICE_BYTES,
  CAPTURE_MAX_VOICE_SECONDS,
  CaptureInputError,
  assistantToolPermission,
  applyCaptureJournalAction,
  captureRecordId,
  emptyIdealHumanDay,
  extractCaptureActions,
  isCaptureJournalAction,
  parseCaptureConfirmRequest,
  parseCaptureEditRequest,
  parseCaptureIngestRequest,
  parseCaptureSearchInput,
  type CaptureActionView,
  type CaptureActionPayload,
  type CaptureCapabilities,
  type CaptureContextView,
  type CaptureSearchResult,
  type CaptureSource,
  type CaptureView,
} from "@lifeos/core";
import {
  CaptureStoreError,
  type CaptureConfirmOptions,
  type CaptureServiceStore,
  type CaptureSourceReference,
  type CaptureVoiceReference,
  type CaptureProcessingJob,
  type LifeOSStore,
  type TelegramUserRecord,
} from "@lifeos/db";
import { AssistantBrain } from "./assistant/brain.js";
import { loadPlanningData } from "./planning-context.js";

export class CaptureServiceError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode = 503,
  ) {
    super(code);
    this.name = "CaptureServiceError";
  }
}

export interface CaptureConfig {
  enabled: boolean;
  workerEnabled: boolean;
  memoryDeleteEnabled: boolean;
}

export function readCaptureConfig(
  source: Record<string, string | undefined> = process.env,
): CaptureConfig {
  const flag = (key: string, fallback: boolean) =>
    source[key] === undefined
      ? fallback
      : ["true", "1", "yes", "on"].includes(source[key]!.toLowerCase());
  return {
    enabled: flag("LIFEOS_CAPTURE_ENABLED", true),
    workerEnabled: flag("LIFEOS_CAPTURE_WORKER_ENABLED", true),
    memoryDeleteEnabled: flag("LIFEOS_ASSISTANT_MEMORY_DELETE_ENABLED", false),
  };
}

/** Capture text proposes work. Only the store's atomic confirmation can commit it. */
export class CaptureService {
  private worker?: ReturnType<typeof setInterval>;
  private working = false;
  private stopping = false;
  private processing = 0;
  private readonly usage = new Map<string, { minute: number; count: number }>();
  constructor(
    private readonly options: {
      store?: LifeOSStore;
      config: CaptureConfig;
      assistant?: AssistantBrain;
      now?: () => Date;
    },
  ) {}

  capabilities(): CaptureCapabilities {
    const enabled =
      this.options.config.enabled && Boolean(this.options.store?.captureInbox);
    return {
      enabled,
      text: enabled,
      telegramVoice: enabled,
      transcription: "unavailable",
      transcriptionRequiresConsent: true,
      aiExtraction: false,
      maxTextLength: CAPTURE_MAX_TEXT,
      maxVoiceBytes: CAPTURE_MAX_VOICE_BYTES,
      maxVoiceSeconds: CAPTURE_MAX_VOICE_SECONDS,
      memoryDeleteEnabled: enabled && this.options.config.memoryDeleteEnabled,
      actionKinds: [...CAPTURE_ACTION_KINDS],
    };
  }
  private now(): Date {
    return this.options.now?.() ?? new Date();
  }
  private persistence(user: TelegramUserRecord): CaptureServiceStore {
    if (!user.userId || user.status !== "active")
      throw new CaptureServiceError("capture_permission_denied", 403);
    if (!this.options.config.enabled || !this.options.store?.captureInbox)
      throw new CaptureServiceError("capture_unavailable");
    return this.options.store.captureInbox;
  }
  private limit(userId: string) {
    const minute = Math.floor(this.now().getTime() / 60000);
    for (const [key, value] of this.usage)
      if (value.minute !== minute) this.usage.delete(key);
    const value = this.usage.get(userId);
    if ((value?.count ?? 0) >= 30 || (!value && this.usage.size >= 2000))
      throw new CaptureServiceError("capture_rate_limited", 429);
    this.usage.set(userId, { minute, count: (value?.count ?? 0) + 1 });
  }
  async search(
    user: TelegramUserRecord,
    raw: unknown = {},
  ): Promise<CaptureSearchResult> {
    return this.persistence(user).search(
      user.userId,
      parseCaptureSearchInput(raw),
    );
  }
  async get(user: TelegramUserRecord, id: string): Promise<CaptureView> {
    const capture = await this.persistence(user).get(
      user.userId,
      captureRecordId(id),
    );
    if (!capture) throw new CaptureServiceError("capture_not_found", 404);
    return this.withContext(user, capture);
  }
  async ingest(
    user: TelegramUserRecord,
    raw: unknown,
    source: Exclude<CaptureSource, "legacy">,
    trusted?: {
      voice?: CaptureVoiceReference;
      sourceReference?: CaptureSourceReference;
    },
  ): Promise<{ capture: CaptureView; created: boolean }> {
    const persistence = this.persistence(user);
    const input = parseCaptureIngestRequest(raw);
    if (
      input.inputType === "voice" &&
      (source !== "telegram" || !trusted?.voice)
    )
      throw new CaptureInputError();
    this.limit(user.userId);
    const result = await persistence.ingest(user.userId, {
      ...input,
      source,
      ...trusted,
    });
    // Duplicate ingress is a durable read: it never processes or emits a reply twice.
    if (result.created && result.capture.state === "queued") {
      try {
        result.capture = await this.process(user, result.capture.id);
      } catch {
        /* The durable queue survives a failed/terminated request. */
      }
    }
    if (!result.capture.context)
      result.capture = await this.withContext(user, result.capture);
    return result;
  }
  async edit(
    user: TelegramUserRecord,
    id: string,
    raw: unknown,
  ): Promise<CaptureView> {
    const result = await this.persistence(user).edit(
      user.userId,
      captureRecordId(id),
      parseCaptureEditRequest(raw),
    );
    if (result.state === "queued") return this.process(user, id);
    return this.withContext(user, result);
  }
  async process(user: TelegramUserRecord, id: string): Promise<CaptureView> {
    const persistence = this.persistence(user);
    captureRecordId(id);
    if (this.processing >= 2) {
      const queued = await persistence.get(user.userId, id);
      if (!queued) throw new CaptureServiceError("capture_not_found", 404);
      return this.withContext(user, queued);
    }
    this.processing++;
    try {
      const job = await persistence.claim(user.userId, id, randomUUID());
      if (!job) return this.get(user, id);
      return this.withContext(user, await this.processJob(user, job));
    } finally {
      this.processing--;
    }
  }
  private async processJob(
    user: TelegramUserRecord,
    job: CaptureProcessingJob,
  ): Promise<CaptureView> {
    const persistence = this.persistence(user);
    try {
      if (job.capture.inputType === "voice" && !job.capture.transcript)
        return await persistence.finish(
          user.userId,
          job.capture.id,
          job.leaseToken,
          { errorCode: "transcription_unavailable" },
        );
      const proposals = extractCaptureActions(
        job.capture.transcript ?? job.capture.text,
        {
          now: new Date(job.referenceTime ?? job.capture.createdAt),
          timezone: user.timezone,
        },
      );
      return await persistence.finish(
        user.userId,
        job.capture.id,
        job.leaseToken,
        { proposals },
      );
    } catch (error) {
      if (
        error instanceof CaptureStoreError &&
        error.code === "capture_lease_lost"
      )
        throw error;
      return persistence.finish(user.userId, job.capture.id, job.leaseToken, {
        errorCode:
          error instanceof CaptureInputError
            ? "invalid_capture_input"
            : "capture_processing_unavailable",
      });
    }
  }
  async retry(
    user: TelegramUserRecord,
    id: string,
    expectedRevision: number,
  ): Promise<CaptureView> {
    await this.persistence(user).retry(
      user.userId,
      captureRecordId(id),
      expectedRevision,
    );
    return this.process(user, id);
  }
  async cancel(user: TelegramUserRecord, id: string, revision: number) {
    return this.withContext(
      user,
      await this.persistence(user).cancel(
        user.userId,
        captureRecordId(id),
        revision,
      ),
    );
  }
  async archive(
    user: TelegramUserRecord,
    id: string,
    revision: number,
    archived: boolean,
  ) {
    return this.withContext(
      user,
      await this.persistence(user).archive(
        user.userId,
        captureRecordId(id),
        revision,
        archived,
      ),
    );
  }
  async delete(user: TelegramUserRecord, id: string, revision: number) {
    await this.persistence(user).delete(
      user.userId,
      captureRecordId(id),
      revision,
    );
  }
  async memories(user: TelegramUserRecord) {
    this.persistence(user);
    if (!this.options.store?.assistant)
      throw new CaptureServiceError("capture_memory_unavailable");
    const rows = await this.options.store.assistant.listMemories(user.userId, {
      limit: 50,
      includeArchived: true,
    });
    if (rows.some((row) => row.userId !== user.userId))
      throw new CaptureServiceError("capture_permission_denied", 403);
    return rows.map(({ key, category, content, updatedAt, archivedAt }) => ({
      key,
      category,
      content,
      updatedAt,
      archivedAt,
    }));
  }
  async confirm(
    user: TelegramUserRecord,
    id: string,
    raw: unknown,
  ): Promise<CaptureView> {
    const persistence = this.persistence(user);
    const request = parseCaptureConfirmRequest(raw);
    const capture = await persistence.get(user.userId, captureRecordId(id));
    if (!capture) throw new CaptureServiceError("capture_not_found", 404);
    const selected = capture.actions.filter((action) =>
      request.actionIds.includes(action.id),
    );
    if (selected.length !== request.actionIds.length)
      throw new CaptureInputError();
    if (selected.some((action) => action.status !== "succeeded")) {
      if (capture.revision !== request.expectedRevision)
        throw new CaptureServiceError("capture_conflict", 409);
      if (
        !capture.reviewExpiresAt ||
        Date.parse(capture.reviewExpiresAt) <= this.now().getTime()
      )
        throw new CaptureServiceError("capture_expired", 409);
    }
    // SQL applies the selected subset in stored proposal order. Prepared journal
    // revisions must use that same order regardless of checkbox click order.
    if (
      selected.some((action) => action.kind === "memory.delete") &&
      !this.options.config.memoryDeleteEnabled
    )
      throw new CaptureServiceError("capture_permission_denied", 403);
    const options: CaptureConfirmOptions = {
      allowMemoryDelete: this.options.config.memoryDeleteEnabled,
    };
    await this.prepareReadResults(user, selected, options);
    await this.prepareJournalEntries(user, capture.id, selected, options);
    // Revision/expiry/selected payloads, domain writes and receipts are checked in ONE transaction.
    return this.withContext(
      user,
      await persistence.confirm(user.userId, id, request, options),
    );
  }
  private async prepareReadResults(
    user: TelegramUserRecord,
    actions: CaptureActionView[],
    options: CaptureConfirmOptions,
  ) {
    options.readResults = [];
    for (const action of actions) {
      if (action.kind !== "question.read" || action.status === "succeeded")
        continue;
      let summary =
        "No verified answer is available from saved data. No external model was called.";
      const call = action.args.tool;
      if (
        call &&
        assistantToolPermission(call.tool) === "READ" &&
        this.options.assistant
      ) {
        const answer = await this.options.assistant.registry.execute(
          {
            user,
            source: "tma",
            requestId: `capture-read:${action.id}`,
            now: this.now(),
            origin: "deterministic",
            allowDestructive: false,
          },
          call,
        );
        summary = answer.text.slice(0, 4000);
      }
      options.readResults.push({
        actionId: action.id,
        action: { kind: action.kind, args: action.args },
        summary,
      });
    }
  }
  private async prepareJournalEntries(
    user: TelegramUserRecord,
    captureId: string,
    actions: CaptureActionView[],
    options: CaptureConfirmOptions,
  ) {
    const selected = actions.filter(
      (action) =>
        action.status !== "succeeded" && isCaptureJournalAction(action),
    );
    if (!selected.length) return;
    if (!this.options.store?.getIdealHumanDays)
      throw new CaptureServiceError("capture_journal_unavailable");
    const saved = await this.options.store.getIdealHumanDays(user.userId);
    const days = new Map(saved.map((day) => [day.date, day]));
    options.journalEntries = [];
    for (const action of selected) {
      if (!("date" in action.args)) throw new CaptureInputError();
      const day =
        days.get(action.args.date) ?? emptyIdealHumanDay(action.args.date);
      const payload = {
        kind: action.kind,
        args: action.args,
      } as CaptureActionPayload;
      const entry = applyCaptureJournalAction(
        day,
        payload,
        `${captureId}_${action.id}`,
        action.origin,
      );
      options.journalEntries.push({
        actionId: action.id,
        action: payload,
        date: day.date,
        expectedRevision: day.revision,
        entry,
      });
      days.set(day.date, { ...entry, revision: day.revision + 1 });
    }
  }
  private async withContext(
    user: TelegramUserRecord,
    capture: CaptureView,
  ): Promise<CaptureView> {
    const reference = DateTime.fromISO(capture.createdAt, {
      zone: user.timezone,
    });
    const dated = capture.actions.find((action) => "date" in action.args);
    const tomorrow = /\btomorrow\b|завтра/iu.test(
      capture.transcript ?? capture.text,
    );
    const date =
      dated && "date" in dated.args
        ? dated.args.date
        : reference.plus({ days: tomorrow ? 1 : 0 }).toISODate()!;
    const context: CaptureContextView = {
      date,
      timezone: user.timezone,
      warnings: [],
      commitments: [],
      deadlines: [],
      suggestedOrder: [],
      scheduleKnown: false,
    };
    try {
      const data = await loadPlanningData(
        this.options.store!,
        user,
        date,
        this.now(),
      );
      context.commitments = data.events.slice(0, 30);
      context.warnings = [...data.plan.warnings];
      context.scheduleKnown =
        data.events.length > 0 &&
        !data.plan.warnings.some((value) =>
          /incomplete|unverified|invalid|safety limit/iu.test(value),
        );
      context.deadlines = data.plan.rankedTasks
        .filter((task) => task.dueAt)
        .slice(0, 20)
        .map((task) => ({ title: task.title, dueAt: task.dueAt ?? null }));
      context.suggestedOrder = [
        ...new Set([
          ...data.plan.rankedTasks
            .filter(
              (task) =>
                task.dueAt &&
                Date.parse(task.dueAt) <=
                  DateTime.fromISO(date, { zone: user.timezone })
                    .endOf("day")
                    .toMillis(),
            )
            .slice(0, 3)
            .map((task) => task.title),
          ...capture.actions
            .filter(
              (action) =>
                action.status !== "succeeded" && action.status !== "cancelled",
            )
            .map((action) => action.summary),
        ]),
      ].slice(0, 6);
      const lms = await this.options.store!.getLmsConnection(user.userId);
      const syncAt = lms.lastSyncSuccessAt
        ? Date.parse(lms.lastSyncSuccessAt)
        : NaN;
      const fresh =
        Number.isFinite(syncAt) &&
        syncAt <= this.now().getTime() &&
        this.now().getTime() - syncAt <= 86400000;
      context.scheduleKnown =
        context.scheduleKnown && lms.state === "connected" && fresh;
      if (lms.state !== "connected")
        context.warnings.push(
          "University connection needs attention; saved deadlines and classes may be incomplete.",
        );
      else if (!fresh)
        context.warnings.push(
          "University synchronization is missing or stale; verify upcoming classes and deadlines.",
        );
      if (!context.scheduleKnown)
        context.warnings.push(
          "Timetable completeness is unknown. Missing class or calendar times have not been invented.",
        );
      for (const action of capture.actions) {
        if (action.kind !== "planning.suggest" || !action.args.time) continue;
        const at = DateTime.fromISO(`${action.args.date}T${action.args.time}`, {
          zone: user.timezone,
        }).toMillis();
        if (
          data.events.some(
            (event) =>
              Date.parse(event.startsAt) <= at && at < Date.parse(event.endsAt),
          )
        )
          context.warnings.push(
            `The suggested time for “${action.args.title}” overlaps a saved commitment. Review it before approving.`,
          );
      }
      if (
        capture.actions.filter(
          (action) => !["succeeded", "cancelled"].includes(action.status),
        ).length > 6
      )
        context.warnings.push(
          "This capture contains many activities. Approve a manageable subset; untimed items have not been scheduled.",
        );
    } catch {
      context.scheduleKnown = false;
      context.warnings.push(
        "Saved schedule/context is unavailable. Keep activities untimed until verified.",
      );
    }
    if (this.options.store?.assistant) {
      try {
        const memories = await this.options.store.assistant.listMemories(
          user.userId,
          { limit: 10 },
        );
        context.preferences = memories
          .filter(
            (memory) =>
              memory.userId === user.userId &&
              !memory.archivedAt &&
              ["preference", "goal", "constraint"].includes(memory.category),
          )
          .map((memory) => memory.content)
          .slice(0, 10);
      } catch {
        context.warnings.push(
          "Explicit planning preferences could not be loaded.",
        );
      }
    }
    return { ...capture, context };
  }
  start(): void {
    if (
      !this.capabilities().enabled ||
      !this.options.config.workerEnabled ||
      this.worker
    )
      return;
    this.stopping = false;
    this.worker = setInterval(() => {
      void this.tick();
    }, 5000);
    this.worker.unref();
  }
  stop(): void {
    this.stopping = true;
    if (this.worker) clearInterval(this.worker);
    this.worker = undefined;
  }
  async tick(): Promise<void> {
    if (
      this.working ||
      this.stopping ||
      this.processing >= 2 ||
      !this.options.store?.captureInbox
    )
      return;
    this.working = true;
    this.processing++;
    try {
      const persistence = this.options.store.captureInbox;
      await persistence.sweep(25);
      const next = await persistence.claimNext(randomUUID());
      if (!next || this.stopping) return;
      const user = await this.options.store.resolveUserById(next.userId);
      if (user?.status === "active") await this.processJob(user, next.job);
    } catch {
      /* Durable leases/retry ceilings retain recoverable state; no private error logging. */
    } finally {
      this.working = false;
      this.processing--;
    }
  }
}
