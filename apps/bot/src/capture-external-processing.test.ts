import { describe, expect, it, vi } from "vitest";
import {
  defaultAiRouterSettings,
  analyzeCaptureText,
  type AiBudgetStore,
  type CaptureView,
} from "@lifeos/core";
import {
  CaptureStoreError,
  type CaptureServiceStore,
  type LifeOSStore,
  type TelegramUserRecord,
} from "@lifeos/db";
import { AiGovernor, readAiGovernorConfig } from "./ai-governor.js";
import { AiModelRouter } from "./ai-model-router.js";
import { readAiModelRouterConfig } from "./ai-model-router-config.js";
import { processCaptureExternal } from "./capture-external-processing.js";
import { CaptureService } from "./capture-service.js";
import { loadPlanningData } from "./planning-context.js";
import { speechOgg } from "./capture-speech-provider.test-fixtures.js";
import { validateTelegramVoice } from "./telegram/voice.js";

const OWNER = "20000000-0000-4000-8000-000000000001";
const ID = "a0000000-bbbb-4000-8000-000000000001";
vi.mock("./planning-context.js", () => ({
  loadPlanningData: vi.fn(async () => ({
    events: [],
    plan: { warnings: [], rankedTasks: [] },
  })),
}));
const NOW = Date.parse("2026-11-04T12:00:00Z");
// An original Telegram event before midnight in Almaty, received/processed later.
const REFERENCE = "2026-11-03T18:59:59.000Z";
const SOURCE = "Tomorrow finish DBMS, go to the gym and film my vlog";
const TEXT_REPLY = JSON.stringify({
  actions: [
    {
      kind: "task.create",
      args: { title: "Finish DBMS", notes: "", dueAt: null },
    },
    {
      kind: "planning.suggest",
      args: {
        date: "2026-11-07",
        title: "Go to the gym",
        notes: "",
        time: null,
      },
    },
    {
      kind: "filming.idea",
      args: { date: "2026-11-07", content: "Film my vlog" },
    },
  ],
});
const user = {
  userId: OWNER,
  telegramUserId: 12345,
  timezone: "Asia/Almaty",
  status: "active",
} as TelegramUserRecord;
function capture(voice: boolean): CaptureView {
  return {
    id: ID,
    inputType: voice ? "voice" : "text",
    source: "telegram",
    sourceLabel: "Telegram",
    text: voice ? "[Voice note]" : SOURCE,
    transcript: null,
    state: voice ? "awaiting_transcript" : "needs_review",
    revision: 1,
    createdAt: "2026-11-04T00:00:00.000Z",
    updatedAt: "2026-11-04T00:00:00.000Z",
    archivedAt: null,
    expiresAt: null,
    reviewExpiresAt: null,
    errorCode: null,
    actions: [],
    context: {
      date: "2026-11-04",
      timezone: "Asia/Almaty",
      scheduleKnown: false,
      commitments: [],
      deadlines: [],
      suggestedOrder: [],
      warnings: [],
    },
  };
}
function fixture(voice = false) {
  let current: CaptureView | null = capture(voice);
  let activeOwner: TelegramUserRecord | null = { ...user };
  let heldLease: string | null = null;
  const original = structuredClone(current);
  const controller = new AbortController();
  const requests = new Set<string>();
  const reference = validateTelegramVoice(
    {
      file_id: "fixture-private-file",
      file_unique_id: "fixture-private-unique",
      duration: 1,
      mime_type: "audio/ogg",
      file_size: speechOgg().length,
    },
    Date.parse(REFERENCE) / 1000,
    new Date(NOW),
  );
  const claimExternal = vi.fn<
    NonNullable<CaptureServiceStore["claimExternal"]>
  >(async (owner, id, request) => {
    if (owner !== OWNER || id.toLowerCase() !== ID || !current)
      throw new CaptureStoreError("capture_not_found");
    if (requests.has(request.requestId)) return null;
    if (
      current.revision !== request.expectedRevision ||
      current.state === "processing"
    )
      throw new CaptureStoreError("capture_conflict");
    requests.add(request.requestId);
    heldLease = request.leaseToken;
    current = {
      ...current,
      state: "processing",
      revision: current.revision + 1,
    };
    return {
      capture: structuredClone(current),
      leaseToken: heldLease,
      leaseExpiresAt: new Date(NOW + 60000).toISOString(),
      attemptCount: 1,
      voice: voice ? reference : null,
      referenceTime: REFERENCE,
    };
  });
  const finish = vi.fn<CaptureServiceStore["finish"]>(
    async (owner, id, lease, result) => {
      if (owner !== OWNER || id.toLowerCase() !== ID || !current)
        throw new CaptureStoreError("capture_not_found");
      if (activeOwner?.status !== "active")
        throw new CaptureStoreError("capture_permission_denied");
      if (current.state !== "processing" || lease !== heldLease)
        throw new CaptureStoreError("capture_lease_lost");
      heldLease = null;
      current = {
        ...current,
        revision: current.revision + 1,
        state: result.errorCode
          ? "failed"
          : result.proposals?.length
            ? "needs_review"
            : "completed",
        errorCode: result.errorCode ?? result.fallbackCode ?? null,
        transcript: result.transcript ?? current.transcript,
        ...(result.transcriptSource
          ? { transcriptSource: result.transcriptSource }
          : {}),
        actions: (result.proposals ?? []).map((action) => ({
          ...action,
          status: action.missingFields.length
            ? ("needs_input" as const)
            : ("pending" as const),
          resultSummary: null,
          completedAt: null,
        })),
      };
      return structuredClone(current);
    },
  );
  const ports = {
    claimExternal,
    finish,
    get: vi.fn<CaptureServiceStore["get"]>(async (owner, id) =>
      owner === OWNER && id.toLowerCase() === ID
        ? structuredClone(current)
        : null,
    ),
  };
  const persistence = ports as unknown as CaptureServiceStore;
  const store = {
    resolveUserById: vi.fn(async (owner: string) =>
      owner === OWNER ? structuredClone(activeOwner) : null,
    ),
    createTask: vi.fn(),
    logHydration: vi.fn(),
    saveIdealHumanDay: vi.fn(),
    executeAssistantMutation: vi.fn(),
  };
  const settings = defaultAiRouterSettings();
  settings.allowedTiers = ["balanced", "voice"];
  settings.allowedProviders = ["openai"];
  settings.tierModels.balanced = ["intent"];
  settings.tierModels.voice = ["speech"];
  settings.privacy = {
    general: ["openai"],
    health: ["openai"],
    finance: ["openai"],
    university: ["openai"],
  };
  settings.spending = {
    paidCallsAuthorized: true,
    maxRequestCostMicros: 10000,
    maxDailyCostMicros: 100000,
  };
  const metadata = {
    provider: "openai",
    billing: "api",
    verifiedAt: new Date(NOW).toISOString(),
    credentialIds: ["fixture-key"],
    providerOnly: [],
    sort: "price",
    requireZdr: true,
    source: "https://developers.openai.com/api/docs/models/gpt-transcribe",
  };
  const config = readAiModelRouterConfig(
    {
      LIFEOS_AI_ROUTER_ENABLED: "true",
      LIFEOS_AI_ROUTER_PAID_REQUESTS_ENABLED: "true",
      LIFEOS_AI_ROUTER_MAX_REQUEST_COST_MICROS: "10000",
      LIFEOS_AI_ROUTER_MAX_DAILY_COST_MICROS: "100000",
      LIFEOS_AI_ROUTER_MAX_OUTPUT_TOKENS: "4096",
      OPENAI_API_KEY: "sk-synthetic-capture-integration-only",
      LIFEOS_AI_ROUTER_CREDENTIALS_JSON: JSON.stringify([
        {
          id: "fixture-key",
          provider: "openai",
          ownerUserId: OWNER,
          features: ["classification"],
          env: "OPENAI_API_KEY",
        },
      ]),
      LIFEOS_AI_ROUTER_MODELS_JSON: JSON.stringify([
        {
          ...metadata,
          id: "intent",
          label: "Synthetic intent model",
          model: "fixture-intent",
          tiers: ["balanced"],
          capabilities: ["text", "json"],
          inputCostMicrosPer1k: 1,
          outputCostMicrosPer1k: 1,
        },
        {
          ...metadata,
          id: "speech",
          label: "Synthetic speech model",
          model: "gpt-transcribe",
          tiers: ["voice"],
          capabilities: ["audio"],
          inputCostMicrosPer1k: null,
          outputCostMicrosPer1k: null,
          audioCostMicrosPerMinute: 4500,
        },
      ]),
    },
    NOW,
  );
  const budget: AiBudgetStore = {
    reserve: vi.fn<AiBudgetStore["reserve"]>(async () => "reserved"),
    finish: vi.fn(async () => {}),
  };
  const governor = new AiGovernor({
    store: budget,
    config: { ...readAiGovernorConfig({}), timeoutMs: 1000 },
  });
  let modelText = TEXT_REPLY;
  const fetcher = vi.fn<typeof fetch>(async (url) => {
    if (url === "https://api.openai.com/v1/audio/transcriptions")
      return Response.json({
        text: SOURCE,
        languages: [{ code: "en" }],
        usage: { type: "duration", seconds: 1 },
      });
    if (url === "https://api.openai.com/v1/chat/completions")
      return Response.json({
        model: "fixture-intent",
        choices: [
          {
            finish_reason: "stop",
            message: { role: "assistant", content: modelText },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      });
    throw new Error("Unexpected mocked provider endpoint");
  });
  const router = new AiModelRouter(config, {
    governor,
    settings: {
      get: vi.fn(async () => ({
        settings: structuredClone(settings),
        revision: 7,
      })),
      save: vi.fn(async () => {
        throw new Error("Unused settings mutation");
      }),
    },
    fetchImpl: fetcher,
    now: () => NOW,
  });
  const execute = vi.spyOn(router, "execute");
  const prepareSpeech = vi.spyOn(router, "prepareSpeech");
  const audio = { bytes: speechOgg(), mimeType: "audio/ogg" as const };
  const download = vi.fn(async () => audio);
  const onClaim =
    vi.fn<
      NonNullable<Parameters<typeof processCaptureExternal>[0]["onClaim"]>
    >();
  const input = {
    user,
    capture: original,
    request: {
      requestId: "external-fixture-one",
      expectedRevision: 1,
      mode: voice ? ("transcription" as const) : ("model" as const),
      confirmed: true as const,
    },
    store: store as unknown as LifeOSStore,
    persistence,
    router,
    governor,
    download,
    signal: controller.signal,
    now: () => new Date(NOW),
    onClaim,
  };
  return {
    input,
    ports,
    store,
    config,
    settings,
    router,
    execute,
    prepareSpeech,
    fetcher,
    budget,
    download,
    audio,
    controller,
    onClaim,
    original,
    run: () => processCaptureExternal(input),
    read: () => structuredClone(current),
    blockOwner() {
      activeOwner = { ...user, status: "blocked" };
    },
    cancel(abort = false) {
      if (current)
        current = {
          ...current,
          state: "cancelled",
          revision: current.revision + 1,
        };
      heldLease = null;
      if (abort) controller.abort();
    },
    modelReply(text: string) {
      modelText = text;
    },
    editCurrent(patch: Partial<CaptureView>) {
      if (current) current = { ...current, ...patch };
    },
  };
}

function serviceFixture(voice = true) {
  const f = fixture(voice);
  const cancel = vi.fn<CaptureServiceStore["cancel"]>(
    async (owner, id, revision) => {
      const current = f.read();
      if (owner !== OWNER || id.toLowerCase() !== ID || !current)
        throw new CaptureStoreError("capture_not_found");
      if (current.revision !== revision)
        throw new CaptureStoreError("capture_conflict");
      f.cancel();
      return f.read()!;
    },
  );
  const edit = vi.fn<CaptureServiceStore["edit"]>(
    async (owner, id, request) => {
      const current = f.read();
      if (owner !== OWNER || id.toLowerCase() !== ID || !current)
        throw new CaptureStoreError("capture_not_found");
      if (current.revision !== request.expectedRevision)
        throw new CaptureStoreError("capture_conflict");
      f.editCurrent({
        state: "queued",
        revision: current.revision + 1,
        transcript: request.transcript ?? current.transcript,
        transcriptSource: "manual",
      });
      return f.read()!;
    },
  );
  const store = {
    ...f.store,
    captureInbox: {
      ...f.ports,
      cancel,
      edit,
      claim: vi.fn<CaptureServiceStore["claim"]>(async () => null),
    },
    getLmsConnection: vi.fn(async () => ({
      state: "not_configured",
      lastSyncSuccessAt: null,
    })),
    getIdealHumanDays: vi.fn(async () => []),
  };
  const service = new CaptureService({
    store: store as unknown as LifeOSStore,
    config: {
      enabled: true,
      workerEnabled: false,
      memoryDeleteEnabled: false,
      aiExtractionEnabled: true,
      transcriptionEnabled: true,
    },
    router: f.router,
    governor: f.input.governor,
    voiceDownload: f.download,
    now: f.input.now,
  });
  return { ...f, service, cancel, edit };
}

function deferredProvider(f: ReturnType<typeof serviceFixture>) {
  let resolve!: (response: Response) => void;
  const pending = new Promise<Response>((done) => {
    resolve = done;
  });
  const signals: AbortSignal[] = [];
  f.fetcher.mockImplementation(async (_url, request) => {
    if (!(request?.signal instanceof AbortSignal))
      throw new Error("Expected real execution cancellation signal");
    signals.push(request.signal);
    return pending;
  });
  return {
    signals,
    resolve: () =>
      resolve(
        Response.json({
          text: SOURCE,
          languages: [{ code: "en" }],
          usage: { type: "duration", seconds: 1 },
        }),
      ),
  };
}

describe("actual asynchronous CaptureService lifecycle", () => {
  it("canonicalizes mixed-case UUIDs for exclusion/cancel, drops late speech and releases the active record", async () => {
    const f = serviceFixture();
    const provider = deferredProvider(f);
    try {
      const started = await f.service.external(
        user,
        ID.toUpperCase(),
        f.input.request,
      );
      expect(started).toMatchObject({
        id: ID,
        state: "processing",
        revision: 2,
      });
      await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledOnce());
      await expect(
        f.service.external(user, ID, {
          ...f.input.request,
          requestId: "different-request-two",
          expectedRevision: 2,
        }),
      ).rejects.toMatchObject({ code: "capture_conflict" });
      expect(f.ports.claimExternal).toHaveBeenCalledOnce();
      expect(f.fetcher).toHaveBeenCalledOnce();
      const cancelled = await f.service.cancel(user, ID, 2);
      expect(cancelled).toMatchObject({ state: "cancelled", revision: 3 });
      expect(provider.signals[0].aborted).toBe(true);
      provider.resolve();
      await vi.waitFor(() => expect(f.budget.finish).toHaveBeenCalledOnce());
      expect(f.read()).toMatchObject({
        state: "cancelled",
        transcript: null,
        revision: 3,
        actions: [],
      });
      expect(f.audio.bytes.every((byte) => byte === 0)).toBe(true);
      // Simulate the owner's explicit manual retry, then prove the old controller slot is gone.
      f.editCurrent({ state: "awaiting_transcript", revision: 4 });
      f.download.mockImplementation(async () => ({
        bytes: speechOgg(),
        mimeType: "audio/ogg" as const,
      }));
      f.fetcher.mockImplementation(async () =>
        Response.json({
          text: SOURCE,
          languages: [{ code: "en" }],
          usage: { type: "duration", seconds: 1 },
        }),
      );
      await vi.waitFor(async () => {
        const next = await f.service.external(user, ID.toUpperCase(), {
          ...f.input.request,
          requestId: "fresh-owner-retry-three",
          expectedRevision: 4,
        });
        expect(["processing", "needs_review"]).toContain(next.state);
      });
      await vi.waitFor(() => expect(f.read()?.state).toBe("needs_review"));
      expect(f.fetcher).toHaveBeenCalledTimes(2);
      expect(f.ports.claimExternal).toHaveBeenCalledTimes(2);
      expect(f.store.createTask).not.toHaveBeenCalled();
    } finally {
      provider.resolve();
      f.service.stop();
    }
  });
  it("stop aborts real in-flight provider signals and refuses new external work", async () => {
    const f = serviceFixture();
    const provider = deferredProvider(f);
    try {
      await f.service.external(user, ID.toUpperCase(), f.input.request);
      await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledOnce());
      f.service.stop();
      expect(provider.signals[0].aborted).toBe(true);
      await expect(
        f.service.external(user, ID, {
          ...f.input.request,
          requestId: "after-stop-request-two",
          expectedRevision: 2,
        }),
      ).rejects.toMatchObject({ code: "capture_external_unavailable" });
      provider.resolve();
      await vi.waitFor(() => expect(f.read()?.state).toBe("failed"));
      expect(f.read()).toMatchObject({
        text: "[Voice note]",
        transcript: null,
        errorCode: "voice_cancelled",
        actions: [],
      });
      expect(f.audio.bytes.every((byte) => byte === 0)).toBe(true);
      expect(f.fetcher).toHaveBeenCalledOnce();
    } finally {
      provider.resolve();
      f.service.stop();
    }
  });
  it("a successful manual transcript edit aborts superseded inference and keeps the manual text", async () => {
    const f = serviceFixture();
    const provider = deferredProvider(f);
    try {
      await f.service.external(user, ID.toUpperCase(), f.input.request);
      await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledOnce());
      const edited = await f.service.edit(user, ID, {
        expectedRevision: 2,
        transcript: "Tomorrow finish DBMS manually",
      });
      expect(provider.signals[0].aborted).toBe(true);
      provider.resolve();
      await vi.waitFor(() => expect(f.budget.finish).toHaveBeenCalledOnce());
      expect(edited.transcript).toBe("Tomorrow finish DBMS manually");
      expect(f.read()).toMatchObject({
        transcript: "Tomorrow finish DBMS manually",
        transcriptSource: "manual",
        state: "queued",
      });
      expect(
        f.ports.finish.mock.calls.every((call) => !call[3].transcript),
      ).toBe(true);
    } finally {
      provider.resolve();
      f.service.stop();
    }
  });
  it.each([
    ["Ертең DBMS тапсырмасын бітіру керек", new Date(NOW), "2026-11-05"],
    ["Tomorrow finish DBMS", new Date(REFERENCE), "2026-11-04"],
  ] as const)(
    "uses trusted task proposal dates for context: %s",
    async (text, anchor, date) => {
      const f = serviceFixture(false);
      const actions = analyzeCaptureText(text, {
        now: anchor,
        timezone: "Asia/Almaty",
      }).proposals.map((action) => ({
        ...action,
        status: "pending" as const,
        resultSummary: null,
        completedAt: null,
      }));
      expect(actions).toHaveLength(1);
      expect(actions[0].kind).toBe("task.create");
      expect(actions[0].presentation?.suggestedDate).toBe(date);
      f.editCurrent({ text, actions });
      vi.mocked(loadPlanningData).mockClear();
      const value = await f.service.get(user, ID);
      expect(value.context).toMatchObject({ date, timezone: "Asia/Almaty" });
      expect(loadPlanningData).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ userId: OWNER, timezone: "Asia/Almaty" }),
        date,
        expect.any(Date),
      );
      expect(f.fetcher).not.toHaveBeenCalled();
      expect(f.ports.claimExternal).not.toHaveBeenCalled();
      f.service.stop();
    },
  );
});

