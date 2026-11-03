import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import {
  parseCaptureProposals,
  type CaptureConfirmRequest,
  type CaptureEditRequest,
  type CaptureSearchInput,
  type CaptureView,
} from "@lifeos/core";
import {
  CaptureStoreError,
  type CaptureConfirmOptions,
  type CaptureServiceStore,
  type CaptureStoreIngestInput,
  type LifeOSStore,
  type TelegramUserRecord,
} from "@lifeos/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CaptureService, CaptureServiceError } from "./capture-service.js";
import { createBotServer } from "./server.js";
import { createWebSessionToken, hashWebToken } from "./web-session.js";
import type { TelegramClient } from "./telegram/types.js";

vi.mock("./planning-context.js", () => ({
  loadPlanningData: vi.fn(async () => ({
    events: [],
    plan: { warnings: [], rankedTasks: [] },
  })),
}));

const OWNER = "20000000-0000-4000-8000-000000000001";
const OTHER = "20000000-0000-4000-8000-000000000002";
const CAPTURE = "10000000-0000-4000-8000-000000000001";
const FOREIGN = "10000000-0000-4000-8000-000000000002";
const MISSING = "10000000-0000-4000-8000-000000000003";
const BOT = "capture-http-synthetic-bot";
const PATH = "/api/tma/captures";
const ORIGIN = "https://lifeos.test";
const servers: ReturnType<typeof createBotServer>[] = [];

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

function telegramHeaders(id = 20, authDate = Math.floor(Date.now() / 1000)) {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    user: JSON.stringify({ id, first_name: "Synthetic capture owner" }),
  });
  const check = [...params]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const key = createHmac("sha256", "WebAppData").update(BOT).digest();
  params.set("hash", createHmac("sha256", key).update(check).digest("hex"));
  return {
    "x-telegram-init-data": params.toString(),
    "content-type": "application/json",
  };
}

