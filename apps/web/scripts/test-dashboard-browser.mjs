// Production Next artifact, isolated loopback fixture API, real browser and authentication flow.
// pnpm exec tsx apps/web/scripts/test-dashboard-browser.mjs
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { execFileSync } from "node:child_process";
import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile, rename } from "node:fs/promises";
import { resolve, basename } from "node:path";
import {
  clearIdealHumanReflection,
  emptyIdealHumanDay,
  hasIdealHumanReflection,
  idealHumanDate,
  idealHumanDayNumber,
  idealHumanLocalDate,
  parseIdealHumanDay,
} from "../../../packages/core/src/ideal-human.ts";
import { DEFAULT_DAILY_LIFE_PREFERENCES } from "../../../packages/core/src/daily-life.ts";
import {
  AI_ROUTER_PROVIDERS,
  defaultAiRouterSettings,
  parseAiRouterSettings,
} from "../../../packages/core/src/ai-model-router.ts";
import { captureBrowserFixture } from "../../../scripts/capture-browser-fixtures.mjs";
import { captureBrowserScenarios } from "../../../scripts/capture-browser-scenarios.mjs";
import { academicBrowserFixture } from "../../../scripts/academic-browser-fixtures.mjs";
import { academicBrowserScenarios } from "../../../scripts/academic-browser-scenarios.mjs";
import {
  v6BrowserFixture,
  V6_VIEWPORTS,
  V6_SCENARIO_COUNT,
} from "../../../scripts/v6-browser-fixtures.mjs";
import {
  v6BrowserDriver,
  v6CourseAndHomeScenarios,
  v6PolicyAndPreferenceScenarios,
} from "../../../scripts/v6-browser-scenarios.mjs";
import {
  freeRouterBrowserSnapshot,
  assertFreeRouterBrowserPanel,
} from "../../../scripts/free-ai-router-browser-fixtures.mjs";
const { chromium } = await import(
  process.env.LIFEOS_PLAYWRIGHT_MODULE || "playwright"
);
const workspace = resolve(new URL("../../..", import.meta.url).pathname);
const artifacts = resolve(
  process.env.LIFEOS_WEB_BROWSER_ARTIFACTS ||
    "/tmp/lifeos-web-dashboard-browser",
);
await mkdir(artifacts, { recursive: true });
const sessionA = "ws1_" + "A".repeat(43),
  sessionB = "ws1_" + "B".repeat(43);
// User-supplied profile names can contain long unbroken words, handles or IDs.
const fixtureDisplayName = (owner) =>
  `Fixture owner ${owner} ${"0123456789abcdef".repeat(4)}`;
const sessions = new Map([
  [sessionA, "A"],
  [sessionB, "B"],
]);
const logins = new Set();
const days = new Map([
  ["A", []],
  ["B", []],
]);
const tasks = new Map([
  ["A", []],
  ["B", []],
]);
const water = new Map([
  ["A", []],
  ["B", []],
]);
const receipts = new Map();
const captureFixtures = new Map([
  ["A", captureBrowserFixture("A")],
  ["B", captureBrowserFixture("B")],
]);
const academicFixtures = new Map([
  ["A", academicBrowserFixture("A")],
  ["B", academicBrowserFixture("B")],
]);
const v6Fixtures = new Map([
  ["A", v6BrowserFixture("A")],
  ["B", v6BrowserFixture("B")],
]);
const v6FixtureHistory = [...v6Fixtures.values()];
const routerSettings = new Map([
  ["A", { settings: defaultAiRouterSettings(), revision: 0 }],
  ["B", { settings: defaultAiRouterSettings(), revision: 0 }],
]);
let routerSettingsPuts = 0,
  routerSaveFailure = 0,
  routerChatEnabled = false;
let routerFreeProfileState = null;
const routerChats = [];
const routerModels = [
  {
    id: "fixture-or-balanced",
    label: "Fixture OpenRouter Balanced",
    provider: "openrouter",
    model: "fixture/route-balanced",
    tiers: ["fast", "balanced"],
    capabilities: ["text", "json"],
    billing: "api",
    inputCostMicrosPer1k: 100,
    outputCostMicrosPer1k: 200,
    configured: true,
    authorized: true,
    status: "configured",
    privacy: "external",
    metadataVerified: true,
  },
  {
    id: "fixture-gemini-balanced",
    label: "Fixture Gemini Balanced",
    provider: "gemini",
    model: "gemini-fixture-fallback",
    tiers: ["balanced"],
    capabilities: ["text", "json"],
    billing: "api",
    inputCostMicrosPer1k: 300,
    outputCostMicrosPer1k: 500,
    configured: true,
    authorized: true,
    status: "configured",
    privacy: "external",
    metadataVerified: true,
  },
];
const routerSnapshot = (owner) => {
  const snapshot = {
    ...structuredClone(routerSettings.get(owner)),
    models: routerModels.map((model) =>
      owner === "A"
        ? { ...model }
        : {
            ...model,
            configured: false,
            authorized: false,
            status: "disconnected",
          },
    ),
    providers: AI_ROUTER_PROVIDERS.map((id) => ({
      id,
      status:
        id === "chatgpt_plan"
          ? "permission_required"
          : owner === "A" && ["gemini", "openrouter"].includes(id)
            ? "configured_unverified"
            : "not_configured",
      credentialLabels:
        owner === "A" && ["gemini", "openrouter"].includes(id)
          ? ["fixture-" + id + "-project"]
          : [],
      verified: false,
    })),
    recentExecutions: [],
    operatorLimits: {
      routerEnabled: true,
      maxRequestCostMicros: 1_000_000,
      maxDailyCostMicros: 5_000_000,
      paidRequestsEnabled: true,
      maxOutputTokens: 256,
    },
    chatgptPlan: {
      status: "prepared",
      identityConnected: false,
      planUsageAuthorized: false,
      usesApiCredits: false,
      manageUsageUrl: "https://chatgpt.com/settings/usage",
    },
  };
  return routerFreeProfileState
    ? freeRouterBrowserSnapshot(snapshot, {
        status: routerFreeProfileState,
        ownerConfigured: owner === "A",
      })
    : snapshot;
};
let taskVersion = 0,
  waterVersion = 0,
  workout = null;
let journalPuts = 0,
  reflectionClears = 0,
  journalFail = false,
  journalDelay = 0,
  analyses = 0;
