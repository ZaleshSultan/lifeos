import type { AddressInfo } from "node:net";
import type { LifeOSStore, TelegramUserRecord } from "@lifeos/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBotServer } from "./server.js";
import {
  createWebLoginToken,
  createWebSessionToken,
  hashWebToken,
  issueWebLoginToken,
} from "./web-session.js";

const secret = "test-web-login-secret";
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

async function fixture() {
  const users = new Map<string, TelegramUserRecord>(
    ["user-a", "user-b"].map((userId, index) => [
      userId,
      {
        userId,
        telegramUserId: index + 100,
        displayName: userId,
        username: null,
        timezone: "UTC",
        status: "active",
        role: "user",
      },
    ]),
  );
  const logins = new Map<
    string,
    { userId: string; expiresAt: string; used: boolean }
  >();
  const sessions = new Map<
    string,
    { userId: string; expiresAt: number; revoked: boolean }
  >();
  const store = {
    issueWebLoginToken: vi.fn(async ({ userId, tokenHash, expiresAt }) => {
      logins.set(tokenHash, { userId, expiresAt, used: false });
      return true;
    }),
    exchangeWebLoginToken: vi.fn(async ({ userId, tokenHash, sessionHash }) => {
      const login = logins.get(tokenHash);
      if (
        !login ||
        login.used ||
        login.userId !== userId ||
        Date.parse(login.expiresAt) <= Date.now() ||
        users.get(userId)?.status !== "active"
      )
        return null;
      login.used = true;
      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      sessions.set(sessionHash, { userId, expiresAt, revoked: false });
      return new Date(expiresAt).toISOString();
    }),
    resolveWebSession: vi.fn(async (hash: string) => {
      const session = sessions.get(hash);
      return session && !session.revoked && session.expiresAt > Date.now()
        ? session.userId
        : null;
    }),
    revokeWebSession: vi.fn(async (userId: string, hash: string) => {
      const session = sessions.get(hash);
      if (session?.userId === userId) session.revoked = true;
    }),
    resolveUserById: vi.fn(async (userId: string) => users.get(userId) ?? null),
    getUserObsidianSettings: vi.fn(async () => null),
    getObsidianSyncStatus: vi.fn(async () => ({ counts: {} })),
    getSafeUserOAuthConnection: vi.fn(async () => null),
    getWeatherSettings: vi.fn(async () => null),
    getTmaHomeSummary: vi.fn(
      async (user: TelegramUserRecord) =>
        ({ displayName: user.userId }) as Awaited<
          ReturnType<LifeOSStore["getTmaHomeSummary"]>
        >,
    ),
  } satisfies Partial<LifeOSStore>;
  const server = createBotServer({
    store: store as unknown as LifeOSStore,
    config: {
      webSessionSecret: secret,
      allowUnsafeTmaDevAuth: true,
      lifeosDefaultUserId: "dev-user",
    },
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = (path: string, token: string, method = "GET") =>
    fetch(url + path, {
      method,
      headers: { authorization: `Bearer ${token}` },
    });
  const issue = (userId = "user-a") =>
    issueWebLoginToken(store as unknown as LifeOSStore, userId, secret);
  const exchange = (token: string) =>
    request("/api/web/auth/exchange", token, "POST");
  const login = async (userId = "user-a") => {
    const link = await issue(userId);
    const response = await exchange(link);
    expect(response.status).toBe(200);
    const { data } = await response.json();
    return { link, token: data.token as string };
  };
  return { store, users, logins, sessions, request, issue, exchange, login };
}

describe("web authentication HTTP boundary", () => {
  it("exchanges once for a fresh session, stores only hashes, and loads the owner", async () => {
    const f = await fixture();
    const { link, token } = await f.login();
    expect(token).not.toBe(link);
    expect(f.sessions.has(hashWebToken(token))).toBe(true);
    expect(JSON.stringify([...f.logins, ...f.sessions])).not.toContain(token);
    expect(JSON.stringify([...f.logins, ...f.sessions])).not.toContain(link);
    const response = await f.request("/api/tma/session", token);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      data: { state: "active", displayName: "user-a" },
    });
    expect((await f.exchange(link)).status).toBe(401);
  });
  it("rejects expired or incorrectly signed links before database exchange", async () => {
    const f = await fixture();
    const expired = createWebLoginToken(
      "user-a",
      secret,
      1,
      Math.floor(Date.now() / 1000) - 2,
    );
    for (const token of [
      expired,
      createWebLoginToken("user-a", "invalid-secret"),
      (await f.issue()) + ".",
      createWebSessionToken(),
    ]) {
      const response = await f.exchange(token);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "invalid_web_login" });
    }
    expect(f.store.exchangeWebLoginToken).not.toHaveBeenCalled();
  });
  it("rejects signed but unissued links and database-expired links", async () => {
    const f = await fixture();
    expect(
      (await f.exchange(createWebLoginToken("user-a", secret))).status,
    ).toBe(401);
    const link = await f.issue();
    f.logins.get(hashWebToken(link))!.expiresAt = new Date(0).toISOString();
    expect((await f.exchange(link)).status).toBe(401);
  });
  it("has exactly one successful concurrent HTTP exchange", async () => {
    const f = await fixture();
    const link = await f.issue();
    const responses = await Promise.all(
      Array.from({ length: 12 }, () => f.exchange(link)),
    );
    expect(responses.filter((r) => r.status === 200)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 401)).toHaveLength(11);
    expect(f.sessions.size).toBe(1);
  });
  it("revokes on logout and rejects stolen cookie replay across all web authorization paths", async () => {
    const f = await fixture();
    const { token } = await f.login();
    expect((await f.request("/api/tma/home", token)).status).toBe(200);
    expect(
      (await f.request("/api/web/auth/logout", token, "POST")).status,
    ).toBe(204);
    expect(f.store.revokeWebSession).toHaveBeenCalledWith(
      "user-a",
      hashWebToken(token),
    );
    for (const path of [
      "/api/tma/session",
      "/api/tma/home",
      "/api/tma/register",
    ]) {
      expect(
        (
          await f.request(
            path,
            token,
            path.endsWith("register") ? "POST" : "GET",
          )
        ).status,
      ).toBe(401);
    }
    expect(
      (await f.request("/api/web/auth/logout", token, "POST")).status,
    ).toBe(204);
  });
  it.each(["blocked", "pending"] as const)(
    "denies %s users during exchange and on existing sessions",
    async (status) => {
      const f = await fixture();
      const { token } = await f.login();
      const link = await f.issue();
      f.users.get("user-a")!.status = status;
      expect((await f.exchange(link)).status).toBe(401);
      expect((await f.request("/api/tma/session", token)).status).toBe(401);
      expect((await f.request("/api/tma/home", token)).status).toBe(401);
    },
  );
  it("rejects expired/revoked sessions, removed profiles and login credentials as bearer sessions", async () => {
    const f = await fixture();
    const first = await f.login();
    f.sessions.get(hashWebToken(first.token))!.revoked = true;
    const second = await f.login();
    f.sessions.get(hashWebToken(second.token))!.expiresAt = 0;
    const third = await f.login();
    f.users.delete("user-a");
    for (const token of [
      first.token,
      second.token,
      third.token,
      third.link,
      "invalid",
    ]) {
      for (const path of ["/api/tma/session", "/api/tma/home"])
        expect((await f.request(path, token)).status).toBe(401);
    }
    expect(f.store.getTmaHomeSummary).not.toHaveBeenCalled();
  });
  it("isolates resource access and revocation between users", async () => {
    const f = await fixture();
    const a = await f.login();
    const b = await f.login("user-b");
    const response = await f.request(
      "/api/tma/home?userId=user-b&user_id=user-b",
      a.token,
    );
    expect(await response.json()).toMatchObject({
      data: { displayName: "user-a" },
    });
    await f.request("/api/web/auth/logout?userId=user-b", a.token, "POST");
    expect((await f.request("/api/tma/home", b.token)).status).toBe(200);
  });
  it("fails closed on storage outages with generic errors and no token logging", async () => {
    const f = await fixture();
    const { token } = await f.login();
    const link = await f.issue();
    const logs = [
      vi.spyOn(console, "log"),
      vi.spyOn(console, "warn"),
      vi.spyOn(console, "error"),
    ];
    f.store.exchangeWebLoginToken.mockRejectedValueOnce(new Error(link));
    const response = await f.exchange(link);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(link);
    f.store.resolveWebSession.mockRejectedValue(new Error(token));
    expect((await f.request("/api/tma/home", token)).status).toBe(500);
    expect(
      (await f.request("/api/web/auth/logout", token, "POST")).status,
    ).toBe(503);
    for (const spy of logs) expect(spy).not.toHaveBeenCalled();
  });
  it("rejects state changes via GET", async () => {
    const f = await fixture();
    for (const path of ["/api/web/auth/exchange", "/api/web/auth/logout"]) {
      expect((await f.request(path, await f.issue())).status).toBe(405);
    }
    expect(f.store.exchangeWebLoginToken).not.toHaveBeenCalled();
  });
});
