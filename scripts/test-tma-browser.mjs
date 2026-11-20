// Local browser verification only. Run with pnpm exec tsx and an isolated Playwright install.
// Required: LIFEOS_TMA_DIST; optional: LIFEOS_PLAYWRIGHT_MODULE, LIFEOS_CHROMIUM_EXECUTABLE, LIFEOS_BROWSER_ARTIFACTS, LIFEOS_TMA_API_ORIGIN.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
const { chromium } = await import(
  process.env.LIFEOS_PLAYWRIGHT_MODULE || "playwright"
);
import {
  builtinStudyCalculatorState,
  syllabusProfiles,
} from "../packages/core/src/study-syllabi.ts";
import { defaultScholarshipConfig } from "../packages/core/src/scholarship.ts";
import {
  defaultAiRouterSettings,
  parseAiRouterSettings,
} from "../packages/core/src/ai-model-router.ts";
import {
  freeRouterBrowserSnapshot,
  assertFreeRouterBrowserPanel,
} from "./free-ai-router-browser-fixtures.mjs";
const artifact = resolve(
  process.env.LIFEOS_BROWSER_ARTIFACTS || "/tmp/lifeos-tma-browser-artifacts",
);
if (!process.env.LIFEOS_TMA_DIST)
  throw new Error("Set LIFEOS_TMA_DIST to the staged /tma production build.");
const root = resolve(process.env.LIFEOS_TMA_DIST);
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, "http://local").pathname);
    const relative = path.replace(/^\/tma\/?/, "") || "index.html";
    const file = resolve(root, relative);
    if (!file.startsWith(root + sep)) throw new Error("bad path");
    const body = await readFile(file);
    res.setHeader(
      "Content-Type",
      { ".js": "text/javascript", ".css": "text/css", ".html": "text/html" }[
        extname(file)
      ] || "application/octet-stream",
    );
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("missing");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = "http://127.0.0.1:" + server.address().port;
const apiOrigin = new URL(
  process.env.LIFEOS_TMA_API_ORIGIN || "https://lifeos.zalewko.me",
).origin;
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.LIFEOS_CHROMIUM_EXECUTABLE || undefined,
  timeout: 180_000,
  args: ["--no-sandbox", "--renderer-process-limit=1"],
});
console.log("Browser launched; using staged assets and mocked APIs only.");
let failed = 0,
  passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log("PASS " + name);
  } catch (e) {
    failed++;
    console.log("FAIL " + name + ": " + e.message);
  }
}
function workspace() {
  const courses = syllabusProfiles.map((p) => ({
    id: p.id,
    code: p.courseCode,
    title: p.title,
    calculator: builtinStudyCalculatorState(p.courseCode),
    scholarship: defaultScholarshipConfig(),
    schedules: [],
    startsOn: null,
    endsOn: null,
    externalCourseKey: null,
  }));
  courses[0].scholarship.scenarios.realistic.periodTotals.att2 = 80;
  const records = [
    ["Assignment 1", 75],
    ["Assignment 2", 50],
    ["Assignment 3", 70],
    ["Assignment Lecture Async 1", 88],
    ["Quiz Midterm", 81],
    ["Calculated Register Midterm", 72.1],
  ].map(([title, score], i) => ({
    id: "grade-" + i,
    userId: "fixture-owner",
    sourceEventId: null,
    courseTitle: courses[0].title,
    title,
    recordType: title === "Assignment Lecture Async 1" ? "assignment" : "grade",
    score,
    maxScore: 100,
    percentage: score,
    valueText: null,
    occursAt: null,
    dueAt: null,
    createdAt: "2026-10-11T00:00:00Z",
    updatedAt: "2026-10-11T00:00:00Z",
  }));
  return { timezone: "Asia/Qyzylorda", courses, records };
}

function seedPublishedGrades(data) {
  const dbms = data.courses.find((course) => course.id === "dbms");
  const os = data.courses.find((course) => course.id === "os");
  dbms.externalCourseKey = "moodle:501";
  os.externalCourseKey = "moodle:502";
  const template = data.records[0];
  const grade = (course, courseId, itemId, title, score, raw = {}) => ({
    ...template,
    id: `record-${courseId}-${itemId}`,
    sourceEventId: `source-${courseId}-${itemId}`,
    courseTitle: course.title,
    title,
    score,
    percentage: score,
    rawJson: { moodle_course_id: courseId, moodle_item_id: itemId, ...raw },
  });
  const total = {
    source: "moodle_course_total",
    moodle_course_id: "501",
    moodle_item_id: "99",
    score: 81,
    max_score: 100,
  };
  data.records = [
    grade(dbms, "501", "1", "Calculated grade Register Midterm", 70, {
      lifeos_course_total: total,
    }),
    grade(dbms, "501", "2", "Calculated grade Register Endterm", 80, {
      lifeos_course_total: total,
    }),
    grade(dbms, "501", "3", "Calculated grade Register Final", 90),
    grade(dbms, "501", "99", "Course total", 81, { itemtype: "course" }),
    grade(dbms, "501", "4", "Assignment 1", 75, {
      itemtype: "mod",
      moodle_module: "assign",
    }),
    grade(os, "502", "5", "Assignment 2", 0, {
      itemtype: "mod",
      moodle_module: "assign",
    }),
    grade(dbms, "503", "6", "Оценка другой группы", 97, {
      itemtype: "mod",
      moodle_module: "assign",
    }),
  ];
}

function seedCompletedCourse(data) {
  const course = data.courses.find((item) => item.id === "networks");
  course.externalCourseKey = "moodle:504";
  const assignments = Array.from({ length: 8 }, (_, i) => [
    "Assignment " + (i + 1),
    i < 4 ? 76 : 78,
    "mod",
  ]);
  const grades = [
    ...assignments,
    ["Midterm", 76, "mod"],
    ["Endterm", 74, "mod"],
    ["Cisco certificate", 80, "mod"],
    ["Final exam", 73, "mod"],
    ["Calculated grade Register Midterm", 76, "manual"],
    ["Calculated grade Register Endterm", 77, "manual"],
    ["Calculated grade Register Final", 73, "manual"],
    // 30% of 76 + 30% of 77 + 40% of 73 = 75.1; Moodle publishes 75.
    ["Course total", 75, "course"],
  ];
  data.records.push(
    ...grades.map(([title, score, itemtype], i) => ({
      ...data.records[0],
      id: "record-504-" + i,
      sourceEventId: "source-504-" + i,
      courseTitle: course.title,
      title,
      score,
      percentage: score,
      rawJson: {
        moodle_course_id: "504",
        moodle_item_id: String(i + 1),
        itemtype,
      },
    })),
  );
}

