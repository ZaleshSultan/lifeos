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
    ["Lecture Async 1", 88],
    ["Quiz Midterm", 81],
    ["Calculated Register Midterm", 72.1],
  ].map(([title, score], i) => ({
    id: "grade-" + i,
    userId: "fixture-owner",
    sourceEventId: null,
    courseTitle: courses[0].title,
    title,
    recordType: "grade",
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
async function setup(width, options = {}) {
  const context = await browser.newContext({
    viewport: { width, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const data = workspace();
  let saves = 0;
  let saveGate = null;
  let releaseSave = () => {};
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith("/api/tma/"))
      return url.origin === origin ? route.continue() : route.abort();
    // The real production artifact may embed its public API origin. Fulfill
    // these calls locally before any network connection can be made.
    if (url.origin !== origin && url.origin !== apiOrigin) return route.abort();
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
    else if (url.pathname === "/api/tma/ai/status")
      body = {
        data: {
          enabled: false,
          available: false,
          reason: "ai_disabled",
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
