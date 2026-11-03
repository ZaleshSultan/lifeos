import { describe, expect, it, vi } from "vitest";
import {
  emptyIdealHumanDay,
  parseCaptureProposals,
  type CaptureActionView,
  type CaptureConfirmRequest,
  type CaptureView,
  type IdealHumanDay,
} from "@lifeos/core";
import type {
  CaptureConfirmOptions,
  CaptureServiceStore,
  LifeOSStore,
  TelegramUserRecord,
} from "@lifeos/db";
import { CaptureService } from "./capture-service.js";
import type { AssistantBrain } from "./assistant/brain.js";

vi.mock("./planning-context.js", () => ({
  loadPlanningData: vi.fn(async () => ({
    events: [],
    plan: { warnings: [], rankedTasks: [] },
  })),
}));

const id = "10000000-0000-4000-8000-000000000001";
const owner = "20000000-0000-4000-8000-000000000001";
const now = new Date("2026-11-03T17:00:00.000Z");
const user = {
  userId: owner,
  telegramUserId: 12345,
  timezone: "Asia/Almaty",
  status: "active",
} as TelegramUserRecord;
function capture(patch: Partial<CaptureView> = {}): CaptureView {
  return {
    id,
    inputType: "text",
    source: "tma",
    sourceLabel: "Mini App",
    text: "Add task DBMS",
    transcript: null,
    state: "queued",
    revision: 1,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    archivedAt: null,
    expiresAt: null,
    reviewExpiresAt: "2026-11-03T17:10:00.000Z",
    errorCode: null,
    actions: [],
    ...patch,
  };
}
function actions(raw: unknown[]): CaptureActionView[] {
  return parseCaptureProposals(raw).map((action) => ({
    ...action,
    status: action.missingFields.length ? "needs_input" : "pending",
    resultSummary: null,
    completedAt: null,
  }));
}
function fixture(initial = capture()) {
  const ports = {
    search: vi.fn(async () => ({ captures: [initial], nextCursor: null })),
    get: vi.fn(async () => initial),
    ingest: vi.fn(async () => ({ capture: initial, created: true })),
    edit: vi.fn(async () => initial),
    retry: vi.fn(async () => initial),
    claim: vi.fn(async () => ({
      capture: initial,
      leaseToken: "lease",
      leaseExpiresAt: "2026-11-03T17:01:00.000Z",
      attemptCount: 1,
      voice: null,
      referenceTime: initial.createdAt,
    })),
    finish: vi.fn(
      async (
        _user: string,
        _id: string,
        _lease: string,
        input: {
          proposals?: ReturnType<typeof parseCaptureProposals>;
          errorCode?: string;
        },
      ) =>
        capture({
          state: "needs_review",
          actions: input.proposals
            ? actions(input.proposals.map(({ kind, args }) => ({ kind, args })))
            : [],
          revision: 2,
        }),
    ),
    confirm: vi.fn(
      async (
        _user: string,
        _id: string,
        _input: CaptureConfirmRequest,
        _options: CaptureConfirmOptions,
      ) => capture({ state: "completed", revision: 3 }),
    ),
    cancel: vi.fn(async () => capture({ state: "cancelled" })),
    archive: vi.fn(async () => capture({ archivedAt: now.toISOString() })),
    delete: vi.fn(async () => {}),
    claimNext: vi.fn(
      async () =>
        null as {
          userId: string;
          job: Awaited<ReturnType<CaptureServiceStore["claim"]>> & {};
        } | null,
    ),
    markExternalAttempt: vi.fn(async () => {}),
    sweep: vi.fn(async () => ({ scrubbed: 0 })),
  };
  const store = {
    captureInbox: ports,
    resolveUserById: vi.fn(async () => user),
    getLmsConnection: vi.fn(async () => ({
      state: "not_configured",
      lastSyncSuccessAt: null,
    })),
    getIdealHumanDays: vi.fn(async (): Promise<IdealHumanDay[]> => []),
    createTask: vi.fn(),
    createLifeEntity: vi.fn(),
  };
  const service = new CaptureService({
    store: store as unknown as LifeOSStore,
    config: { enabled: true, workerEnabled: false, memoryDeleteEnabled: false },
    now: () => now,
  });
  return { service, store, ports };
}