async function fixture(enabled = true) {
  const now = new Date();
  const users = new Map<number, TelegramUserRecord>(
    [20, 21].map((telegramUserId, index) => [
      telegramUserId,
      {
        userId: index ? OTHER : OWNER,
        telegramUserId,
        displayName: "Synthetic owner",
        username: null,
        timezone: "Asia/Almaty",
        status: "active",
        role: "user",
      },
    ]),
  );
  const actions = parseCaptureProposals([
    { kind: "water.log", args: { amountMl: 250 } },
  ]).map((action) => ({
    ...action,
    status: "pending" as const,
    resultSummary: null,
    completedAt: null,
  }));
  const makeCapture = (id: string, text: string): CaptureView => ({
    id,
    text,
    inputType: "text",
    source: "tma",
    sourceLabel: "Telegram Mini App",
    transcript: null,
    state: "needs_review",
    revision: 3,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    archivedAt: null,
    expiresAt: null,
    reviewExpiresAt: new Date(now.getTime() + 600_000).toISOString(),
    errorCode: null,
    actions: structuredClone(actions),
  });
  const rows = new Map([
    [
      CAPTURE,
      {
        owner: OWNER,
        capture: makeCapture(CAPTURE, "Synthetic owner capture"),
      },
    ],
    [
      FOREIGN,
      {
        owner: OTHER,
        capture: makeCapture(FOREIGN, "Foreign private capture"),
      },
    ],
  ]);
  function owned(userId: string, id: string): CaptureView {
    const row = rows.get(id);
    if (!row || row.owner !== userId)
      throw new CaptureStoreError("capture_not_found");
    return structuredClone(row.capture);
  }
  const ingress = new Map<string, CaptureView>();
  const ports = {
    search: vi.fn(async (userId: string, _input: CaptureSearchInput) => ({
      captures: [...rows.values()]
        .filter((row) => row.owner === userId)
        .map((row) => structuredClone(row.capture)),
      nextCursor: null,
    })),
    get: vi.fn(
      async (userId: string, id: string): Promise<CaptureView | null> => {
        const row = rows.get(id);
        return row?.owner === userId ? structuredClone(row.capture) : null;
      },
    ),
    ingest: vi.fn(async (userId: string, input: CaptureStoreIngestInput) => {
      const key = `${userId}:${input.requestId}`;
      const previous = ingress.get(key);
      const capture = previous ?? {
        ...owned(userId, CAPTURE),
        text: input.text,
        source: input.source,
      };
      ingress.set(key, capture);
      return { capture, created: !previous };
    }),
    edit: vi.fn(
      async (userId: string, id: string, _input: CaptureEditRequest) =>
        owned(userId, id),
    ),
    confirm: vi.fn(
      async (
        userId: string,
        id: string,
        _input: CaptureConfirmRequest,
        _options: CaptureConfirmOptions,
      ) => ({ ...owned(userId, id), state: "completed" as const }),
    ),
    cancel: vi.fn(async (userId: string, id: string, _revision: number) => ({
      ...owned(userId, id),
      state: "cancelled" as const,
    })),
    retry: vi.fn(async (userId: string, id: string, _revision: number) =>
      owned(userId, id),
    ),
    archive: vi.fn(
      async (
        userId: string,
        id: string,
        _revision: number,
        archived: boolean,
      ) => ({
        ...owned(userId, id),
        archivedAt: archived ? now.toISOString() : null,
      }),
    ),
    delete: vi.fn(async (userId: string, id: string, _revision: number) => {
      owned(userId, id);
    }),
    claim: vi.fn(async (_userId: string, _id: string, _lease: string) => null),
    claimNext: vi.fn(async (_lease: string) => null),
    markExternalAttempt: vi.fn(async () => {}),
    finish: vi.fn(async (userId: string, id: string) => owned(userId, id)),
    sweep: vi.fn(async () => ({ scrubbed: 0 })),
  } satisfies CaptureServiceStore;
  const sessions = new Map<
    string,
    { userId: string; expiresAt: number; revoked: boolean }
  >();
  const resolveTelegramUser = vi.fn(
    async (id: number) => users.get(id) ?? null,
  );
  const resolveWebSession = vi.fn(async (hash: string) => {
    const session = sessions.get(hash);
    return session && !session.revoked && session.expiresAt > Date.now()
      ? session.userId
      : null;
  });
  const resolveUserById = vi.fn(
    async (userId: string) =>
      [...users.values()].find((user) => user.userId === userId) ?? null,
  );
  const domainWrite = vi.fn();
  const store = {
    captureInbox: ports,
    resolveTelegramUser,
    resolveWebSession,
    resolveUserById,
    getLmsConnection: vi.fn(async () => ({
      state: "not_configured",
      lastSyncSuccessAt: null,
    })),
    getIdealHumanDays: vi.fn(async () => []),
    createTask: domainWrite,
    createReminder: domainWrite,
    createLifeEntity: domainWrite,
  } as unknown as LifeOSStore;
  // Exercise the actual route/core/service validators; only auth and persistence are fixtures.
  const captures = new CaptureService({
    store,
    config: { enabled, workerEnabled: false, memoryDeleteEnabled: false },
    now: () => now,
  });
  const sendMessage = vi.fn(async () => ({ message_id: 1 }));
  const server = createBotServer({
    store,
    captures,
    telegram: { sendMessage } as unknown as TelegramClient,
    config: {
      telegramBotToken: BOT,
      telegramWebhookSecret: "capture-http-webhook-secret",
      webSessionSecret: "capture-http-web-secret",
      nodeEnv: "production",
      corsAllowedOrigins: [ORIGIN],
    },
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = (
    resource = "",
    init: RequestInit & { json?: unknown } = {},
  ) => {
    const { json, ...options } = init;
    return fetch(base + PATH + resource, {
      ...options,
      headers: options.headers ?? telegramHeaders(),
      ...(Object.hasOwn(init, "json") ? { body: JSON.stringify(json) } : {}),
    });
  };
  const session = (
    userId = OWNER,
    expiresAt = Date.now() + 60_000,
    revoked = false,
  ) => {
    const token = createWebSessionToken();
    sessions.set(hashWebToken(token), { userId, expiresAt, revoked });
    return token;
  };
  return {
    request,
    ports,
    captures,
    users,
    rows,
    session,
    domainWrite,
    sendMessage,
    resolveTelegramUser,
    resolveWebSession,
    resolveUserById,
  };
}

async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = await response.json();
  expect(body).toMatchObject({ error: code });
  expect(body).not.toHaveProperty("data");
  return body;
}

describe("capture HTTP authentication and owner boundary", () => {
  it.each(["missing", "invalid", "expired", "future"])(
    "rejects %s Telegram authentication before parsing private input",
    async (kind) => {
      const f = await fixture();
      const headers: Record<string, string> =
        kind === "missing"
          ? {}
          : kind === "invalid"
            ? { "x-telegram-init-data": "auth_date=1&hash=forged" }
            : telegramHeaders(
                20,
                Math.floor(Date.now() / 1000) +
                  (kind === "expired" ? -86_401 : 301),
              );
      await expectError(
        await f.request("", {
          method: "POST",
          headers,
          body: "malformed JSON",
        }),
        401,
        "invalid_telegram_init_data",
      );
      expect(f.resolveTelegramUser).not.toHaveBeenCalled();
      expect(f.ports.ingest).not.toHaveBeenCalled();
    },
  );

  it.each(["pending", "blocked"] as const)(
    "rejects %s linked owners before capture reads",
    async (status) => {
      const f = await fixture();
      f.users.get(20)!.status = status;
      await expectError(await f.request(), 403, `telegram_user_${status}`);
      expect(f.ports.search).not.toHaveBeenCalled();
    },
  );

  it("rejects signed unlinked Telegram owners", async () => {
    const f = await fixture();
    await expectError(
      await f.request("/capabilities", { headers: telegramHeaders(999) }),
      403,
      "telegram_user_not_linked",
    );
    expect(f.ports.search).not.toHaveBeenCalled();
  });

  it("accepts signed Telegram identity and returns only its private capture page", async () => {
    const f = await fixture();
    const response = await f.request();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(
      body.data.captures.map((capture: CaptureView) => capture.id),
    ).toEqual([CAPTURE]);
    expect(JSON.stringify(body)).not.toContain("Foreign private capture");
    expect(f.ports.search).toHaveBeenCalledWith(OWNER, {
      query: "",
      includeArchived: false,
      limit: 20,
    });
    expect(f.domainWrite).not.toHaveBeenCalled();
    expect(f.sendMessage).not.toHaveBeenCalled();
  });

  it("uses a live opaque web session and labels its new capture source as web", async () => {
    const f = await fixture();
    const token = f.session();
    const response = await f.request("", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      json: {
        requestId: "capture-web-1",
        inputType: "text",
        text: "A synthetic idea",
      },
    });
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      data: { text: "A synthetic idea", source: "web" },
    });
    expect(f.resolveWebSession).toHaveBeenCalledWith(hashWebToken(token));
    expect(f.resolveUserById).toHaveBeenCalledWith(OWNER);
    expect(f.ports.ingest).toHaveBeenCalledWith(
      OWNER,
      expect.objectContaining({ source: "web" }),
    );
    expect(f.resolveTelegramUser).not.toHaveBeenCalled();
    expect(f.domainWrite).not.toHaveBeenCalled();
  });

  it.each(["invalid", "expired", "revoked", "blocked"])(
    "fails closed for an explicit %s web session despite valid Telegram headers",
    async (kind) => {
      const f = await fixture();
      const token =
        kind === "invalid"
          ? "invalid"
          : f.session(
              OWNER,
              kind === "expired" ? Date.now() - 1 : Date.now() + 60_000,
              kind === "revoked",
            );
      if (kind === "blocked") f.users.get(20)!.status = "blocked";
      await expectError(
        await f.request("", {
          headers: { ...telegramHeaders(), authorization: `Bearer ${token}` },
        }),
        401,
        "invalid_web_session",
      );
      expect(f.resolveTelegramUser).not.toHaveBeenCalled();
      expect(f.ports.search).not.toHaveBeenCalled();
    },
  );

  it("gives valid explicit web identity precedence over a different signed Telegram owner", async () => {
    const f = await fixture();
    const response = await f.request("", {
      headers: {
        ...telegramHeaders(21),
        authorization: `Bearer ${f.session()}`,
      },
    });
    expect(response.status).toBe(200);
    expect(f.ports.search).toHaveBeenCalledWith(OWNER, expect.anything());
    expect(f.resolveTelegramUser).not.toHaveBeenCalled();
  });

  it("returns the same opaque not-found response for foreign and nonexistent capture selectors", async () => {
    const f = await fixture();
    const foreign = await expectError(
      await f.request(`/${FOREIGN}`),
      404,
      "capture_not_found",
    );
    const missing = await expectError(
      await f.request(`/${MISSING}`),
      404,
      "capture_not_found",
    );
    expect(foreign).toEqual(missing);
    expect(f.ports.get.mock.calls).toEqual([
      [OWNER, FOREIGN],
      [OWNER, MISSING],
    ]);
    expect(JSON.stringify(foreign)).not.toContain(OTHER);
  });

  it("cannot edit or confirm another owner's capture through a valid selector", async () => {
    const f = await fixture();
    await expectError(
      await f.request(`/${FOREIGN}`, {
        method: "PATCH",
        json: {
          expectedRevision: 3,
          transcript: "A synthetic transcript",
        },
      }),
      404,
      "capture_not_found",
    );
    await expectError(
      await f.request(`/${FOREIGN}/confirm`, {
        method: "POST",
        json: {
          requestId: "foreign-approval-1",
          expectedRevision: 3,
          actionIds: ["action-1"],
          confirmed: true,
        },
      }),
      404,
      "capture_not_found",
    );
    expect(f.ports.edit).toHaveBeenCalledExactlyOnceWith(
      OWNER,
      FOREIGN,
      expect.anything(),
    );
    expect(f.ports.confirm).not.toHaveBeenCalled();
  });
});

