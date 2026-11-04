import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import {
  analyzeCaptureText,
  captureActionMissingFields,
  captureActionSummary,
  type CaptureView,
} from "@lifeos/core";
import {
  CaptureStoreError,
  type CaptureServiceStore,
  type LifeOSStore,
  type TelegramUserRecord,
} from "@lifeos/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiModelRouter } from "./ai-model-router.js";
import { CaptureService } from "./capture-service.js";
import { createBotServer } from "./server.js";
import { createWebSessionToken, hashWebToken } from "./web-session.js";
import type { TelegramClient } from "./telegram/types.js";

vi.mock("./planning-context.js", () => ({
  loadPlanningData: vi.fn(async () => ({
    events: [],
    plan: { warnings: [], rankedTasks: [] },
  })),
}));

const OWNER = "30000000-0000-4000-8000-000000000001",
  OTHER = "30000000-0000-4000-8000-000000000002";
const RECORD = "40000000-0000-4000-8000-000000000001",
  FOREIGN = "40000000-0000-4000-8000-000000000002",
  CREATED = "40000000-0000-4000-8000-000000000003",
  MISSING = "40000000-0000-4000-8000-000000000099";
const BOT = "nighthawk2-http-synthetic-bot",
  ORIGIN = "https://lifeos.test";
const ORIGINAL =
  "Завтра после университета нужно потренироваться, закончить DBMS и снять пару кадров для Ideal Human.";
const now = new Date("2026-11-04T03:00:00Z");
const servers: ReturnType<typeof createBotServer>[] = [];
const nativeFetch = globalThis.fetch.bind(globalThis);

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
          server.closeAllConnections();
        }),
    ),
  );
  vi.restoreAllMocks();
});

function signed(id = 30) {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id, first_name: "Synthetic Nighthawk2 owner" }),
  });
  const data = [...params]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const key = createHmac("sha256", "WebAppData").update(BOT).digest();
  params.set("hash", createHmac("sha256", key).update(data).digest("hex"));
  return {
    "content-type": "application/json",
    "x-telegram-init-data": params.toString(),
  };
}

