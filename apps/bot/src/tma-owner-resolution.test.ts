import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { LifeOSStore } from "@lifeos/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBotServer } from "./server.js";

const token = "test-only-owner-resolution-token";
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
});

function signedIdentity() {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: 33, first_name: "Fixture owner" }),
  });
  const payload = [...params]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  params.set(
    "hash",
    createHmac("sha256", secret).update(payload).digest("hex"),
  );
  return { "x-telegram-init-data": params.toString() };
}

async function fixture() {
  const resolveTelegramUser = vi.fn(async (_id: number): Promise<null> => null);
  const getTmaStudySummary = vi.fn();
  const createPendingTelegramUser = vi.fn();
  const linkDefaultTelegramUser = vi.fn();
  const store = {
    resolveTelegramUser,
    getTmaStudySummary,
    createPendingTelegramUser,
    linkDefaultTelegramUser,
  } as unknown as LifeOSStore;
  const server = createBotServer({
    store,
    config: {
      telegramBotToken: token,
      lifeosDefaultUserId: "configured-owner-must-not-be-used-as-fallback",
      lifeosDefaultTelegramUserId: 33,
      lifeosAdminTelegramIds: [33],
      allowUnsafeTmaDevAuth: false,
    },
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    resolveTelegramUser,
    getTmaStudySummary,
    createPendingTelegramUser,
    linkDefaultTelegramUser,
  };
}

describe("missing production owner boundaries", () => {
  it("distinguishes valid Telegram identity from an absent LifeOS profile without creating one", async () => {
    const f = await fixture();
    const headers = signedIdentity();
    const session = await fetch(`${f.base}/api/tma/session`, { headers });
    expect(session.status).toBe(200);
    expect(session.headers.get("cache-control")).toBe("no-store");
    await expect(session.json()).resolves.toMatchObject({
      data: { state: "unregistered", profile: null },
    });

    const study = await fetch(`${f.base}/api/tma/study`, { headers });
    expect(study.status).toBe(403);
    await expect(study.json()).resolves.toEqual({
      error: "telegram_user_not_linked",
    });
    expect(f.resolveTelegramUser).toHaveBeenCalledWith(33);
    expect(f.getTmaStudySummary).not.toHaveBeenCalled();
    expect(f.createPendingTelegramUser).not.toHaveBeenCalled();
    expect(f.linkDefaultTelegramUser).not.toHaveBeenCalled();
  });

  it("does not turn a database outage into registration or disclose the provider error", async () => {
    const f = await fixture();
    f.resolveTelegramUser.mockRejectedValue(
      new Error("test-only private database diagnostic"),
    );
    for (const path of ["/api/tma/session", "/api/tma/study"]) {
      const response = await fetch(f.base + path, {
        headers: signedIdentity(),
      });
      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        error: "internal_error",
        message: "Request failed.",
      });
    }
    expect(f.getTmaStudySummary).not.toHaveBeenCalled();
    expect(f.createPendingTelegramUser).not.toHaveBeenCalled();
    expect(f.linkDefaultTelegramUser).not.toHaveBeenCalled();
  });

  it("rejects invalid Telegram credentials before any profile lookup", async () => {
    const f = await fixture();
    const response = await fetch(`${f.base}/api/tma/session`, {
      headers: { "x-telegram-init-data": "invalid-test-only-identity" },
    });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "invalid_telegram_init_data",
    });
    expect(f.resolveTelegramUser).not.toHaveBeenCalled();
    expect(f.createPendingTelegramUser).not.toHaveBeenCalled();
  });
});
