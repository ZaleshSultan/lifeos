import { createHmac, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { LifeOSStore, TelegramUserRecord } from "@lifeos/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBotServer } from "./server.js";
import {
  hashHealthToken,
  signHealthIngestToken,
  verifyHealthIngestToken,
} from "./health-credentials.js";

const secret = "synthetic-health-signing-secret";
const botToken = "synthetic-telegram-token";
const users: TelegramUserRecord[] = [1, 2].map((id) => ({
  userId: `00000000-0000-4000-8000-00000000000${id}`,
  telegramUserId: id,
  status: "active",
  role: "user",
  displayName: "Synthetic",
  username: null,
  timezone: "UTC",
}));
const servers: ReturnType<typeof createBotServer>[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections();
        }),
    ),
  );
});
function initData(id = 1) {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id, first_name: "Synthetic" }),
  });
  const check = [...params]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  params.set(
    "hash",
    createHmac(
      "sha256",
      createHmac("sha256", "WebAppData").update(botToken).digest(),
    )
      .update(check)
      .digest("hex"),
  );
  return params.toString();
}
const payload = {
  date: "2026-01-01",
  source: "xiaomi_health_connect",
  metrics: [{ type: "steps", value: 100, unit: "steps" }],
};
async function fixture() {
  const profiles = structuredClone(users);
  const devices = new Map<
    string,
    {
      userId: string;
      tokenHash: string;
      expiresAt: string;
      revokedAt: string | null;
    }
  >();
  const upsertHealthMetrics = vi.fn(async () => ({ created: 1, updated: 0 }));
  const store = {
    resolveTelegramUser: vi.fn(
      async (id: number) =>
        profiles.find((user) => user.telegramUserId === id) ?? null,
    ),
    resolveUserById: vi.fn(
      async (id: string) => profiles.find((user) => user.userId === id) ?? null,
    ),
    issueHealthIngestCredential: vi.fn(
      async (input: {
        userId: string;
        tokenHash: string;
        expiresAt: string;
      }) => {
        if (
          profiles.find((user) => user.userId === input.userId)?.status !==
          "active"
        )
          return null;
        const id = randomUUID();
        devices.set(id, { ...input, revokedAt: null });
        return id;
      },
    ),
    resolveHealthIngestCredential: vi.fn(
      async (userId: string, tokenHash: string) =>
        [...devices.values()].some(
          (d) =>
            d.userId === userId &&
            d.tokenHash === tokenHash &&
            !d.revokedAt &&
            Date.parse(d.expiresAt) > Date.now(),
        ),
    ),
    revokeHealthIngestCredential: vi.fn(async (userId: string, id: string) => {
      const device = devices.get(id);
      if (device?.userId === userId)
        device.revokedAt = new Date().toISOString();
    }),
    listHealthIngestCredentials: vi.fn(async (userId: string) =>
      [...devices]
        .filter(([, d]) => d.userId === userId)
        .map(([deviceId, d]) => ({
          deviceId,
          createdAt: new Date().toISOString(),
          expiresAt: d.expiresAt,
          revokedAt: d.revokedAt,
        })),
    ),
    upsertHealthMetrics,
  };
  const server = createBotServer({
    config: { telegramBotToken: botToken, lifeosHealthIngestJwtSecret: secret },
    store: store as unknown as LifeOSStore,
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const issue = async (id = 1) => {
    const response = await fetch(url + "/api/tma/health/ingest-token", {
      method: "POST",
      headers: { "x-telegram-init-data": initData(id) },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    return (
      (await response.json()) as {
        data: {
          token: string;
          deviceId: string;
          tokenType: string;
          expiresInSeconds: number;
        };
      }
    ).data;
  };
  const ingest = (
    token?: string,
    body: unknown = payload,
    path = "/api/health/ingest",
  ) =>
    fetch(url + path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  return { store, url, profiles, devices, issue, ingest };
}
describe("revocable health credentials", () => {
  it("registers only a hash and preserves Android Bearer payload and repeated snapshot uploads", async () => {
    const f = await fixture();
    const issued = await f.issue();
    expect(issued).toMatchObject({
      tokenType: "Bearer",
      expiresInSeconds: 2592000,
    });
    const stored = f.store.issueHealthIngestCredential.mock.calls[0][0];
    expect(stored.tokenHash).toBe(hashHealthToken(issued.token));
    expect(JSON.stringify([...f.devices])).not.toContain(issued.token);
    expect((await f.ingest(issued.token)).status).toBe(200);
    expect(
      (await f.ingest(issued.token, payload, "/health/ingest")).status,
    ).toBe(200);
    expect(f.store.upsertHealthMetrics).toHaveBeenCalledWith(
      expect.objectContaining({ userId: users[0].userId }),
    );
    const another = await f.issue();
    expect(another.token).not.toBe(issued.token);
    expect(another.deviceId).not.toBe(issued.deviceId);
  });
  it("rejects expired, forged, unregistered legacy and missing credentials without writes", async () => {
    const f = await fixture();
    const { token } = await f.issue();
    for (const invalid of [
      undefined,
      token.slice(0, -1) + "!",
      signHealthIngestToken(
        users[0],
        secret,
        Math.floor(Date.now() / 1000) - 2592000,
      ),
      signHealthIngestToken(users[0], secret),
      "ws1_" + "a".repeat(43),
    ]) {
      expect((await f.ingest(invalid)).status).toBe(401);
    }
    expect(f.store.upsertHealthMetrics).not.toHaveBeenCalled();
  });
  it.each(["blocked", "pending"] as const)(
    "checks current %s profile after token issuance",
    async (status) => {
      const f = await fixture();
      const { token } = await f.issue();
      f.profiles[0].status = status;
      expect((await f.ingest(token)).status).toBe(401);
      const issued = await fetch(f.url + "/api/tma/health/ingest-token", {
        method: "POST",
        headers: { "x-telegram-init-data": initData() },
      });
      expect(issued.status).toBe(403);
      expect(f.store.upsertHealthMetrics).not.toHaveBeenCalled();
    },
  );
  it("revokes a device via the authenticated API and never returns hashes or tokens in device lists", async () => {
    const f = await fixture();
    const { token, deviceId } = await f.issue();
    const list = await fetch(f.url + "/api/tma/health/devices", {
      headers: { "x-telegram-init-data": initData() },
    });
    const listed = await list.text();
    expect(listed).toContain(deviceId);
    expect(listed).not.toContain(token);
    expect(listed).not.toContain(hashHealthToken(token));
    for (let i = 0; i < 2; i++)
      expect(
        (
          await fetch(f.url + "/api/tma/health/devices/" + deviceId, {
            method: "DELETE",
            headers: { "x-telegram-init-data": initData() },
          })
        ).status,
      ).toBe(200);
    expect((await f.ingest(token)).status).toBe(401);
    expect(f.store.upsertHealthMetrics).not.toHaveBeenCalled();
  });
  it("isolates ingestion, device enumeration and revocation across users", async () => {
    const f = await fixture();
    const a = await f.issue();
    const b = await f.issue(2);
    for (const body of [
      { ...payload, userId: users[1].userId },
      { ...payload, user_id: users[1].userId },
    ])
      expect((await f.ingest(a.token, body)).status).toBe(403);
    const list = await fetch(f.url + "/api/tma/health/devices", {
      headers: { "x-telegram-init-data": initData(2) },
    });
    expect(await list.text()).not.toContain(a.deviceId);
    expect(
      (
        await fetch(f.url + "/api/tma/health/devices/" + a.deviceId, {
          method: "DELETE",
          headers: { "x-telegram-init-data": initData(2) },
        })
      ).status,
    ).toBe(200);
    expect((await f.ingest(a.token)).status).toBe(200);
    expect((await f.ingest(b.token)).status).toBe(200);
  });
  it("fails closed when credential or profile storage is unavailable, without leaking diagnostics", async () => {
    const f = await fixture();
    const { token } = await f.issue();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    f.store.resolveHealthIngestCredential.mockRejectedValueOnce(
      new Error(`database diagnostic ${token}`),
    );
    const result = await f.ingest(token);
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain(token);
    f.store.resolveUserById.mockRejectedValueOnce(
      new Error(`profile diagnostic ${token}`),
    );
    expect((await f.ingest(token)).status).toBe(503);
    expect(f.store.upsertHealthMetrics).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    f.store.issueHealthIngestCredential.mockRejectedValueOnce(
      new Error("unavailable"),
    );
    expect(
      (
        await fetch(f.url + "/api/tma/health/ingest-token", {
          method: "POST",
          headers: { "x-telegram-init-data": initData() },
        })
      ).status,
    ).toBe(503);
  });
  it("rejects malformed, unsupported and oversized input", async () => {
    const f = await fixture();
    const { token } = await f.issue();
    expect(
      (
        await f.ingest(token, {
          ...payload,
          metrics: [{ type: "unsupported", value: 1 }],
        })
      ).status,
    ).toBe(400);
    for (const body of [
      "{",
      JSON.stringify({ padding: "x".repeat(1024 * 1024) }),
    ]) {
      const response = await fetch(f.url + "/api/health/ingest", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body,
      });
      expect(response.status).toBe(body === "{" ? 400 : 413);
    }
    expect(f.store.upsertHealthMetrics).not.toHaveBeenCalled();
  });
  it("rejects explicit invalid Bearer even with valid Telegram initData", async () => {
    const f = await fixture();
    const send = (authorization?: string) =>
      fetch(f.url + "/api/health/ingest", {
        method: "POST",
        headers: {
          "x-telegram-init-data": initData(),
          "content-type": "application/json",
          ...(authorization ? { authorization } : {}),
        },
        body: JSON.stringify(payload),
      });
    expect((await send("Bearer invalid")).status).toBe(401);
    expect((await send()).status).toBe(200);
  });
  it("requires authentication to list or revoke devices", async () => {
    const f = await fixture();
    const { deviceId } = await f.issue();
    expect((await fetch(f.url + "/api/tma/health/devices")).status).toBe(401);
    expect(
      (
        await fetch(f.url + "/api/tma/health/devices/" + deviceId, {
          method: "DELETE",
        })
      ).status,
    ).toBe(401);
  });
});
describe("health signature and lifetime validation", () => {
  it("rejects unsupported algorithm/scope and invalid timestamp shapes even with a valid HMAC", () => {
    const token = signHealthIngestToken(users[0], secret);
    const [header, payload] = token.split(".");
    const original = JSON.parse(Buffer.from(payload, "base64url").toString());
    const now = Math.floor(Date.now() / 1000);
    const sign = (h: unknown, p: unknown) => {
      const input = [h, p]
        .map((value) =>
          Buffer.from(JSON.stringify(value)).toString("base64url"),
        )
        .join(".");
      return (
        input +
        "." +
        createHmac("sha256", secret).update(input).digest("base64url")
      );
    };
    const h = JSON.parse(Buffer.from(header, "base64url").toString());
    for (const changes of [
      { scope: "web_login" },
      { expiresAt: now },
      { issuedAt: now + 301 },
      { expiresAt: now + 2592001 },
      { issuedAt: 1.5 },
      { expiresAt: null },
      { expiresAt: now - 1 },
      { nonce: "legacy-nonce" },
    ])
      expect(
        verifyHealthIngestToken(sign(h, { ...original, ...changes }), secret),
      ).toBeNull();
    expect(
      verifyHealthIngestToken(sign({ ...h, alg: "none" }, original), secret),
    ).toBeNull();
    expect(
      verifyHealthIngestToken(
        header + "." + payload + "." + "я".repeat(43),
        secret,
      ),
    ).toBeNull();
  });
});