async function fixture(externalEnabled = false) {
  const users = new Map<number, TelegramUserRecord>(
    [30, 31].map((telegramUserId, index) => [
      telegramUserId,
      {
        userId: index ? OTHER : OWNER,
        telegramUserId,
        displayName: "Synthetic Nighthawk2",
        username: null,
        timezone: "Asia/Almaty",
        status: "active",
        role: "user",
      },
    ]),
  );
  const make = (id: string, text: string): CaptureView => ({
    id,
    inputType: "text",
    source: "tma",
    sourceLabel: "Telegram Mini App",
    text,
    transcript: null,
    state: "needs_review",
    revision: 1,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    archivedAt: null,
    expiresAt: null,
    reviewExpiresAt: new Date(Date.now() + 600000).toISOString(),
    errorCode: null,
    actions: analyzeCaptureText(text, {
      now,
      timezone: "Asia/Almaty",
    }).proposals.map((action) => ({
      ...action,
      extractionOrigin: "deterministic",
      status: action.missingFields.length ? "needs_input" : "pending",
      resultSummary: null,
      completedAt: null,
    })),
  });
  const rows = new Map([
    [RECORD, { owner: OWNER, capture: make(RECORD, ORIGINAL) }],
    [
      FOREIGN,
      { owner: OTHER, capture: make(FOREIGN, "task: Foreign private text") },
    ],
  ]);
  const owned = (userId: string, id: string) => {
    const row = rows.get(id);
    if (!row || row.owner !== userId)
      throw new CaptureStoreError("capture_not_found");
    return row.capture;
  };
  const copy = (userId: string, id: string) =>
    structuredClone(owned(userId, id));
  const leases = new Map<string, string>();
  const ports = {
    search: vi.fn(async (userId: string) => ({
      captures: [...rows.values()]
        .filter((row) => row.owner === userId)
        .map((row) => structuredClone(row.capture)),
      nextCursor: null,
    })),
    get: vi.fn(async (userId: string, id: string) =>
      rows.get(id)?.owner === userId ? copy(userId, id) : null,
    ),
    ingest: vi.fn<NonNullable<CaptureServiceStore["ingest"]>>(
      async (userId, input) => {
        const capture = {
          ...make(CREATED, input.text),
          source: input.source,
          state: "queued" as const,
          actions: [],
        };
        rows.set(CREATED, { owner: userId, capture });
        return { capture: structuredClone(capture), created: true };
      },
    ),
    claim: vi.fn<NonNullable<CaptureServiceStore["claim"]>>(
      async (userId, id, leaseToken) => {
        const capture = owned(userId, id);
        if (capture.state !== "queued") return null;
        capture.state = "processing";
        capture.revision++;
        leases.set(id, leaseToken);
        return {
          capture: copy(userId, id),
          leaseToken,
          leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
          attemptCount: 1,
          voice: null,
          referenceTime: now.toISOString(),
        };
      },
    ),
    finish: vi.fn<NonNullable<CaptureServiceStore["finish"]>>(
      async (userId, id, leaseToken, input) => {
        const capture = owned(userId, id);
        if (leases.get(id) !== leaseToken)
          throw new CaptureStoreError("capture_lease_lost");
        capture.actions = (input.proposals ?? []).map((action) => ({
          ...action,
          extractionOrigin:
            action.origin === "model" ? "model" : "deterministic",
          status: action.missingFields.length ? "needs_input" : "pending",
          resultSummary: null,
          completedAt: null,
        }));
        capture.state = "needs_review";
        capture.revision++;
        capture.reviewExpiresAt = new Date(Date.now() + 600000).toISOString();
        return copy(userId, id);
      },
    ),
    revise: vi.fn<NonNullable<CaptureServiceStore["revise"]>>(
      async (userId, id, revision, changes) => {
        const capture = owned(userId, id);
        if (capture.revision !== revision)
          throw new CaptureStoreError("capture_conflict");
        for (const actionId of [
          ...changes.cancelActionIds,
          ...changes.updates.map((update) => update.actionId),
        ]) {
          const action = capture.actions.find(
            (action) => action.id === actionId,
          );
          if (!action || action.status === "succeeded")
            throw new CaptureStoreError("capture_conflict");
        }
        capture.actions = capture.actions.map((action) => {
          if (changes.cancelActionIds.includes(action.id))
            return { ...action, status: "cancelled" };
          const update = changes.updates.find(
            (update) => update.actionId === action.id,
          );
          if (!update) return action;
          return {
            ...action,
            ...update.action,
            presentation: update.presentation,
            origin: "edited",
            summary: captureActionSummary(update.action),
            missingFields: captureActionMissingFields(update.action),
          };
        });
        capture.revision++;
        return copy(userId, id);
      },
    ),
    edit: vi.fn<NonNullable<CaptureServiceStore["edit"]>>(async (userId, id) =>
      copy(userId, id),
    ),
    confirm: vi.fn(async () => {
      throw new Error("HTTP review tests must not approve domain writes");
    }),
    cancel: vi.fn<NonNullable<CaptureServiceStore["cancel"]>>(
      async (userId, id) => copy(userId, id),
    ),
    retry: vi.fn<NonNullable<CaptureServiceStore["retry"]>>(
      async (userId, id) => copy(userId, id),
    ),
    archive: vi.fn<NonNullable<CaptureServiceStore["archive"]>>(
      async (userId, id) => copy(userId, id),
    ),
    delete: vi.fn<NonNullable<CaptureServiceStore["delete"]>>(
      async (userId, id) => {
        owned(userId, id);
      },
    ),
    claimExternal: vi.fn(async () => null),
    claimNext: vi.fn(async () => null),
    markExternalAttempt: vi.fn(async () => {}),
    sweep: vi.fn(async () => ({ scrubbed: 0 })),
  } satisfies CaptureServiceStore;
  const sessions = new Map<string, string>();
  const resolveTelegramUser = vi.fn(
    async (id: number) => users.get(id) ?? null,
  );
  const domainWrite = vi.fn();
  const store = {
    captureInbox: ports,
    resolveTelegramUser,
    resolveUserById: vi.fn(
      async (userId: string) =>
        [...users.values()].find((user) => user.userId === userId) ?? null,
    ),
    resolveWebSession: vi.fn(
      async (hash: string) => sessions.get(hash) ?? null,
    ),
    getLmsConnection: vi.fn(async () => ({
      state: "not_configured",
      lastSyncSuccessAt: null,
    })),
    getIdealHumanDays: vi.fn(async () => []),
    createTask: domainWrite,
    createReminder: domainWrite,
    createLifeEntity: domainWrite,
  } as unknown as LifeOSStore;
  const router = {
    status: vi.fn(() => ({ enabled: false })),
    prepareExtraction: vi.fn(async () => {
      throw new Error("No provider preparation authorized");
    }),
    prepareSpeech: vi.fn(async () => {
      throw new Error("No speech preparation authorized");
    }),
  };
  const captures = new CaptureService({
    store,
    router: router as unknown as AiModelRouter,
    config: {
      enabled: true,
      workerEnabled: false,
      memoryDeleteEnabled: false,
      aiExtractionEnabled: externalEnabled,
      transcriptionEnabled: externalEnabled,
    },
    now: () => now,
  });
  const sendMessage = vi.fn(async () => ({ message_id: 1 }));
  const server = createBotServer({
    store,
    captures,
    telegram: { sendMessage } as unknown as TelegramClient,
    config: {
      telegramBotToken: BOT,
      telegramWebhookSecret: "nighthawk2-http-webhook-secret",
      webSessionSecret: "nighthawk2-http-session-secret",
      nodeEnv: "production",
      corsAllowedOrigins: [ORIGIN],
    },
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const outsideRequests: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    if (url.origin !== base) {
      outsideRequests.push(url.origin);
      return Promise.reject(
        new Error("External requests are forbidden in this HTTP suite"),
      );
    }
    return nativeFetch(input, init);
  });
  const request = (
    resource: string,
    init: RequestInit & { json?: unknown } = {},
  ) => {
    const { json, ...options } = init;
    return fetch(base + "/api/tma/captures" + resource, {
      ...options,
      headers: options.headers ?? signed(),
      ...(Object.hasOwn(init, "json") ? { body: JSON.stringify(json) } : {}),
    });
  };
  const webSession = () => {
    const token = createWebSessionToken();
    sessions.set(hashWebToken(token), OWNER);
    return {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    };
  };
  return {
    request,
    ports,
    rows,
    users,
    router,
    outsideRequests,
    domainWrite,
    sendMessage,
    resolveTelegramUser,
    webSession,
  };
}
const payloads = {
  correct: {
    expectedRevision: 1,
    instruction: "Нет, DBMS не завтра, а в пятницу.",
  },
  reject: { expectedRevision: 1, actionId: "action-1" },
  external: {
    expectedRevision: 1,
    requestId: "nighthawk2-http-request",
    mode: "model",
    confirmed: true,
  },
} as const;
async function error(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = await response.json();
  expect(body).toMatchObject({ error: code });
  expect(body).not.toHaveProperty("data");
  expect(JSON.stringify(body)).not.toMatch(
    /Foreign private|nighthawk2-http-synthetic-bot/,
  );
}
function noProviders(f: Awaited<ReturnType<typeof fixture>>) {
  expect(f.router.prepareExtraction).not.toHaveBeenCalled();
  expect(f.router.prepareSpeech).not.toHaveBeenCalled();
  expect(f.ports.claimExternal).not.toHaveBeenCalled();
  expect(f.domainWrite).not.toHaveBeenCalled();
  expect(f.ports.confirm).not.toHaveBeenCalled();
  expect(f.sendMessage).not.toHaveBeenCalled();
  expect(f.outsideRequests).toEqual([]);
}

