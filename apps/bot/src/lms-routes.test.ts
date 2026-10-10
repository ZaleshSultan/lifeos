import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import {
  decryptSecret,
  LmsStoreError,
  type LifeOSStore,
  type LmsConnection,
  type ManualStudyWork,
  type TelegramUserRecord,
} from "@lifeos/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBotServer } from "./server.js";
import { LmsSessionService, type LmsValidator } from "./lms-sessions.js";
import { createLifeosAiService, readLifeosAiConfig } from "./lifeos-ai.js";
import { createWebSessionToken } from "./web-session.js";

const BOT_TOKEN = "lms-http-test-token";
const WEB_SECRET = "lms-http-web-secret";
const ENCRYPTION_KEY = Buffer.alloc(32, 7);
const servers: ReturnType<typeof createBotServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
  vi.restoreAllMocks();
});

function headers(id = 20, authDate = Math.floor(Date.now() / 1000)) {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    user: JSON.stringify({ id, first_name: "LMS test" }),
  });
  const data = [...params]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  params.set("hash", createHmac("sha256", secret).update(data).digest("hex"));
  return {
    "x-telegram-init-data": params.toString(),
    "content-type": "application/json",
  };
}

function post(body: unknown, id = 20): RequestInit {
  return { method: "POST", headers: headers(id), body: JSON.stringify(body) };
}

function disconnected(): LmsConnection {
  return {
    configured: false,
    state: "not_configured",
    lastSyncSuccessAt: null,
    lastSyncAttemptAt: null,
    lastErrorCategory: null,
    sessionExpiresAt: null,
    syncRequestedAt: null,
    unsupportedFeatures: [],
  };
}

