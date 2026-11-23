import { createHmac } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { fullBodyTemplate, type PersonalTemplate } from "@lifeos/core";
import type { LifeOSStore } from "@lifeos/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBotServer } from "./server.js";

const token = "test-personal-template";
const requestId = "f9637cea-6322-4654-b51b-3daec4ea1702";
const servers: ReturnType<typeof createBotServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

function signedHeader(telegramId: number) {
  const values = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: telegramId, first_name: "Fixture" }),
  });
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const payload = Array.from(values, ([key, value]) => key + "=" + value).join("\n");
  values.set("hash", createHmac("sha256", secret).update(payload).digest("hex"));
  return values.toString();
}

async function fixture(configuredOwner?: string) {
  const template = { exercises: fullBodyTemplate(), revision: 0 };
  const templates = new Map<string, PersonalTemplate>([["user-10", template]]);
  const personalTemplate = vi.fn(async (id: string, action?: "existing" | PersonalTemplate) => {
    if (action === "existing") return templates.get(id) ?? null;
    const result = action ?? templates.get(id) ?? template;
    templates.set(id, result);
    return result;
  });
  const startPersonalWorkout = vi.fn(async () => ({ id: requestId }));
  const changePersonalWorkout = vi.fn(async () => ({ id: requestId }));
  const server = createBotServer({
    config: { telegramBotToken: token, lifeosDefaultUserId: configuredOwner },
    store: {
      resolveTelegramUser: async (telegramUserId: number) => ({
        userId: "user-" + telegramUserId, telegramUserId, status: "active", role: "user", timezone: "UTC",
      }),
      personalTemplate, startPersonalWorkout, changePersonalWorkout,
    } as unknown as LifeOSStore,
  });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port + "/api/tma/workout/personal/";
  function request(user: number, path: string, method: string, body?: unknown) {
    return fetch(base + path, {
      method,
      headers: { "x-telegram-init-data": signedHeader(user), "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  return { template, personalTemplate, startPersonalWorkout, changePersonalWorkout, request };
}

describe("authenticated personal workout access", () => {
  it.each([undefined, "user-99"])("uses the saved template with configured owner %s", async (configuredOwner) => {
    const f = await fixture(configuredOwner);
    const commands = [
      ["template", "PUT", f.template],
      ["start", "POST", { requestId, userId: "user-10" }],
      [requestId, "PATCH", { requestId, revision: 0, kind: "note", text: "Gym", userId: "user-10" }],
    ] as const;
    await expect((await f.request(10, "template", "POST")).json()).resolves.toEqual({ data: f.template });
    await expect((await f.request(20, "template", "POST")).json()).resolves.toEqual({ data: null });
    for (const [path, method, body] of commands) {
      expect((await f.request(20, path, method, body)).status).toBe(404);
      expect((await f.request(10, path, method, body)).status).toBe(200);
    }
    expect(f.personalTemplate.mock.calls.every(([, action]) => action !== undefined)).toBe(true);
    expect(f.startPersonalWorkout.mock.calls).toEqual([["user-10", requestId]]);
    expect(f.changePersonalWorkout).toHaveBeenCalledExactlyOnceWith("user-10", requestId, 0, requestId, { kind: "note", text: "Gym" });
  });

  it("seeds only an explicitly configured owner and reads the saved document on repeat", async () => {
    const f = await fixture("user-20");
    for (let i = 0; i < 2; i++) {
      await expect((await f.request(20, "template", "POST")).json()).resolves.toEqual({ data: f.template });
    }
    expect(f.personalTemplate.mock.calls).toEqual([["user-20", "existing"], ["user-20"], ["user-20", "existing"]]);
  });
});