const date = "2026-11-03";
const fixtureProgram = {
  title: "Fixture beginner program",
  days: [
    {
      id: "fixture-program-day",
      title: "Fixture light day",
      exercises: [
        {
          name: "Fixture row",
          sets: [{ reps: 8, weightKg: null, restSeconds: 90 }],
        },
      ],
    },
  ],
};
const fixtureHistory = [];
const json = (res, data, status = 200) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(status >= 400 ? data : { data }));
};
const hydration = (owner, targetDate = date) => {
  const entries = water
    .get(owner)
    .filter(
      (entry) => idealHumanLocalDate(new Date(entry.occurredAt)) === targetDate,
    );
  return {
    date: targetDate,
    timezone: "Asia/Almaty",
    totalMl: entries
      .filter((entry) => !entry.undoneAt)
      .reduce((total, entry) => total + entry.amountMl, 0),
    entries,
    truncated: false,
  };
};
const summary = (owner, targetDate = date) => ({
  date: targetDate,
  timezone: "Asia/Almaty",
  dayNumber: idealHumanDayNumber(targetDate),
  health: {
    sleepMinutes: null,
    weightKg: null,
    steps: null,
    workoutMinutes: null,
    lastSyncAt: null,
    sourceLabels: [],
    missing: ["sleepMinutes"],
    devicePermissions: "not_reported",
    warnings: [],
  },
  hydration: hydration(owner, targetDate),
  nutrition: {
    mealCount:
      days.get(owner).find((record) => record.date === targetDate)?.meals
        .length ?? 0,
    caloriesKcal: null,
    proteinG: null,
    fatG: null,
    carbsG: null,
    estimated: true,
    incomplete: true,
  },
  morning: {
    title: "Утренний обзор",
    facts: ["Fixture saved priority"],
    suggestions: ["Fixture optional suggestion"],
    warnings: ["Fixture stale LMS warning"],
    questions: [],
    tomorrowOrder: [],
  },
  evening: {
    title: "Вечерний обзор",
    facts: ["Fixture recorded facts only"],
    suggestions: [],
    warnings: [],
    questions: ["Что получилось?"],
    tomorrowOrder: [],
  },
  documentary: {
    shots: [
      {
        kind: "a_roll",
        title: "Fixture optional diary",
        reason: "Предложение, не снятый материал",
      },
    ],
    filmingDays: 0,
    backupConfirmedDays: 0,
    weeklyReflection: [],
  },
  sourceWarnings: [],
  generatedBy: "deterministic",
});
const dailyPlan = {
  date,
  timezone: "Asia/Almaty",
  mode: "maintenance",
  window: { startsAt: "2026-11-03T03:00:00Z", endsAt: "2026-11-03T17:00:00Z" },
  availableMinutes: 60,
  freeSlots: [],
  conflicts: [],
  rankedTasks: [],
  blocks: [],
  unscheduledTaskIds: [],
  warnings: [],
};
const trace = [];
const backend = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://fixture");
    const path = url.pathname;
    trace.push({
      path,
      method: req.method,
      hasBearer: Boolean(req.headers.authorization),
    });
    const auth = req.headers.authorization ?? "";
    let body = "";
    for await (const chunk of req) body += chunk;
    const input = body ? JSON.parse(body) : {};
    if (path === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ status: "ok" }));
    }
    if (path === "/api/web/auth/exchange") {
      const login = auth.replace("Bearer ", "");
      if (
        !["fixture-login-A", "fixture-login-B"].includes(login) ||
        logins.has(login)
      )
        return json(res, { error: "invalid_web_login" }, 401);
      logins.add(login);
      return json(res, {
        token: login.endsWith("A") ? sessionA : sessionB,
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      });
    }
    const owner = sessions.get(auth.replace("Bearer ", ""));
    if (!owner) return json(res, { error: "invalid_web_session" }, 401);
    if (path === "/api/web/auth/logout") {
      sessions.delete(auth.replace("Bearer ", ""));
      res.writeHead(204);
      return res.end();
    }
    if (path.startsWith("/api/tma/captures")) {
      const result = await captureFixtures
        .get(owner)
        .response(path.slice("/api/tma/".length), req.method, input);
      res.writeHead(result.status, { "content-type": "application/json" });
      return res.end(JSON.stringify(result.body));
    }
    if (path.startsWith("/api/tma/study/concierge")) {
      const result = await academicFixtures
        .get(owner)
        .response(path.slice("/api/tma/".length), req.method, input);
      res.writeHead(result.status, { "content-type": "application/json" });
      return res.end(JSON.stringify(result.body));
    }
    const v6Result = v6Fixtures
      .get(owner)
      .response(
        path.slice("/api/tma/".length),
        req.method,
        input,
        url.searchParams,
      );
    if (v6Result) {
      res.writeHead(v6Result.status, { "content-type": "application/json" });
      return res.end(JSON.stringify(v6Result.body));
    }
    if (path === "/api/tma/session")
      return json(res, {
        state: "active",
        telegramUserId: owner === "A" ? 900001 : 900002,
        displayName: fixtureDisplayName(owner),
        profile: { status: "active", role: "user" },
        integrations: {
          telegram: { connected: true },
          google: {
            connected: false,
            status: "not_configured",
            calendarWriteEnabled: false,
            reconnectRequired: false,
          },
        },
      });
    if (path === "/api/tma/home")
      return json(res, {
        displayName: fixtureDisplayName(owner),
        localDate: date,
        modeLabel: "Normal",
        modeReason: "Fixture factual mode",
        recoveryMode: "baseline",
        focusScore: null,
        pendingSyncCount: 0,
      });
    if (path === "/api/tma/today")
      return json(res, {
        plan: { ...dailyPlan, date: url.searchParams.get("date") ?? date },
        events: [
          {
            title: "Fixture saved calendar event",
            startsAt: "2026-11-03T04:00:00Z",
            endsAt: "2026-11-03T05:00:00Z",
          },
        ],
        reminders: [],
        productivity: {
          totalCreated: 0,
          totalCompleted: 0,
          completionRate: null,
          truncated: false,
          warnings: [],
        },
        ai: {
          enabled: false,
          available: false,
          reason: "disabled",
          liveEnabled: false,
        },
      });
    if (path === "/api/tma/daily-life/summary")
      return json(res, summary(owner, url.searchParams.get("date") ?? date));
    if (path === "/api/tma/daily-life/preferences")
      return json(
        res,
        req.method === "PUT"
          ? { ...input, revision: input.revision + 1 }
          : DEFAULT_DAILY_LIFE_PREFERENCES,
      );
    if (path === "/api/tma/ideal-human/reflection/clear") {
      reflectionClears++;
      assert.equal(input.confirmed, true);
      const old = days.get(owner).find((v) => v.date === input.date);
      if (!old || old.revision !== input.expectedRevision)
        return json(res, { error: "ideal_human_conflict" }, 409);
      const next = {
        ...clearIdealHumanReflection(old),
        revision: old.revision + 1,
      };
      days.set(owner, [
        ...days.get(owner).filter((v) => v.date !== next.date),
        next,
      ]);
      return json(res, next);
    }
    if (path === "/api/tma/ideal-human/days") {
      if (req.method === "GET") return json(res, days.get(owner));
      journalPuts++;
      if (journalDelay) await new Promise((r) => setTimeout(r, journalDelay));
      if (journalFail)
        return json(res, { error: "fixture_network_failure" }, 503);
      const day = parseIdealHumanDay(input.day);
      const old = days.get(owner).find((v) => v.date === day.date);
      if ((old?.revision ?? 0) !== input.expectedRevision)
        return json(res, { error: "ideal_human_conflict" }, 409);
      const next = { ...day, revision: day.revision + 1 };
      days.set(owner, [
        ...days.get(owner).filter((v) => v.date !== next.date),
        next,
      ]);
      return json(res, next);
    }
    if (path === "/api/tma/tasks") {
      if (req.method === "GET")
        return json(res, { tasks: tasks.get(owner), truncated: false });
      if (receipts.has(owner + input.requestId))
        return json(res, receipts.get(owner + input.requestId));
      const next = {
        id: `task-${++taskVersion}`,
        title: input.title,
        notes: input.notes ?? "",
        dueAt: input.dueAt ?? null,
        status: "inbox",
        updatedAt: new Date(Date.now() + taskVersion).toISOString(),
        completedAt: null,
      };
      tasks.get(owner).unshift(next);
      receipts.set(owner + input.requestId, next);
      return json(res, next);
    }
    if (path.startsWith("/api/tma/tasks/")) {
      const task = tasks
        .get(owner)
        .find((v) => v.id === path.split("/").at(-1));
      if (!task) return json(res, { error: "task_not_found" }, 404);
      if (task.updatedAt !== input.expectedUpdatedAt)
        return json(res, { error: "task_conflict" }, 409);
      Object.assign(task, input, {
        updatedAt: new Date(Date.now() + ++taskVersion).toISOString(),
      });
      delete task.expectedUpdatedAt;
      return json(res, task);
    }
    if (path === "/api/tma/hydration") {
      if (req.method === "POST" && !receipts.has(owner + input.requestId)) {
        water.get(owner).unshift({
          id: `water-${++waterVersion}`,
          amountMl: input.amountMl,
          occurredAt: new Date().toISOString(),
          source: "web",
          undoneAt: null,
        });
        receipts.set(owner + input.requestId, true);
      }
      return json(
        res,
        hydration(
          owner,
          url.searchParams.get("date") ?? idealHumanLocalDate(new Date()),
        ),
      );
    }
    if (/^\/api\/tma\/hydration\/[^/]+\/undo$/.test(path)) {
      const entry = water
        .get(owner)
        .find((v) => v.id === path.split("/").at(-2));
      if (entry) entry.undoneAt ??= new Date().toISOString();
      return json(
        res,
        hydration(
          owner,
          url.searchParams.get("date") ?? idealHumanLocalDate(new Date()),
        ),
      );
    }
    if (path === "/api/tma/nutrition/capabilities")
      return json(res, {
        available: true,
        requiresConsent: true,
        reason: null,
      });
    if (path === "/api/tma/nutrition/analyze") {
      analyses++;
      assert.equal(input.consentToExternalAnalysis, true);
      return json(res, {
        draftId: "fixture-food-draft",
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        items: [
          {
            label: "Fixture meal estimate",
            portion: "Fixture approximate portion",
            caloriesKcal: 600,
            proteinG: 20,
            fatG: 15,
            carbsG: 90,
          },
        ],
        uncertainty: ["Fixture estimate; review before saving"],
        source: "gemini",
        estimated: true,
        requiresReview: true,
      });
    }
    if (path === "/api/tma/workout/program") return json(res, fixtureProgram);
    if (path === "/api/tma/workout/current") return json(res, workout);
    if (path === "/api/tma/workout/history") return json(res, fixtureHistory);
    if (path === "/api/tma/workout/start") {
      workout = {
        id: "fixture-workout",
        title: "Fixture light day",
        mode: "maintenance",
        startedAt: new Date().toISOString(),
        completedSets: 0,
        totalSets: 1,
        progressPercent: 0,
        exercises: [
          {
            id: "fixture-exercise",
            name: "Fixture row",
            sets: [
              {
                id: "fixture-set",
                index: 1,
                targetReps: 8,
                targetWeightKg: null,
                restSeconds: 90,
                completed: false,
              },
            ],
          },
        ],
      };
      return json(res, workout);
    }
    if (path === "/api/tma/workout/sets/fixture-set") {
      Object.assign(workout.exercises[0].sets[0], {
        targetReps: input.reps,
        targetWeightKg: input.weightKg,
        restSeconds: input.restSeconds,
      });
      return json(res, workout);
    }
    if (path === "/api/tma/workout/sets/fixture-set/complete") {
      workout.exercises[0].sets[0].completed = true;
      workout.completedSets = 1;
      return json(res, workout);
    }
    if (path === "/api/tma/workout/fixture-workout/complete") {
      fixtureHistory.unshift({
        ...workout,
        endedAt: new Date().toISOString(),
        volumeKg: 0,
      });
      workout = null;
      return json(res, fixtureHistory[0]);
    }
    if (path === "/api/tma/lms/connection")
      return json(res, {
        configured: false,
        state: "session_expired",
        lastSyncSuccessAt: null,
        lastSyncAttemptAt: null,
        lastErrorCategory: null,
      });
    if (path === "/api/tma/lms/work")
      return json(res, {
        timezone: "Asia/Almaty",
        lastSyncSuccessAt: null,
        stale: true,
        truncated: false,
        items: [],
      });
    if (path === "/api/tma/health")
      return json(res, {
        date,
        lifeMode: "maintenance",
        lifeModeLabel: "Normal",
        recommendation: "Fixture missing data",
        recoveryMode: "baseline",
        dataCompletenessScore: 0,
        hasMetrics: false,
        sleepMinutes: null,
        steps: null,
        restingHeartRate: null,
        trends: [
          {
            date,
            sleepMinutes: null,
            steps: null,
            restingHeartRate: null,
            activeEnergyKcal: null,
            workoutMinutes: null,
          },
        ],
        sources: [],
        missingMetrics: { sleep: true },
      });
    if (path === "/api/tma/finance")
      return json(res, {
        currency: "KZT",
        baseCurrency: "KZT",
        today: { amount: 0, count: 0 },
        week: { amount: 0, count: 0 },
        month: { amount: 0, count: 0 },
        monthlySummary: { income: 0, expense: 0, net: 0 },
        topCategories: [],
        budgets: [],
        recentTransactions: [],
        recentExpenses: [],
        recentIncome: [],
        recentReceipts: [],
        anomalies: [],
        recommendations: [],
        drafts: [],
      });
    if (path === "/api/tma/ai/status")
      return json(res, {
        enabled: routerChatEnabled,
        available: routerChatEnabled,
        reason: routerChatEnabled ? null : "disabled",
        liveEnabled: false,
      });
    if (path === "/api/tma/ai/router/settings") {
      if (req.method === "PUT") {
        routerSettingsPuts++;
        assert.deepEqual(Object.keys(input).sort(), [
          "expectedRevision",
          "settings",
        ]);
        if (routerSaveFailure)
          return json(
            res,
            { error: "fixture_router_failure" },
            routerSaveFailure,
          );
        const old = routerSettings.get(owner);
        if (input.expectedRevision !== old.revision)
          return json(res, { error: "ai_router_settings_conflict" }, 409);
        routerSettings.set(owner, {
          settings: parseAiRouterSettings(input.settings),
          revision: old.revision + 1,
        });
      }
      return json(res, routerSnapshot(owner));
    }
    if (path === "/api/tma/ai/chat") {
      if (!routerChatEnabled) return json(res, { error: "ai_disabled" }, 503);
      assert.equal(req.method, "POST");
      assert.ok(
        Object.keys(input).every((key) =>
          [
            "messages",
            "date",
            "requestId",
            "previousModelId",
            "confirmationToken",
          ].includes(key),
        ),
      );
      assert.match(input.requestId, /^[a-f0-9-]{36}$/i);
      assert.ok(Array.isArray(input.messages) && input.messages.length > 0);
      for (const message of input.messages)
        assert.deepEqual(Object.keys(message).sort(), ["role", "text"]);
      routerChats.push({ owner, input: structuredClone(input) });
      const count = routerChats.filter((item) => item.owner === owner).length;
      const fallback = count === 2,
        model = routerModels[fallback ? 1 : 0];
      return json(res, {
        answer: `Fixture routed answer ${count}`,
        suggestions: [],
        provider: model.provider,
        readOnly: true,
        modelRoute: {
          version: 1,
          requestId: input.requestId,
          modelId: model.id,
          provider: model.provider,
          model: model.model,
          billing: "api",
          estimatedCostMicros: fallback ? 1500 : 1200,
          reportedCostMicros: fallback ? 900 : 800,
          costSource: fallback ? "provider_reported" : "rate_estimate",
          latencyMs: fallback ? 84 : 42,
          fallback,
          reason: fallback ? "automatic_fallback" : "automatic_tier",
          privacy: "external",
          ...(fallback ? {} : { upstreamProvider: "Fixture OR host" }),
        },
      });
    }
    if (path === "/api/tma/reminders") return json(res, { reminders: [] });
    return json(res, { error: "not_found" }, 404);
  } catch {
    json(res, { error: "fixture_validation_failed" }, 400);
  }
});
await new Promise((r) => backend.listen(0, "127.0.0.1", r));
const reserve = createServer();
await new Promise((r) => reserve.listen(0, "127.0.0.1", r));
const port = reserve.address().port;
await new Promise((r) => reserve.close(r));
const localOrigin = `http://127.0.0.1:${port}`;
const tlsKey = resolve(artifacts, "fixture-tls.key");
const tlsCert = resolve(artifacts, "fixture-tls.crt");
execFileSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-keyout",
    tlsKey,
    "-out",
    tlsCert,
    "-days",
    "1",
    "-nodes",
    "-subj",
    "/CN=127.0.0.1",
    "-addext",
    "subjectAltName=IP:127.0.0.1",
  ],
  { stdio: "ignore" },
);
const frontend = createHttpsServer(
  { key: await readFile(tlsKey), cert: await readFile(tlsCert) },
  async (req, res) => {
    try {
      const assetPath = new URL(req.url, "https://fixture").pathname;
      if (
        req.method === "GET" &&
        /^\/tma\/campus-maps\/[a-f0-9]{40}\/C1\.[123]\.[123][0-9]{2}[KLP]?\.png$/.test(
          assetPath,
        )
      ) {
        const publicRoot = resolve(
          process.env.LIFEOS_TMA_DIST || resolve(workspace, "apps/tma/dist"),
        );
        const image = await readFile(
          resolve(publicRoot, assetPath.slice("/tma/".length)),
        );
        res.writeHead(200, { "content-type": "image/png" });
        return res.end(image);
      }
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const response = await fetch(localOrigin + req.url, {
        method: req.method,
        headers: req.headers,
        body: ["GET", "HEAD"].includes(req.method)
          ? undefined
          : Buffer.concat(chunks),
        redirect: "manual",
      });
      const headers = Object.fromEntries(response.headers.entries());
      delete headers["content-encoding"];
      delete headers["content-length"];
      res.writeHead(response.status, headers);
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      res.writeHead(503);
      res.end("fixture unavailable");
    }
  },
);
await new Promise((done) => frontend.listen(0, "127.0.0.1", done));
const origin = `https://127.0.0.1:${frontend.address().port}`;
let logs = "";
const app = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "-H",
    "127.0.0.1",
    "-p",
    String(port),
  ],
  {
    cwd: resolve(workspace, "apps/web"),
    env: {
      PATH: process.env.PATH,
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      LIFEOS_WEB_APP_URL: `${origin}/web`,
      NEXT_PUBLIC_WEB_APP_URL: "https://lifeos.zalewko.me/web",
      LIFEOS_API_BASE_URL: `http://127.0.0.1:${backend.address().port}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
app.stdout.on("data", (v) => (logs += v));
app.stderr.on("data", (v) => (logs += v));
let browser;
let passed = 0;
let currentCase = null;
let runFailure = null;
const startedAtUtc = new Date().toISOString();
const caseResults = [];
const screenshots = [];
const pageErrors = [];
const blockedExternalRequests = [];
let diagnosticPage;
const expectedCases = process.env.LIFEOS_WEB_BROWSER_LOGOUT_ONLY
  ? 2
  : 82 + (V6_VIEWPORTS.length - 4) + V6_SCENARIO_COUNT;
async function checkpoint() {
  const path = resolve(artifacts, "checkpoint.json");
  await writeFile(
    path + ".tmp",
    JSON.stringify(
      {
        startedAtUtc,
        updatedAtUtc: new Date().toISOString(),
        passed,
        expectedCases,
        currentCase,
        caseResults,
        screenshots,
        runFailure,
        pageErrors,
        productionVerified: false,
        blockedExternalRequests,
        realProviderCalls: 0,
        telegramSends: 0,
      },
      null,
      2,
    ),
  );
  await rename(path + ".tmp", path);
}
async function captureScreenshot(page, options) {
  const record = {
    file: basename(String(options.path)),
    state: "running",
    startedAtUtc: new Date().toISOString(),
  };
  screenshots.push(record);
  await checkpoint();
  try {
    await page.screenshot({
      ...options,
      animations: "disabled",
      timeout: 120000,
    });
    record.state = "passed";
  } catch (error) {
    record.state = "failed";
    record.error = error.message;
    runFailure = { stage: "screenshot_evidence", error: error.message };
    throw error;
  } finally {
    record.finishedAtUtc = new Date().toISOString();
    await checkpoint();
  }
}
async function test(name, fn) {
  if (
    process.env.LIFEOS_WEB_BROWSER_LOGOUT_ONLY &&
    !/unauthenticated|logout/.test(name)
  )
    return;
  currentCase = name;
  await checkpoint();
  try {
    await fn();
    passed++;
    caseResults.push({
      name,
      state: "passed",
      finishedAtUtc: new Date().toISOString(),
    });
    console.log("PASS " + name);
  } catch (error) {
    caseResults.push({ name, state: "failed", error: error.message });
    runFailure ??= { stage: "functional_assertion", error: error.message };
    if (diagnosticPage) {
      await writeFile(
        resolve(artifacts, "failure-page.json"),
        JSON.stringify({
          case: name,
          pathname: new URL(diagnosticPage.url()).pathname,
          text: (await diagnosticPage.locator("body").innerText()).slice(
            0,
            5000,
          ),
          blockedExternalRequests,
        }),
      ).catch(() => {});
      await diagnosticPage
        .screenshot({
          path: resolve(artifacts, "failure-page.png"),
          fullPage: true,
          timeout: 10000,
        })
        .catch(() => {});
    }
    throw error;
  } finally {
    currentCase = null;
    await checkpoint();
  }
}
try {
  for (let i = 0; i < 100; i++) {
    try {
      const ready = await fetch(`${localOrigin}/web/access`);
      if (ready.ok) break;
    } catch {}
    if (i === 99) throw new Error("Next fixture server did not start");
    await new Promise((r) => setTimeout(r, 300));
  }
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.LIFEOS_CHROMIUM_EXECUTABLE,
    args: [
      "--no-sandbox",
      "--renderer-process-limit=1",
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost",
      "--no-proxy-server",
    ],
    timeout: 120000,
  });
  async function isolatedContext(options) {
    const ctx = await browser.newContext({
      ...options,
      ignoreHTTPSErrors: true,
    });
    await ctx.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (["data:", "blob:"].includes(url.protocol) || url.origin === origin)
        return route.continue();
      blockedExternalRequests.push(url.origin);
      return route.abort("blockedbyclient");
    });
    return ctx;
  }
  async function selectFixtureDay(p) {
    const selector = p.getByRole("combobox", {
      name: /^День эксперимента/,
    });
    await selector.waitFor();
    // selectOption waits for the real enabled, hydrated control; do not fake Date.
    await selector.selectOption(date);
    assert.equal(await selector.isEnabled(), true);
    assert.equal(await selector.inputValue(), date);
    await p
      .getByRole("heading", { name: "Ideal Human — Day 1/30", exact: true })
      .waitFor();
    assert.equal(
      await p.getByLabel("Утренний вес, кг", { exact: true }).isEnabled(),
      true,
    );
  }
  async function openFixtureJournal(p) {
    await p.goto(`${origin}/web/ideal-human`);
    await selectFixtureDay(p);
  }
  async function shownNutritionDate(p) {
    assert.equal(new URL(p.url()).pathname, "/web/nutrition");
    const label = p.getByText(/^\d{4}-\d{2}-\d{2}\s*·\s*Asia\/Almaty\./);
    await label.waitFor();
    const match = /^(\d{4}-\d{2}-\d{2})\s*·\s*Asia\/Almaty\./.exec(
      await label.innerText(),
    );
    assert.ok(match);
    return match[1];
  }
  const context = await isolatedContext({
    viewport: { width: 1440, height: 1000 },
    timezoneId: "UTC",
  });
  const page = await context.newPage();
  diagnosticPage = page;
  const errors = pageErrors;
  page.on("pageerror", (e) => errors.push(e.message));
  const acceptDialog = (dialog) => void dialog.accept();
  page.on("dialog", acceptDialog);
  await test("unauthenticated dashboard redirects and real one-time login establishes private cookie", async () => {
    await page.goto(`${origin}/web/today`);
    await page.getByRole("heading", { name: "Твой LifeOS Web" }).waitFor();
    await page.goto(`${origin}/web/login?token=fixture-login-A`);
    await page.waitForTimeout(1000);

    await page
      .getByRole("heading", { name: `Сегодня · ${fixtureDisplayName("A")}` })
      .waitFor();
    assert.ok(!page.url().includes("token="));
    const cookie = (await context.cookies()).find(
      (c) => c.name === "lifeos_web_session",
    );
    assert.ok(cookie?.httpOnly && cookie.secure);
  });
  await test("long profile names remain readable without clipping at 320px tablet and desktop", async () => {
    for (const width of [320, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${origin}/web/today`);
      const heading = page.getByRole("heading", {
        name: `Сегодня · ${fixtureDisplayName("A")}`,
        exact: true,
      });
      await heading.waitFor();
      const geometry = await heading.evaluate((element) => ({
        viewport: innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        headingWidth: element.clientWidth,
        headingContentWidth: element.scrollWidth,
      }));
      assert.ok(
        geometry.documentWidth <= geometry.viewport &&
          geometry.headingContentWidth <= geometry.headingWidth,
        `Long profile name overflows or is clipped: ${JSON.stringify(geometry)}`,
      );
      await captureScreenshot(page, {
        path: resolve(artifacts, `web-long-profile-name-${width}.png`),
      });
    }
  });
  for (const width of V6_VIEWPORTS) {
    await test(`four primary sections preserve planner drafts and course/day context at ${width}px`, async () => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `${origin}/web/planner?courseId=fixture-course&date=2026-01-02`,
      );
      const primary = page.getByRole("navigation", {
        name: "Основные разделы LifeOS",
        exact: true,
      });
      assert.equal(await primary.getByRole("link").count(), 4);
      await page
        .getByRole("textbox", { name: "Название", exact: true })
        .fill(`Unfinished fixture ${width}`);
      await primary
        .getByRole("link", { name: "Здоровье", exact: true })
        .click();
      await page
        .getByRole("heading", {
          name: "Здоровье и восстановление",
          exact: true,
        })
        .waitFor();
      assert.equal(
        await primary.locator('[aria-current="page"]').innerText(),
        "Здоровье",
      );
      await primary
        .getByRole("link", { name: "Настройки", exact: true })
        .click();
      await page.locator("h1").waitFor();
      await primary.getByRole("link", { name: "Главная", exact: true }).click();
      await page
        .getByRole("navigation", {
          name: /^(?:Внутри|Модули) раздела «Главная»$/,
        })
        .getByRole("link", { name: "Задачи и план", exact: true })
        .click();
      assert.equal(
        await page
          .getByRole("textbox", { name: "Название", exact: true })
          .inputValue(),
        `Unfinished fixture ${width}`,
      );
      const route = new URL(page.url());
      assert.equal(route.searchParams.get("courseId"), "fixture-course");
      assert.equal(route.searchParams.get("date"), "2026-01-02");
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await captureScreenshot(page, {
        path: resolve(artifacts, `web-navigation-${width}.png`),
      });
      await page
        .getByRole("textbox", { name: "Название", exact: true })
        .fill("");
    });
  }
  for (const width of V6_VIEWPORTS) {
    const fixture = v6BrowserFixture("A");
    v6Fixtures.set("A", fixture);
    v6FixtureHistory.push(fixture);
    await page.setViewportSize({ width, height: 900 });
    const driver = v6BrowserDriver(page, "web", origin);
    await v6CourseAndHomeScenarios({
      page,
      fixture,
      driver,
      test,
      prefix: `Web V6 ${width}px`,
    });
    if ([390, 1440].includes(width))
      await v6PolicyAndPreferenceScenarios({
        page,
        fixture,
        driver,
        test,
        prefix: `Web V6 ${width}px`,
      });
    if (!process.env.LIFEOS_WEB_BROWSER_LOGOUT_ONLY)
      await captureScreenshot(page, {
        path: resolve(artifacts, `web-v6-${width}.png`),
        fullPage: true,
      });
  }
  await test("Ideal Human saves once and persists after reloading", async () => {
    await openFixtureJournal(page);
    await page.getByLabel("Утренний вес, кг", { exact: true }).fill("51.7");
    await page.getByLabel("Сон, часов", { exact: true }).fill("7.5");
    journalDelay = 150;
    const before = journalPuts;
    await page
      .getByRole("button", { name: "Сохранить день", exact: true })
      .evaluate((button) => {
        button.form.requestSubmit();
        button.form.requestSubmit();
      });
    await page
      .getByText(
        "Сохранено в LifeOS. Запись доступна в Telegram и после повторного входа.",
      )
      .waitFor();
    assert.equal(journalPuts, before + 1);
    journalDelay = 0;
    await page.reload();
    await selectFixtureDay(page);
    assert.equal(
      await page.getByLabel("Утренний вес, кг", { exact: true }).inputValue(),
      "51.7",
    );
    assert.equal(
      days.get("A").find((record) => record.date === date)?.sleepMinutes,
      450,
    );
  });
  await test("network failure retains edits and stale writes preserve remote version", async () => {
    await page.getByLabel("Утренний вес, кг", { exact: true }).fill("52");
    journalFail = true;
    await page
      .getByRole("button", { name: "Сохранить день", exact: true })
      .click();
    await page.getByText(/Правки остаются на этом экране/).waitFor();
    assert.equal(
      await page.getByLabel("Утренний вес, кг", { exact: true }).inputValue(),
      "52",
    );
    journalFail = false;
    const remoteDay = days.get("A").find((record) => record.date === date);
    assert.ok(remoteDay);
    remoteDay.revision++;
    remoteDay.notes = "Fixture remote edit";
    await page
      .getByRole("navigation", { name: "Основные разделы LifeOS", exact: true })
      .getByRole("link", { name: "Здоровье", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Здоровье и восстановление", exact: true })
      .waitFor();
    await page
      .getByRole("navigation", { name: "Основные разделы LifeOS", exact: true })
      .getByRole("link", { name: "Главная", exact: true })
      .click();
    await page
      .getByRole("navigation", {
        name: "Модули раздела «Главная»",
        exact: true,
      })
      .getByRole("link", { name: "Дневник и съёмка", exact: true })
      .click();
    assert.equal(
      await page.getByLabel("Утренний вес, кг", { exact: true }).inputValue(),
      "52",
    );
    await page
      .getByRole("button", { name: "Сохранить день", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Загрузить сохранённую версию" })
      .waitFor();
    assert.equal(
      days.get("A").find((record) => record.date === date)?.weightKg,
      51.7,
    );
    await page
      .getByRole("button", { name: "Загрузить сохранённую версию" })
      .click();
    await page
      .getByRole("button", { name: "Загрузить сохранённую версию" })
      .waitFor({ state: "hidden" });
    assert.equal(
      await page.getByLabel("Утренний вес, кг", { exact: true }).inputValue(),
      "51.7",
    );
  });
  await test("server-rendered journal rejects edits until its handlers hydrate, then saves and reloads", async () => {
    const delayed = await isolatedContext({
      viewport: { width: 320, height: 844 },
      timezoneId: "UTC",
    });
    await delayed.addCookies(await context.cookies());
    const p = await delayed.newPage();
    const delayedErrors = [];
    p.on("pageerror", (error) => delayedErrors.push(error.message));
    let releaseScripts;
    const scriptGate = new Promise((resolve) => {
      releaseScripts = resolve;
    });
    const isNextScript = (request) =>
      new URL(request.url()).origin === origin &&
      new URL(request.url()).pathname.startsWith("/web/_next/") &&
      request.resourceType() === "script";
    await p.route("**/*", async (route) => {
      if (isNextScript(route.request())) await scriptGate;
      return route.fallback();
    });
    let seededDate = null;
    try {
      const today = idealHumanLocalDate(new Date());
      const initialDate =
        today < idealHumanDate(1)
          ? idealHumanDate(1)
          : today > idealHumanDate(30)
            ? idealHumanDate(30)
            : today;
      if (initialDate !== date) {
        const fixtureDay = days.get("A").find((record) => record.date === date);
        assert.ok(fixtureDay && fixtureDay.revision > 0);
        assert.equal(hasIdealHumanReflection(fixtureDay), true);
        assert.equal(
          days.get("A").some((record) => record.date === initialDate),
          false,
        );
        // SSR opens today's clamped experiment day; keep its reflection controls
        // present while JavaScript is held, then exercise the real Nov 3 selector.
        const temporaryDay = parseIdealHumanDay({
          ...structuredClone(fixtureDay),
          date: initialDate,
        });
        days.set("A", [...days.get("A"), temporaryDay]);
        seededDate = initialDate;
      }
      const firstScript = p.waitForRequest(isNextScript, { timeout: 30000 });
      await p.goto(`${origin}/web/ideal-human`, { waitUntil: "commit" });
      await firstScript;
      const weight = p.getByLabel("Утренний вес, кг", { exact: true });
      const dateSelector = p.getByRole("combobox", {
        name: /^День эксперимента/,
      });
      const save = p.getByRole("button", {
        name: "Сохранить день",
        exact: true,
      });
      const clear = p.getByRole("button", {
        name: "Удалить вечернюю рефлексию",
        exact: true,
        includeHidden: true,
      });
      await weight.waitFor({ state: "attached" });
      assert.equal(await weight.isDisabled(), true);
      assert.equal(await dateSelector.isDisabled(), true);
      assert.equal(await save.isDisabled(), true);
      assert.equal(await clear.isDisabled(), true);
      const journalControls = p
        .locator("form")
        .filter({ has: weight })
        .locator("input, select, textarea, button");
      assert.ok((await journalControls.count()) > 0);
      for (const control of await journalControls.all())
        assert.equal(await control.isDisabled(), true);
      await p.getByText("Подготавливаем дневник…", { exact: true }).waitFor();
      const initialSelectedDate = await dateSelector.inputValue();
      assert.equal(initialSelectedDate, initialDate);
      assert.match(initialSelectedDate, /^\d{4}-\d{2}-\d{2}$/);
      const initialRecord = days
        .get("A")
        .find((record) => record.date === initialSelectedDate);
      assert.equal(
        await weight.inputValue(),
        initialRecord?.weightKg == null ? "" : String(initialRecord.weightKg),
      );
      releaseScripts();
      await p
        .getByText("Подготавливаем дневник…", { exact: true })
        .waitFor({ state: "hidden" });
      assert.equal(await weight.isEnabled(), true);
      assert.equal(await dateSelector.isEnabled(), true);
      await selectFixtureDay(p);
      await p
        .locator("summary")
        .filter({ hasText: "Вечерняя рефлексия" })
        .click();
      assert.equal(await clear.isEnabled(), true);
      await weight.fill("51.8");
      const saved = p.waitForResponse(
        (response) =>
          new URL(response.url()).pathname ===
            "/web/api/bridge/ideal-human/days" &&
          response.request().method() === "PUT",
      );
      await save.click();
      assert.equal((await saved).status(), 200);
      await p
        .getByText(
          "Сохранено в LifeOS. Запись доступна в Telegram и после повторного входа.",
        )
        .waitFor();
      assert.equal(
        days.get("A").find((record) => record.date === date).weightKg,
        51.8,
      );
      await p.reload();
      await selectFixtureDay(p);
      assert.equal(await weight.inputValue(), "51.8");
      assert.deepEqual(delayedErrors, []);
    } finally {
      releaseScripts();
      try {
        await delayed.close();
      } finally {
        if (seededDate)
          days.set(
            "A",
            days.get("A").filter((record) => record.date !== seededDate),
          );
      }
    }
  });
  await test("task creation, editing and completion use actual shared endpoints", async () => {
    await page.goto(`${origin}/web/planner`);
    await page
      .getByLabel("Название", { exact: true })
      .fill("Fixture study priority");
    await page
      .getByRole("textbox", { name: "Заметки", exact: true })
      .fill("Fixture saved task notes");
    await page
      .getByLabel("Дедлайн, если известен (Asia/Almaty)", { exact: true })
      .fill("2026-11-03T17:30");
    await page
      .getByRole("button", { name: "Добавить задачу", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Fixture study priority" })
      .waitFor();
    await page.getByText("Изменить задачу", { exact: true }).click();
    const editTitle = page.getByRole("textbox", {
      name: "Новое название",
      exact: true,
    });
    const editNotes = page.getByRole("textbox", {
      name: "Заметки задачи",
      exact: true,
    });
    const editDue = page.getByLabel("Дедлайн задачи (Asia/Almaty)", {
      exact: true,
    });
    const discard = page.getByRole("button", {
      name: "Отменить правки задачи",
      exact: true,
    });
    assert.equal(await discard.count(), 1);
    const savedTask = { ...tasks.get("A")[0] };
    const taskPatchesBeforeDiscard = trace.filter(
      (request) =>
        request.method === "PATCH" &&
        request.path.startsWith("/api/tma/tasks/"),
    ).length;
    await editTitle.fill("Unsaved title to discard");
    await editNotes.fill("Unsaved notes to discard");
    await editDue.fill("2026-11-04T09:15");
    assert.equal(await discard.isEnabled(), true);
    await discard.click();
    await page.waitForFunction(() =>
      [...document.querySelectorAll("input")].some(
        (input) => input.value === "Fixture study priority",
      ),
    );
    assert.equal(await editTitle.inputValue(), "Fixture study priority");
    assert.equal(await editNotes.inputValue(), "Fixture saved task notes");
    assert.equal(await editDue.inputValue(), "2026-11-03T17:30");
    assert.equal(await discard.isDisabled(), true);
    await page.waitForLoadState("networkidle");
    assert.equal(
      trace.filter(
        (request) =>
          request.method === "PATCH" &&
          request.path.startsWith("/api/tma/tasks/"),
      ).length,
      taskPatchesBeforeDiscard,
    );
    assert.deepEqual(tasks.get("A")[0], savedTask);
    await page
      .getByLabel("Новое название", { exact: true })
      .fill("Fixture edited priority");
    await page
      .getByRole("button", { name: "Сохранить задачу", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Fixture edited priority" })
      .waitFor();
    await page.getByRole("combobox").selectOption("done");
    await page.waitForFunction(
      () => document.querySelector("select")?.value === "done",
    );
    assert.equal(tasks.get("A")[0].status, "done");
  });
  await test("hydration quick logging and undo are explicit and shared", async () => {
    await page.goto(`${origin}/web/nutrition`);
    const shownDate = await shownNutritionDate(page);
    await page.getByRole("button", { name: "+250 мл", exact: true }).click();
    await page.getByText("250 мл", { exact: true }).first().waitFor();
    assert.equal(hydration("A", shownDate).date, shownDate);
    assert.equal(hydration("A", shownDate).totalMl, 250);
    await page
      .getByRole("button", { name: "Отменить последнюю запись", exact: true })
      .click();
    await page.getByText("Последняя запись воды отменена.").waitFor();
    assert.equal(hydration("A", shownDate).totalMl, 0);
  });
  await test("meal photo is local until consent, draft remains unsaved, confirmation writes reviewed estimate", async () => {
    const shownDate = await shownNutritionDate(page);
    const beforeDays = structuredClone(days.get("A"));
    const previous = structuredClone(
      beforeDays.find((record) => record.date === shownDate) ??
        emptyIdealHumanDay(shownDate),
    );
    const otherDays = beforeDays.filter((record) => record.date !== shownDate);
    const putsBefore = journalPuts;
    assert.equal(analyses, 0);
    const png = Buffer.from(
      await page.evaluate(() => {
        const c = document.createElement("canvas");
        c.width = 64;
        c.height = 64;
        const x = c.getContext("2d");
        x.fillStyle = "#335533";
        x.fillRect(0, 0, 64, 64);
        return c.toDataURL("image/png").split(",")[1];
      }),
      "base64",
    );
    await page.getByLabel("Фото приёма пищи", { exact: true }).setInputFiles({
      name: "fixture.png",
      mimeType: "image/png",
      buffer: png,
    });
    const analyze = page.getByRole("button", {
      name: "Оценить фото — без сохранения еды",
      exact: true,
    });
    await analyze.waitFor();
    assert.ok(await analyze.isDisabled());
    assert.equal(analyses, 0);
    await page
      .getByRole("checkbox", { name: /Разрешаю отправить это фото/ })
      .check();
    await analyze.click();
    await page
      .getByText("Оценка AI: проверь и исправь", { exact: true })
      .waitFor();
    assert.deepEqual(days.get("A"), beforeDays);
    assert.equal(journalPuts, putsBefore);
    await page.getByLabel("Ккал", { exact: true }).fill("650");
    page.off("dialog", acceptDialog);
    const guard = page.waitForEvent("dialog").then(async (dialog) => {
      assert.match(dialog.message(), /несохранённые изменения/);
      await dialog.dismiss();
    });
    await page.locator('a[href="/web/planner"]').first().click();
    await guard;
    page.on("dialog", acceptDialog);
    assert.equal(new URL(page.url()).pathname, "/web/nutrition");
    assert.equal(
      await page.getByLabel("Ккал", { exact: true }).inputValue(),
      "650",
    );
    journalFail = true;
    const failedSave = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          "/web/api/bridge/ideal-human/days" &&
        response.request().method() === "PUT",
    );
    await page
      .getByRole("button", {
        name: "Подтвердить и сохранить приём пищи",
        exact: true,
      })
      .click();
    assert.equal((await failedSave).status(), 503);
    await page
      .getByText(
        "Сервис временно недоступен. Проверь соединение и повтори попытку.",
        { exact: true },
      )
      .waitFor();
    assert.deepEqual(days.get("A"), beforeDays);
    assert.equal(
      await page.getByLabel("Ккал", { exact: true }).inputValue(),
      "650",
    );
    journalFail = false;
    await page
      .getByRole("button", {
        name: "Подтвердить и сохранить приём пищи",
        exact: true,
      })
      .click();
    await page
      .getByText("Подтверждённая оценка сохранена в дневнике.", {
        exact: false,
      })
      .waitFor();
    assert.equal(analyses, 1);
    const saved = days.get("A").find((record) => record.date === shownDate);
    assert.ok(saved);
    assert.equal(saved.date, shownDate);
    assert.equal(saved.revision, previous.revision + 1);
    assert.equal(saved.meals.length, previous.meals.length + 1);
    assert.deepEqual(
      saved.meals.slice(0, previous.meals.length),
      previous.meals,
    );
    const estimate = saved.meals.at(-1);
    assert.equal(estimate.caloriesKcal, 650);
    assert.equal(estimate.corrected, true);
    assert.equal(estimate.analysisSource, "gemini");
    assert.equal(estimate.estimated, true);
    assert.deepEqual(
      { ...saved, meals: previous.meals, revision: previous.revision },
      previous,
    );
    assert.deepEqual(
      days.get("A").filter((record) => record.date !== shownDate),
      otherDays,
    );
    await page.reload();
    assert.equal(await shownNutritionDate(page), shownDate);
    assert.deepEqual(
      JSON.parse(
        await page.getByLabel("Питание JSON", { exact: true }).inputValue(),
      ),
      saved.meals,
    );
    assert.deepEqual(
      days.get("A").filter((record) => record.date !== shownDate),
      otherDays,
    );
  });
  await test("manual meal creation preserves provenance without photo analysis", async () => {
    await page.goto(`${origin}/web/nutrition`);
    await page.waitForLoadState("networkidle");
    const shownDate = await shownNutritionDate(page);
    const beforeDays = structuredClone(days.get("A"));
    const previous = structuredClone(
      beforeDays.find((record) => record.date === shownDate) ??
        emptyIdealHumanDay(shownDate),
    );
    const otherDays = beforeDays.filter((record) => record.date !== shownDate);
    const previousAnalyses = analyses;
    const mealIndex = previous.meals.length + 1;
    await page
      .locator("summary")
      .filter({ hasText: /^Питание/ })
      .click();
    await page
      .getByRole("button", { name: "Добавить приём пищи", exact: true })
      .click();
    await page
      .getByRole("textbox", {
        name: `Приём пищи ${mealIndex}: что ел`,
        exact: true,
      })
      .fill("Fixture manually logged meal");
    await page
      .getByLabel(`Блюдо ${mealIndex}, ккал`, { exact: true })
      .fill("250");
    assert.deepEqual(days.get("A"), beforeDays);
    assert.equal(analyses, previousAnalyses);
    await page
      .getByRole("button", { name: "Сохранить питание", exact: true })
      .click();
    await page
      .getByText("Питание сохранено в том же дневнике Ideal Human.", {
        exact: true,
      })
      .waitFor();
    const saved = days.get("A").find((record) => record.date === shownDate);
    assert.ok(saved);
    assert.equal(saved.date, shownDate);
    assert.equal(saved.revision, previous.revision + 1);
    assert.equal(saved.meals.length, previous.meals.length + 1);
    assert.deepEqual(
      saved.meals.slice(0, previous.meals.length),
      previous.meals,
    );
    const manual = saved.meals.at(-1);
    assert.equal(manual.label, "Fixture manually logged meal");
    assert.equal(manual.caloriesKcal, 250);
    assert.equal(manual.analysisSource, "manual");
    assert.equal(manual.corrected, false);
    assert.deepEqual(
      { ...saved, meals: previous.meals, revision: previous.revision },
      previous,
    );
    assert.deepEqual(
      days.get("A").filter((record) => record.date !== shownDate),
      otherDays,
    );
    assert.equal(analyses, previousAnalyses);
    await page.reload();
    await page.waitForLoadState("networkidle");
    assert.equal(await shownNutritionDate(page), shownDate);
    assert.deepEqual(
      JSON.parse(
        await page.getByLabel("Питание JSON", { exact: true }).inputValue(),
      ),
      saved.meals,
    );
    assert.deepEqual(
      days.get("A").filter((record) => record.date !== shownDate),
      otherDays,
    );
    await page
      .locator("summary")
      .filter({ hasText: /^Питание/ })
      .click();
    assert.equal(
      await page
        .getByRole("textbox", {
          name: `Приём пищи ${mealIndex}: что ел`,
          exact: true,
        })
        .inputValue(),
      "Fixture manually logged meal",
    );
    assert.equal(analyses, previousAnalyses);
  });
  await test("workout starts only on action, logs sets and completes into existing history", async () => {
    await page.goto(`${origin}/web/workouts`);
    await page
      .getByRole("button", { name: "Начать тренировку", exact: true })
      .click();
    await page.getByLabel("Повторы", { exact: true }).fill("10");
    await page
      .getByRole("button", { name: "Подход выполнен", exact: true })
      .click();
    await page.getByText("Подход 1 · выполнен", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "Завершить тренировку", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Начать тренировку", exact: true })
      .waitFor();
    assert.equal(fixtureHistory.length, 1);
    assert.equal(fixtureHistory[0].completedSets, 1);
  });
  await test("cross-origin cookie mutation is rejected", async () => {
    const before = tasks.get("A").length;
    const response = await context.request.post(
      `${origin}/web/api/bridge/tasks`,
      {
        headers: {
          origin: "https://attacker.invalid",
          cookie: `lifeos_web_session=${sessionA}`,
        },
        data: { title: "forged", requestId: "forged-request" },
      },
    );
    assert.equal(response.status(), 403);
    assert.equal(tasks.get("A").length, before);
  });
  await test("router settings save manual/automatic policy and retain drafts on failure or CAS conflict", async () => {
    const beforeChats = routerChats.length,
      beforePuts = routerSettingsPuts;
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto(`${origin}/web/settings`);
    const region = page.getByRole("region", {
      name: "AI Model Router settings",
      exact: true,
    });
    const mode = region.getByRole("combobox", {
      name: "Выбор модели",
      exact: true,
    });
    const manual = region.getByRole("combobox", {
      name: "Ручная модель",
      exact: true,
    });
    const save = region.getByRole("button", {
      name: "Сохранить настройки AI",
      exact: true,
    });
    const requestLimit = region.getByRole("textbox", {
      name: "Максимум на запрос, USD",
      exact: true,
    });
    const dailyLimit = region.getByRole("textbox", {
      name: "Максимум за день, USD",
      exact: true,
    });
    const saveWithStatus = async (status) => {
      const response = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname ===
            "/web/api/bridge/ai/router/settings" &&
          response.request().method() === "PUT",
      );
      await save.click();
      assert.equal((await response).status(), status);
    };
    await mode.selectOption("manual");
    await manual.selectOption("fixture-gemini-balanced");
    await region
      .getByRole("checkbox", { name: "OpenRouter", exact: true })
      .check();
    await region
      .getByRole("checkbox", { name: "Gemini API", exact: true })
      .check();
    await region
      .getByRole("checkbox", { name: "Быстрые задачи", exact: true })
      .check();
    await region
      .getByRole("checkbox", { name: "Повседневные задачи", exact: true })
      .check();
    await region
      .getByRole("combobox", { name: "Добавить модель: fast", exact: true })
      .selectOption("fixture-or-balanced");
    await region
      .getByRole("combobox", { name: "Добавить модель: balanced", exact: true })
      .selectOption("fixture-or-balanced");
    await region
      .getByRole("combobox", { name: "Добавить модель: balanced", exact: true })
      .selectOption("fixture-gemini-balanced");
    for (const category of ["Обычный текст", "Университет"]) {
      await region
        .locator("summary")
        .filter({ hasText: new RegExp("^" + category) })
        .click();
      for (const provider of ["OpenRouter", "Gemini API"])
        await region
          .getByRole("checkbox", {
            name: `Разрешить ${category} для ${provider}`,
            exact: true,
          })
          .check();
    }
    await region
      .getByRole("checkbox", { name: /Я разрешаю платные запросы/ })
      .check();
    await requestLimit.fill("0.015");
    await dailyLimit.fill("0.05");
    await region
      .getByRole("checkbox", {
        name: "Разрешить ограниченные запасные попытки",
        exact: true,
      })
      .check();
    await region
      .getByRole("checkbox", {
        name: "Разрешить смену провайдера в пределах моих разрешений",
        exact: true,
      })
      .check();
    await region
      .getByRole("combobox", { name: "Максимум попыток", exact: true })
      .selectOption("2");
    await saveWithStatus(200);
    await region.getByText(/Настройки сохранены\./).waitFor();
    const saved = routerSettings.get("A");
    assert.equal(saved.settings.mode, "manual");
    assert.equal(saved.settings.manualModelId, "fixture-gemini-balanced");
    assert.deepEqual(saved.settings.allowedProviders, ["openrouter", "gemini"]);
    assert.deepEqual(saved.settings.allowedTiers, [
      "deterministic",
      "fast",
      "balanced",
    ]);
    assert.deepEqual(saved.settings.tierModels.balanced, [
      "fixture-or-balanced",
      "fixture-gemini-balanced",
    ]);
    assert.deepEqual(saved.settings.privacy.health, []);
    assert.deepEqual(saved.settings.privacy.finance, []);
    assert.deepEqual(saved.settings.privacy.university, [
      "openrouter",
      "gemini",
    ]);
    assert.deepEqual(saved.settings.spending, {
      paidCallsAuthorized: true,
      maxRequestCostMicros: 15000,
      maxDailyCostMicros: 50000,
    });
    assert.deepEqual(saved.settings.fallback, {
      enabled: true,
      maxAttempts: 2,
      allowProviderChange: true,
    });
    assert.equal(routerChats.length, beforeChats);
    await page.reload();
    await mode.waitFor();
    assert.equal(await mode.inputValue(), "manual");
    assert.equal(await manual.inputValue(), "fixture-gemini-balanced");
    assert.equal(await requestLimit.inputValue(), "0.015");
    assert.match(await region.innerText(), /Учётная запись ещё не подключена/);
    assert.equal(
      await region
        .getByRole("link", {
          name: "Управлять использованием плана ChatGPT",
          exact: true,
        })
        .getAttribute("href"),
      "https://chatgpt.com/settings/usage",
    );
    await mode.selectOption("auto");
    await saveWithStatus(200);
    await region.getByText(/Настройки сохранены\./).waitFor();
    await requestLimit.fill("0.02");
    routerSaveFailure = 503;
    await saveWithStatus(503);
    await region
      .getByText(/Несохранённые изменения остались на экране\./)
      .waitFor();
    assert.equal(await requestLimit.inputValue(), "0.02");
    assert.equal(
      routerSettings.get("A").settings.spending.maxRequestCostMicros,
      15000,
    );
    routerSaveFailure = 0;
    routerSettings.get("A").revision++;
    routerSettings.get("A").settings.spending.maxDailyCostMicros = 60000;
    await saveWithStatus(409);
    await region.getByText(/Запись изменилась в другом окне/).waitFor();
    assert.equal(await requestLimit.inputValue(), "0.02");
    assert.equal(
      routerSettings.get("A").settings.spending.maxRequestCostMicros,
      15000,
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    page.off("dialog", acceptDialog);
    let navigationDialog = false;
    const rejectUnexpectedDialog = (dialog) => {
      navigationDialog = true;
      return dialog.dismiss();
    };
    page.on("dialog", rejectUnexpectedDialog);
    try {
      await page
        .getByRole("navigation", {
          name: "Основные разделы LifeOS",
          exact: true,
        })
        .getByRole("link", { name: "Главная", exact: true })
        .click();
      await page
        .getByRole("heading", { name: `Сегодня · ${fixtureDisplayName("A")}` })
        .waitFor();
      await page
        .getByRole("navigation", {
          name: "Основные разделы LifeOS",
          exact: true,
        })
        .getByRole("link", { name: "Настройки", exact: true })
        .click();
      await region.waitFor();
      assert.equal(navigationDialog, false);
      assert.equal(new URL(page.url()).pathname, "/web/settings");
      assert.equal(await requestLimit.inputValue(), "0.02");
    } finally {
      page.off("dialog", rejectUnexpectedDialog);
      page.on("dialog", acceptDialog);
    }
    const reloaded = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          "/web/api/bridge/ai/router/settings" &&
        response.request().method() === "GET",
    );
    await region
      .getByRole("button", { name: "Обновить настройки AI", exact: true })
      .click();
    assert.equal((await reloaded).status(), 200);
    await region
      .getByText("Есть несохранённые изменения.", { exact: true })
      .waitFor({ state: "hidden" });
    assert.equal(await mode.inputValue(), "auto");
    assert.equal(await requestLimit.inputValue(), "0.015");
    assert.equal(await dailyLimit.inputValue(), "0.06");
    assert.equal(await save.isDisabled(), true);
    assert.equal(routerSettingsPuts, beforePuts + 4);
    assert.equal(routerChats.length, beforeChats);
    assert.deepEqual(routerSettings.get("B"), {
      settings: defaultAiRouterSettings(),
      revision: 0,
    });
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `router settings overflow at ${width}`,
      );
    }
    await captureScreenshot(page, {
      path: resolve(artifacts, "web-ai-router-settings.png"),
    });
  });
  await test("routed chat shows actual model/cost provenance and retains only safe conversation continuity", async () => {
    routerChatEnabled = true;
    try {
      await page.setViewportSize({ width: 320, height: 900 });
      await page.goto(`${origin}/web/ai`);
      const question = page.getByRole("textbox", {
        name: "Сообщение",
        exact: true,
      });
      const send = page.getByRole("button", { name: "Отправить", exact: true });
      const details = page.locator('[aria-label="Использование AI модели"]');
      await question.fill("First fixture planning question");
      await send.click();
      await page
        .getByText("Fixture routed answer 1", { exact: true })
        .waitFor();
      await details.first().waitFor();
      const first = await details.first().innerText();
      assert.match(first, /OpenRouter/);
      assert.match(first, /fixture\/route-balanced/);
      assert.match(first, /Fixture OR host/);
      assert.match(first, /42 мс/);
      assert.match(first, /Оценка по использованным токенам/);
      assert.doesNotMatch(first, /Стоимость от провайдера/);
      assert.equal(routerChats[0].input.previousModelId, undefined);
      await question.fill("Second fixture planning question");
      await send.click();
      await page
        .getByText("Fixture routed answer 2", { exact: true })
        .waitFor();
      assert.equal(await details.count(), 2);
      const second = await details.nth(1).innerText();
      assert.match(second, /Google Gemini/);
      assert.match(second, /gemini-fixture-fallback/);
      assert.match(second, /84 мс/);
      assert.match(second, /Стоимость от провайдера/);
      assert.match(second, /Использован резервный маршрут/);
      assert.match(second, /Внешняя обработка/);
      assert.equal(routerChats[1].input.previousModelId, "fixture-or-balanced");
      for (const entry of routerChats)
        for (const message of entry.input.messages)
          assert.deepEqual(Object.keys(message).sort(), ["role", "text"]);
      assert.equal(
        routerChats[1].input.messages[1].text,
        "Fixture routed answer 1",
      );
      assert.equal(await details.first().innerText(), first);
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        "routed receipt overflow at320",
      );
      await page
        .getByRole("button", { name: "Очистить экран", exact: true })
        .click();
      assert.equal(await details.count(), 0);
      await question.fill("Fresh fixture conversation");
      await send.click();
      await page
        .getByText("Fixture routed answer 3", { exact: true })
        .waitFor();
      assert.equal(routerChats[2].input.previousModelId, undefined);
      assert.equal(routerChats[2].input.messages.length, 1);
      assert.equal(
        new Set(routerChats.map((entry) => entry.input.requestId)).size,
        3,
      );
      assert.equal(await details.count(), 1);
      await captureScreenshot(page, {
        path: resolve(artifacts, "web-ai-model-receipt-320.png"),
      });
    } finally {
      routerChatEnabled = false;
    }
  });
  await test("free-only router preparation at320/390 preserves pooled quotas, unavailable status and zero paid consent", async () => {
    const original = structuredClone(routerSettings.get("A"));
    const untouchedOtherOwner = structuredClone(routerSettings.get("B"));
    const beforeChats = routerChats.length,
      beforePuts = routerSettingsPuts;
    routerSettings.set("A", {
      settings: defaultAiRouterSettings(),
      revision: 0,
    });
    routerFreeProfileState = "cooldown";
    try {
      for (const width of [320, 390]) {
        routerFreeProfileState = "cooldown";
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${origin}/web/settings`);
        const region = page.getByRole("region", {
          name: "AI Model Router settings",
          exact: true,
        });
        await assertFreeRouterBrowserPanel(region, routerFreeProfileState);
        const mode = region.getByLabel("Выбор модели", { exact: true });
        const save = region.getByRole("button", {
          name: "Сохранить настройки AI",
          exact: true,
        });
        const requestLimit = region.getByLabel("Максимум на запрос, USD", {
          exact: true,
        });
        await requestLimit.fill("0.01");
        await save.click();
        await region
          .getByText(
            "Лимит превышает ограничение сервера. Уменьши сумму перед сохранением.",
            { exact: true },
          )
          .waitFor();
        assert.equal(routerSettingsPuts, beforePuts + (width === 320 ? 0 : 2));
        await requestLimit.fill("0");
        await mode.selectOption("manual");
        await region
          .getByLabel("Ручная модель", { exact: true })
          .selectOption("fixture-or-balanced");
        await save.click();
        await region
          .getByText(
            "Настройки сохранены. Сохранение не запускает AI-запрос или проверку провайдера.",
            { exact: true },
          )
          .waitFor();
        assert.equal(routerSettings.get("A").settings.mode, "manual");
        assert.equal(
          routerSettings.get("A").settings.manualModelId,
          "fixture-or-balanced",
        );
        await region
          .getByRole("button", { name: "Обновить настройки AI", exact: true })
          .click();
        await region
          .getByText(
            "Настройки сохранены. Сохранение не запускает AI-запрос или проверку провайдера.",
            { exact: true },
          )
          .waitFor({ state: "hidden" });
        assert.equal(await mode.inputValue(), "manual");
        await mode.selectOption("auto");
        await save.click();
        await region
          .getByText(
            "Настройки сохранены. Сохранение не запускает AI-запрос или проверку провайдера.",
            { exact: true },
          )
          .waitFor();
        routerFreeProfileState = "review_required";
        await region
          .getByRole("button", { name: "Обновить настройки AI", exact: true })
          .click();
        await region
          .getByText(/приостановлен до проверки владельцем/)
          .waitFor();
        await assertFreeRouterBrowserPanel(region, "review_required");
        assert.equal(await mode.inputValue(), "auto");
        assert.deepEqual(routerSettings.get("A").settings.allowedProviders, []);
        assert.deepEqual(routerSettings.get("A").settings.spending, {
          paidCallsAuthorized: false,
          maxRequestCostMicros: 0,
          maxDailyCostMicros: 0,
        });
        assert.ok(
          Object.values(routerSettings.get("A").settings.privacy).every(
            (providers) => providers.length === 0,
          ),
        );
        assert.equal(routerChats.length, beforeChats);
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          `free router settings overflow at${width}`,
        );
        await captureScreenshot(page, {
          path: resolve(artifacts, `web-free-router-settings-${width}.png`),
        });
      }
      assert.equal(routerSettingsPuts, beforePuts + 4);
      assert.deepEqual(routerSettings.get("B"), untouchedOtherOwner);
      assert.deepEqual(
        routerSnapshot("B")
          .providers.filter((provider) =>
            ["gemini", "openrouter"].includes(provider.id),
          )
          .map((provider) => provider.credentialLabels),
        [[], []],
      );
    } finally {
      routerFreeProfileState = null;
      routerSettings.set("A", original);
    }
  });
  await test("reflection deletion confirms intent, blocks dirty drafts and preserves other facts", async () => {
    const original = days.get("A").find((v) => v.date === date);
    original.notes = "Private reflection to remove";
    original.tomorrowPlan = "Retain tomorrow's draft";
    original.revision++;
    await openFixtureJournal(page);
    const reflection = page.locator("details").filter({
      has: page.locator("summary").filter({ hasText: "Вечерняя рефлексия" }),
    });
    await reflection.locator("summary").click();
    const clear = page.getByRole("button", {
      name: "Удалить вечернюю рефлексию",
      exact: true,
    });
    await page.getByLabel("Утренний вес, кг", { exact: true }).fill("52");
    assert.equal(await clear.isDisabled(), true);
    await page.reload();
    await selectFixtureDay(page);
    await reflection.locator("summary").click();
    const before = reflectionClears;
    page.off("dialog", acceptDialog);
    page.once("dialog", (dialog) => dialog.dismiss());
    await clear.click();
    page.on("dialog", acceptDialog);
    assert.equal(reflectionClears, before);
    await clear.click();
    await page
      .getByText(
        "Вечерняя рефлексия удалена из дневника LifeOS. Остальные записи сохранены.",
      )
      .waitFor();
    assert.equal(reflectionClears, before + 1);
    const current = days.get("A").find((v) => v.date === date);
    assert.deepEqual(current, {
      ...clearIdealHumanReflection(original),
      revision: original.revision + 1,
    });
    await page.reload();
    await selectFixtureDay(page);
    assert.equal(
      await page.getByLabel("Утренний вес, кг", { exact: true }).inputValue(),
      String(current.weightKg),
    );
    assert.equal(current.tomorrowPlan, "Retain tomorrow's draft");
  });
  page.off("dialog", acceptDialog);
  for (const width of [320, 390, 768, 1440]) {
    captureFixtures.set("A", captureBrowserFixture("A"));
    await page.setViewportSize({ width, height: 900 });
    await captureBrowserScenarios({
      page,
      fixture: captureFixtures.get("A"),
      test,
      prefix: `Web ${width}px`,
      open: () => page.goto(`${origin}/web/capture`),
    });
    await captureScreenshot(page, {
      path: resolve(artifacts, `web-capture-${width}.png`),
      fullPage: true,
    });
  }
  for (const width of [320, 390, 768, 1440]) {
    academicFixtures.set("A", academicBrowserFixture("A"));
    await page.setViewportSize({ width, height: 900 });
    await academicBrowserScenarios({
      page,
      fixture: academicFixtures.get("A"),
      prefix: `Web academic ${width}px`,
      test,
      open: () => page.goto(`${origin}/web/study`),
    });
    await captureScreenshot(page, {
      path: resolve(artifacts, `web-academic-${width}.png`),
      fullPage: true,
    });
  }
  page.on("dialog", acceptDialog);
  await test("web sessions isolate users in the rendered journal, capture inbox and academic events", async () => {
    const b = await isolatedContext({ viewport: { width: 390, height: 844 } });
    const p = await b.newPage();
    await p.goto(`${origin}/web/login?token=fixture-login-B`);
    await openFixtureJournal(p);
    assert.equal(
      await p.getByLabel("Утренний вес, кг", { exact: true }).inputValue(),
      "",
    );
    assert.equal(days.get("B").length, 0);
    await p.goto(
      `${origin}/web/capture?captureId=${captureFixtures.get("A").voiceId}`,
    );
    await p
      .getByRole("alert")
      .filter({ hasText: /недоступна|не найдена/ })
      .waitFor();
    assert.equal(
      await p
        .getByText("filming idea: Library b-roll", { exact: true })
        .count(),
      0,
    );
    assert.equal(
      await p
        .getByRole("region", { name: "Просмотр записи", exact: true })
        .count(),
      0,
    );
    await p.goto(`${origin}/web/study`);
    const academic = p.getByLabel("Учебный консьерж", { exact: true });
    await academic
      .getByRole("heading", {
        name: "Экзамены и учебный календарь",
        exact: true,
      })
      .waitFor();
    assert.equal(
      await academic
        .getByRole("heading", {
          name: "Synthetic Systems examination",
          exact: true,
        })
        .count(),
      0,
    );
    assert.equal(
      await academic
        .getByRole("heading", { name: "Synthetic CSV selected", exact: true })
        .count(),
      0,
    );
    await academic
      .getByRole("tab", { name: "Личные экзамены", exact: true })
      .click();
    assert.equal(
      await academic
        .getByRole("heading", {
          name: "Synthetic personal event corrected",
          exact: true,
        })
        .count(),
      0,
    );
    await b.close();
  });
  await test("all legacy routes render at six viewport widths without overflow or page errors", async () => {
    for (const width of V6_VIEWPORTS) {
      await page.setViewportSize({ width, height: 900 });
      for (const path of [
        "today",
        "planner",
        "calendar",
        "study",
        "workouts",
        "health",
        "nutrition",
        "finance",
        "ai",
        "capture",
        "ideal-human",
        "settings",
        "notifications",
        "creator",
      ]) {
        await page.goto(`${origin}/web/${path}`);
        await page.locator("h1").waitFor();
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
          `${path} overflow at ${width}`,
        );
      }
      await page.goto(`${origin}/web/ideal-human`);
      await captureScreenshot(page, {
        path: resolve(artifacts, `web-ideal-human-${width}.png`),
        fullPage: true,
      });
    }
    assert.deepEqual(errors, []);
  });
  await test("logout waits for client readiness, revokes the session and protected routes fail closed", async () => {
    const delayed = await isolatedContext({
      viewport: { width: 1440, height: 900 },
    });
    await delayed.addCookies(await context.cookies());
    const p = await delayed.newPage();
    const logoutErrors = [];
    p.on("pageerror", (error) => logoutErrors.push(error.message));
    let releaseScripts;
    const scriptGate = new Promise((resolve) => {
      releaseScripts = resolve;
    });
    const isNextScript = (request) =>
      new URL(request.url()).origin === origin &&
      new URL(request.url()).pathname.startsWith("/web/_next/") &&
      request.resourceType() === "script";
    await p.route("**/*", async (route) => {
      if (isNextScript(route.request())) await scriptGate;
      return route.fallback();
    });
    try {
      const firstScript = p.waitForRequest(isNextScript);
      await p.goto(`${origin}/web/settings`, { waitUntil: "commit" });
      await firstScript;
      const logout = p.getByRole("button", { name: "Выйти", exact: true });
      await logout.waitFor();
      assert.equal(await logout.isDisabled(), true);
      assert.equal(sessions.has(sessionA), true);
      releaseScripts();
      await logout.click({ trial: true });
      assert.equal(await logout.isEnabled(), true);
      const [response] = await Promise.all([
        p.waitForResponse(
          (response) => new URL(response.url()).pathname === "/web/logout",
        ),
        logout.click(),
      ]);
      assert.equal(response.status(), 303);
      assert.equal(new URL(response.request().headers().origin).origin, origin);
      await p.getByRole("heading", { name: "Твой LifeOS Web" }).waitFor();
      await p.waitForLoadState("networkidle");
      assert.equal(sessions.has(sessionA), false);
      assert.equal(
        (await delayed.cookies()).some(
          (cookie) => cookie.name === "lifeos_web_session",
        ),
        false,
      );
      assert.deepEqual(logoutErrors, []);
    } finally {
      releaseScripts();
      await delayed.close();
    }
    await page.goto(`${origin}/web/ideal-human`);
    await page.getByRole("heading", { name: "Твой LifeOS Web" }).waitFor();
  });
  assert.deepEqual(
    blockedExternalRequests,
    [],
    "unexpected external browser request was blocked",
  );
  assert.equal(passed, expectedCases);
  console.log(
    `Web dashboard browser: ${passed} scenarios passed; fixtures only.`,
  );
} catch (error) {
  runFailure ??= { stage: "runner", error: error.message };
  throw error;
} finally {
  await checkpoint();
  await writeFile(
    resolve(artifacts, "results.json"),
    JSON.stringify(
      {
        success: !runFailure && passed === expectedCases,
        startedAtUtc,
        finishedAtUtc: new Date().toISOString(),
        passed,
        expectedCases,
        caseResults,
        screenshots,
        runFailure,
        pageErrors,
        viewports: V6_VIEWPORTS,
        v6FixtureCases: V6_SCENARIO_COUNT,
        v6FixtureWrites: v6FixtureHistory.reduce(
          (sum, fixture) => ({
            preferences: sum.preferences + fixture.writes.preferences,
            policy: sum.policy + fixture.writes.policy,
          }),
          { preferences: 0, policy: 0 },
        ),
        v6DeliveryJobs: v6FixtureHistory.reduce(
          (sum, fixture) => sum + fixture.deliveryJobs,
          0,
        ),
        api: "isolated_loopback_fixtures",
        productionVerified: false,
        realProviderCalls: 0,
        telegramSends: 0,
        mockRoutedReplies: routerChats.length,
        mockRouterSettingsPuts: routerSettingsPuts,
      },
      null,
      2,
    ),
  );
  if (browser) await browser.close();
  app.kill("SIGTERM");
  await new Promise((r) => frontend.close(r));
  await new Promise((r) => backend.close(r));
  await writeFile(resolve(artifacts, "next.log"), logs);
}
