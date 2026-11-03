// Local browser verification only. Run with pnpm exec tsx and an isolated Playwright install.
// Required: LIFEOS_TMA_DIST; optional: LIFEOS_PLAYWRIGHT_MODULE, LIFEOS_CHROMIUM_EXECUTABLE, LIFEOS_BROWSER_ARTIFACTS, LIFEOS_TMA_API_ORIGIN.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
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
    if (!file.startsWith(root + "/")) throw new Error("bad path");
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
  const router = routerFixture(Boolean(options.activeRouterPolicy));
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
          enabled: Boolean(options.router),
          available: Boolean(options.router),
          reason: options.router ? null : "ai_disabled",
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
    const t = await setup(width);
    const { page } = t;
    await test(`${width}px scholarship cards, DBMS reconciliation and no overflow`, async () => {
      await page.goto(origin + "/tma/?screen=dashboard");
      await page
        .getByRole("heading", { name: "Стипендия", exact: true })
        .waitFor();
      for (const p of syllabusProfiles)
        assert.equal(
          await page
            .getByRole("article", { name: p.title, exact: true })
            .count(),
          1,
        );
      assert.ok((await page.locator("main").innerText()).includes("72,10"));
      const dbms = page.getByRole("article", {
        name: syllabusProfiles[0].title,
        exact: true,
      });
      assert.match(
        await dbms.innerText(),
        /официальный итог Moodle 72,10; по компонентам 72,10/,
      );
      const evidenceSummary = dbms.getByText(
        "Подтверждённые оценки и допущения",
        { exact: true },
      );
      await evidenceSummary.click();
      const external = evidenceSummary
        .locator("..")
        .getByText("Assignment Lecture Async 1 · итог внешней платформы", {
          exact: false,
        });
      await external.waitFor();
      assert.ok((await external.locator("..").innerText()).includes("88,00"));
      await evidenceSummary.click();
      assert.ok(
        (await page.locator("main").innerText()).includes(
          "не гарантирует выплату",
        ),
      );
      for (const label of [
        "Сегодня",
        "Стипендия",
        "Учёба",
        "AI",
        "Другие разделы",
      ]) {
        const box = await page
          .getByRole("navigation")
          .getByRole("button", { name: label, exact: true })
          .boundingBox();
        assert.ok(box.height >= 44 && box.width >= 44);
      }
      await noOverflow(page);
    });
    await test(`${width}px scholarship input and refresh recovery`, async () => {
      const card = page.getByRole("article", {
        name: syllabusProfiles[0].title,
        exact: true,
      });
      await card.getByText("Изменить сценарии и цель", { exact: true }).click();
      await card
        .getByLabel("Личная цель итоговой оценки", { exact: true })
        .fill("85");
      await page.waitForFunction(() =>
        Object.keys(sessionStorage).some(
          (k) =>
            k.includes(":scholarship:") &&
            sessionStorage[k].includes('"target":85'),
        ),
      );
      await noOverflow(page);
      await page.reload();
      await page
        .getByRole("heading", { name: "Стипендия", exact: true })
        .waitFor();
      await card.getByText("Изменить сценарии и цель", { exact: true }).click();
      assert.equal(
        await card
          .getByLabel("Личная цель итоговой оценки", { exact: true })
          .inputValue(),
        "85",
      );
      assert.equal(t.saves(), 0);
    });
    await test(`${width}px Study draft survives navigation and refresh`, async () => {
      await page.getByRole("button", { name: "Учёба", exact: true }).click();
      await page.getByRole("tab", { name: "Калькулятор", exact: true }).click();
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
      const card = page.getByRole("article", {
        name: syllabusProfiles[0].title,
        exact: true,
      });
      await card.getByText("Изменить сценарии и цель", { exact: true }).click();
      assert.equal(
        await card
          .getByLabel("Личная цель итоговой оценки", { exact: true })
          .inputValue(),
        "85",
      );
      await page.getByRole("button", { name: "Учёба", exact: true }).click();
      await page
        .getByRole("tab", { name: "Калькулятор", exact: true })
        .waitFor();
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
    await test(`${width}px server conflicts preserve recovered drafts`, async () => {
      await page
        .getByRole("navigation")
        .getByRole("button", { name: "Стипендия", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "Стипендия", exact: true })
        .waitFor();
      t.data.courses[0].scholarship.target = 90;
      await page
        .getByRole("button", { name: "Обновить оценки и прогноз", exact: true })
        .click();
      const card = page.getByRole("article", {
        name: syllabusProfiles[0].title,
        exact: true,
      });
      await card.getByText("Изменить сценарии и цель", { exact: true }).click();
      await card
        .getByText("Настройки изменились в другой сессии.", { exact: false })
        .waitFor();
      assert.equal(
        await card
          .getByLabel("Личная цель итоговой оценки", { exact: true })
          .inputValue(),
        "85",
      );
      assert.equal(
        await card
          .getByRole("button", {
            name: "Сохранить три сценария и настройки",
            exact: true,
          })
          .isDisabled(),
        true,
      );
      assert.equal(t.saves(), 0);
      await noOverflow(page);
    });
    await test(`${width}px an in-flight save survives leaving the section without a false conflict`, async () => {
      const card = page.getByRole("article", {
        name: syllabusProfiles[0].title,
        exact: true,
      });
      await card
        .getByRole("button", {
          name: "Принять сохранённые настройки",
          exact: true,
        })
        .click();
      await card
        .getByLabel("Личная цель итоговой оценки", { exact: true })
        .fill("85");
      t.holdNextSave();
      const response = page.waitForResponse(
        (response) =>
          response.url().endsWith("/scholarship") &&
          response.request().method() === "PUT",
      );
      await card
        .getByRole("button", {
          name: "Сохранить три сценария и настройки",
          exact: true,
        })
        .click();
      await page
        .getByRole("navigation")
        .getByRole("button", { name: "Учёба", exact: true })
        .click();
      await page.getByRole("heading", { name: "Учёба", exact: true }).waitFor();
      t.releaseSave();
      await response;
      await page
        .getByRole("navigation")
        .getByRole("button", { name: "Стипендия", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "Стипендия", exact: true })
        .waitFor();
      await card.getByText("Изменить сценарии и цель", { exact: true }).click();
      assert.equal(
        await card
          .getByLabel("Личная цель итоговой оценки", { exact: true })
          .inputValue(),
        "85",
      );
      assert.equal(
        await card
          .getByRole("button", {
            name: "Сохранить три сценария и настройки",
            exact: true,
          })
          .isDisabled(),
        false,
      );
      assert.equal(
        await card
          .getByText("Настройки изменились в другой сессии.", { exact: false })
          .count(),
        0,
      );
      assert.equal(t.saves(), 1);
      await page.waitForFunction(
        () =>
          !Object.keys(sessionStorage).some((key) =>
            key.includes(":scholarship:"),
          ),
      );
      await noOverflow(page);
    });
    await test(`${width}px AI disabled and More navigation are usable`, async () => {
      await page.getByRole("button", { name: "AI", exact: true }).click();
      await page
        .getByRole("heading", {
          name: "AI assistance unavailable",
          exact: true,
        })
        .waitFor();
      await noOverflow(page);
      await page
        .getByRole("button", { name: "Другие разделы", exact: true })
        .click();
      assert.equal(
        await page
          .getByRole("button", { name: "Здоровье", exact: true })
          .count(),
        1,
      );
      await noOverflow(page);
      assert.deepEqual(t.errors, []);
    });
    await mkdir(artifact + "/browser", { recursive: true });
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "Стипендия", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Стипендия", exact: true })
      .waitFor();
    await page.screenshot({
      path: artifact + `/browser/tma-${width}.png`,
      fullPage: true,
    });
    await page
      .getByRole("article", { name: syllabusProfiles[0].title, exact: true })
      .screenshot({
        path: artifact + `/browser/tma-dbms-${width}.png`,
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
        await page
          .getByRole("heading", { name: "Учёба", exact: true })
          .waitFor();
        assert.equal(t.router.settings.spending.maxRequestCostMicros, 10_000);
        await page
          .getByRole("navigation")
          .getByRole("button", { name: "AI", exact: true })
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
      "Сервис временно недоступен",
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
          .getByRole("button", { name: "Retry", exact: true })
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