describe("capture HTTP validation and explicit review authority", () => {
  it("creates and durably replays Telegram-app ingress without an extra write or confirmation", async () => {
    const f = await fixture();
    const input = {
      requestId: "capture-tma-1",
      inputType: "text",
      text: "A synthetic idea",
      retentionDays: null,
    };
    const first = await f.request("", { method: "POST", json: input });
    const replay = await f.request("", { method: "POST", json: input });
    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(await first.json()).toEqual(await replay.json());
    expect(f.ports.ingest).toHaveBeenCalledWith(
      OWNER,
      expect.objectContaining({ ...input, source: "tma" }),
    );
    expect(f.ports.confirm).not.toHaveBeenCalled();
    expect(f.domainWrite).not.toHaveBeenCalled();
  });

  it.each([
    ["", "PUT", "GET, POST"],
    ["/search", "GET", "POST"],
    ["/capabilities", "POST", "GET"],
    [`/${CAPTURE}/confirm`, "DELETE", "POST"],
    [`/${CAPTURE}`, "POST", "GET, PATCH, DELETE"],
  ])(
    "rejects wrong method %s %s before reading a body",
    async (resource, method, allow) => {
      const f = await fixture();
      const response = await f.request(resource, {
        method,
        ...(method === "GET" ? {} : { body: "malformed" }),
      });
      await expectError(response, 405, "method_not_allowed");
      expect(response.headers.get("allow")).toBe(allow);
      expect(f.ports.ingest).not.toHaveBeenCalled();
      expect(f.ports.confirm).not.toHaveBeenCalled();
    },
  );

  it.each([
    "?userId=foreign",
    `/${CAPTURE}?userId=${OTHER}`,
    "/search?query=private",
  ])("rejects query authority on %s", async (resource) => {
    const f = await fixture();
    await expectError(await f.request(resource), 400, "capture_invalid_input");
    expect(f.ports.search).not.toHaveBeenCalled();
    expect(f.ports.get).not.toHaveBeenCalled();
  });

  it.each([
    { userId: OTHER },
    { source: "telegram" },
    { voice: { fileId: "server-only" } },
    { sourceReference: { chatId: 21, messageId: 1, updateId: 1 } },
    { text: "password: do-not-store" },
  ])(
    "rejects injected authority or credentials before ingress persistence",
    async (extra) => {
      const f = await fixture();
      await expectError(
        await f.request("", {
          method: "POST",
          json: {
            requestId: "capture-invalid-1",
            inputType: "text",
            text: "A synthetic idea",
            ...extra,
          },
        }),
        400,
        "capture_invalid_input",
      );
      expect(f.ports.ingest).not.toHaveBeenCalled();
    },
  );

  it("uses production service validators for search, transcript edits and confirmation bodies", async () => {
    const f = await fixture();
    for (const [resource, method, json] of [
      ["/search", "POST", { query: "idea", userId: OTHER }],
      [
        `/${CAPTURE}`,
        "PATCH",
        { expectedRevision: 3, transcript: "A safe transcript", userId: OTHER },
      ],
      [
        `/${CAPTURE}/confirm`,
        "POST",
        {
          requestId: "approval-1",
          expectedRevision: 3,
          actionIds: ["action-1"],
          confirmed: true,
          journalEntries: [],
        },
      ],
      [
        `/${CAPTURE}/confirm`,
        "POST",
        {
          requestId: "approval-1",
          expectedRevision: 3,
          actionIds: ["action-1"],
          confirmed: false,
        },
      ],
    ] as const)
      await expectError(
        await f.request(resource, { method, json }),
        400,
        "capture_invalid_input",
      );
    expect(f.ports.search).not.toHaveBeenCalled();
    expect(f.ports.edit).not.toHaveBeenCalled();
    expect(f.ports.confirm).not.toHaveBeenCalled();
  });

  it("forwards only explicit stored-action approval into the atomic persistence port", async () => {
    const f = await fixture();
    const approval = {
      requestId: "owner-approval-1",
      expectedRevision: 3,
      actionIds: ["action-1"],
      confirmed: true,
    };
    const response = await f.request(`/${CAPTURE}/confirm`, {
      method: "POST",
      json: approval,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      data: { id: CAPTURE, state: "completed" },
    });
    expect(f.ports.confirm).toHaveBeenCalledExactlyOnceWith(
      OWNER,
      CAPTURE,
      approval,
      {
        allowMemoryDelete: false,
        readResults: [],
      },
    );
    expect(f.domainWrite).not.toHaveBeenCalled();
    expect(f.sendMessage).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { expectedRevision: 3 },
    { expectedRevision: 3, confirmed: false },
    { expectedRevision: "3", confirmed: true },
    { expectedRevision: 0, confirmed: true },
    { expectedRevision: 3, confirmed: true, userId: OTHER },
  ])("requires exact deletion consent and a numeric revision", async (json) => {
    const f = await fixture();
    await expectError(
      await f.request(`/${CAPTURE}`, { method: "DELETE", json }),
      400,
      "capture_invalid_input",
    );
    expect(f.ports.delete).not.toHaveBeenCalled();
  });

  it("forwards confirmed deletion only for the authenticated owner and selected revision", async () => {
    const f = await fixture();
    const response = await f.request(`/${CAPTURE}`, {
      method: "DELETE",
      json: { expectedRevision: 3, confirmed: true },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ data: { deleted: true } });
    expect(f.ports.delete).toHaveBeenCalledExactlyOnceWith(OWNER, CAPTURE, 3);
    await expectError(
      await f.request(`/${FOREIGN}`, {
        method: "DELETE",
        json: { expectedRevision: 3, confirmed: true },
      }),
      404,
      "capture_not_found",
    );
  });

  it.each([undefined, null, "true", 1])(
    "rejects non-boolean archive choices",
    async (archived) => {
      const f = await fixture();
      await expectError(
        await f.request(`/${CAPTURE}/archive`, {
          method: "POST",
          json: { expectedRevision: 3, archived },
        }),
        400,
        "capture_invalid_input",
      );
      expect(f.ports.archive).not.toHaveBeenCalled();
    },
  );

  it.each([true, false])(
    "accepts explicit archive=%s with owner and revision",
    async (archived) => {
      const f = await fixture();
      const response = await f.request(`/${CAPTURE}/archive`, {
        method: "POST",
        json: { expectedRevision: 3, archived },
      });
      expect(response.status).toBe(200);
      expect(f.ports.archive).toHaveBeenCalledExactlyOnceWith(
        OWNER,
        CAPTURE,
        3,
        archived,
      );
    },
  );

  it("rejects stale process requests before claiming work", async () => {
    const f = await fixture();
    await expectError(
      await f.request(`/${CAPTURE}/process`, {
        method: "POST",
        json: { expectedRevision: 2 },
      }),
      409,
      "capture_conflict",
    );
    expect(f.ports.claim).not.toHaveBeenCalled();
  });

  it("rejects malformed and oversized JSON at the HTTP boundary", async () => {
    const f = await fixture();
    await expectError(
      await f.request("", { method: "POST", body: "{not valid JSON" }),
      400,
      "invalid_json",
    );
    await expectError(
      await f.request("", {
        method: "POST",
        body: JSON.stringify({ text: "x".repeat(65_537) }),
      }),
      413,
      "request_body_too_large",
    );
    expect(f.ports.ingest).not.toHaveBeenCalled();
  });

  it("reports disabled capture honestly and performs no capture persistence", async () => {
    const f = await fixture(false);
    await expectError(
      await f.request("", { headers: {} }),
      401,
      "invalid_telegram_init_data",
    );
    const capabilities = await f.request("/capabilities");
    expect(capabilities.status).toBe(200);
    expect(await capabilities.json()).toMatchObject({
      data: {
        enabled: false,
        transcription: "unavailable",
        aiExtraction: false,
      },
    });
    await expectError(await f.request(), 503, "capture_unavailable");
    await expectError(
      await f.request("", {
        method: "POST",
        json: {
          requestId: "capture-disabled-1",
          inputType: "text",
          text: "An idea",
        },
      }),
      503,
      "capture_unavailable",
    );
    expect(f.ports.search).not.toHaveBeenCalled();
    expect(f.ports.ingest).not.toHaveBeenCalled();
  });

  it("sanitizes unexpected storage diagnostics and preserves known safe conflict codes", async () => {
    const f = await fixture();
    f.ports.search.mockRejectedValueOnce(
      new Error("private database diagnostic with credentials"),
    );
    expect(
      await expectError(await f.request(), 503, "capture_storage_unavailable"),
    ).toEqual({ error: "capture_storage_unavailable" });
    f.ports.archive.mockRejectedValueOnce(
      new CaptureStoreError("capture_conflict"),
    );
    await expectError(
      await f.request(`/${CAPTURE}/archive`, {
        method: "POST",
        json: { expectedRevision: 3, archived: true },
      }),
      409,
      "capture_conflict",
    );
    vi.spyOn(f.captures, "search").mockRejectedValueOnce(
      new CaptureServiceError("capture_rate_limited", 429),
    );
    await expectError(await f.request(), 429, "capture_rate_limited");
  });
});