describe("Nighthawk2 actual HTTP review and external-operation boundary", () => {
  it("creates three isolated unapproved proposals with rich public metadata from the exact Russian input", async () => {
    const f = await fixture();
    const response = await f.request("", {
      method: "POST",
      json: {
        requestId: "nighthawk2-http-ingest",
        inputType: "text",
        text: ORIGINAL,
        retentionDays: null,
      },
    });
    expect(response.status).toBe(201);
    const view = (await response.json()).data as CaptureView;
    expect(view.actions).toHaveLength(3);
    expect(view.actions.map((action) => action.kind).sort()).toEqual([
      "filming.idea",
      "planning.suggest",
      "task.create",
    ]);
    const task = view.actions.find((action) => action.kind === "task.create")!;
    expect(task.presentation?.title).toBe("Закончить DBMS");
    expect(task.presentation?.suggestedDate).toBe("2026-11-05");
    expect(task.args).toMatchObject({ dueAt: null });
    expect(
      view.actions.find((action) => action.kind === "planning.suggest")?.args,
    ).toMatchObject({ time: null });
    expect(
      JSON.stringify(
        view.actions.find((action) => action.kind === "filming.idea")?.args,
      ),
    ).not.toMatch(/DBMS|потренир/iu);
    expect(
      view.actions.every(
        (action) =>
          action.status !== "succeeded" && action.completedAt === null,
      ),
    ).toBe(true);
    expect(JSON.stringify(view)).not.toMatch(
      /"user_id"|"fileId"|"sourceReference"|"receiptHash"/,
    );
    noProviders(f);
  });
  it.each(["correct", "reject", "external"] as const)(
    "authenticates %s before parsing private instructions",
    async (operation) => {
      const f = await fixture();
      await error(
        await f.request(`/${RECORD}/${operation}`, {
          method: "POST",
          headers: {},
          body: "malformed",
        }),
        401,
        "invalid_telegram_init_data",
      );
      expect(f.ports.get).not.toHaveBeenCalled();
      expect(f.ports.revise).not.toHaveBeenCalled();
      noProviders(f);
    },
  );
  it.each(["correct", "reject", "external"] as const)(
    "rejects foreign Origin and wrong method on %s",
    async (operation) => {
      const f = await fixture();
      await error(
        await f.request(`/${RECORD}/${operation}`, {
          method: "POST",
          headers: { ...signed(), origin: "https://untrusted.invalid" },
          json: payloads[operation],
        }),
        403,
        "origin_not_allowed",
      );
      const response = await f.request(`/${RECORD}/${operation}`);
      await error(response, 405, "method_not_allowed");
      expect(response.headers.get("allow")).toBe("POST");
      expect(f.ports.revise).not.toHaveBeenCalled();
      noProviders(f);
    },
  );
  it.each(["correct", "reject", "external"] as const)(
    "bounds JSON and rejects caller authority fields on %s",
    async (operation) => {
      const f = await fixture();
      const path = `/${RECORD}/${operation}`;
      await error(
        await f.request(path, { method: "POST", body: "{" }),
        400,
        "invalid_json",
      );
      await error(
        await f.request(path, {
          method: "POST",
          body: JSON.stringify({ instruction: "x".repeat(65537) }),
        }),
        413,
        "request_body_too_large",
      );
      await error(
        await f.request(path, {
          method: "POST",
          json: { ...payloads[operation], userId: OTHER },
        }),
        400,
        "capture_invalid_input",
      );
      await error(
        await f.request(path + "?user_id=" + OTHER, {
          method: "POST",
          json: payloads[operation],
        }),
        400,
        "capture_invalid_input",
      );
      expect(f.ports.revise).not.toHaveBeenCalled();
      noProviders(f);
    },
  );
  it.each(["correct", "reject", "external"] as const)(
    "denies another owner and unknown record opaquely before %s can reserve external work",
    async (operation) => {
      const f = await fixture(true);
      for (const id of [FOREIGN, MISSING])
        await error(
          await f.request(`/${id}/${operation}`, {
            method: "POST",
            json: payloads[operation],
          }),
          404,
          "capture_not_found",
        );
      expect(f.rows.get(FOREIGN)?.capture.text).toBe(
        "task: Foreign private text",
      );
      noProviders(f);
    },
  );
  it("rejects an array external mode before claiming or preparing any provider work", async () => {
    const f = await fixture(true);
    const before = structuredClone(f.rows.get(RECORD)?.capture);
    await error(
      await f.request(`/${RECORD}/external`, {
        method: "POST",
        json: { ...payloads.external, mode: ["model"] },
      }),
      400,
      "capture_invalid_input",
    );
    expect(f.rows.get(RECORD)?.capture).toEqual(before);
    noProviders(f);
  });
  it("keeps external model and speech unavailable with flags off even after explicit per-record consent", async () => {
    const f = await fixture();
    const caps = await f.request("/capabilities");
    expect(caps.status).toBe(200);
    expect((await caps.json()).data).toMatchObject({
      aiExtraction: false,
      externalModel: "unavailable",
      transcription: "unavailable",
    });
    for (const mode of ["model", "transcription"])
      await error(
        await f.request(`/${RECORD}/external`, {
          method: "POST",
          json: { ...payloads.external, mode },
        }),
        503,
        "capture_external_unavailable",
      );
    noProviders(f);
  });
  it("corrects and rejects only reviewed proposals through a live web session, and retains CAS and unclear-input boundaries", async () => {
    const f = await fixture();
    const headers = { ...f.webSession(), origin: ORIGIN };
    const corrected = await f.request(`/${RECORD}/correct`, {
      method: "POST",
      headers,
      json: payloads.correct,
    });
    expect(corrected.status).toBe(200);
    const view = (await corrected.json()).data as CaptureView;
    const task = view.actions.find((action) => action.kind === "task.create")!;
    expect(task.presentation?.suggestedDate).toBe("2026-11-06");
    expect(task.args).toMatchObject({ dueAt: null });
    expect(view.revision).toBe(2);
    await error(
      await f.request(`/${RECORD}/correct`, {
        method: "POST",
        headers,
        json: payloads.correct,
      }),
      409,
      "capture_conflict",
    );
    await error(
      await f.request(`/${RECORD}/correct`, {
        method: "POST",
        headers,
        json: { expectedRevision: 2, instruction: "Остальные задачи сохрани" },
      }),
      400,
      "capture_correction_unclear",
    );
    const workout = view.actions.find(
      (action) => action.kind === "planning.suggest",
    )!;
    const rejected = await f.request(`/${RECORD}/reject`, {
      method: "POST",
      headers,
      json: { expectedRevision: 2, actionId: workout.id },
    });
    expect(rejected.status).toBe(200);
    const after = (await rejected.json()).data as CaptureView;
    expect(
      after.actions.find((action) => action.id === workout.id)?.status,
    ).toBe("cancelled");
    expect(
      after.actions.find((action) => action.kind === "filming.idea")?.status,
    ).toBe("pending");
    expect(f.ports.revise).toHaveBeenCalledTimes(2);
    noProviders(f);
  });
  it("does not fall back from invalid explicit web credentials to valid Telegram identity", async () => {
    const f = await fixture();
    await error(
      await f.request(`/${RECORD}/correct`, {
        method: "POST",
        headers: { ...signed(), authorization: "Bearer invalid" },
        json: payloads.correct,
      }),
      401,
      "invalid_web_session",
    );
    expect(f.resolveTelegramUser).not.toHaveBeenCalled();
    expect(f.ports.revise).not.toHaveBeenCalled();
    noProviders(f);
  });
  it.each(["pending", "blocked"] as const)(
    "rejects %s profile status before every new operation",
    async (status) => {
      const f = await fixture();
      f.users.get(30)!.status = status;
      for (const operation of ["correct", "reject", "external"] as const)
        await error(
          await f.request(`/${RECORD}/${operation}`, {
            method: "POST",
            json: payloads[operation],
          }),
          403,
          `telegram_user_${status}`,
        );
      expect(f.ports.get).not.toHaveBeenCalled();
      expect(f.ports.revise).not.toHaveBeenCalled();
      noProviders(f);
    },
  );
});