describe("capture service authorization and deterministic processing", () => {
  it("rejects inactive owners before any capture access", async () => {
    const f = fixture();
    await expect(
      f.service.search({ ...user, status: "blocked" }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(f.ports.search).not.toHaveBeenCalled();
  });
  it("rejects credential text and caller-selected identity before persistence", async () => {
    const f = fixture();
    await expect(
      f.service.ingest(
        user,
        {
          requestId: "capture-1",
          inputType: "text",
          text: "password: do-not-store",
        },
        "tma",
      ),
    ).rejects.toThrow();
    await expect(
      f.service.ingest(
        user,
        {
          requestId: "capture-1",
          inputType: "text",
          text: "an idea",
          userId: "foreign",
        },
        "tma",
      ),
    ).rejects.toThrow();
    expect(f.ports.ingest).not.toHaveBeenCalled();
  });
  it("persists then proposes text without executing any domain action", async () => {
    const f = fixture();
    const value = await f.service.ingest(
      user,
      {
        requestId: "capture-1",
        inputType: "text",
        text: "Add task DBMS",
        retentionDays: null,
      },
      "tma",
    );
    expect(value.created).toBe(true);
    expect(f.ports.ingest).toHaveBeenCalledWith(
      owner,
      expect.objectContaining({ source: "tma", requestId: "capture-1" }),
    );
    expect(f.ports.finish.mock.calls[0][3].proposals?.[0]).toMatchObject({
      kind: "task.create",
      args: { title: "DBMS" },
    });
    expect(f.ports.confirm).not.toHaveBeenCalled();
    expect(f.store.createTask).not.toHaveBeenCalled();
    expect(f.store.createLifeEntity).not.toHaveBeenCalled();
  });
  it("does not process duplicate ingestion", async () => {
    const f = fixture();
    f.ports.ingest.mockResolvedValue({ capture: capture(), created: false });
    await f.service.ingest(
      user,
      { requestId: "capture-1", inputType: "text", text: "Add task DBMS" },
      "telegram",
    );
    expect(f.ports.claim).not.toHaveBeenCalled();
    expect(f.ports.finish).not.toHaveBeenCalled();
  });
  it("retains a persisted queue when request processing becomes unavailable", async () => {
    const f = fixture();
    f.ports.claim.mockRejectedValue(new Error("private storage detail"));
    const result = await f.service.ingest(
      user,
      { requestId: "capture-1", inputType: "text", text: "Add task DBMS" },
      "tma",
    );
    expect(result.capture.state).toBe("queued");
    expect(result.created).toBe(true);
  });
  it("anchors relative dates to original event time across midnight and restarts", async () => {
    const f = fixture(capture({ text: "Tomorrow I want to go to the gym" }));
    f.ports.claim.mockResolvedValue({
      capture: capture({ text: "Tomorrow I want to go to the gym" }),
      leaseToken: "lease",
      leaseExpiresAt: "2026-11-04T01:00:00Z",
      attemptCount: 2,
      voice: null,
      referenceTime: "2026-11-02T18:59:59Z",
    });
    await f.service.process(user, id);
    expect(f.ports.finish.mock.calls[0][3].proposals?.[0]).toMatchObject({
      kind: "planning.suggest",
      args: { date: "2026-11-03" },
    });
  });
  it("keeps voice unavailable with no processing or external call", async () => {
    const f = fixture(
      capture({ inputType: "voice", text: "", state: "awaiting_transcript" }),
    );
    const fetcher = vi.spyOn(globalThis, "fetch");
    try {
      await f.service.ingest(
        user,
        { requestId: "capture-1", inputType: "voice", text: "" },
        "telegram",
        {
          voice: {
            fileId: "private",
            fileUniqueId: "stable",
            durationSeconds: 12,
            mimeType: "audio/ogg",
            fileSize: 2000,
            referenceExpiresAt: "2026-11-04T16:00:00Z",
          },
        },
      );
      expect(f.service.capabilities().transcription).toBe("unavailable");
      expect(f.ports.claim).not.toHaveBeenCalled();
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      fetcher.mockRestore();
    }
  });
  it("rejects browser-supplied voice without trusted Telegram metadata", async () => {
    const f = fixture();
    await expect(
      f.service.ingest(
        user,
        { requestId: "capture-1", inputType: "voice", text: "" },
        "web",
      ),
    ).rejects.toThrow();
    expect(f.ports.ingest).not.toHaveBeenCalled();
  });
});

describe("reviewed action execution", () => {
  it("forwards only the selected stored action IDs into atomic confirmation", async () => {
    const f = fixture(
      capture({
        state: "needs_review",
        actions: actions([
          {
            kind: "note.save",
            args: { title: "An idea", content: "private thought" },
          },
          { kind: "water.log", args: { amountMl: 250 } },
        ]),
      }),
    );
    await f.service.confirm(user, id, {
      requestId: "confirm-1",
      expectedRevision: 1,
      actionIds: ["action-2"],
      confirmed: true,
    });
    expect(f.ports.confirm).toHaveBeenCalledWith(
      owner,
      id,
      expect.objectContaining({ actionIds: ["action-2"], confirmed: true }),
      { allowMemoryDelete: false, readResults: [] },
    );
    expect(f.store.createTask).not.toHaveBeenCalled();
  });
  it("requires explicit confirmation and forbids client execution options", async () => {
    const f = fixture();
    for (const change of [
      { confirmed: false },
      { journalEntries: [] },
      { allowMemoryDelete: true },
    ]) {
      await expect(
        f.service.confirm(user, id, {
          requestId: "confirm-1",
          expectedRevision: 1,
          actionIds: ["action-1"],
          confirmed: true,
          ...change,
        }),
      ).rejects.toThrow();
    }
    expect(f.ports.confirm).not.toHaveBeenCalled();
  });
  it("honors the existing destructive-memory permission", async () => {
    const f = fixture(
      capture({
        actions: actions([
          { kind: "memory.delete", args: { key: "gym_time" } },
        ]),
      }),
    );
    await expect(
      f.service.confirm(user, id, {
        requestId: "confirm-1",
        expectedRevision: 1,
        actionIds: ["action-1"],
        confirmed: true,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(f.ports.confirm).not.toHaveBeenCalled();
  });
  it("preserves unrelated journal facts and prepares sequential CAS within one confirmation", async () => {
    const day = {
      ...emptyIdealHumanDay("2026-11-03"),
      revision: 4,
      highlights: "existing private highlight",
      workoutNotes: "existing workout",
    };
    const f = fixture(
      capture({
        actions: actions([
          {
            kind: "filming.idea",
            args: { date: day.date, content: "Film the walk" },
          },
          {
            kind: "reflection.add",
            args: { date: day.date, content: "a reflection" },
          },
        ]),
      }),
    );
    f.store.getIdealHumanDays.mockResolvedValue([day]);
    await f.service.confirm(user, id, {
      requestId: "confirm-1",
      expectedRevision: 1,
      actionIds: ["action-2", "action-1"],
      confirmed: true,
    });
    const prepared = (
      f.ports.confirm.mock.calls[0] as unknown as [
        string,
        string,
        unknown,
        {
          journalEntries: Array<{
            expectedRevision: number;
            entry: typeof day;
          }>;
        },
      ]
    )[3].journalEntries;
    expect(prepared.map((entry) => entry.expectedRevision)).toEqual([4, 5]);
    expect(prepared[1].entry.highlights).toBe(day.highlights);
    expect(prepared[1].entry.workoutNotes).toBe(day.workoutNotes);
    expect(prepared[1].entry.storyboard).toContain("Film the walk");
    expect(prepared[1].entry.notes).toContain("a reflection");
    expect(prepared[1].entry.footageCaptured).toBeNull();
    expect(prepared[1].entry.footage).toEqual(day.footage);
  });
  it("uses only existing read tools for question answers", async () => {
    const f = fixture(
      capture({
        actions: actions([
          {
            kind: "question.read",
            args: {
              text: "Show tasks",
              tool: { tool: "productivity.tasks", args: {} },
            },
          },
        ]),
      }),
    );
    const execute = vi.fn(async () => ({
      text: "Only saved tasks",
      sources: [],
    }));
    const service = new CaptureService({
      store: f.store as unknown as LifeOSStore,
      config: {
        enabled: true,
        workerEnabled: false,
        memoryDeleteEnabled: false,
      },
      assistant: { registry: { execute } } as unknown as AssistantBrain,
      now: () => now,
    });
    await service.confirm(user, id, {
      requestId: "confirm-1",
      expectedRevision: 1,
      actionIds: ["action-1"],
      confirmed: true,
    });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ user, allowDestructive: false }),
      { tool: "productivity.tasks", args: {} },
    );
    expect(f.store.createTask).not.toHaveBeenCalled();
  });
  it("rejects stale or expired approvals before reading journals", async () => {
    for (const patch of [
      { revision: 2 },
      { reviewExpiresAt: "2026-11-03T16:59:59.000Z" },
    ]) {
      const f = fixture(
        capture({
          actions: actions([
            {
              kind: "reflection.add",
              args: { date: "2026-11-03", content: "owner reflection" },
            },
          ]),
          ...patch,
        }),
      );
      await expect(
        f.service.confirm(user, id, {
          requestId: "confirm-1",
          expectedRevision: 1,
          actionIds: ["action-1"],
          confirmed: true,
        }),
      ).rejects.toMatchObject({ statusCode: 409 });
      expect(f.store.getIdealHumanDays).not.toHaveBeenCalled();
      expect(f.ports.confirm).not.toHaveBeenCalled();
    }
  });
  it("does not reread or rewrite a journal for an already committed action replay", async () => {
    const done = actions([
      {
        kind: "reflection.add",
        args: { date: "2026-11-03", content: "already saved" },
      },
    ]);
    done[0].status = "succeeded";
    const f = fixture(capture({ actions: done }));
    await f.service.confirm(user, id, {
      requestId: "confirm-1",
      expectedRevision: 1,
      actionIds: ["action-1"],
      confirmed: true,
    });
    expect(f.store.getIdealHumanDays).not.toHaveBeenCalled();
    expect(f.ports.confirm).toHaveBeenCalledOnce();
  });
});