function routerFixture(active = false) {
  const descriptor = (id, provider, model) => ({
    id,
    provider,
    model,
    label: `Fixture ${provider} balanced`,
    tiers: ["balanced", "fast"],
    capabilities: ["text", "json"],
    billing: "api",
    inputCostMicrosPer1k: 100,
    outputCostMicrosPer1k: 200,
    configured: true,
    authorized: true,
    status: "configured",
    privacy: "external",
    metadataVerified: true,
  });
  const settings = defaultAiRouterSettings();
  if (active) {
    settings.allowedTiers.push("balanced");
    settings.allowedProviders = ["openrouter", "gemini"];
    settings.privacy.general = ["openrouter", "gemini"];
    settings.privacy.university = ["openrouter", "gemini"];
    settings.tierModels.balanced = ["fixture-openrouter", "fixture-gemini"];
    settings.spending = {
      paidCallsAuthorized: true,
      maxRequestCostMicros: 10_000,
      maxDailyCostMicros: 30_000,
    };
    settings.fallback = {
      enabled: true,
      maxAttempts: 2,
      allowProviderChange: true,
    };
  }
  return {
    settings,
    revision: 0,
    models: [
      descriptor(
        "fixture-openrouter",
        "openrouter",
        "fixture/provider-balanced",
      ),
      descriptor("fixture-gemini", "gemini", "gemini-fixture-balanced"),
    ],
    providers: [
      "gemini",
      "openrouter",
      "openai",
      "anthropic",
      "chatgpt_plan",
    ].map((id) => ({
      id,
      status:
        id === "chatgpt_plan"
          ? "permission_required"
          : ["gemini", "openrouter"].includes(id)
            ? "configured_unverified"
            : "not_configured",
      credentialLabels: ["gemini", "openrouter"].includes(id)
        ? ["fixture-project"]
        : [],
      verified: false,
    })),
    operatorLimits: {
      routerEnabled: true,
      paidRequestsEnabled: true,
      maxRequestCostMicros: 1_000_000,
      maxDailyCostMicros: 5_000_000,
      maxOutputTokens: 2048,
    },
    chatgptPlan: {
      status: "prepared",
      identityConnected: false,
      planUsageAuthorized: false,
      usesApiCredits: false,
      manageUsageUrl: "https://chatgpt.com/settings/usage",
    },
    recentExecutions: [],
  };
}

function todayFixture() {
  return {
    plan: {
      date: "2026-11-03",
      timezone: "Asia/Almaty",
      mode: "maintenance",
      window: {
        startsAt: "2026-11-03T08:00:00+05:00",
        endsAt: "2026-11-03T22:00:00+05:00",
      },
      availableMinutes: 0,
      freeSlots: [],
      conflicts: [],
      rankedTasks: [],
      blocks: [],
      unscheduledTaskIds: [],
      warnings: [],
    },
    events: [],
    reminders: [],
    productivity: {
      startDate: "2026-10-28",
      endDate: "2026-11-03",
      timezone: "Asia/Almaty",
      daily: [],
      totalCreated: 0,
      totalCompleted: 0,
      completionRate: null,
      truncated: false,
      warnings: [],
    },
    ai: {
      enabled: true,
      available: true,
      reason: null,
      liveEnabled: false,
      assistantEnabled: false,
    },
  };
}

