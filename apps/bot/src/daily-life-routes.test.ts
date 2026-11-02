import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_DAILY_LIFE_PREFERENCES,
  DailyLifeConflictError,
  type TaskWorkspaceItem,
} from "@lifeos/core";
import {
  DailyLifeNotFoundError,
  type LifeOSStore,
  type HealthSyncStatusSummary,
  type TelegramUserRecord,
} from "@lifeos/db";
import { createBotServer } from "./server.js";
import { createWebSessionToken, hashWebToken } from "./web-session.js";

const BOT = "daily-life-http-synthetic-bot";
const OWNER = "00000000-0000-4000-8000-000000000020";
const FOREIGN = "00000000-0000-4000-8000-000000000021";
const ENTRY = "00000000-0000-4000-8000-000000001020";
const TASK = "00000000-0000-4000-8000-000000002020";
const DATE = "2026-11-03";
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
function telegramHeaders(id = 20, authDate = Math.floor(Date.now() / 1000)) {
  const p = new URLSearchParams({
    auth_date: String(authDate),
    user: JSON.stringify({ id, first_name: "Synthetic daily-life" }),
  });
  const check = [...p]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(BOT).digest();
  p.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return {
    "x-telegram-init-data": p.toString(),
    "content-type": "application/json",
  };
}
async function fixture(status: TelegramUserRecord["status"] = "active") {
  const user = (id = 20): TelegramUserRecord => ({
    userId: id === 20 ? OWNER : FOREIGN,
    telegramUserId: id,
    displayName: "Synthetic owner",
    username: null,
    timezone: "Asia/Almaty",
    status,
    role: "user",
  });
  const token = createWebSessionToken();
  let prefs = { ...DEFAULT_DAILY_LIFE_PREFERENCES };
  const water = new Map<
    string,
    { amount: number; source: string; undone: boolean }
  >();
  const hydration = vi.fn(
    async (userId: string, date: string, timezone: string) => ({
      date,
      timezone,
      totalMl: [...water.entries()]
        .filter(([key, v]) => key.startsWith(userId + ":") && !v.undone)
        .reduce((n, [, v]) => n + v.amount, 0),
      entries: [],
      truncated: false,
    }),
  );
  const logWater = vi.fn(
    async (
      userId: string,
      amount: number,
      requestId: string,
      source: string,
    ) => {
      const key = userId + ":" + requestId;
      const old = water.get(key);
      if (old && (old.amount !== amount || old.source !== source))
        throw new DailyLifeConflictError();
      water.set(key, old ?? { amount, source, undone: false });
      return DATE;
    },
  );
  const undoWater = vi.fn(async (userId: string, entryId: string) => {
    if (userId !== OWNER || entryId !== ENTRY)
      throw new DailyLifeNotFoundError();
    for (const [key, v] of water)
      if (key.startsWith(userId + ":")) v.undone = true;
    return DATE;
  });
  const preferences = vi.fn(async () => ({ ...prefs }));
  const savePreferences = vi.fn(
    async (_userId: string, input: typeof prefs) => {
      if (input.revision !== prefs.revision) throw new DailyLifeConflictError();
      prefs = { ...input, revision: prefs.revision + 1 };
      return { ...prefs };
    },
  );
  const task: TaskWorkspaceItem = {
    id: TASK,
    title: "Actual saved task",
    notes: "",
    dueAt: null,
    status: "next",
    updatedAt: "2026-11-03T05:00:00.000Z",
    completedAt: null,
    priority: 2,
  };
  const tasks = vi.fn(async () => ({ tasks: [task], truncated: false }));
  const manageTask = vi.fn(
    async (
      _userId: string,
      taskId: string | null,
      _requestId: string | null,
      patch: Record<string, unknown>,
      expected: string | null,
    ) => {
      if (taskId && expected !== task.updatedAt)
        throw new DailyLifeConflictError();
      return { ...task, ...patch };
    },
  );
  const getIdealHumanDays = vi.fn(async () => []);
  const getHealthMetricDay = vi.fn(async () => ({
    date: DATE,
    metrics: {},
    records: [],
    sources: [],
    sourceLabel: null,
    latestSource: null,
    missingMetrics: {},
  }));
  const getHealthSyncStatus = vi.fn(
    async (): Promise<HealthSyncStatusSummary> => ({
      counts: {},
      runs: [],
      latestRun: null,
    }),
  );
  const getTmaStudySummary = vi.fn(async () => ({
    timezone: "Asia/Almaty",
    courses: [],
    records: [],
  }));
  const getWorkoutHistory = vi.fn(async () => []);
  const getLmsWork = vi.fn(async () => ({
    timezone: "Asia/Almaty",
    items: [],
    stale: true,
    truncated: false,
    warnings: [],
    unsupportedFeatures: [],
    lastSyncSuccessAt: null,
    lastSyncAttemptAt: null,
  }));
  const getLmsConnection = vi.fn(async () => ({
    configured: false,
    state: "not_configured",
    lastSyncSuccessAt: null,
    lastSyncAttemptAt: null,
    lastErrorCategory: null,
    sessionExpiresAt: null,
    syncRequestedAt: null,
    unsupportedFeatures: [],
  }));
  const saveLmsSession = vi.fn(),
    requestLmsSync = vi.fn(),
    deleteLmsSession = vi.fn(),
    addManualStudyWork = vi.fn();
  const resolveTelegramUser = vi.fn(async (id: number) => user(id));
  const resolveWebSession = vi.fn(async (hash: string) =>
    hash === hashWebToken(token) ? OWNER : null,
  );
  const resolveUserById = vi.fn(async () => user());
  const store = {
    resolveTelegramUser,
    resolveWebSession,
    resolveUserById,
    getIdealHumanDays,
    getHealthMetricDay,
    getHealthSyncStatus,
    getTmaStudySummary,
    getWorkoutHistory,
    getLmsWork,
    getLmsConnection,
    saveLmsSession,
    requestLmsSync,
    deleteLmsSession,
    addManualStudyWork,
    dailyLife: {
      hydration,
      logWater,
      undoWater,
      tasks,
      manageTask,
      preferences,
      savePreferences,
    },
  } as unknown as LifeOSStore;
  const server = createBotServer({
    store,
    config: { telegramBotToken: BOT, allowUnsafeTmaDevAuth: false },
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = (path: string, method = "GET", body?: unknown, id = 20) =>
    fetch(base + path, {
      method,
      headers: telegramHeaders(id),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  const web = (path: string, method = "GET", body?: unknown) =>
    fetch(base + path, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  return {
    base,
    call,
    web,
    water,
    hydration,
    logWater,
    undoWater,
    preferences,
    savePreferences,
    tasks,
    manageTask,
    getIdealHumanDays,
    getHealthMetricDay,
    getHealthSyncStatus,
    getTmaStudySummary,
    getWorkoutHistory,
    getLmsWork,
    getLmsConnection,
    saveLmsSession,
    requestLmsSync,
    deleteLmsSession,
    addManualStudyWork,
    resolveTelegramUser,
    resolveWebSession,
    task,
  };
}

describe("Daily Life HTTP authenticated owner boundary", () => {
  it("rejects unauthenticated reads and writes before touching private stores", async () => {
    const f = await fixture();
    for (const [path, method] of [
      ["/api/tma/daily-life/summary", "GET"],
      ["/api/tma/hydration", "POST"],
      ["/api/tma/tasks", "POST"],
      ["/api/tma/daily-life/preferences", "PUT"],
    ]) {
      const r = await fetch(f.base + path, {
        method,
        ...(method !== "GET" ? { body: "unparsed malformed input" } : {}),
      });
      expect(r.status).toBe(401);
    }
    for (const op of [
      f.hydration,
      f.logWater,
      f.tasks,
      f.savePreferences,
      f.getIdealHumanDays,
    ])
      expect(op).not.toHaveBeenCalled();
  });
  it.each(["pending", "blocked"] as const)(
    "rejects signed %s profiles",
    async (status) => {
      const f = await fixture(status);
      expect((await f.call("/api/tma/hydration")).status).toBe(403);
      expect(f.hydration).not.toHaveBeenCalled();
    },
  );
  it("rejects expired Telegram signatures and explicit invalid web credentials", async () => {
    const f = await fixture();
    expect(
      (
        await fetch(f.base + "/api/tma/hydration", {
          headers: telegramHeaders(20, 1),
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await fetch(f.base + "/api/tma/hydration", {
          headers: { ...telegramHeaders(), authorization: "Bearer invalid" },
        })
      ).status,
    ).toBe(401);
    expect(f.hydration).not.toHaveBeenCalled();
  });
  it("scopes reads to resolved identity and ignores a foreign query hint", async () => {
    const f = await fixture();
    const r = await f.call(`/api/tma/hydration?date=${DATE}&userId=${FOREIGN}`);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(f.hydration).toHaveBeenCalledWith(OWNER, DATE, "Asia/Almaty");
    await f.call(`/api/tma/hydration?date=${DATE}`, "GET", undefined, 21);
    expect(f.hydration).toHaveBeenLastCalledWith(FOREIGN, DATE, "Asia/Almaty");
  });
  it("rejects foreign body injection and invalid/partial water input without writes", async () => {
    const f = await fixture();
    for (const body of [
      { amountMl: 250, requestId: "water-http-0001", userId: FOREIGN },
      { amountMl: 0, requestId: "water-http-0001" },
      { amountMl: 5001, requestId: "water-http-0001" },
      { amountMl: 250 },
      { requestId: "water-http-0001" },
    ])
      expect((await f.call("/api/tma/hydration", "POST", body)).status).toBe(
        400,
      );
    expect(f.logWater).not.toHaveBeenCalled();
    expect((await f.call("/api/tma/hydration?date=2026-02-30")).status).toBe(
      400,
    );
    expect(f.hydration).not.toHaveBeenCalled();
  });
  it("forwards stable water request IDs, reloads persistence and retains owner/source", async () => {
    const f = await fixture();
    const body = { amountMl: 250, requestId: "water-http-0001" };
    for (let n = 0; n < 2; n++) {
      const r = await f.call("/api/tma/hydration", "POST", body);
      expect(r.status).toBe(200);
      expect((await r.json()).data.totalMl).toBe(250);
    }
    expect(f.logWater).toHaveBeenLastCalledWith(
      OWNER,
      250,
      body.requestId,
      "tma",
    );
    expect(
      (await (await f.call(`/api/tma/hydration?date=${DATE}`)).json()).data
        .totalMl,
    ).toBe(250);
    const web = await f.web("/api/tma/hydration", "POST", {
      amountMl: 100,
      requestId: "water-web-000001",
    });
    expect(web.status).toBe(200);
    expect(f.logWater).toHaveBeenLastCalledWith(
      OWNER,
      100,
      "water-web-000001",
      "web",
    );
    expect(
      (await f.call("/api/tma/hydration", "POST", { ...body, amountMl: 300 }))
        .status,
    ).toBe(409);
  });
  it("keeps undo owner scoped and does not disclose foreign records", async () => {
    const f = await fixture();
    await f.call("/api/tma/hydration", "POST", {
      amountMl: 250,
      requestId: "water-http-0001",
    });
    const path = `/api/tma/hydration/${ENTRY}/undo`;
    expect((await f.call(path, "POST", {}, 21)).status).toBe(404);
    expect(f.undoWater).toHaveBeenLastCalledWith(FOREIGN, ENTRY);
    for (let n = 0; n < 2; n++) {
      const r = await f.call(path, "POST", {});
      expect(r.status).toBe(200);
      expect((await r.json()).data.totalMl).toBe(0);
    }
    expect((await f.call(path, "POST", { userId: FOREIGN })).status).toBe(400);
  });
  it("validates task create/update and returns CAS conflicts with no successful overwrite", async () => {
    const f = await fixture();
    expect(
      (
        await f.call("/api/tma/tasks", "POST", {
          requestId: "task-http-000001",
          title: "Prepare gym bag",
          dueAt: null,
        })
      ).status,
    ).toBe(200);
    expect(f.manageTask).toHaveBeenLastCalledWith(
      OWNER,
      null,
      "task-http-000001",
      { title: "Prepare gym bag", notes: "", dueAt: null },
      null,
    );
    expect(
      (
        await f.call(`/api/tma/tasks/${TASK}`, "PATCH", {
          status: "done",
          expectedUpdatedAt: "2026-11-03T04:00:00Z",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await f.call(`/api/tma/tasks/${TASK}`, "PATCH", {
          status: "done",
          expectedUpdatedAt: f.task.updatedAt,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await f.call("/api/tma/tasks", "POST", {
          requestId: "task-http-000002",
          title: "foreign",
          userId: FOREIGN,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await f.call(`/api/tma/tasks/${TASK}`, "PATCH", {
          status: null,
          expectedUpdatedAt: f.task.updatedAt,
        })
      ).status,
    ).toBe(400);
  });
  it("shows default OFF preferences, validates explicit choices and returns revision conflicts", async () => {
    const f = await fixture();
    const first = await f.call("/api/tma/daily-life/preferences");
    expect(await first.json()).toEqual({
      data: DEFAULT_DAILY_LIFE_PREFERENCES,
    });
    expect(
      (
        await f.call("/api/tma/daily-life/preferences", "PUT", {
          ...DEFAULT_DAILY_LIFE_PREFERENCES,
          morningEnabled: true,
        })
      ).status,
    ).toBe(200);
    expect(f.savePreferences).toHaveBeenLastCalledWith(OWNER, {
      ...DEFAULT_DAILY_LIFE_PREFERENCES,
      morningEnabled: true,
    });
    expect(
      (
        await f.call(
          "/api/tma/daily-life/preferences",
          "PUT",
          DEFAULT_DAILY_LIFE_PREFERENCES,
        )
      ).status,
    ).toBe(409);
    for (const body of [
      { morningEnabled: true },
      { ...DEFAULT_DAILY_LIFE_PREFERENCES, userId: FOREIGN },
      { ...DEFAULT_DAILY_LIFE_PREFERENCES, morningTime: "25:00" },
    ])
      expect(
        (await f.call("/api/tma/daily-life/preferences", "PUT", body)).status,
      ).toBe(400);
  });
  it("returns a partial summary with missing measurements and fixed source warnings", async () => {
    const f = await fixture();
    f.getHealthMetricDay.mockRejectedValueOnce(
      new Error("private-provider-token-must-not-leak"),
    );
    f.getLmsWork.mockRejectedValueOnce(
      new Error("private-provider-token-must-not-leak"),
    );
    const r = await f.call(`/api/tma/daily-life/summary?date=${DATE}`);
    expect(r.status).toBe(200);
    const { data } = await r.json();
    expect(data).toMatchObject({
      date: DATE,
      dayNumber: 1,
      generatedBy: "deterministic",
      health: { sleepMinutes: null, weightKg: null },
      nutrition: { caloriesKcal: null, proteinG: null },
    });
    expect(data.sourceWarnings).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^Health unavailable/),
        expect.stringMatching(/^LMS unavailable/),
      ]),
    );
    expect(JSON.stringify(data)).not.toContain("private-provider-token");
    expect(JSON.stringify(data.morning)).toContain("Алинур");
    expect(JSON.stringify(data.morning)).toContain("Мафия");
    expect(JSON.stringify(data.evening)).toMatch(/не сохран|not saved/i);
    expect(f.getIdealHumanDays).toHaveBeenCalledWith(OWNER);
    expect(f.getWorkoutHistory).toHaveBeenCalledWith(OWNER);
  });
  it("projects only safe ingest status metadata and keeps record timestamps distinct", async () => {
    const f = await fixture();
    const run = {
      id: "internal-provider-row-must-not-leak",
      syncDate: DATE,
      syncReason: "manual",
      status: "failed" as const,
      dataCompletenessScore: null,
      missingMetrics: {},
      completedAt: "2026-11-03T02:00:00Z",
      error: "provider-token-must-not-leak",
    };
    f.getHealthSyncStatus.mockResolvedValueOnce({
      counts: { failed: 1, success: 1 },
      latestRun: run,
      runs: [
        run,
        {
          ...run,
          status: "success",
          completedAt: "2026-11-02T23:00:00Z",
          error: null,
        },
      ],
    });
    const { data } = await (
      await f.call(`/api/tma/daily-life/summary?date=${DATE}`)
    ).json();
    expect(data.healthSync).toEqual({
      available: true,
      latestStatus: "failed",
      latestCompletedAt: "2026-11-03T02:00:00.000Z",
      recentSuccessAt: "2026-11-02T23:00:00.000Z",
      historyLimit: 5,
    });
    expect(data.health.lastSyncAt).toBeNull();
    expect(JSON.stringify(data)).not.toContain("must-not-leak");
    expect(f.getHealthSyncStatus).toHaveBeenCalledWith(OWNER);
  });
  it("keeps unknown sync status unavailable without exposing provider failures", async () => {
    const f = await fixture();
    f.getHealthSyncStatus.mockRejectedValueOnce(
      new Error("provider-token-must-not-leak"),
    );
    const { data } = await (
      await f.call(`/api/tma/daily-life/summary?date=${DATE}`)
    ).json();
    expect(data.healthSync).toMatchObject({
      available: false,
      latestStatus: null,
      recentSuccessAt: null,
    });
    expect(data.sourceWarnings).toContain(
      "Health sync unavailable; previous stored data was not changed.",
    );
    expect(JSON.stringify(data)).not.toContain("provider-token");
  });
  it("permits only exact safe LMS web reads and keeps credential mutations Telegram-only", async () => {
    const f = await fixture();
    for (const path of ["/api/tma/lms/work", "/api/tma/lms/connection"])
      expect((await f.web(path)).status).toBe(200);
    expect(f.getLmsWork).toHaveBeenCalledWith(OWNER, "Asia/Almaty");
    expect(f.getLmsConnection).toHaveBeenCalledWith(OWNER);
    for (const [path, method] of [
      ["/api/tma/lms/session/validate", "POST"],
      ["/api/tma/lms/session/save", "POST"],
      ["/api/tma/lms/sync", "POST"],
      ["/api/tma/lms/session", "DELETE"],
      ["/api/tma/lms/work/manual", "POST"],
      ["/api/tma/lms/connection/", "GET"],
    ])
      expect(
        (
          await f.web(
            path,
            method,
            method === "GET"
              ? undefined
              : { cookie: "never accepted from web" },
          )
        ).status,
      ).toBe(401);
    for (const op of [
      f.saveLmsSession,
      f.requestLmsSync,
      f.deleteLmsSession,
      f.addManualStudyWork,
    ])
      expect(op).not.toHaveBeenCalled();
  });
});
