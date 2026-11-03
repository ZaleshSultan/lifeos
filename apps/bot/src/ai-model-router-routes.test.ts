import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import {
  defaultAiRouterSettings,
  parseAiRouterSettings,
  type AiRouterSettings,
} from "@lifeos/core";
import {
  AiRouterSettingsConflictError,
  type AiRouterSettingsStore,
  type LifeOSStore,
  type TelegramUserRecord,
} from "@lifeos/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAiGovernor } from "./ai-governor.js";
import { AiModelRouter } from "./ai-model-router.js";
import { readAiModelRouterConfig } from "./ai-model-router-config.js";
import { createBotServer } from "./server.js";
import { createWebSessionToken, hashWebToken } from "./web-session.js";
import type { TelegramClient } from "./telegram/types.js";

const OWNER = "10000000-0000-4000-8000-000000000001";
const OTHER = "10000000-0000-4000-8000-000000000002";
const BOT_TOKEN = "router-http-signed-fixture-bot";
const KEY = "sk-or-v1-synthetic-owner-http-key";
const OTHER_KEY = "sk-or-v1-synthetic-other-http-key";
const ORIGIN = "https://lifeos.test";
const PATH = "/api/tma/ai/router";
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

function telegramHeaders(id = 30, authDate = Math.floor(Date.now() / 1000)) {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    user: JSON.stringify({ id, first_name: "Synthetic router fixture" }),
  });
  const check = [...params]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => key + "=" + value)
    .join("\n");
  const key = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  params.set("hash", createHmac("sha256", key).update(check).digest("hex"));
  return {
    "x-telegram-init-data": params.toString(),
    "content-type": "application/json",
  };
}
function approved(): AiRouterSettings {
  const settings = defaultAiRouterSettings();
  settings.allowedTiers = ["deterministic", "balanced"];
  settings.allowedProviders = ["openrouter"];
  settings.tierModels.balanced = ["fixture-model"];
  settings.privacy.general = ["openrouter"];
  settings.spending = {
    paidCallsAuthorized: true,
    maxRequestCostMicros: 1_000_000,
    maxDailyCostMicros: 2_000_000,
  };
  return settings;
}
async function fixture() {
  const users = new Map<number, TelegramUserRecord>(
    [30, 31].map((telegramUserId, index) => [
      telegramUserId,
      {
        userId: index ? OTHER : OWNER,
        telegramUserId,
        displayName: "Synthetic owner " + index,
        username: null,
        timezone: "Asia/Almaty",
        status: "active",
        role: "user",
      },
    ]),
  );
  const rows = new Map<
    string,
    { settings: AiRouterSettings; revision: number }
  >();
  const bSettings = defaultAiRouterSettings();
  bSettings.spending.maxRequestCostMicros = 17;
  bSettings.spending.maxDailyCostMicros = 42;
  rows.set(OTHER, { settings: bSettings, revision: 7 });
  const get = vi.fn(async (userId: string) =>
    structuredClone(
      rows.get(userId) ?? { settings: defaultAiRouterSettings(), revision: 0 },
    ),
  );
  const save = vi.fn(
    async (
      userId: string,
      value: AiRouterSettings,
      expectedRevision: number,
    ) => {
      const parsed = parseAiRouterSettings(value);
      const current = rows.get(userId) ?? {
        settings: defaultAiRouterSettings(),
        revision: 0,
      };
      if (
        current.revision > 0 &&
        JSON.stringify(current.settings) === JSON.stringify(parsed) &&
        [current.revision, current.revision - 1].includes(expectedRevision)
      )
        return structuredClone(current);
      if (current.revision !== expectedRevision)
        throw new AiRouterSettingsConflictError();
      const next = {
        settings: structuredClone(parsed),
        revision: expectedRevision + 1,
      };
      rows.set(userId, next);
      return structuredClone(next);
    },
  );
  const getRecent = vi.fn(async () => []);
  const settingsStore: AiRouterSettingsStore = { get, save, getRecent };
  const sessions = new Map<string, string>();
  const resolveTelegramUser = vi.fn(
    async (id: number) => users.get(id) ?? null,
  );
  const resolveWebSession = vi.fn(
    async (hash: string) => sessions.get(hash) ?? null,
  );
  const resolveUserById = vi.fn(
    async (userId: string) =>
      [...users.values()].find((user) => user.userId === userId) ?? null,
  );
  const domainWrite = vi.fn();
  const store = {
    resolveTelegramUser,
    resolveWebSession,
    resolveUserById,
    createTask: domainWrite,
    createReminder: domainWrite,
    updateAssessmentItem: domainWrite,
  } as unknown as LifeOSStore;
  const reserve = vi.fn(async () => "reserved" as const),
    finish = vi.fn(async () => undefined);
  const providerFetch = vi
    .fn<typeof fetch>()
    .mockRejectedValue(new Error("A preview must never contact a provider"));
  const now = Date.now();
  const config = readAiModelRouterConfig(
    {
      LIFEOS_AI_ROUTER_ENABLED: "true",
      LIFEOS_AI_ROUTER_PAID_REQUESTS_ENABLED: "true",
      LIFEOS_AI_ROUTER_MAX_REQUEST_COST_MICROS: "1000000",
      LIFEOS_AI_ROUTER_MAX_DAILY_COST_MICROS: "2000000",
      OPENROUTER_API_KEY: KEY,
      LIFEOS_OPENROUTER_KEY_OTHER: OTHER_KEY,
      LIFEOS_AI_ROUTER_CREDENTIALS_JSON: JSON.stringify([
        {
          id: "owner-project",
          provider: "openrouter",
          ownerUserId: OWNER,
          features: ["chat", "meal_photo"],
          env: "OPENROUTER_API_KEY",
        },
        {
          id: "other-project",
          provider: "openrouter",
          ownerUserId: OTHER,
          features: ["chat"],
          env: "LIFEOS_OPENROUTER_KEY_OTHER",
        },
      ]),
      LIFEOS_AI_ROUTER_MODELS_JSON: JSON.stringify([
        {
          id: "fixture-model",
          label: "Mock reviewed catalog model",
          provider: "openrouter",
          model: "fixture/http-model",
          tiers: ["balanced"],
          capabilities: ["text", "json"],
          billing: "api",
          inputCostMicrosPer1k: 1000,
          outputCostMicrosPer1k: 2000,
          verifiedAt: new Date(now).toISOString(),
          source: "https://openrouter.ai/docs/models",
          credentialIds: ["owner-project", "other-project"],
          providerOnly: ["synthetic-provider"],
          requireZdr: true,
          sort: "price",
        },
      ]),
    },
    now,
  );
  expect(config.configurationInvalid).toBe(false);
  const router = new AiModelRouter(config, {
    settings: settingsStore,
    governor: createAiGovernor({ source: {}, store: { reserve, finish } }),
    fetchImpl: providerFetch,
    now: () => now,
  });
  const sendMessage = vi.fn(async () => ({ message_id: 1 }));
  const server = createBotServer({
    store,
    aiRouter: router,
    telegram: { sendMessage } as unknown as TelegramClient,
    config: {
      telegramBotToken: BOT_TOKEN,
      webSessionSecret: "router-http-web-session-fixture",
      nodeEnv: "production",
      telegramWebhookSecret: "router-fixture-webhook-secret",
      corsAllowedOrigins: [ORIGIN],
    },
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = (
    resource = "/settings",
    method = "GET",
    body?: unknown,
    id = 30,
    extraHeaders: Record<string, string> = {},
  ) =>
    fetch(base + PATH + resource, {
      method,
      headers: { ...telegramHeaders(id), ...extraHeaders },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const session = (userId = OWNER) => {
    const token = createWebSessionToken();
    sessions.set(hashWebToken(token), userId);
    return token;
  };
  return {
    base,
    request,
    rows,
    users,
    get,
    save,
    getRecent,
    reserve,
    finish,
    providerFetch,
    sendMessage,
    domainWrite,
    resolveTelegramUser,
    resolveWebSession,
    resolveUserById,
    session,
    sessions,
  };
}

describe("AI router authenticated HTTP settings and preview", () => {
  it("reads a default policy without creating an opt-in and projects only the authenticated owner's key labels", async () => {
    const f = await fixture();
    const response = await f.request();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.data.settings).toEqual(defaultAiRouterSettings());
    expect(body.data.revision).toBe(0);
    expect(
      body.data.providers.find(
        (provider: { id: string }) => provider.id === "openrouter",
      ),
    ).toMatchObject({
      status: "configured_unverified",
      credentialLabels: ["owner-project"],
      verified: false,
    });
    expect(body.data.chatgptPlan).toMatchObject({
      status: "prepared",
      identityConnected: false,
      planUsageAuthorized: false,
      usesApiCredits: false,
    });
    expect(f.get).toHaveBeenCalledWith(OWNER);
    expect(f.getRecent).toHaveBeenCalledWith(OWNER);
    expect(f.rows.has(OWNER)).toBe(false);
    expect(f.save).not.toHaveBeenCalled();
    for (const forbidden of [
      KEY,
      OTHER_KEY,
      OTHER,
      "other-project",
      "OPENROUTER_API_KEY",
    ])
      expect(JSON.stringify(body)).not.toContain(forbidden);
    expect(f.providerFetch).not.toHaveBeenCalled();
    expect(f.reserve).not.toHaveBeenCalled();
  });

  it("saves, replays and reloads only the current owner's revisioned policy without inference or messages", async () => {
    const f = await fixture();
    const settings = approved();
    const response = await f.request("/settings", "PUT", {
      settings,
      expectedRevision: 0,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      data: { settings, revision: 1 },
    });
    const replay = await f.request("/settings", "PUT", {
      settings,
      expectedRevision: 0,
    });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ data: { revision: 1 } });
    expect(await (await f.request()).json()).toMatchObject({
      data: { settings, revision: 1 },
    });
    expect(f.save.mock.calls.every(([owner]) => owner === OWNER)).toBe(true);
    expect(f.rows.get(OTHER)?.revision).toBe(7);
    expect(f.rows.get(OTHER)?.settings.spending.maxDailyCostMicros).toBe(42);
    expect(f.providerFetch).not.toHaveBeenCalled();
    expect(f.reserve).not.toHaveBeenCalled();
    expect(f.finish).not.toHaveBeenCalled();
    expect(f.sendMessage).not.toHaveBeenCalled();
    expect(f.domainWrite).not.toHaveBeenCalled();
  });

  it("rejects stale edits instead of overwriting the saved owner policy", async () => {
    const f = await fixture();
    const first = approved();
    expect(
      (
        await f.request("/settings", "PUT", {
          settings: first,
          expectedRevision: 0,
        })
      ).status,
    ).toBe(200);
    const second = structuredClone(first);
    second.mode = "manual";
    second.manualModelId = "fixture-model";
    const conflict = await f.request("/settings", "PUT", {
      settings: second,
      expectedRevision: 0,
    });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({
      error: "ai_router_settings_conflict",
    });
    expect(f.rows.get(OWNER)).toEqual({ settings: first, revision: 1 });
  });

  it("rejects client-selected owners, secrets, endpoints and unknown policy fields before writes", async () => {
    const f = await fixture();
    const valid = { settings: approved(), expectedRevision: 0 };
    for (const body of [
      { ...valid, user_id: OTHER },
      { ...valid, userId: OTHER },
      { ...valid, provider: "openai" },
      { ...valid, apiKey: KEY },
      { ...valid, url: "https://untrusted.example" },
      { ...valid, settings: { ...valid.settings, apiKey: KEY } },
      {
        ...valid,
        settings: { ...valid.settings, baseUrl: "http://127.0.0.1/admin" },
      },
    ]) {
      const response = await f.request("/settings", "PUT", body);
      expect(response.status).toBe(400);
      expect(JSON.stringify(await response.json())).not.toContain(KEY);
    }
    expect(f.save).not.toHaveBeenCalled();
    expect(f.providerFetch).not.toHaveBeenCalled();
    expect(f.rows.has(OWNER)).toBe(false);
  });

  it("rejects every query selector and cannot target another owner", async () => {
    const f = await fixture();
    for (const resource of [
      "/settings?user_id=" + OTHER,
      "/settings?userId=" + OTHER,
      "/settings?url=https://untrusted.example",
      "/settings?date=2026-11-03",
      "/preview?user_id=" + OTHER,
    ]) {
      const response = await f.request(
        resource,
        resource.startsWith("/preview") ? "POST" : "GET",
        resource.startsWith("/preview")
          ? { category: "chat", estimatedInputTokens: 10, maxOutputTokens: 20 }
          : undefined,
      );
      expect(response.status).toBe(400);
    }
    expect(f.get).not.toHaveBeenCalled();
    expect(f.save).not.toHaveBeenCalled();
    expect(f.providerFetch).not.toHaveBeenCalled();
    const other = await f.request("/settings", "GET", undefined, 31);
    expect(other.status).toBe(200);
    expect(await other.json()).toMatchObject({
      data: { revision: 7, settings: { spending: { maxDailyCostMicros: 42 } } },
    });
    expect(f.get).toHaveBeenLastCalledWith(OTHER);
  });

  it("authenticates missing, malformed, expired and future Telegram claims before reading settings", async () => {
    const f = await fixture();
    const now = Math.floor(Date.now() / 1000);
    const wrong = telegramHeaders();
    wrong["x-telegram-init-data"] = wrong["x-telegram-init-data"].replace(
      /hash=[^&]+/,
      "hash=" + "0".repeat(64),
    );
    const invalidHeaders: Record<string, string>[] = [
      {},
      wrong,
      telegramHeaders(30, now - 90_000),
      telegramHeaders(30, now + 3600),
    ];
    for (const headers of invalidHeaders) {
      const response = await fetch(f.base + PATH + "/settings", { headers });
      expect(response.status).toBe(401);
    }
    expect(f.get).not.toHaveBeenCalled();
    expect(f.save).not.toHaveBeenCalled();
    expect(f.providerFetch).not.toHaveBeenCalled();
  });

  it.each(["pending", "blocked"] as const)(
    "blocks a %s profile on reads, settings writes and previews",
    async (status) => {
      const f = await fixture();
      f.users.set(30, { ...f.users.get(30)!, status });
      for (const [resource, method, body] of [
        ["/settings", "GET", undefined],
        ["/settings", "PUT", { settings: approved(), expectedRevision: 0 }],
        [
          "/preview",
          "POST",
          { category: "chat", estimatedInputTokens: 10, maxOutputTokens: 20 },
        ],
      ] as const) {
        const response = await f.request(resource, method, body);
        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({
          error:
            status === "pending"
              ? "telegram_user_pending"
              : "telegram_user_blocked",
        });
      }
      expect(f.get).not.toHaveBeenCalled();
      expect(f.save).not.toHaveBeenCalled();
      expect(f.reserve).not.toHaveBeenCalled();
      expect(f.providerFetch).not.toHaveBeenCalled();
    },
  );

  it("rejects an unlinked signed Telegram user", async () => {
    const f = await fixture();
    const response = await f.request("/settings", "GET", undefined, 99);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "telegram_user_not_linked",
    });
    expect(f.get).not.toHaveBeenCalled();
  });

  it("accepts only a live opaque web session and never falls back from an invalid bearer to valid Telegram data", async () => {
    const f = await fixture();
    const token = f.session();
    expect(
      (
        await f.request("/settings", "GET", undefined, 31, {
          authorization: "Bearer " + token,
        })
      ).status,
    ).toBe(200);
    expect(f.get).toHaveBeenLastCalledWith(OWNER);
    f.get.mockClear();
    f.resolveTelegramUser.mockClear();
    f.sessions.delete(hashWebToken(token));
    for (const value of [token, "invalid"])
      expect(
        (
          await f.request("/settings", "GET", undefined, 30, {
            authorization: "Bearer " + value,
          })
        ).status,
      ).toBe(401);
    expect(f.resolveTelegramUser).not.toHaveBeenCalled();
    expect(f.get).not.toHaveBeenCalled();
    const fresh = f.session();
    f.users.set(30, { ...f.users.get(30)!, status: "blocked" });
    expect(
      (
        await f.request("/settings", "GET", undefined, 30, {
          authorization: "Bearer " + fresh,
        })
      ).status,
    ).toBe(401);
    expect(f.get).not.toHaveBeenCalled();
    expect(f.save).not.toHaveBeenCalled();
  });

  it("keeps previews entirely offline even when both operator and owner authorize paid models", async () => {
    const f = await fixture();
    expect(
      (
        await f.request("/settings", "PUT", {
          settings: approved(),
          expectedRevision: 0,
        })
      ).status,
    ).toBe(200);
    const response = await f.request("/preview", "POST", {
      category: "chat",
      estimatedInputTokens: 100,
      maxOutputTokens: 100,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      data: {
        providerRequests: 0,
        budgetEnforcedAtExecution: true,
        decision: {
          kind: "selected",
          candidates: [
            {
              modelId: "fixture-model",
              provider: "openrouter",
              billing: "api",
            },
          ],
        },
      },
    });
    const local = await f.request("/preview", "POST", {
      category: "tagging",
      estimatedInputTokens: 0,
      maxOutputTokens: 1,
    });
    expect(await local.json()).toMatchObject({
      data: {
        providerRequests: 0,
        decision: { kind: "deterministic", candidates: [] },
      },
    });
    expect(f.providerFetch).not.toHaveBeenCalled();
    expect(f.reserve).not.toHaveBeenCalled();
    expect(f.finish).not.toHaveBeenCalled();
    expect(f.sendMessage).not.toHaveBeenCalled();
  });

  it("cannot turn preview into inference or bypass privacy with raw request fields", async () => {
    const f = await fixture();
    const valid = {
      category: "chat",
      estimatedInputTokens: 100,
      maxOutputTokens: 100,
    };
    for (const extra of [
      { user_id: OTHER },
      { messages: [{ role: "user", content: "Hidden inference" }] },
      { prompt: "Hidden inference" },
      { apiKey: KEY },
      { provider: "openai" },
      { baseUrl: "https://untrusted.example" },
      { dataCategories: ["general"] },
      { paidAuthorized: true },
      { execute: true },
    ])
      expect(
        (await f.request("/preview", "POST", { ...valid, ...extra })).status,
      ).toBe(400);
    expect(f.get).not.toHaveBeenCalled();
    expect(f.save).not.toHaveBeenCalled();
    expect(f.providerFetch).not.toHaveBeenCalled();
    expect(f.reserve).not.toHaveBeenCalled();
  });

  it("returns safe unavailable decisions rather than making a diagnostic provider call", async () => {
    const f = await fixture();
    const response = await f.request("/preview", "POST", {
      category: "nutrition_photo",
      estimatedInputTokens: 100,
      maxOutputTokens: 100,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { providerRequests: 0, decision: { kind: "unavailable" } },
    });
    expect(f.providerFetch).not.toHaveBeenCalled();
    expect(f.reserve).not.toHaveBeenCalled();
  });

  it("rejects unsupported methods and exposes no credential, OAuth, execution or administrator routes", async () => {
    const f = await fixture();
    for (const [resource, methods] of [
      ["/settings", ["POST", "PATCH", "DELETE"]],
      ["/preview", ["GET", "PUT", "PATCH", "DELETE"]],
    ] as const)
      for (const method of methods)
        expect(
          (
            await f.request(
              resource,
              method,
              ["GET", "DELETE"].includes(method) ? undefined : {},
            )
          ).status,
        ).toBe(405);
    for (const resource of [
      "/credentials",
      "/connect",
      "/execute",
      "/admin",
      "/keys",
      "/oauth/callback",
    ])
      for (const method of ["GET", "POST", "PUT"])
        expect(
          (await f.request(resource, method, method === "GET" ? undefined : {}))
            .status,
        ).toBe(404);
    expect(f.get).not.toHaveBeenCalled();
    expect(f.save).not.toHaveBeenCalled();
    expect(f.providerFetch).not.toHaveBeenCalled();
    expect(f.sendMessage).not.toHaveBeenCalled();
  });

  it("enforces exact production CORS before authentication or storage access", async () => {
    const f = await fixture();
    const response = await f.request(
      "/settings",
      "PUT",
      { settings: approved(), expectedRevision: 0 },
      30,
      { origin: "https://lifeos.test.attacker.invalid" },
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "origin_not_allowed" });
    expect(f.resolveTelegramUser).not.toHaveBeenCalled();
    expect(f.get).not.toHaveBeenCalled();
    expect(f.save).not.toHaveBeenCalled();
    const valid = await f.request("/settings", "GET", undefined, 30, {
      origin: ORIGIN,
    });
    expect(valid.status).toBe(200);
    expect(valid.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  });

  it("preserves malformed JSON and oversized-body status codes without calling the store", async () => {
    const f = await fixture();
    const invalid = await fetch(f.base + PATH + "/settings", {
      method: "PUT",
      headers: telegramHeaders(),
      body: "{invalid-json",
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: "invalid_json" });
    const oversized = await fetch(f.base + PATH + "/settings", {
      method: "PUT",
      headers: telegramHeaders(),
      body: JSON.stringify({ padding: "x".repeat(70_000) }),
    });
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toMatchObject({
      error: "request_body_too_large",
    });
    expect(f.get).not.toHaveBeenCalled();
    expect(f.save).not.toHaveBeenCalled();
    expect(f.providerFetch).not.toHaveBeenCalled();
  });
});
