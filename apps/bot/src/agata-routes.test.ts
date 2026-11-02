import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { LifeOSStore } from "@lifeos/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBotServer } from "./server.js";
import { createLifeosAiService, readLifeosAiConfig } from "./lifeos-ai.js";
import { agataCapabilities } from "../../../packages/core/src/agata.js";

const BOT_TOKEN = "agata-fixture-bot-token";
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
  const values = new URLSearchParams({
    auth_date: String(authDate),
    user: JSON.stringify({ id }),
  });
  const text = [...values]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  values.set("hash", createHmac("sha256", secret).update(text).digest("hex"));
  return { "x-telegram-init-data": values.toString() };
}

async function fixture() {
  const unrelatedStoreCall = vi.fn(() => {
    throw new Error("Unexpected private-data access");
  });
  const resolveTelegramUser = vi.fn(async (id: number) =>
    id === 23
      ? null
      : {
          userId: `fixture-owner-${id}`,
          telegramUserId: id,
          timezone: "Asia/Almaty",
          displayName: "Fixture",
          username: null,
          status: id === 21 ? "blocked" : id === 22 ? "pending" : "active",
          role: "user",
        },
  );
  const store = {
    resolveTelegramUser,
    getLmsWork: unrelatedStoreCall,
    getPlanningSnapshot: unrelatedStoreCall,
    createReminder: unrelatedStoreCall,
    upsertUserOAuthConnection: unrelatedStoreCall,
  } as unknown as LifeOSStore;
  const ai = createLifeosAiService(readLifeosAiConfig({}));
  const ask = vi.fn();
  const server = createBotServer({
    store,
    ai: { ...ai, ask },
    config: { telegramBotToken: BOT_TOKEN },
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    unrelatedStoreCall,
    resolveTelegramUser,
    ask,
  };
}

describe("AGATA capability HTTP boundary", () => {
  it("requires signed, unexpired active-profile authorization", async () => {
    const f = await fixture();
    const path = f.base + "/api/tma/agata/capabilities";
    expect((await fetch(path)).status).toBe(401);
    expect(
      (
        await fetch(path, {
          headers: headers(20, Math.floor(Date.now() / 1000) - 90000),
        })
      ).status,
    ).toBe(401);
    for (const id of [21, 22, 23])
      expect((await fetch(path, { headers: headers(id) })).status).toBe(403);
    expect(f.unrelatedStoreCall).not.toHaveBeenCalled();
    expect(f.ask).not.toHaveBeenCalled();
  });

  it("returns only honest disabled capabilities through the actual server", async () => {
    const f = await fixture();
    for (const id of [20, 24]) {
      const result = await fetch(f.base + "/api/tma/agata/capabilities", {
        headers: headers(id),
      });
      expect(result.status).toBe(200);
      expect(result.headers.get("cache-control")).toBe("no-store");
      expect(await result.json()).toEqual({ data: agataCapabilities() });
    }
    expect(f.resolveTelegramUser).toHaveBeenCalledWith(24);
    expect(f.unrelatedStoreCall).not.toHaveBeenCalled();
    expect(f.ask).not.toHaveBeenCalled();
  });

  it("rejects query overrides, mutations, connection and invented vision operations", async () => {
    const f = await fixture();
    const path = f.base + "/api/tma/agata/capabilities";
    expect(
      (await fetch(path + "?user_id=another-owner", { headers: headers() }))
        .status,
    ).toBe(400);
    const mutation = await fetch(path, {
      method: "POST",
      headers: headers(),
      body: "{}",
    });
    expect(mutation.status).toBe(405);
    expect(mutation.headers.get("allow")).toBe("GET");
    for (const operation of [
      "connect",
      "execute",
      "analyze_meal_photo",
      "reminder",
    ])
      expect(
        (
          await fetch(f.base + "/api/tma/agata/" + operation, {
            headers: headers(),
          })
        ).status,
      ).toBe(404);
    for (const path of [
      "/api/agata/today",
      "/api/agata/deadlines",
      "/api/agata/reminder",
    ])
      expect(
        (
          await fetch(f.base + path, {
            headers: { "X-Agata-Api-Key": "unprovisioned" },
          })
        ).status,
      ).toBe(404);
    expect(f.unrelatedStoreCall).not.toHaveBeenCalled();
    expect(f.ask).not.toHaveBeenCalled();
  });
});