async function fixture(
  options: {
    statuses?: Record<number, "active" | "pending" | "blocked">;
    unlinked?: number[];
    validator?: LmsValidator;
    key?: Buffer;
    allowDevAuth?: boolean;
  } = {},
) {
  let clock = Date.now();
  const connections = new Map<string, LmsConnection>();
  const ciphertexts = new Map<string, string>();
  const validator = vi.fn(
    options.validator ?? (async () => ({ ok: true as const })),
  );
  const sessions = new LmsSessionService({
    validator,
    key: options.key ?? ENCRYPTION_KEY,
    now: () => clock,
    retentionHours: 24,
  });
  const resolveTelegramUser = vi.fn(
    async (id: number): Promise<TelegramUserRecord | null> =>
      options.unlinked?.includes(id)
        ? null
        : {
            userId: `owner-${id}`,
            telegramUserId: id,
            displayName: "LMS test",
            username: null,
            timezone: "Asia/Almaty",
            status: options.statuses?.[id] ?? "active",
            role: "user",
          },
  );
  const resolveUserById = vi.fn(async (userId: string) => ({
    userId,
    telegramUserId: 20,
    displayName: "Web user",
    username: null,
    timezone: "UTC",
    status: "active" as const,
    role: "user" as const,
  }));
  const getLmsConnection = vi.fn(
    async (userId: string) => connections.get(userId) ?? disconnected(),
  );
  const getLmsWork = vi.fn(async (userId: string, timezone: string) => ({
    timezone,
    lastSyncSuccessAt: connections.get(userId)?.lastSyncSuccessAt ?? null,
    lastSyncAttemptAt: null,
    stale: true,
    truncated: false,
    warnings: [],
    unsupportedFeatures: [],
    items: [],
  }));
  const saveLmsSession = vi.fn(
    async (input: {
      userId: string;
      encryptedCookie: string;
      expiresAt: string;
    }) => {
      ciphertexts.set(input.userId, input.encryptedCookie);
      const metadata: LmsConnection = {
        ...disconnected(),
        configured: true,
        state: "connected",
        sessionExpiresAt: input.expiresAt,
      };
      connections.set(input.userId, metadata);
      return metadata;
    },
  );
  const deleteLmsSession = vi.fn(async (userId: string) => {
    ciphertexts.delete(userId);
    const metadata = disconnected();
    connections.set(userId, metadata);
    return metadata;
  });
  const requestLmsSync = vi.fn(async (userId: string) => {
    connections.set(userId, {
      ...(connections.get(userId) ?? disconnected()),
      syncRequestedAt: new Date(clock).toISOString(),
    });
  });
  const addManualStudyWork = vi.fn(
    async (_userId: string, _work: ManualStudyWork) => undefined,
  );
  const getPlanningSnapshot = vi.fn();
  const unrelatedWrites = vi.fn();
  const store = {
    resolveTelegramUser,
    resolveUserById,
    getLmsConnection,
    getLmsWork,
    saveLmsSession,
    deleteLmsSession,
    requestLmsSync,
    addManualStudyWork,
    getPlanningSnapshot,
    createTask: unrelatedWrites,
    updateAssessmentItem: unrelatedWrites,
    createReminder: unrelatedWrites,
  } as unknown as LifeOSStore;
  const aiService = createLifeosAiService(readLifeosAiConfig({}));
  const ask = vi.fn(async () => ({
    answer: "Unused",
    suggestions: [],
    provider: "gemini" as const,
  }));
  const server = createBotServer({
    store,
    lmsSessions: sessions,
    ai: { ...aiService, ask },
    config: {
      telegramBotToken: BOT_TOKEN,
      webSessionSecret: WEB_SECRET,
      allowUnsafeTmaDevAuth: options.allowDevAuth ?? false,
      lifeosDefaultUserId: "unsafe-dev-owner",
      lifeosDefaultTelegramUserId: 999,
    },
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    sessions,
    validator,
    connections,
    ciphertexts,
    resolveTelegramUser,
    resolveUserById,
    getLmsConnection,
    getLmsWork,
    saveLmsSession,
    deleteLmsSession,
    requestLmsSync,
    addManualStudyWork,
    getPlanningSnapshot,
    unrelatedWrites,
    ask,
    advance(ms: number) {
      clock += ms;
    },
  };
}

const routes = [
  ["GET", "/api/tma/lms/connection"],
  ["GET", "/api/tma/lms/work"],
  ["POST", "/api/tma/lms/session/validate"],
  ["POST", "/api/tma/lms/session/save"],
  ["POST", "/api/tma/lms/sync"],
  ["DELETE", "/api/tma/lms/session"],
  ["POST", "/api/tma/lms/work/manual"],
] as const;

function expectNoPrivateDataAccess(f: Awaited<ReturnType<typeof fixture>>) {
  for (const method of [
    f.validator,
    f.getLmsConnection,
    f.getLmsWork,
    f.saveLmsSession,
    f.deleteLmsSession,
    f.requestLmsSync,
    f.addManualStudyWork,
    f.getPlanningSnapshot,
    f.unrelatedWrites,
    f.ask,
  ])
    expect(method).not.toHaveBeenCalled();
}

describe("LMS HTTP authentication boundary", () => {
  it("requires valid signed Telegram initData on every LMS route before parsing credentials", async () => {
    const f = await fixture();
    for (const [method, path] of routes) {
      const response = await fetch(`${f.base}${path}`, {
        method,
        ...(method !== "GET" ? { body: "not valid JSON" } : {}),
      });
      expect(response.status, path).toBe(401);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(f.resolveTelegramUser).not.toHaveBeenCalled();
    expectNoPrivateDataAccess(f);
  });

  it.each(["pending", "blocked"] as const)(
    "rejects an authenticated %s profile across all LMS routes",
    async (status) => {
      const f = await fixture({ statuses: { 20: status } });
      for (const [method, path] of routes) {
        const response = await fetch(`${f.base}${path}`, {
          method,
          headers: headers(),
          ...(method !== "GET" ? { body: "not valid JSON" } : {}),
        });
        expect(response.status, path).toBe(403);
        expect(await response.json()).toEqual({
          error: `telegram_user_${status}`,
        });
        expect(response.headers.get("cache-control")).toBe("no-store");
      }
      expectNoPrivateDataAccess(f);
    },
  );

  it("rejects expired, future-dated, forged and unlinked Telegram identities", async () => {
    const f = await fixture({ unlinked: [25] });
    const now = Math.floor(Date.now() / 1000);
    for (const signed of [
      headers(20, now - 86401),
      headers(20, now + 301),
      {
        ...headers(),
        "x-telegram-init-data": `${headers()["x-telegram-init-data"]}invalid`,
      },
    ]) {
      const response = await fetch(`${f.base}/api/tma/lms/session/validate`, {
        method: "POST",
        headers: signed,
        body: JSON.stringify({ cookie: "private-cookie" }),
      });
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    const unlinked = await fetch(`${f.base}/api/tma/lms/connection`, {
      headers: headers(25),
    });
    expect(unlinked.status).toBe(403);
    expect(await unlinked.json()).toEqual({
      error: "telegram_user_not_linked",
    });
    expectNoPrivateDataAccess(f);
  });

  it("rejects the development fallback and a valid web session even when configured", async () => {
    const f = await fixture({ allowDevAuth: true });
    const token = createWebSessionToken("owner-20", WEB_SECRET);
    const authHeaders: Record<string, string>[] = [
      {},
      { authorization: `Bearer ${token}` },
    ];
    for (const auth of authHeaders) {
      for (const [method, path] of routes) {
        const response = await fetch(`${f.base}${path}`, {
          method,
          headers: { ...auth, "content-type": "application/json" },
          ...(method !== "GET" ? { body: "{}" } : {}),
        });
        expect(response.status, path).toBe(401);
        expect(response.headers.get("cache-control")).toBe("no-store");
      }
    }
    expect(f.resolveUserById).not.toHaveBeenCalled();
    expectNoPrivateDataAccess(f);
  });

  it("scopes connection and work reads only to the authenticated active owner", async () => {
    const f = await fixture();
    expect(
      (
        await fetch(`${f.base}/api/tma/lms/connection`, {
          headers: headers(21),
        })
      ).status,
    ).toBe(200);
    expect(f.getLmsConnection).toHaveBeenCalledWith("owner-21");
    expect(
      (await fetch(`${f.base}/api/tma/lms/work`, { headers: headers(22) }))
        .status,
    ).toBe(200);
    expect(f.getLmsWork).toHaveBeenCalledWith("owner-22", "Asia/Almaty");
    const foreign = await fetch(
      `${f.base}/api/tma/lms/connection?user_id=owner-20`,
      { headers: headers(21) },
    );
    expect(foreign.status).toBe(400);
    expect(foreign.headers.get("cache-control")).toBe("no-store");
    expect(f.getLmsConnection).toHaveBeenCalledTimes(1);
  });
});

describe("LMS session HTTP validation and retention", () => {
  it("rejects client ownership, header cookies, malformed input, unsafe URLs, and unknown fields", async () => {
    const f = await fixture();
    const bodies = [
      { cookie: "private-cookie", user_id: "foreign" },
      { cookie: "private-cookie", userId: "foreign" },
      { cookie: "private-cookie", url: "https://foreign.example" },
      { cookie: "private-cookie", confirmed: true },
      { cookie: "ESTSAUTHPERSISTENT=private-cookie" },
      { cookie: "a;b" },
      { cookie: "a b" },
      { cookie: "a\nb" },
      { cookie: "a\\b" },
      { cookie: "a,b" },
      { cookie: '"private-cookie"' },
      { cookie: "" },
      { cookie: null },
      { cookie: "x".repeat(16385) },
      [],
      null,
    ];
    for (const [index, body] of bodies.entries()) {
      const response = await fetch(
        `${f.base}/api/tma/lms/session/validate`,
        post(body, 100 + index),
      );
      expect(response.status, JSON.stringify(body).slice(0, 60)).toBe(400);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.text()).not.toContain("private-cookie");
    }
    const queryCredential = await fetch(
      `${f.base}/api/tma/lms/session/validate?cookie=private-cookie`,
      post({ cookie: "private-cookie" }, 200),
    );
    expect(queryCredential.status).toBe(400);
    expect(await queryCredential.text()).not.toContain("private-cookie");
    expect(f.validator).not.toHaveBeenCalled();
    expect(f.saveLmsSession).not.toHaveBeenCalled();
  });

  it("enforces JSON content type, valid JSON and the 20 KB credential body cap", async () => {
    const f = await fixture();
    const contentType = await fetch(`${f.base}/api/tma/lms/session/validate`, {
      method: "POST",
      headers: { ...headers(30), "content-type": "text/plain" },
      body: JSON.stringify({ cookie: "private-cookie" }),
    });
    expect(contentType.status).toBe(415);
    const malformed = await fetch(`${f.base}/api/tma/lms/session/validate`, {
      method: "POST",
      headers: headers(31),
      body: '{"cookie":',
    });
    expect(malformed.status).toBe(400);
    const oversized = await fetch(
      `${f.base}/api/tma/lms/session/validate`,
      post({ cookie: "x".repeat(20000) }, 32),
    );
    expect(oversized.status).toBe(413);
    for (const response of [contentType, malformed, oversized])
      expect(response.headers.get("cache-control")).toBe("no-store");
    expect(f.validator).not.toHaveBeenCalled();
    expect(f.saveLmsSession).not.toHaveBeenCalled();
  });

  it("rate-limits validation to three attempts per minute per authenticated user", async () => {
    const f = await fixture();
    for (let attempt = 0; attempt < 3; attempt++)
      expect(
        (
          await fetch(
            `${f.base}/api/tma/lms/session/validate`,
            post({ cookie: "private-cookie" }),
          )
        ).status,
      ).toBe(200);
    const limited = await fetch(
      `${f.base}/api/tma/lms/session/validate`,
      post({ cookie: "private-cookie" }),
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get("cache-control")).toBe("no-store");
    expect(f.validator).toHaveBeenCalledTimes(3);
    expect(
      (
        await fetch(
          `${f.base}/api/tma/lms/session/validate`,
          post({ cookie: "other-cookie" }, 21),
        )
      ).status,
    ).toBe(200);
    f.advance(60001);
    expect(
      (
        await fetch(
          `${f.base}/api/tma/lms/session/validate`,
          post({ cookie: "private-cookie" }),
        )
      ).status,
    ).toBe(200);
    expect(f.saveLmsSession).not.toHaveBeenCalled();
  });

  it("validates without writes, encrypts only on explicit owned save, and never returns credentials or calls AI", async () => {
    const f = await fixture();
    const validation = await fetch(
      `${f.base}/api/tma/lms/session/validate`,
      post({ cookie: "private-cookie" }),
    );
    expect(validation.status).toBe(200);
    expect(validation.headers.get("cache-control")).toBe("no-store");
    const receipt = (await validation.json()).data;
    expect(Object.keys(receipt).sort()).toEqual([
      "expiresAt",
      "validationToken",
    ]);
    expect(Date.parse(receipt.expiresAt)).toBeGreaterThan(Date.now());
    expect(f.saveLmsSession).not.toHaveBeenCalled();
    const foreign = await fetch(
      `${f.base}/api/tma/lms/session/save`,
      post({ validationToken: receipt.validationToken }, 21),
    );
    expect(foreign.status).toBe(400);
    expect(await foreign.json()).toEqual({ error: "lms_validation_required" });
    expect(f.saveLmsSession).not.toHaveBeenCalled();
    const saved = await fetch(
      `${f.base}/api/tma/lms/session/save`,
      post({ validationToken: receipt.validationToken }),
    );
    expect(saved.status).toBe(200);
    expect(saved.headers.get("cache-control")).toBe("no-store");
    const savedText = await saved.text();
    const input = f.saveLmsSession.mock.calls[0][0];
    expect(input.userId).toBe("owner-20");
    expect(input.encryptedCookie).toMatch(/^enc:v1:/);
    expect(
      JSON.parse(decryptSecret(input.encryptedCookie, ENCRYPTION_KEY)!),
    ).toEqual({
      version: 1,
      userId: "owner-20",
      platform: "aitu_moodle",
      cookie: "private-cookie",
    });
    for (const value of [
      "private-cookie",
      input.encryptedCookie,
      receipt.validationToken,
    ])
      expect(savedText).not.toContain(value);
    const replay = await fetch(
      `${f.base}/api/tma/lms/session/save`,
      post({ validationToken: receipt.validationToken }),
    );
    expect(replay.status).toBe(400);
    expect(f.saveLmsSession).toHaveBeenCalledTimes(1);
    expect(f.getPlanningSnapshot).not.toHaveBeenCalled();
    expect(f.ask).not.toHaveBeenCalled();
    expect(f.unrelatedWrites).not.toHaveBeenCalled();
  });

  it("requires revalidation after receipt expiry and rejects unvalidated saves", async () => {
    const f = await fixture();
    const validation = await fetch(
      `${f.base}/api/tma/lms/session/validate`,
      post({ cookie: "private-cookie" }),
    );
    const receipt = (await validation.json()).data;
    f.advance(300001);
    const expired = await fetch(
      `${f.base}/api/tma/lms/session/save`,
      post({ validationToken: receipt.validationToken }),
    );
    expect(expired.status).toBe(400);
    expect(await expired.json()).toEqual({ error: "lms_validation_required" });
    const unvalidated = await fetch(
      `${f.base}/api/tma/lms/session/save`,
      post({ cookie: "private-cookie" }, 21),
    );
    expect(unvalidated.status).toBe(400);
    expect(f.saveLmsSession).not.toHaveBeenCalled();
  });

  it("fails closed on bad encryption keys and rejected or failing provider validation", async () => {
    const missingKey = await fixture({ key: Buffer.alloc(1) });
    const unavailable = await fetch(
      `${missingKey.base}/api/tma/lms/session/validate`,
      post({ cookie: "private-cookie" }),
    );
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({
      error: "encryption_unavailable",
    });
    expect(missingKey.validator).not.toHaveBeenCalled();
    const expired = await fixture({
      validator: async () => ({ ok: false, errorCategory: "session_expired" }),
    });
    const rejected = await fetch(
      `${expired.base}/api/tma/lms/session/validate`,
      post({ cookie: "private-cookie" }),
    );
    expect(rejected.status).toBe(422);
    expect(await rejected.json()).toEqual({ error: "session_expired" });
    const failing = await fixture({
      validator: async () => {
        throw new Error("private-cookie raw upstream details");
      },
    });
    const failure = await fetch(
      `${failing.base}/api/tma/lms/session/validate`,
      post({ cookie: "private-cookie" }),
    );
    expect(failure.status).toBe(503);
    expect(await failure.json()).toEqual({ error: "connection_failed" });
    for (const f of [missingKey, expired, failing])
      expect(f.saveLmsSession).not.toHaveBeenCalled();
    for (const response of [unavailable, rejected, failure])
      expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it.each(["session_expired", "interactive_login_required", "unsupported_auth_flow"] as const)(
    "returns fixed SSO diagnostics for %s without exposing provider content or saving a receipt",
    async (errorCategory) => {
      const event = { stage: "oidc_form_post", reason: "callback_invalid" } as const;
      const f = await fixture({
        validator: async () => ({
          ok: false,
          errorCategory,
          diagnostics: {
            ...event,
            cookie: "private-cookie",
            url: "https://login.microsoftonline.com/?code=private-code",
            events: [{ ...event, html: "private-html", form: { code: "private-code" } }],
          },
        }),
      });
      const response = await fetch(`${f.base}/api/tma/lms/session/validate`, post({ cookie: "private-cookie" }));
      expect(response.status).toBe(422);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({
        error: errorCategory,
        diagnostics: { ...event, events: [event] },
      });
      expect(f.saveLmsSession).not.toHaveBeenCalled();
    },
  );
});

describe("LMS sync, deletion and manual study routes", () => {
  it("scopes sync and session deletion by the authenticated user and rejects client ownership", async () => {
    const f = await fixture();
    const synced = await fetch(`${f.base}/api/tma/lms/sync`, post({}, 21));
    expect(synced.status).toBe(200);
    expect(await synced.json()).toEqual({ data: { requested: true } });
    expect(f.requestLmsSync).toHaveBeenCalledWith("owner-21");
    const deleted = await fetch(`${f.base}/api/tma/lms/session`, {
      method: "DELETE",
      headers: headers(22),
    });
    expect(deleted.status).toBe(200);
    expect(f.deleteLmsSession).toHaveBeenCalledWith("owner-22");
    const wrongOwnerSync = await fetch(
      `${f.base}/api/tma/lms/sync`,
      post({ user_id: "owner-20" }, 23),
    );
    const wrongOwnerDelete = await fetch(`${f.base}/api/tma/lms/session`, {
      method: "DELETE",
      headers: headers(24),
      body: JSON.stringify({ user_id: "owner-20" }),
    });
    expect(wrongOwnerSync.status).toBe(400);
    expect(wrongOwnerDelete.status).toBe(400);
    expect(f.requestLmsSync).toHaveBeenCalledTimes(1);
    expect(f.deleteLmsSession).toHaveBeenCalledTimes(1);
    expect(f.unrelatedWrites).not.toHaveBeenCalled();
  });

  it("returns a safe 409 for leased sessions and consumes the save receipt before storage", async () => {
    const f = await fixture();
    f.saveLmsSession.mockRejectedValue(
      new LmsStoreError("lms_sync_in_progress"),
    );
    f.deleteLmsSession.mockRejectedValue(
      new LmsStoreError("lms_sync_in_progress"),
    );
    const validation = await fetch(
      `${f.base}/api/tma/lms/session/validate`,
      post({ cookie: "private-cookie" }),
    );
    const receipt = (await validation.json()).data;
    const saved = await fetch(
      `${f.base}/api/tma/lms/session/save`,
      post({ validationToken: receipt.validationToken }),
    );
    const deleted = await fetch(`${f.base}/api/tma/lms/session`, {
      method: "DELETE",
      headers: headers(),
    });
    for (const response of [saved, deleted]) {
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: "lms_sync_in_progress" });
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    const replay = await fetch(
      `${f.base}/api/tma/lms/session/save`,
      post({ validationToken: receipt.validationToken }),
    );
    expect(replay.status).toBe(400);
    expect(f.saveLmsSession).toHaveBeenCalledTimes(1);
  });

  it("creates manual work with unknown submission/date without requiring a stored session", async () => {
    const f = await fixture();
    const response = await fetch(
      `${f.base}/api/tma/lms/work/manual`,
      post(
        {
          title: "  Prepare report  ",
          kind: "assignment",
          submissionStatus: "unknown",
          dueAt: null,
        },
        21,
      ),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { created: true } });
    expect(f.addManualStudyWork).toHaveBeenCalledWith("owner-21", {
      title: "Prepare report",
      courseTitle: null,
      kind: "assignment",
      submissionStatus: "unknown",
      dueAt: null,
    });
    expect(f.validator).not.toHaveBeenCalled();
    expect(f.getLmsConnection).not.toHaveBeenCalled();
    expect(f.saveLmsSession).not.toHaveBeenCalled();
    expect(f.getPlanningSnapshot).not.toHaveBeenCalled();
    expect(f.ask).not.toHaveBeenCalled();
  });

  it("validates manual status, ownership, text limits and explicit real date/time offsets", async () => {
    const f = await fixture();
    const valid = {
      title: "Course report",
      kind: "assignment",
      submissionStatus: "unknown",
    };
    const invalid = [
      { ...valid, user_id: "foreign" },
      { ...valid, submissionStatus: "graded" },
      { ...valid, score: 100 },
      { ...valid, kind: "invented" },
      { ...valid, title: "" },
      { ...valid, title: "x".repeat(241) },
      { ...valid, courseTitle: "x".repeat(241) },
      { ...valid, title: "a\nb" },
      { ...valid, dueAt: "not-a-date" },
      { ...valid, dueAt: "2026-10-11" },
      { ...valid, dueAt: "2026-10-11T12:00" },
      { ...valid, dueAt: "2026-02-30T12:00:00Z" },
    ];
    for (const [index, body] of invalid.entries()) {
      const response = await fetch(
        `${f.base}/api/tma/lms/work/manual`,
        post(body, 100 + index),
      );
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(f.addManualStudyWork).not.toHaveBeenCalled();
    const explicitOffset = await fetch(
      `${f.base}/api/tma/lms/work/manual`,
      post({ ...valid, dueAt: "2026-10-11T12:00:00+05:00" }, 200),
    );
    expect(explicitOffset.status).toBe(200);
    expect(f.addManualStudyWork).toHaveBeenCalledWith(
      "owner-200",
      expect.objectContaining({ dueAt: "2026-10-11T07:00:00.000Z" }),
    );
  });

  it("keeps no-store and sanitization on method, path, and database failures", async () => {
    const f = await fixture();
    const method = await fetch(`${f.base}/api/tma/lms/connection`, post({}));
    const unknown = await fetch(`${f.base}/api/tma/lms/unknown`, {
      headers: headers(),
    });
    f.getLmsConnection.mockRejectedValue(
      new Error("private-cookie database payload"),
    );
    const storageFailure = await fetch(`${f.base}/api/tma/lms/connection`, {
      headers: headers(),
    });
    expect(method.status).toBe(405);
    expect(unknown.status).toBe(404);
    expect(storageFailure.status).toBe(503);
    for (const response of [method, unknown, storageFailure]) {
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.text()).not.toContain("private-cookie");
    }
  });
});