function chatFixture(number) {
  const second = number === 2;
  return {
    answer:
      number === 1
        ? "First approved fixture answer."
        : number === 2
          ? "Second approved fixture answer."
          : "Fresh approved fixture answer.",
    suggestions: [],
    provider: second ? "gemini" : "openrouter",
    readOnly: true,
    modelRoute: {
      version: 1,
      requestId: `fixture-request-${number}`,
      modelId: second ? "fixture-gemini" : "fixture-openrouter",
      provider: second ? "gemini" : "openrouter",
      model: second ? "gemini-fixture-balanced" : "fixture/provider-balanced",
      billing: "api",
      estimatedCostMicros: 10,
      reportedCostMicros: second ? 6 : 4,
      costSource: second ? "rate_estimate" : "provider_reported",
      latencyMs: second ? 234 : 123,
      fallback: second,
      reason: second ? "automatic_fallback" : "automatic_tier",
      privacy: "external",
    },
  };
}
async function setup(width, options = {}) {
  const context = await browser.newContext({
    viewport: { width, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const data = workspace();
  const baseRouter = routerFixture(Boolean(options.activeRouterPolicy));
  const router = options.freeProfile
    ? freeRouterBrowserSnapshot(baseRouter)
    : baseRouter;
  let routerReads = 0,
    routerWrites = 0,
    failRouterWrite = 0;
  let routerReadGate = null,
    releaseRouterRead = () => {};
  const routerRequests = [],
    chatRequests = [],
    externalRequests = [];
  let saves = 0;
  let saveGate = null;
  let releaseSave = () => {};
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith("/api/tma/")) {
      if (url.origin === origin) return route.continue();
      externalRequests.push(url.origin + url.pathname);
      return route.abort();
    }
    // The real production artifact may embed its public API origin. Fulfill
    // these calls locally before any network connection can be made.
    if (url.origin !== origin && url.origin !== apiOrigin) {
      externalRequests.push(url.origin + url.pathname);
      return route.abort();
    }
    const cors = {
      "access-control-allow-origin": origin,
      "access-control-allow-headers": "content-type,x-telegram-init-data",
      "access-control-allow-methods": "GET,PUT,POST,DELETE,OPTIONS",
    };
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: cors });
    let body,
      status = 200;
    if (url.pathname === "/api/tma/session") {
      if (options.authError) {
        status = 401;
        body = {
          error: "invalid_init_data",
          message: "PRIVATE BACKEND DIAGNOSTIC",
        };
      } else
        body = {
          data: {
            state: "active",
            telegramUserId: 12345,
            displayName: "Local browser fixture",
            profile: { role: "user", status: "active" },
            integrations: {
              telegram: { connected: true },
              obsidian: { connected: false },
              google: { connected: false },
              health: { connected: false },
            },
          },
        };
    } else if (url.pathname === "/api/tma/study") {
      if (options.studyError) {
        status = 503;
        body = {
          error: "database_not_configured",
          message: "PRIVATE DATABASE DIAGNOSTIC",
        };
      } else
        body = {
          data: options.empty ? { ...data, courses: [], records: [] } : data,
        };
    } else if (url.pathname === "/api/tma/lms/work")
      body = {
        data: {
          items: [],
          stale: false,
          truncated: false,
          warnings: [],
          unsupportedFeatures: [],
          timezone: data.timezone,
          lastSyncSuccessAt: null,
          lastSyncAttemptAt: null,
        },
      };
    else if (url.pathname === "/api/tma/lms/connection")
      body = {
        data: {
          configured: false,
          state: "not_configured",
          lastSyncSuccessAt: null,
          lastSyncAttemptAt: null,
          lastErrorCategory: null,
          sessionExpiresAt: null,
          syncRequestedAt: null,
          unsupportedFeatures: [],
        },
      };
    else if (options.router && url.pathname === "/api/tma/today")
      body = { data: todayFixture() };
    else if (options.router && url.pathname === "/api/tma/ai/router/settings") {
      if (route.request().method() === "GET") {
        routerReads++;
        if (routerReadGate) await routerReadGate;
        body = { data: router };
      } else if (route.request().method() === "PUT") {
        routerWrites++;
        const input = JSON.parse(route.request().postData());
        routerRequests.push(input);
        if (failRouterWrite) {
          status = failRouterWrite;
          failRouterWrite = 0;
          body = {
            error:
              status === 409
                ? "ai_router_settings_conflict"
                : "ai_router_storage_unavailable",
            message: "PRIVATE ROUTER DIAGNOSTIC",
          };
        } else if (input.expectedRevision !== router.revision) {
          status = 409;
          body = {
            error: "ai_router_settings_conflict",
            message: "PRIVATE ROUTER REVISION",
          };
        } else {
          router.settings = parseAiRouterSettings(input.settings);
          router.revision++;
          body = { data: router };
        }
      } else return route.abort();
    } else if (
      options.router &&
      url.pathname === "/api/tma/ai/chat" &&
      route.request().method() === "POST"
    ) {
      chatRequests.push(JSON.parse(route.request().postData()));
      body = { data: chatFixture(chatRequests.length) };
    } else if (url.pathname === "/api/tma/ai/status")
      body = {
        data: {
          enabled: Boolean(options.router && !options.freeProfile),
          available: Boolean(options.router && !options.freeProfile),
          reason: options.freeProfile
            ? "ai_router_disabled"
            : options.router
              ? null
              : "ai_disabled",
          liveEnabled: false,
          assistantEnabled: false,
        },
      };
    else if (
      data.courses.some(
        (course) =>
          url.pathname ===
          `/api/tma/study/courses/${encodeURIComponent(course.id)}/scholarship`,
      ) &&
      route.request().method() === "PUT"
    ) {
      saves++;
      const config = JSON.parse(route.request().postData()).config;
      const course = data.courses.find(
        (course) =>
          url.pathname ===
          `/api/tma/study/courses/${encodeURIComponent(course.id)}/scholarship`,
      );
      course.scholarship = config;
      if (saveGate) await saveGate;
      body = { data: config };
    } else {
      return route.abort();
    }
    await route.fulfill({
      status,
      headers: cors,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  return {
    context,
    page,
    errors,
    data,
    saves: () => saves,
    router,
    routerReads: () => routerReads,
    routerWrites: () => routerWrites,
    routerRequests,
    chatRequests,
    externalRequests,
    failRouterWrite(status) {
      failRouterWrite = status;
    },
    externalRouterChange(update) {
      router.settings = parseAiRouterSettings(update(router.settings));
      router.revision++;
    },
    holdRouterRead() {
      routerReadGate = new Promise((done) => {
        releaseRouterRead = done;
      });
    },
    releaseRouterRead() {
      releaseRouterRead();
      routerReadGate = null;
    },
    holdNextSave() {
      saveGate = new Promise((done) => {
        releaseSave = done;
      });
    },
    releaseSave() {
      releaseSave();
      saveGate = null;
    },
  };
}
async function noOverflow(page) {
  const extra = await page.evaluate(() => ({
    width: innerWidth,
    total: document.documentElement.scrollWidth,
    items: [...document.querySelectorAll("body *")]
      .filter((e) => e.getBoundingClientRect().right > innerWidth + 1)
      .slice(0, 6)
      .map((e) => ({
        tag: e.tagName,
        text: e.textContent.slice(0, 70),
        right: e.getBoundingClientRect().right,
      })),
  }));
  assert.ok(extra.total <= extra.width, JSON.stringify(extra));
  const clippedLabels = await page.evaluate(() =>
    [...document.querySelectorAll("article dl dt")].flatMap((label) => {
      const range = document.createRange();
      range.selectNodeContents(label);
      const box = label.getBoundingClientRect();
      return [...range.getClientRects()].some(
        (text) => text.right > box.right + 1,
      )
        ? [label.textContent]
        : [];
    }),
  );
  assert.deepEqual(
    clippedLabels,
    [],
    "Metric labels must stay inside their columns",
  );
}
try {
  for (const width of [320, 390]) {
    await test(`${width}px published Moodle grades on first load and when switching subjects`, async () => {
      const t = await setup(width);
      const { page } = t;
      seedPublishedGrades(t.data);
      const writes = [];
      page.on("request", (req) => {
        if (
          req.url().includes("/api/tma/") &&
          ["POST", "PUT", "PATCH", "DELETE"].includes(req.method())
        ) {
          writes.push(req.method());
        }
      });
      try {
        await page.goto(origin + "/tma/?screen=dashboard");
        const grades = page.getByRole("region", {
          name: "Полученные оценки",
          exact: true,
        });
        const course = page.getByRole("combobox", {
          name: "Предмет",
          exact: true,
        });
        const term = (name) =>
          grades.getByText(name, { exact: true }).and(grades.locator("dt"));
        const grade = async (name, expected) => {
          const label = term(name);
          await label.waitFor();
          assert.equal(await label.count(), 1, name);
          const value = await label
            .locator("xpath=following-sibling::dd[1]")
            .innerText();
          assert.equal(value.trim(), String(expected), name);
        };
        const earned = page
          .getByText("Набрано по силабусу", { exact: true })
          .locator("xpath=following-sibling::dd[1]");
        const examForecast = page.getByLabel("Прогноз: Финальный экзамен", {
          exact: true,
        });
        const checkEarned = async (points) => {
          const label = await earned.innerText();
          assert.equal(label.trim().replace(",", "."), points + " / 100");
        };
        await grades.waitFor();
        assert.equal(await course.inputValue(), "dbms");
        await grade("Мидтерм", 70);
        await grade("Эндтерм", 80);
        await grade("Финал", 90);
        await grade("Итог курса", 81);
        assert.equal(
          await grades.getByText("81", { exact: true }).count(),
          1,
          "the course result embedded in register records and the standalone total must appear once",
        );
        await grade("Assignment 1", 75);
        await checkEarned(40.5);
        assert.equal(
          await examForecast.count(),
          0,
          "verified Register Final supplies the only syllabus exam",
        );
        assert.equal(await grades.getByText("Оценка другой группы").count(), 0);
        const nav = page.getByRole("navigation", { name: "Разделы LifeOS" });
        await nav.getByRole("button", { name: "Учёба", exact: true }).click();
        const card = page
          .getByRole("article")
          .filter({ has: page.getByLabel("Midterm: 70", { exact: true }) });
        await card.getByLabel("Endterm: 80", { exact: true }).waitFor();
        await card.getByLabel("Final: 90", { exact: true }).waitFor();
        assert.equal(
          await card
            .getByLabel("Итог курса", { exact: true })
            .locator("strong")
            .innerText(),
          "81",
        );
        await nav
          .getByRole("button", { name: "Стипендия", exact: true })
          .click();
        await course.selectOption("os");
        await grade("Assignment 2", 0);
        assert.equal(await term("Assignment 1").count(), 0);
        assert.equal(await grades.getByText("81", { exact: true }).count(), 0);
        const published = await grades.innerText();
        const manual = page.getByLabel("Assignment 1", { exact: true });
        if (!(await manual.isVisible()))
          await page
            .locator("summary")
            .filter({ hasText: "Оценки и веса" })
            .click();
        await manual.fill("88");
        await page.getByLabel("Прогноз: Endterm", { exact: true }).fill("91");
        assert.equal(
          await grades.innerText(),
          published,
          "manual entries and forecasts must not appear as published grades",
        );
        await course.selectOption("dbms");
        await grade("Мидтерм", 70);
        await grade("Итог курса", 81);
        assert.equal(await term("Assignment 2").count(), 0);
        t.data.records = t.data.records.filter(
          (r) => r.rawJson.itemtype !== "course",
        );
        for (const row of t.data.records)
          delete row.rawJson.lifeos_course_total;
        await page.reload();
        await checkEarned(40.5);
        assert.equal(await examForecast.count(), 0);
        // A register without a source event cannot supply the syllabus exam.
        const register = t.data.records.find(
          (record) => record.id === "record-501-3",
        );
        const sourceId = register.sourceEventId;
        register.sourceEventId = null;
        await page.reload();
        await checkEarned(4.5);
        await examForecast.waitFor();
        // An actual published exam takes precedence over an otherwise verified register.
        register.sourceEventId = sourceId;
        t.data.records.push({
          ...register,
          id: "record-501-7",
          sourceEventId: "source-501-7",
          title: "Final exam",
          score: 65,
          percentage: 65,
          rawJson: {
            ...register.rawJson,
            moodle_item_id: "7",
            itemtype: "mod",
            moodle_module: "quiz",
          },
        });
        await page.reload();
        await checkEarned(30.5);
        assert.equal(await examForecast.count(), 0);
        await grade("Финал", 90);
        assert.deepEqual(
          writes,
          [],
          "reading grades and trying different scores must not write",
        );
        assert.deepEqual(t.errors, []);
        await noOverflow(page);
      } finally {
        await t.context.close();
      }
    });
  }
  for (const width of [320, 390]) {
    await test(`${width}px a completed syllabus shows the published course total and reopens the planner for a partial course`, async () => {
      const t = await setup(width);
      const { page } = t;
      seedPublishedGrades(t.data);
      seedCompletedCourse(t.data);
      try {
        await page.goto(origin + "/tma/?screen=dashboard");
        const subject = page.getByRole("combobox", {
          name: "Предмет",
          exact: true,
        });
        const published = page.getByRole("region", {
          name: "Полученные оценки",
          exact: true,
        });
        const complete = page.locator('output[aria-label="Итог по предмету"]');
        const needed = page.locator('output[aria-label="Нужный средний балл"]');
        const plan = page.getByRole("region", {
          name: "План по работам",
          exact: true,
        });
        const gap = page.getByText("До цели", { exact: true });
        const checkComplete = async () => {
          await complete.waitFor();
          assert.match(
            (await complete.innerText()).trim(),
            /^75(?:\s*\/\s*100)?$/,
          );
          await published.waitFor();
          const endterm = published
            .getByText("Эндтерм", { exact: true })
            .locator("xpath=following-sibling::dd[1]");
          assert.equal(await endterm.innerText(), "77");
          assert.equal(await needed.count(), 0);
          assert.equal(await plan.count(), 0);
          assert.equal(await gap.count(), 0);
          assert.equal(
            await page.getByRole("textbox", { name: /^Прогноз:/ }).count(),
            0,
          );
        };
        await subject.selectOption("networks");
        await checkComplete();
        await noOverflow(page);
        await subject.selectOption("dbms");
        await published.getByText("Итог курса", { exact: true }).waitFor();
        await needed.waitFor();
        await gap.waitFor();
        await plan.waitFor();
        assert.equal(await complete.count(), 0);
        await subject.selectOption("networks");
        await checkComplete();
        assert.equal(t.saves(), 0);
        assert.deepEqual(t.errors, []);
      } finally {
        await t.context.close();
      }
    });
  }
  for (const width of [320, 390]) {
    const t = await setup(width);
    const { page } = t;
    const nav = page.getByRole("navigation", { name: "Разделы LifeOS" });
    const subject = page.getByRole("combobox", {
      name: "Предмет",
      exact: true,
    });
    const input = (label) => page.getByLabel(label, { exact: true });
    const required = (expected, label = "Нужный средний балл") =>
      page.waitForFunction(
        ({ value, label }) => {
          const text = document.querySelector(
            `output[aria-label="${CSS.escape(label)}"]`,
          )?.textContent;
          const first = text?.replace(",", ".").match(/\d+(?:\.\d+)?/);
          return first && Number(first[0]) === value;
        },
        { value: expected, label },
      );
    await test(`${width}px subject-specific syllabus and average needed for the target`, async () => {
      await page.goto(origin + "/tma/?screen=dashboard");
      await subject.selectOption({ label: "Operating Systems" });
      await required(70);
      if (!(await input("Assignment 1").isVisible())) {
        await page
          .locator("summary")
          .filter({ hasText: "Оценки и веса" })
          .click();
      }
      for (let i = 1; i <= 5; i++) await input("Assignment " + i).fill("80");
      await input("Midterm").fill("85");
      // 29.1 points secured; 64% outstanding. Round up so the target is met.
      await required(63.91);
      await input("Assignment 6").fill("0");
      await required(70.52);
      await input("Assignment 6").fill("");
      await required(63.91);
      await noOverflow(page);
      for (const name of ["Сегодня", "Учёба", "Стипендия", "Другие разделы"]) {
        const box = await nav
          .getByRole("button", { name, exact: true })
          .boundingBox();
        assert.ok(box && box.height >= 44 && box.width >= 44);
      }
    });
    await test(`${width}px per-work forecasts, remaining targets, and course isolation`, async () => {
      const plan = page.getByRole("region", { name: "План по работам" });
      const forecast = (label) =>
        plan.getByLabel("Прогноз: " + label, { exact: true });
      const reset = plan.getByRole("button", { name: "Сбросить прогнозы" });
      const openIds = [
        "assignment_6",
        "assignment_7",
        "assignment_8",
        "final_exam",
      ];
      const checkTargets = async (ids, expected) => {
        for (const id of ids) {
          const result = plan.getByTestId("work-target-" + id);
          await result.waitFor();
          const match = (await result.innerText())
            .replace(",", ".")
            .match(/\d+(?:\.\d+)?/);
          assert.equal(match ? Number(match[0]) : null, expected, id);
        }
      };
      await plan.waitFor();
      await checkTargets([...openIds, "endterm"], 63.91);
      assert.equal(await forecast("Assignment 1").count(), 0);
      assert.equal(await forecast("Midterm").count(), 0);
      await forecast("Endterm").fill("80");
      await required(62.25, "За остальные работы");
      await checkTargets(openIds, 62.25);
      await checkTargets(["endterm"], 80);
      assert.match(
        await page
          .locator(".syllabus-totals div")
          .filter({ hasText: "Набрано" })
          .locator("dd")
          .innerText(),
        /^29[,.]1\s*\/\s*100$/,
      );
      assert.equal(await input("Endterm").inputValue(), "");
      assert.equal(await input("Assignment 1").inputValue(), "80");
      assert.equal(await input("Midterm").inputValue(), "85");
      await noOverflow(page);
      await mkdir(artifact + "/browser", { recursive: true });
      await plan.evaluate((section) =>
        section.scrollIntoView({ block: "start" }),
      );
      await page.screenshot({
        path: artifact + `/browser/tma-scholarship-plan-${width}.png`,
        animations: "disabled",
      });
      await subject.selectOption({ label: "Digital Logic Design" });
      assert.equal(await forecast("Endterm").inputValue(), "");
      await forecast("Endterm").fill("65");
      await forecast("Assignment 1").fill("90");
      t.data.records.push({
        ...t.data.records[0],
        id: "fixture-new-official-grade",
        courseTitle: "Digital Logic Design",
        title: "Assignment 1",
        score: 37,
        percentage: 37,
      });
      await page.reload();
      await subject.selectOption({ label: "Operating Systems" });
      await checkTargets(openIds, 62.25);
      assert.equal(await forecast("Endterm").inputValue(), "80");
      assert.equal(await input("Endterm").inputValue(), "");
      await forecast("Endterm").fill("101");
      assert.equal(
        await forecast("Endterm").getAttribute("aria-invalid"),
        "true",
      );
      await checkTargets(openIds, null);
      await forecast("Endterm").fill("0");
      await required(70.52, "За остальные работы");
      await checkTargets(openIds, 70.52);
      await forecast("Финальный экзамен").fill("0");
      await plan.getByText(/с таким прогнозом цель недостижима/i).waitFor();
      await checkTargets(
        ["assignment_6", "assignment_7", "assignment_8"],
        null,
      );
      assert.equal(await forecast("Финальный экзамен").inputValue(), "0");
      assert.equal(await input("Финальный экзамен").inputValue(), "");
      for (const number of [6, 7, 8]) {
        await forecast("Assignment " + number).fill("50");
      }
      assert.match(
        await page.getByLabel("Итог по прогнозу", { exact: true }).innerText(),
        /^38[,.]1$/,
      );
      await reset.click();
      await checkTargets([...openIds, "endterm"], 63.91);
      assert.equal(await forecast("Endterm").inputValue(), "");
      assert.equal(await forecast("Финальный экзамен").inputValue(), "");
      await subject.selectOption({ label: "Digital Logic Design" });
      assert.equal(await forecast("Endterm").inputValue(), "65");
      assert.equal(
        await forecast("Assignment 1").count(),
        0,
        "a newly imported grade supersedes the prior forecast",
      );
      assert.equal(
        await input("Assignment 1").count(),
        0,
        "an imported grade is read-only",
      );
      const official = page
        .locator(".syllabus-fixed")
        .filter({ hasText: "Assignment 1" });
      assert.equal(await official.locator("strong").innerText(), "37");
      await subject.selectOption({ label: "Operating Systems" });
      assert.equal(
        t.saves(),
        0,
        "forecast edits and resets do not write to the API",
      );
    });
    await test(`${width}px scholarship draft and conflict recovery`, async () => {
      await page.reload();
      await subject.selectOption({ label: "Operating Systems" });
      await required(63.91);
      const target = input("Цель по предмету");
      await target.fill("85");
      assert.equal(t.saves(), 0);
      const os = t.data.courses.find(
        (course) => course.title === "Operating Systems",
      );
      os.scholarship = { ...os.scholarship, target: 90 };
      await page.reload();
      await subject.selectOption({ label: "Operating Systems" });
      await page
        .getByRole("alert")
        .filter({ hasText: "План изменился в другой сессии" })
        .waitFor();
      assert.equal(await target.inputValue(), "85");
      assert.ok(
        await page
          .getByRole("button", { name: "Сохранить расчёт" })
          .isDisabled(),
      );
      await page
        .getByRole("button", { name: "Загрузить сохранённый план" })
        .click();
      await page.locator('input[value="90"]').waitFor();
      assert.equal(await target.inputValue(), "90");
      await target.fill("85");
      await input("Прогноз: Endterm").fill("80");
      t.holdNextSave();
      const response = page.waitForResponse(
        (r) =>
          r.url().endsWith("/scholarship") && r.request().method() === "PUT",
      );
      const sent = page.waitForRequest(
        (r) => r.url().endsWith("/scholarship") && r.method() === "PUT",
      );
      await page.getByRole("button", { name: "Сохранить расчёт" }).click();
      const body = (await sent).postDataJSON();
      assert.equal(body.config.target, 85);
      assert.equal(body.expectedConfig.target, 90);
      assert.deepEqual(
        body.config,
        { ...body.expectedConfig, target: 85 },
        "explicit save must not record the forecast as a grade",
      );
      await nav.getByRole("button", { name: "Учёба", exact: true }).click();
      t.releaseSave();
      await response;
      await nav.getByRole("button", { name: "Стипендия", exact: true }).click();
      await subject.selectOption({ label: "Operating Systems" });
      assert.equal(await target.inputValue(), "85");
      assert.equal(t.saves(), 1);
      assert.equal(
        await page
          .getByText("План изменился в другой сессии.", { exact: false })
          .count(),
        0,
      );
      await noOverflow(page);
    });
    await test(`${width}px Study draft survives navigation and refresh`, async () => {
      await page.getByRole("button", { name: "Учёба", exact: true }).click();
      await page
        .getByLabel("Разделы учёбы", { exact: true })
        .selectOption("calculator");
      await page.locator('input[name="final_exam"]').fill("61");
      await page.waitForFunction(() =>
        Object.keys(sessionStorage).some(
          (k) =>
            k.endsWith(":study:all") &&
            sessionStorage[k].includes('"final_exam":"61"'),
        ),
      );
      await noOverflow(page);
      await page
        .getByRole("navigation")
        .getByRole("button", { name: "Стипендия", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "Стипендия", exact: true })
        .waitFor();
      assert.equal(new URL(page.url()).searchParams.get("screen"), "dashboard");
      await page.getByRole("button", { name: "Учёба", exact: true }).click();
      await page.getByLabel("Разделы учёбы", { exact: true }).waitFor();
      assert.equal(
        await page.locator('input[name="final_exam"]').inputValue(),
        "61",
      );
      await page.reload();
      await page.locator('input[name="final_exam"]').waitFor();
      assert.equal(
        await page.locator('input[name="final_exam"]').inputValue(),
        "61",
      );
    });
    await test(`${width}px grouped navigation and AI disabled state`, async () => {
      await nav
        .getByRole("button", { name: "Другие разделы", exact: true })
        .click();
      const menu = page.getByRole("dialog", { name: "Ещё" });
      for (const name of ["Дела", "Самочувствие", "Сервисы"]) {
        await menu.getByRole("heading", { name, exact: true }).waitFor();
      }
      await menu
        .getByRole("button", { name: "Здоровье", exact: true })
        .waitFor();
      await noOverflow(page);
      await menu
        .getByRole("button", { name: "AI-помощник", exact: true })
        .click();
      await page
        .getByRole("heading", {
          name: "AI assistance unavailable",
          exact: true,
        })
        .waitFor();
      assert.equal(await menu.count(), 0);
      await noOverflow(page);
      assert.deepEqual(t.errors, []);
    });
    await mkdir(artifact + "/browser", { recursive: true });
    await nav.getByRole("button", { name: "Стипендия", exact: true }).click();
    await subject.selectOption({ label: "Operating Systems" });
    await page.screenshot({
      path: artifact + `/browser/tma-${width}.png`,
      fullPage: true,
    });
    await t.context.close();
  }
  for (const width of [320, 390]) {
    const t = await setup(width, { router: true });
    const { page } = t;
    const panel = () =>
      page.getByRole("region", {
        name: "AI Model Router settings",
        exact: true,
      });
    const openSettings = async () => {
      await page
        .getByText("Настройки моделей и приватности AI", { exact: true })
        .click();
      await panel().getByLabel("Выбор модели", { exact: true }).waitFor();
    };
    try {
      await test(`${width}px router settings load only after opening and persist explicit policy`, async () => {
        await page.goto(origin + "/tma/?screen=ai");
        await page.getByLabel("Your question", { exact: true }).waitFor();
        assert.equal(
          t.routerReads(),
          0,
          "closed settings must not fetch or probe a provider",
        );
        assert.equal(t.chatRequests.length, 0);
        t.holdRouterRead();
        const requested = page.waitForRequest(
          (request) =>
            new URL(request.url()).pathname === "/api/tma/ai/router/settings" &&
            request.method() === "GET",
        );
        await openSettings();
        await requested;
        assert.equal(
          await panel()
            .getByRole("button", {
              name: "Сохранить настройки AI",
              exact: true,
            })
            .isDisabled(),
          true,
        );
        t.releaseRouterRead();
        const settings = panel();
        await settings
          .getByLabel("Выбор модели", { exact: true })
          .selectOption("manual");
        await settings
          .getByLabel("Ручная модель", { exact: true })
          .selectOption("fixture-openrouter");
        await settings
          .getByLabel("Выбор модели", { exact: true })
          .selectOption("auto");
        await settings
          .getByLabel("Выбор модели", { exact: true })
          .selectOption("manual");
        for (const provider of ["OpenRouter", "Gemini API"])
          await settings
            .getByRole("checkbox", { name: provider, exact: true })
            .check();
        await settings
          .getByRole("checkbox", { name: "Повседневные задачи", exact: true })
          .check();
        await settings
          .getByLabel("Добавить модель: balanced", { exact: true })
          .selectOption("fixture-openrouter");
        await settings
          .getByLabel("Добавить модель: balanced", { exact: true })
          .selectOption("fixture-gemini");
        await settings
          .getByRole("button", {
            name: "Поднять fixture-gemini в balanced",
            exact: true,
          })
          .click();
        await settings
          .locator("summary")
          .filter({ hasText: /^Обычный текст/ })
          .click();
        for (const provider of ["OpenRouter", "Gemini API"])
          await settings
            .getByRole("checkbox", {
              name: `Разрешить Обычный текст для ${provider}`,
              exact: true,
            })
            .check();
        await settings
          .locator("summary")
          .filter({ hasText: /^Университет/ })
          .click();
        await settings
          .getByRole("checkbox", {
            name: "Разрешить Университет для Gemini API",
            exact: true,
          })
          .check();
        await settings
          .locator("summary")
          .filter({ hasText: /^Здоровье/ })
          .click();
        const health = settings.getByRole("checkbox", {
          name: "Разрешить Здоровье для OpenRouter",
          exact: true,
        });
        await health.check();
        await health.uncheck();
        await settings
          .getByRole("checkbox", { name: /^Я разрешаю платные запросы/ })
          .check();
        await settings
          .getByLabel("Максимум на запрос, USD", { exact: true })
          .fill("0.01");
        await settings
          .getByLabel("Максимум за день, USD", { exact: true })
          .fill("0.03");
        await settings
          .getByRole("checkbox", {
            name: "Разрешить ограниченные запасные попытки",
            exact: true,
          })
          .check();
        await settings
          .getByRole("checkbox", {
            name: "Разрешить смену провайдера в пределах моих разрешений",
            exact: true,
          })
          .check();
        await settings
          .getByLabel("Максимум попыток", { exact: true })
          .selectOption("2");
        const saved = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname ===
              "/api/tma/ai/router/settings" &&
            response.request().method() === "PUT",
        );
        await settings
          .getByRole("button", { name: "Сохранить настройки AI", exact: true })
          .click();
        assert.equal((await saved).status(), 200);
        await settings
          .getByRole("status")
          .filter({ hasText: "Настройки сохранены" })
          .waitFor();
        assert.equal(t.routerWrites(), 1);
        assert.equal(t.routerRequests[0].expectedRevision, 0);
        assert.equal(t.router.settings.mode, "manual");
        assert.equal(t.router.settings.manualModelId, "fixture-openrouter");
        assert.deepEqual(t.router.settings.allowedProviders, [
          "openrouter",
          "gemini",
        ]);
        assert.deepEqual(t.router.settings.tierModels.balanced, [
          "fixture-gemini",
          "fixture-openrouter",
        ]);
        assert.deepEqual(t.router.settings.privacy.general, [
          "openrouter",
          "gemini",
        ]);
        assert.deepEqual(t.router.settings.privacy.university, ["gemini"]);
        assert.deepEqual(t.router.settings.privacy.health, []);
        assert.deepEqual(t.router.settings.privacy.finance, []);
        assert.deepEqual(t.router.settings.spending, {
          paidCallsAuthorized: true,
          maxRequestCostMicros: 10_000,
          maxDailyCostMicros: 30_000,
        });
        assert.deepEqual(t.router.settings.fallback, {
          enabled: true,
          maxAttempts: 2,
          allowProviderChange: true,
        });
        assert.equal(
          t.chatRequests.length,
          0,
          "saving a policy is never an inference request",
        );
        await noOverflow(page);
        await page.reload();
        await page.getByLabel("Your question", { exact: true }).waitFor();
        await openSettings();
        await page.waitForFunction(
          () =>
            document.querySelector('[aria-label="Выбор модели"]')?.value ===
            "manual",
        );
        assert.equal(
          await panel()
            .getByLabel("Выбор модели", { exact: true })
            .inputValue(),
          "manual",
        );
        assert.equal(
          await panel()
            .getByLabel("Ручная модель", { exact: true })
            .inputValue(),
          "fixture-openrouter",
        );
        assert.equal(
          await panel()
            .getByLabel("Максимум на запрос, USD", { exact: true })
            .inputValue(),
          "0.01",
        );
        assert.equal(
          await panel()
            .getByLabel("Максимум за день, USD", { exact: true })
            .inputValue(),
          "0.03",
        );
        assert.equal(
          await panel()
            .getByLabel("Максимум попыток", { exact: true })
            .inputValue(),
          "2",
        );
        assert.equal(
          await panel()
            .getByRole("checkbox", { name: /^Я разрешаю платные запросы/ })
            .isChecked(),
          true,
        );
        assert.match(
          await panel().innerText(),
          /Разрешение использовать план не получено/,
        );
        assert.deepEqual(t.externalRequests, []);
        assert.deepEqual(t.errors, []);
      });
      await test(`${width}px failed and CAS settings saves retain the draft and navigation confirms discard`, async () => {
        const settings = panel();
        await settings
          .getByLabel("Максимум на запрос, USD", { exact: true })
          .fill("0.02");
        t.failRouterWrite(503);
        let response = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname ===
              "/api/tma/ai/router/settings" &&
            response.request().method() === "PUT",
        );
        await settings
          .getByRole("button", { name: "Сохранить настройки AI", exact: true })
          .click();
        assert.equal((await response).status(), 503);
        await settings
          .getByRole("status")
          .filter({ hasText: "Несохранённые изменения остались" })
          .waitFor();
        assert.equal(
          await settings
            .getByLabel("Максимум на запрос, USD", { exact: true })
            .inputValue(),
          "0.02",
        );
        assert.equal(t.router.settings.spending.maxRequestCostMicros, 10_000);
        t.externalRouterChange((value) => ({
          ...value,
          spending: { ...value.spending, maxDailyCostMicros: 50_000 },
        }));
        response = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname ===
              "/api/tma/ai/router/settings" &&
            response.request().method() === "PUT",
        );
        await settings
          .getByRole("button", { name: "Сохранить настройки AI", exact: true })
          .click();
        assert.equal((await response).status(), 409);
        await settings
          .getByRole("status")
          .filter({ hasText: "другой сессии" })
          .waitFor();
        assert.equal(
          await settings
            .getByLabel("Максимум на запрос, USD", { exact: true })
            .inputValue(),
          "0.02",
        );
        assert.equal(
          await settings
            .getByLabel("Максимум за день, USD", { exact: true })
            .inputValue(),
          "0.03",
        );
        assert.ok(
          !(await page.locator("body").innerText()).includes("PRIVATE"),
        );
        const study = page
          .getByRole("navigation")
          .getByRole("button", { name: "Учёба", exact: true });
        await Promise.all([
          page.waitForEvent("dialog").then(async (dialog) => {
            assert.match(dialog.message(), /несохранённые изменения/);
            await dialog.dismiss();
          }),
          study.click(),
        ]);
        assert.equal(new URL(page.url()).searchParams.get("screen"), "ai");
        assert.equal(
          await settings
            .getByLabel("Максимум на запрос, USD", { exact: true })
            .inputValue(),
          "0.02",
        );
        await Promise.all([
          page.waitForEvent("dialog").then(async (dialog) => {
            assert.match(dialog.message(), /несохранённые изменения/);
            await dialog.accept();
          }),
          study.click(),
        ]);
        await page.getByLabel("Разделы учёбы", { exact: true }).waitFor();
        assert.equal(t.router.settings.spending.maxRequestCostMicros, 10_000);
        await page
          .getByRole("button", { name: "Другие разделы", exact: true })
          .click();
        await page
          .getByRole("dialog", { name: "Ещё" })
          .getByRole("button", { name: "AI-помощник", exact: true })
          .click();
        await page.getByLabel("Your question", { exact: true }).waitFor();
        await openSettings();
        response = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname ===
              "/api/tma/ai/router/settings" &&
            response.request().method() === "GET",
        );
        await panel()
          .getByRole("button", { name: "Обновить настройки AI", exact: true })
          .click();
        await response;
        await page.waitForFunction(
          () =>
            document.querySelector('[aria-label="Максимум за день, USD"]')
              ?.value === "0.05",
        );
        assert.equal(
          await panel()
            .getByLabel("Максимум на запрос, USD", { exact: true })
            .inputValue(),
          "0.01",
        );
        assert.equal(t.chatRequests.length, 0);
        assert.deepEqual(t.errors, []);
        assert.deepEqual(t.externalRequests, []);
        await noOverflow(page);
        await mkdir(artifact + "/browser", { recursive: true });
        await page.screenshot({
          path: artifact + `/browser/tma-router-settings-${width}.png`,
          fullPage: true,
        });
      });
    } finally {
      t.releaseRouterRead();
      await t.context.close();
    }

    await test(`${width}px routed chat preserves two model receipts and sends only text plus validated continuity`, async () => {
      const t = await setup(width, { router: true, activeRouterPolicy: true });
      const { page } = t;
      try {
        await page.goto(origin + "/tma/?screen=ai");
        await page.getByLabel("Your question", { exact: true }).waitFor();
        const send = async (text) => {
          const response = page.waitForResponse(
            (response) =>
              new URL(response.url()).pathname === "/api/tma/ai/chat" &&
              response.request().method() === "POST",
          );
          await page.getByLabel("Your question", { exact: true }).fill(text);
          await page
            .getByRole("button", { name: "Send question", exact: true })
            .click();
          assert.equal((await response).status(), 200);
        };
        await send(
          "Explain ordinary project priorities without private records.",
        );
        await page
          .getByText("First approved fixture answer.", { exact: true })
          .waitFor();
        const receipts = page
          .getByRole("log", { name: "LifeOS AI conversation", exact: true })
          .locator('[aria-label="AI model usage"]');
        assert.equal(await receipts.count(), 1);
        assert.match(
          await receipts.nth(0).innerText(),
          /OpenRouter.*fixture\/provider-balanced/,
        );
        assert.match(
          await receipts.nth(0).innerText(),
          /Provider-reported cost/,
        );
        assert.match(
          await receipts.nth(0).innerText(),
          /123 ms.*Selected model/s,
        );
        assert.equal(t.chatRequests[0].previousModelId, undefined);
        await send(
          "Explain the next step using the same approved conversation.",
        );
        await page
          .getByText("Second approved fixture answer.", { exact: true })
          .waitFor();
        assert.equal(await receipts.count(), 2);
        assert.match(
          await receipts.nth(0).innerText(),
          /OpenRouter.*fixture\/provider-balanced/,
        );
        assert.match(
          await receipts.nth(0).innerText(),
          /Provider-reported cost/,
        );
        assert.match(
          await receipts.nth(1).innerText(),
          /Google Gemini.*gemini-fixture-balanced/,
        );
        assert.match(
          await receipts.nth(1).innerText(),
          /Rate-based usage estimate/,
        );
        assert.match(
          await receipts.nth(1).innerText(),
          /234 ms.*Fallback used/s,
        );
        assert.equal(t.chatRequests[1].previousModelId, "fixture-openrouter");
        assert.equal(t.chatRequests[1].messages.length, 3);
        for (const input of t.chatRequests) {
          assert.match(input.requestId, /^[0-9a-f-]{36}$/);
          for (const message of input.messages)
            assert.deepEqual(Object.keys(message).sort(), ["role", "text"]);
        }
        await page
          .getByRole("button", { name: "Clear conversation", exact: true })
          .click();
        assert.equal(await receipts.count(), 0);
        await send("Start a fresh ordinary planning question.");
        await page
          .getByText("Fresh approved fixture answer.", { exact: true })
          .waitFor();
        assert.equal(t.chatRequests[2].previousModelId, undefined);
        assert.equal(t.chatRequests[2].messages.length, 1);
        assert.deepEqual(Object.keys(t.chatRequests[2].messages[0]).sort(), [
          "role",
          "text",
        ]);
        assert.equal(
          t.routerReads(),
          0,
          "chat does not open the settings or consent flow",
        );
        assert.deepEqual(t.externalRequests, []);
        assert.deepEqual(t.errors, []);
        await noOverflow(page);
        await page.screenshot({
          path: artifact + `/browser/tma-router-chat-${width}.png`,
          fullPage: true,
        });
      } finally {
        await t.context.close();
      }
    });
  }
  for (const width of [320, 390]) {
    await test(`${width}px free router preparation keeps shared quotas and consent separate from inference`, async () => {
      const t = await setup(width, { router: true, freeProfile: true });
      const { page } = t;
      const panel = page.getByRole("region", {
        name: "AI Model Router settings",
        exact: true,
      });
      try {
        await page.goto(origin + "/tma/?screen=ai");
        await page
          .getByRole("heading", {
            name: "AI assistance unavailable",
            exact: true,
          })
          .waitFor();
        assert.equal(t.routerReads(), 0);
        await page
          .getByText("Настройки моделей и приватности AI", { exact: true })
          .click();
        await assertFreeRouterBrowserPanel(panel);
        assert.equal(t.router.operatorLimits.routerEnabled, false);
        assert.equal(t.router.operatorLimits.freeOnly, true);
        assert.equal(t.router.operatorLimits.paidRequestsEnabled, false);
        const mode = panel.getByLabel("Выбор модели", { exact: true });
        const save = panel.getByRole("button", {
          name: "Сохранить настройки AI",
          exact: true,
        });
        const requestLimit = panel.getByLabel("Максимум на запрос, USD", {
          exact: true,
        });
        await requestLimit.fill("0.01");
        await save.click();
        await panel
          .getByText(
            "Лимит превышает ограничение сервера. Уменьши сумму перед сохранением.",
            { exact: true },
          )
          .waitFor();
        assert.equal(
          t.routerWrites(),
          0,
          "free preparation must reject a positive spending cap locally",
        );
        await requestLimit.fill("0");
        await mode.selectOption("manual");
        await panel
          .getByLabel("Ручная модель", { exact: true })
          .selectOption("fixture-openrouter");
        await save.click();
        await panel
          .getByText(
            "Настройки сохранены. Сохранение не запускает AI-запрос или проверку провайдера.",
            { exact: true },
          )
          .waitFor();
        assert.equal(t.router.settings.mode, "manual");
        assert.equal(t.router.settings.manualModelId, "fixture-openrouter");
        assert.deepEqual(t.router.settings.allowedProviders, []);
        assert.deepEqual(t.router.settings.spending, {
          paidCallsAuthorized: false,
          maxRequestCostMicros: 0,
          maxDailyCostMicros: 0,
        });
        assert.ok(
          Object.values(t.router.settings.privacy).every(
            (providers) => providers.length === 0,
          ),
        );
        await panel
          .getByRole("button", { name: "Обновить настройки AI", exact: true })
          .click();
        await panel
          .getByText(
            "Настройки сохранены. Сохранение не запускает AI-запрос или проверку провайдера.",
            { exact: true },
          )
          .waitFor({ state: "hidden" });
        assert.equal(await mode.inputValue(), "manual");
        await mode.selectOption("auto");
        await save.click();
        await panel
          .getByText(
            "Настройки сохранены. Сохранение не запускает AI-запрос или проверку провайдера.",
            { exact: true },
          )
          .waitFor();
        t.router.providers.find(
          (provider) => provider.id === "openrouter",
        ).freeRouting = {
          ...t.router.providers.find((provider) => provider.id === "openrouter")
            .freeRouting,
          status: "review_required",
          retryAt: null,
        };
        await panel
          .getByRole("button", { name: "Обновить настройки AI", exact: true })
          .click();
        await panel.getByText(/приостановлен до проверки владельцем/).waitFor();
        await assertFreeRouterBrowserPanel(panel, "review_required");
        assert.equal(await mode.inputValue(), "auto");
        assert.equal(t.routerWrites(), 2);
        assert.equal(t.chatRequests.length, 0);
        assert.deepEqual(t.externalRequests, []);
        assert.deepEqual(t.errors, []);
        await noOverflow(page);
        await mkdir(artifact + "/browser", { recursive: true });
        await page.screenshot({
          path: artifact + `/browser/tma-free-router-${width}.png`,
          fullPage: true,
          animations: "disabled",
          timeout: 120_000,
        });
      } finally {
        await t.context.close();
      }
    });
  }
  for (const [name, options, expected] of [
    [
      "unauthenticated Telegram access",
      { authError: true },
      "Откройте LifeOS заново из Telegram",
    ],
    ["empty scholarship state", { empty: true }, "Нет активных предметов"],
    [
      "scholarship service failure",
      { studyError: true },
      "Не удалось загрузить предметы",
    ],
  ])
    await test(name, async () => {
      const t = await setup(320, options);
      try {
        await t.page.goto(origin + "/tma/?screen=dashboard");
        await t.page.getByText(expected, { exact: false }).waitFor();
        assert.ok(
          !(await t.page.locator("body").innerText()).includes("PRIVATE"),
        );
        await noOverflow(t.page);
        assert.deepEqual(t.errors, []);
      } finally {
        await t.context.close();
      }
    });
  await test("failed lazy screen chunk shows recovery and retains navigation", async () => {
    const t = await setup(390);
    try {
      await t.page.route("**/assets/AiScreen-*.js", (r) => r.abort());
      await t.page.goto(origin + "/tma/?screen=ai");
      await t.page
        .getByRole("heading", {
          name: "Не удалось открыть раздел",
          exact: true,
        })
        .waitFor();
      assert.equal(
        await t.page
          .getByRole("button", { name: "Повторить", exact: true })
          .count(),
        1,
      );
      await t.page
        .getByRole("navigation")
        .getByRole("button", { name: "Стипендия", exact: true })
        .click();
      await t.page
        .getByRole("heading", { name: "Стипендия", exact: true })
        .waitFor();
      await noOverflow(t.page);
    } finally {
      await t.context.close();
    }
  });
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
console.log(
  JSON.stringify({
    passed,
    failed,
    environment:
      "local staged production build; mocked APIs; no Telegram authentication",
  }),
);
process.exitCode = failed ? 1 : 0;
