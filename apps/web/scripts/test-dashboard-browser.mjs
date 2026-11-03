// Production Next artifact, isolated loopback fixture API, real browser and authentication flow.
// pnpm exec tsx apps/web/scripts/test-dashboard-browser.mjs
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { execFileSync } from "node:child_process";
import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  clearIdealHumanReflection,
  emptyIdealHumanDay,
  parseIdealHumanDay,
} from "../../../packages/core/src/ideal-human.ts";
import { DEFAULT_DAILY_LIFE_PREFERENCES } from "../../../packages/core/src/daily-life.ts";
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
const hydration = (owner) => ({
  date,
  timezone: "Asia/Almaty",
  totalMl: water
    .get(owner)
    .filter((v) => !v.undoneAt)
    .reduce((s, v) => s + v.amountMl, 0),
  entries: water.get(owner),
  truncated: false,
});
const summary = (owner) => ({
  date,
  timezone: "Asia/Almaty",
  dayNumber: 1,
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
  hydration: hydration(owner),
  nutrition: {
    mealCount: days.get(owner).find((v) => v.date === date)?.meals.length ?? 0,
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
      return json(res, summary(owner));
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
      return json(res, hydration(owner));
    }
    if (/^\/api\/tma\/hydration\/[^/]+\/undo$/.test(path)) {
      const entry = water
        .get(owner)
        .find((v) => v.id === path.split("/").at(-2));
      if (entry) entry.undoneAt ??= new Date().toISOString();
      return json(res, hydration(owner));
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
    if (path === "/api/tma/study")
      return json(res, {
        timezone: "Asia/Almaty",
        courses: [
          {
            id: "fixture-course",
            title: "Fixture cybersecurity",
            code: "FIXTURE",
            startsOn: null,
            endsOn: null,
            externalCourseKey: null,
            calculator: null,
            schedules: [],
          },
        ],
        records: [
          {
            id: "fixture-grade",
            courseTitle: "Fixture cybersecurity",
            title: "Fixture assignment",
            score: 75,
            maxScore: 100,
            dueAt: null,
          },
        ],
      });
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
        enabled: false,
        available: false,
        reason: "disabled",
        liveEnabled: false,
      });
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
async function test(name, fn) {
  if (
    process.env.LIFEOS_WEB_BROWSER_LOGOUT_ONLY &&
    !/unauthenticated|logout/.test(name)
  )
    return;
  await fn();
  passed++;
  console.log("PASS " + name);
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
      return route.abort("blockedbyclient");
    });
    return ctx;
  }
  const context = await isolatedContext({
    viewport: { width: 1440, height: 1000 },
    timezoneId: "UTC",
  });
  const page = await context.newPage();
  const errors = [];
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
      await page.screenshot({
        path: resolve(artifacts, `web-long-profile-name-${width}.png`),
      });
    }
  });
  await test("Ideal Human saves once and persists after reloading", async () => {
    await page.goto(`${origin}/web/ideal-human`);
    await page
      .getByRole("heading", { name: "Ideal Human — Day 1/30" })
      .waitFor();
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
    assert.equal(
      await page.getByLabel("Утренний вес, кг", { exact: true }).inputValue(),
      "51.7",
    );
    assert.equal(days.get("A")[0].sleepMinutes, 450);
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
    days.get("A")[0].revision++;
    days.get("A")[0].notes = "Fixture remote edit";
    await page
      .getByRole("button", { name: "Сохранить день", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Загрузить сохранённую версию" })
      .waitFor();
    assert.equal(days.get("A")[0].weightKg, 51.7);
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
    try {
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
      await p.getByText("Подготавливаем дневник…", { exact: true }).waitFor();
      assert.equal(
        await weight.inputValue(),
        String(days.get("A")[0].weightKg),
      );
      releaseScripts();
      await p
        .getByText("Подготавливаем дневник…", { exact: true })
        .waitFor({ state: "hidden" });
      assert.equal(await weight.isEnabled(), true);
      assert.equal(await dateSelector.isEnabled(), true);
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
      assert.equal(days.get("A")[0].weightKg, 51.8);
      await p.reload();
      await weight.waitFor();
      await p
        .getByText("Подготавливаем дневник…", { exact: true })
        .waitFor({ state: "hidden" });
      assert.equal(await weight.inputValue(), "51.8");
      assert.deepEqual(delayedErrors, []);
    } finally {
      releaseScripts();
      await delayed.close();
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
    await page.getByRole("button", { name: "+250 мл", exact: true }).click();
    await page.getByText("250 мл", { exact: true }).first().waitFor();
    assert.equal(hydration("A").totalMl, 250);
    await page
      .getByRole("button", { name: "Отменить последнюю запись", exact: true })
      .click();
    await page.getByText("Последняя запись воды отменена.").waitFor();
    assert.equal(hydration("A").totalMl, 0);
  });
  await test("meal photo is local until consent, draft remains unsaved, confirmation writes reviewed estimate", async () => {
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
    assert.equal(days.get("A")[0].meals.length, 0);
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
    assert.equal(days.get("A")[0].meals.length, 0);
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
    assert.equal(days.get("A")[0].meals[0].caloriesKcal, 650);
    assert.equal(days.get("A")[0].meals[0].corrected, true);
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
  await test("reflection deletion confirms intent, blocks dirty drafts and preserves other facts", async () => {
    const original = days.get("A").find((v) => v.date === date);
    original.notes = "Private reflection to remove";
    original.tomorrowPlan = "Retain tomorrow's draft";
    original.revision++;
    await page.goto(`${origin}/web/ideal-human`);
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
    assert.equal(
      await page.getByLabel("Утренний вес, кг", { exact: true }).inputValue(),
      String(current.weightKg),
    );
    assert.equal(current.tomorrowPlan, "Retain tomorrow's draft");
  });
  await test("web sessions isolate users in the rendered journal", async () => {
    const b = await isolatedContext({ viewport: { width: 390, height: 844 } });
    const p = await b.newPage();
    await p.goto(`${origin}/web/login?token=fixture-login-B`);
    await p.goto(`${origin}/web/ideal-human`);
    await p.getByLabel("Утренний вес, кг", { exact: true }).waitFor();
    assert.equal(
      await p.getByLabel("Утренний вес, кг", { exact: true }).inputValue(),
      "",
    );
    assert.equal(days.get("B").length, 0);
    await b.close();
  });
  await test("desktop tablet and 320px routes render without overflow or page errors", async () => {
    for (const width of [320, 768, 1440]) {
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
      await page.screenshot({
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
  await writeFile(
    resolve(artifacts, "results.json"),
    JSON.stringify(
      {
        passed,
        viewports: [320, 768, 1440],
        api: "isolated_loopback_fixtures",
        productionVerified: false,
        realProviderCalls: 0,
      },
      null,
      2,
    ),
  );
  console.log(
    `Web dashboard browser: ${passed} scenarios passed; fixtures only.`,
  );
} finally {
  if (browser) await browser.close();
  app.kill("SIGTERM");
  await new Promise((r) => frontend.close(r));
  await new Promise((r) => backend.close(r));
  await writeFile(resolve(artifacts, "next.log"), logs);
}