describe("explicit capture external processing with real policy/governor and mock transports", () => {
  it("uses classification/all privacy categories, reviewed policy revision and a20-second trusted deadline", async () => {
    const f = fixture();
    const value = await f.run();
    expect(f.execute).toHaveBeenCalledOnce();
    expect(f.execute.mock.calls[0][0]).toMatchObject({
      userId: OWNER,
      feature: "classification",
      task: {
        category: "document_extraction",
        dataCategories: expect.arrayContaining([
          "general",
          "health",
          "finance",
          "university",
        ]),
      },
      expectedSettingsRevision: 7,
      timeoutMs: 20000,
      taskId: ID,
      requestId: expect.stringMatching(/^capture:model:[a-f0-9]{64}$/),
    });
    expect(f.ports.claimExternal).toHaveBeenCalledWith(
      OWNER,
      ID,
      expect.objectContaining({
        expectedRevision: 1,
        requestId: "external-fixture-one",
        policy: expect.objectContaining({
          settingsRevision: 7,
          modelId: "intent",
          provider: "openai",
        }),
      }),
    );
    expect(f.onClaim).toHaveBeenCalledWith(
      expect.objectContaining({ state: "processing", revision: 2 }),
    );
    expect(f.budget.reserve).toHaveBeenCalledOnce();
    expect(f.fetcher).toHaveBeenCalledOnce();
    expect(value.actions).toHaveLength(3);
    expect(
      value.actions.every(
        (action) => action.origin === "model" && action.status !== "succeeded",
      ),
    ).toBe(true);
    expect(value.text).toBe(SOURCE);
    expect(f.store.createTask).not.toHaveBeenCalled();
    expect(f.store.logHydration).not.toHaveBeenCalled();
    expect(f.store.saveIdealHumanDay).not.toHaveBeenCalled();
    expect(f.store.executeAssistantMutation).not.toHaveBeenCalled();
  });
  it("anchors the prompt, model dates and deterministic fallback to the original job event time", async () => {
    for (const malformed of [false, true]) {
      const f = fixture();
      if (malformed) f.modelReply("invalid model JSON");
      const value = await f.run();
      const data = JSON.parse(
        f.execute.mock.calls[0][0].messages[1].content as string,
      );
      expect(data.referenceTime).toBe(REFERENCE);
      expect(
        value.actions.find((a) => a.kind === "planning.suggest")?.args,
      ).toMatchObject({ date: "2026-11-04", time: null });
      expect(
        value.actions.find((a) => a.kind === "filming.idea")?.args,
      ).toMatchObject({ date: "2026-11-04" });
      if (malformed) expect(value.errorCode).toBe("capture_model_fallback");
    }
  });
  it("falls back to deterministic review on invalid JSON/provider errors without rewriting the original", async () => {
    for (const fail of [false, true]) {
      const f = fixture();
      if (fail)
        f.fetcher.mockImplementation(
          async () => new Response("private upstream failure", { status: 500 }),
        );
      else f.modelReply('{"actions":[{"kind":"arbitrary.execute","args":{}}]}');
      const value = await f.run();
      expect(value.errorCode).toBe("capture_model_fallback");
      expect(value.text).toBe(SOURCE);
      expect(value.actions).toHaveLength(3);
      expect(value.actions.every((a) => a.origin === "deterministic")).toBe(
        true,
      );
      expect(f.fetcher).toHaveBeenCalledOnce();
      expect(f.ports.finish).toHaveBeenCalledOnce();
      expect(f.download).not.toHaveBeenCalled();
      expect(f.store.createTask).not.toHaveBeenCalled();
    }
  });
  it("does not execute again when the durable claim says the same request was already handled", async () => {
    const f = fixture();
    const first = await f.run();
    const again = await f.run();
    expect(again).toEqual(first);
    expect(f.execute).toHaveBeenCalledOnce();
    expect(f.fetcher).toHaveBeenCalledOnce();
    expect(f.budget.reserve).toHaveBeenCalledOnce();
  });
  it("rejects stale revisions and archived/already-approved records before any claim or provider call", async () => {
    for (const patch of [
      { revision: 2 },
      { archivedAt: new Date(NOW).toISOString() },
      {
        actions: [
          {
            id: "action-1",
            kind: "note.save",
            args: { title: "Already saved", content: "Saved" },
            origin: "deterministic",
            summary: "Saved",
            missingFields: [],
            status: "succeeded",
            resultSummary: "Saved",
            completedAt: new Date(NOW).toISOString(),
          },
        ],
      },
    ] as Partial<CaptureView>[]) {
      const f = fixture();
      Object.assign(f.input.capture, patch);
      await expect(f.run()).rejects.toMatchObject({
        code: "capture_conflict",
        statusCode: 409,
      });
      expect(f.ports.claimExternal).not.toHaveBeenCalled();
      expect(f.fetcher).not.toHaveBeenCalled();
    }
  });
  it.each(["general", "health", "finance", "university"] as const)(
    "never dispatches STT without %s privacy permission",
    async (category) => {
      const f = fixture(true);
      f.settings.privacy[category] = [];
      await expect(f.run()).rejects.toMatchObject({
        code: "ai_router_privacy_not_allowed",
      });
      expect(f.ports.claimExternal).not.toHaveBeenCalled();
      expect(f.budget.reserve).not.toHaveBeenCalled();
      expect(f.download).not.toHaveBeenCalled();
      expect(f.fetcher).not.toHaveBeenCalled();
      expect(f.read()?.text).toBe("[Voice note]");
    },
  );
  it("keeps pre-cancelled and blocked-owner STT at zero downloads/provider calls", async () => {
    const cancelled = fixture(true);
    cancelled.controller.abort();
    await expect(cancelled.run()).rejects.toMatchObject({
      code: "ai_cancelled",
    });
    expect(cancelled.ports.claimExternal).not.toHaveBeenCalled();
    expect(cancelled.download).not.toHaveBeenCalled();
    expect(cancelled.fetcher).not.toHaveBeenCalled();
    const blocked = fixture(true);
    blocked.onClaim.mockImplementation(() => blocked.blockOwner());
    await expect(blocked.run()).rejects.toMatchObject({
      code: "capture_permission_denied",
    });
    expect(blocked.budget.reserve).not.toHaveBeenCalled();
    expect(blocked.download).not.toHaveBeenCalled();
    expect(blocked.fetcher).not.toHaveBeenCalled();
    expect(blocked.read()?.text).toBe("[Voice note]");
  });
  it("cancels a just-claimed STT job without downloading or publishing and preserves the cancelled revision", async () => {
    const f = fixture(true);
    f.onClaim.mockImplementation(() => f.cancel(true));
    const value = await f.run();
    expect(value.state).toBe("cancelled");
    expect(value.revision).toBe(3);
    expect(f.download).not.toHaveBeenCalled();
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(f.budget.reserve).not.toHaveBeenCalled();
  });
  it("runs the actual native speech adapter through exactly one governor reservation before memory-only download", async () => {
    const f = fixture(true);
    const value = await f.run();
    expect(f.prepareSpeech).toHaveBeenCalledOnce();
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.budget.reserve).toHaveBeenCalledOnce();
    expect(f.budget.reserve).toHaveBeenCalledBefore(f.download);
    expect(f.download).toHaveBeenCalledOnce();
    expect(f.fetcher).toHaveBeenCalledOnce();
    expect(f.fetcher.mock.calls[0][0]).toBe(
      "https://api.openai.com/v1/audio/transcriptions",
    );
    expect(value).toMatchObject({
      text: "[Voice note]",
      transcript: SOURCE,
      transcriptSource: "provider",
      state: "needs_review",
    });
    expect(value.actions).toHaveLength(3);
    expect(
      value.actions.every(
        (a) => a.origin === "deterministic" && a.status !== "succeeded",
      ),
    ).toBe(true);
    expect(
      value.actions.find((a) => a.kind === "filming.idea")?.args,
    ).toMatchObject({ date: "2026-11-04" });
    expect(f.audio.bytes.every((byte) => byte === 0)).toBe(true);
    expect(JSON.stringify(value)).not.toContain("fixture-private-file");
    expect(f.store.createTask).not.toHaveBeenCalled();
    expect(f.store.saveIdealHumanDay).not.toHaveBeenCalled();
  });
  it("preserves the manual transcript path and original voice history after a provider quota error", async () => {
    const f = fixture(true);
    f.fetcher.mockImplementation(
      async () => new Response("private quota body", { status: 429 }),
    );
    const value = await f.run();
    expect(value).toMatchObject({
      text: "[Voice note]",
      transcript: null,
      state: "failed",
      errorCode: "voice_quota_exceeded",
    });
    expect(f.fetcher).toHaveBeenCalledOnce();
    expect(f.download).toHaveBeenCalledOnce();
    expect(f.audio.bytes.every((byte) => byte === 0)).toBe(true);
    expect(f.store.createTask).not.toHaveBeenCalled();
  });
  it("fences model output if the record is cancelled while the provider is in flight", async () => {
    const f = fixture();
    f.fetcher.mockImplementation(async () => {
      f.cancel();
      return Response.json({
        model: "fixture-intent",
        choices: [
          {
            finish_reason: "stop",
            message: { role: "assistant", content: TEXT_REPLY },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      });
    });
    const value = await f.run();
    expect(value.state).toBe("cancelled");
    expect(value.actions).toEqual([]);
    expect(f.fetcher).toHaveBeenCalledOnce();
    expect(f.store.createTask).not.toHaveBeenCalled();
    expect(f.ports.finish.mock.calls.every((call) => !call[3].proposals)).toBe(
      true,
    );
  });
});
