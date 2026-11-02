// Production TMA artifact; all APIs isolated with explicit local fixtures.
// Run: LIFEOS_TMA_DIST=/staged/dist pnpm exec tsx scripts/test-ideal-human-browser.mjs
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
import {
  emptyIdealHumanDay,
  parseIdealHumanDay,
} from "../packages/core/src/ideal-human.ts";
import {
  buildDailyBriefings,
  projectDailyHealth,
  DEFAULT_DAILY_LIFE_PREFERENCES,
} from "../packages/core/src/daily-life.ts";
const { chromium } = await import(
  process.env.LIFEOS_PLAYWRIGHT_MODULE || "playwright"
);
if (!process.env.LIFEOS_TMA_DIST) throw new Error("Set staged LIFEOS_TMA_DIST");
const root = resolve(process.env.LIFEOS_TMA_DIST);
const artifacts = resolve(
  process.env.LIFEOS_BROWSER_ARTIFACTS || "/tmp/lifeos-ideal-browser-artifacts",
);
await mkdir(artifacts, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, "http://local").pathname;
    const file = resolve(
      root,
      pathname.replace(/^\/tma\/?/, "") || "index.html",
    );
    if (!file.startsWith(root + "/")) throw new Error("Invalid asset");
    const body = await readFile(file);
    res.setHeader(
      "Content-Type",
      { ".js": "text/javascript", ".css": "text/css", ".html": "text/html" }[
        extname(file)
      ] || "application/octet-stream",
    );
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.LIFEOS_CHROMIUM_EXECUTABLE || undefined,
  args: ["--no-sandbox", "--renderer-process-limit=1"],
  timeout: 120000,
});
let passed = 0;
async function scenario(name, fn) {
  await fn();
  passed++;
  console.log("PASS " + name);
}
async function fixture(width, options = {}) {
  const context = await browser.newContext({
    viewport: { width, height: 844 },
    isMobile: true,
    hasTouch: true,
    timezoneId: "Asia/Almaty",
  });
  const page = await context.newPage();
  await page.clock.install({ time: new Date("2026-11-03T05:00:00+05:00") });
  const days = new Map();
  const entries = [];
  const waterKeys = new Set();
  let preferences = { ...DEFAULT_DAILY_LIFE_PREFERENCES };
  const waterSummary = () => ({
    date: "2026-11-03",
    timezone: "Asia/Almaty",
    totalMl: entries
      .filter((v) => !v.undoneAt)
      .reduce((n, v) => n + v.amountMl, 0),
    entries: [...entries].reverse(),
    truncated: false,
  });
  let saves = 0,
    failSave = false,
    failLoad = !!options.failLoad,
    hold = null;
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith("/api/tma/"))
      return url.origin === origin ? route.continue() : route.abort();
    const cors = {
      "access-control-allow-origin": origin,
      "access-control-allow-headers": "content-type,x-telegram-init-data",
      "access-control-allow-methods": "GET,PUT,POST,OPTIONS",
    };
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: cors });
    let data = null,
      status = 200,
      error;
    if (url.pathname === "/api/tma/session")
      data = {
        state: "active",
        telegramUserId: 9911001,
        profile: { role: "user", status: "active" },
        integrations: {
          telegram: { connected: true },
          obsidian: { connected: false },
          google: { connected: false },
          health: { connected: false },
        },
      };
    else if (url.pathname === "/api/tma/daily-life/summary") {
      const date = url.searchParams.get("date") || "2026-11-03",
        day = days.get(date) || null;
      const health = projectDailyHealth({
        date,
        manual: day,
        metrics: {},
        records: [],
        now: new Date("2026-11-03T00:00:00Z"),
      });
      data = {
        date,
        timezone: "Asia/Almaty",
        dayNumber: 1,
        health,
        hydration: waterSummary(),
        nutrition: {
          mealCount: day?.meals.length || 0,
          caloriesKcal: null,
          proteinG: null,
          fatG: null,
          carbsG: null,
          estimated: false,
          incomplete: true,
        },
        ...buildDailyBriefings({
          date,
          day,
          health,
          classes: [],
          deadlines: [],
          tasks: [],
          workouts: [],
          lmsStale: true,
        }),
        documentary: {
          shots: [],
          filmingDays: 0,
          backupConfirmedDays: 0,
          weeklyReflection: [],
        },
        sourceWarnings: [],
        generatedBy: "deterministic",
      };
    } else if (url.pathname === "/api/tma/daily-life/preferences") {
      if (route.request().method() === "PUT") {
        const v = JSON.parse(route.request().postData());
        if (v.revision !== preferences.revision) {
          status = 409;
          error = "daily_life_conflict";
        } else preferences = { ...v, revision: v.revision + 1 };
      }
      data = preferences;
    } else if (url.pathname === "/api/tma/hydration") {
      if (route.request().method() === "POST") {
        const v = JSON.parse(route.request().postData());
        if (!waterKeys.has(v.requestId)) {
          waterKeys.add(v.requestId);
          entries.push({
            id: crypto.randomUUID(),
            amountMl: v.amountMl,
            occurredAt: "2026-11-03T00:00:00Z",
            source: "tma",
            undoneAt: null,
          });
        }
      }
      data = waterSummary();
    } else if (/^\/api\/tma\/hydration\/.+\/undo$/.test(url.pathname)) {
      const v = entries.find((e) => e.id === url.pathname.split("/")[4]);
      if (v) v.undoneAt = "2026-11-03T00:01:00Z";
      data = waterSummary();
    } else if (url.pathname === "/api/tma/nutrition/capabilities")
      data = {
        available: false,
        requiresConsent: true,
        reason: "vision_not_configured",
        retainsPhotos: false,
      };
    else if (url.pathname === "/api/tma/ideal-human/days") {
      if (route.request().method() === "PUT") {
        saves++;
        const input = JSON.parse(route.request().postData());
        if (hold) await hold;
        if (failSave) {
          status = 503;
          error = "database_not_configured";
        } else if (
          (days.get(input.day.date)?.revision ?? 0) !== input.expectedRevision
        ) {
          status = 409;
          error = "ideal_human_conflict";
        } else {
          data = {
            ...parseIdealHumanDay(input.day),
            revision: input.expectedRevision + 1,
          };
          days.set(data.date, data);
        }
      } else if (failLoad) {
        status = 503;
        error = "database_not_configured";
      } else data = [...days.values()];
    } else if (url.pathname === "/api/tma/study")
      data = {
        timezone: "Asia/Almaty",
        courses: [
          {
            id: "fixture-course",
            title: "Verified fixture cybersecurity class",
            code: "CYB",
            startsOn: null,
            endsOn: null,
            schedules: [
              {
                id: "fixture-slot",
                dayOfWeek: "tuesday",
                startTime: "09:00",
                endTime: "10:00",
                room: null,
                instructorName: null,
                sessionType: "lecture",
              },
            ],
            calculator: null,
          },
        ],
        records: [],
      };
    else if (url.pathname === "/api/tma/lms/work")
      data = {
        timezone: "Asia/Almaty",
        stale: false,
        truncated: false,
        lastSyncSuccessAt: "2026-11-03T00:00:00Z",
        lastSyncAttemptAt: null,
        warnings: [],
        unsupportedFeatures: [],
        items: [
          {
            title: "Verified fixture assignment",
            courseTitle: "Cybersecurity",
            dueAt: "2026-11-04T12:00:00Z",
            startsAt: null,
            endsAt: null,
            kind: "assignment",
            submissionStatus: "not_submitted",
            category: "upcoming",
            source: "moodle",
            score: null,
            maxScore: null,
            percentage: null,
          },
        ],
      };
    else if (url.pathname === "/api/tma/workout/current") data = null;
    else if (url.pathname === "/api/tma/workout/history") data = [];
    else if (url.pathname === "/api/tma/workout/program") data = null;
    else if (url.pathname === "/api/tma/home")
      data = {
        localDate: "2026-11-03",
        displayName: "Fixture",
        mode: "normal",
        modeLabel: "Normal",
        modeReason: "Fixture",
        recoveryMode: "normal",
        focusScore: null,
      };
    else if (url.pathname === "/api/tma/academic")
      data = { upcoming: [], recentRecords: [] };
    else if (url.pathname === "/api/tma/monthly-review")
      data = { latest: null };
    else if (url.pathname === "/api/tma/ai/status")
      data = { enabled: false, available: false, reason: "ai_disabled" };
    else if (url.pathname === "/api/tma/lms/connection")
      data = {
        configured: false,
        state: "not_configured",
        lastSyncSuccessAt: null,
        lastSyncAttemptAt: null,
        lastErrorCategory: null,
        sessionExpiresAt: null,
        syncRequestedAt: null,
        unsupportedFeatures: [],
      };
    else if (url.pathname.includes("/today"))
      data = {
        date: "2026-11-03",
        timezone: "Asia/Almaty",
        tasks: [],
        events: [],
        reminders: [],
        plan: {
          date: "2026-11-03",
          rankedTasks: [],
          blocks: [],
          warnings: [],
          freeSlots: [],
          conflicts: [],
          unscheduledTaskIds: [],
        },
        ai: { available: false, enabled: false },
        productivity: {
          daily: [],
          totalCreated: 0,
          totalCompleted: 0,
          completionRate: null,
        },
      };
    else if (url.pathname === "/api/tma/reminders")
      data = { reminders: [], timezone: "Asia/Almaty" };
    else return route.abort();
    return route.fulfill({
      status,
      headers: cors,
      contentType: "application/json",
      body: JSON.stringify(
        error
          ? { error, message: "PRIVATE DIAGNOSTIC MUST STAY HIDDEN" }
          : { data },
      ),
    });
  });
  return {
    page,
    context,
    days,
    errors,
    saves: () => saves,
    failSave: (v) => (failSave = v),
    failLoad: (v) => (failLoad = v),
    hold: (p) => (hold = p),
  };
}
async function noOverflow(page) {
  const size = await page.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  assert.ok(size.scroll <= size.width, JSON.stringify(size));
}
async function openDetails(page, title) {
  const summary = page.locator("summary").filter({ hasText: title });
  if (
    (await summary.count()) &&
    !(await summary.evaluate((el) => el.parentElement.open))
  )
    await summary.click();
}
try {
  for (const width of [320, 390]) {
    const f = await fixture(width),
      { page } = f;
    await scenario(
      `${width}px day 1 flexible plan, integrations and unknown values`,
      async () => {
        await page.goto(origin + "/tma/?screen=ideal-human");
        await page.getByLabel("Утренний вес, кг", { exact: true }).waitFor();
        assert.match(await page.locator("main").innerText(), /1\s*\/\s*30/);
        assert.match(await page.locator("main").innerText(), /Алинур/);
        assert.match(
          await page.locator("main").innerText(),
          /Mafia|Мафия|мафия/,
        );
        assert.equal(
          await page
            .getByLabel("Утренний вес, кг", { exact: true })
            .inputValue(),
          "",
        );
        assert.equal(f.saves(), 0);
        await noOverflow(page);
      },
    );
    await scenario(
      `${width}px partial journal, meal, learning, footage and save/reload`,
      async () => {
        await page.getByLabel("Утренний вес, кг", { exact: true }).fill("51.2");
        await page.getByLabel("Сон, часов", { exact: true }).fill("7.5");
        await openDetails(page, "Питание");
        await page
          .getByRole("button", { name: "Добавить приём пищи", exact: true })
          .click();
        await page
          .getByLabel("Приём пищи 1: что ел", { exact: true })
          .fill("Fixture breakfast");
        await openDetails(page, "Интеллект и обучение");
        await page
          .getByRole("button", { name: "Добавить учебную сессию", exact: true })
          .click();
        await page
          .getByLabel("Тема сессии 1", { exact: true })
          .fill("Fixture study topic");
        await page.getByLabel("Сессия 1, минут", { exact: true }).fill("15");
        await openDetails(page, "Документальный фильм");
        await openDetails(page, "Вечерняя рефлексия");
        await page
          .getByLabel("Что получилось", { exact: true })
          .fill("Fixture reflection");
        await page
          .getByRole("button", { name: "Сохранить день", exact: true })
          .click();
        await page.waitForFunction(() =>
          document.body.textContent.includes("Сохранено"),
        );
        assert.equal(f.saves(), 1);
        const saved = f.days.get("2026-11-03");
        assert.equal(saved.weightKg, 51.2);
        assert.equal(saved.sleepMinutes, 450);
        assert.equal(saved.footageBackedUp, null);
        assert.equal(saved.meals[0].caloriesKcal, null);
        await page.reload();
        await page.getByLabel("Утренний вес, кг", { exact: true }).waitFor();
        assert.equal(
          await page
            .getByLabel("Утренний вес, кг", { exact: true })
            .inputValue(),
          "51.2",
        );
        assert.equal(
          await page.getByLabel("Сон, часов", { exact: true }).inputValue(),
          "7.5",
        );
        await noOverflow(page);
      },
    );
    await scenario(
      `${width}px failed save retains edits and hides diagnostics`,
      async () => {
        f.failSave(true);
        await page.getByLabel("Утренний вес, кг", { exact: true }).fill("51.4");
        await page
          .getByRole("button", { name: "Сохранить день", exact: true })
          .click();
        await page.getByRole("alert").waitFor();
        assert.equal(
          await page
            .getByLabel("Утренний вес, кг", { exact: true })
            .inputValue(),
          "51.4",
        );
        assert.ok(
          !(await page.locator("main").innerText()).includes(
            "PRIVATE DIAGNOSTIC",
          ),
        );
        f.failSave(false);
        await page
          .getByRole("button", { name: "Сохранить день", exact: true })
          .click();
        await page.waitForFunction(() =>
          document.body.textContent.includes("Сохранено"),
        );
      },
    );
    await scenario(
      `${width}px stale edit conflict recovers stored version`,
      async () => {
        await page.getByLabel("Утренний вес, кг", { exact: true }).fill("51.6");
        const current = f.days.get("2026-11-03");
        f.days.set(current.date, {
          ...current,
          revision: current.revision + 1,
          weightKg: 51.5,
        });
        await page
          .getByRole("button", { name: "Сохранить день", exact: true })
          .click();
        await page
          .getByRole("button", {
            name: "Загрузить сохранённую версию",
            exact: true,
          })
          .waitFor();
        page.once("dialog", (dialog) => dialog.accept());
        await page
          .getByRole("button", {
            name: "Загрузить сохранённую версию",
            exact: true,
          })
          .click();
        await page.waitForFunction(
          () =>
            document.querySelector('input[type="number"]')?.value === "51.5",
        );
      },
    );
    await scenario(
      `${width}px duplicate submission guard and export`,
      async () => {
        await page.getByLabel("Утренний вес, кг", { exact: true }).fill("51.7");
        let release;
        f.hold(
          new Promise((done) => {
            release = done;
          }),
        );
        const before = f.saves();
        await page
          .getByRole("button", { name: "Сохранить день", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Сохраняем…", exact: true })
          .waitFor();
        assert.equal(
          await page
            .getByLabel("Утренний вес, кг", { exact: true })
            .isDisabled(),
          true,
        );
        assert.equal(f.saves(), before + 1);
        release();
        f.hold(null);
        await page.waitForFunction(() =>
          document.body.textContent.includes("Сохранено"),
        );
        assert.equal(f.saves(), before + 1);
        const downloadButton = page
          .getByRole("button", {
            name: /Скачать все данные.*JSON|Экспорт.*JSON|Скачать JSON/,
          })
          .first();
        if (await downloadButton.count()) {
          const download = page.waitForEvent("download");
          await downloadButton.click();
          const file = await download;
          assert.match(file.suggestedFilename(), /ideal-human.*json/);
        }
      },
    );
    await scenario(
      `${width}px mobile workout and study navigation, unsaved guard`,
      async () => {
        await page
          .getByRole("button", {
            name: "Открыть тренировку и подходы",
            exact: true,
          })
          .click();
        await page
          .getByRole("heading", { name: "Начать тренировку", exact: true })
          .waitFor();
        await page
          .getByRole("button", { name: "Создать свою программу", exact: true })
          .click();
        await page
          .getByRole("button", {
            name: "Выбрать ознакомительный план",
            exact: true,
          })
          .click();
        assert.equal(
          await page
            .getByLabel("Название программы", { exact: true })
            .inputValue(),
          "Ознакомительная тренировка · Underground GYM",
        );
        await noOverflow(page);
        await page.goto(origin + "/tma/?screen=ideal-human");
        await page.getByLabel("Утренний вес, кг", { exact: true }).waitFor();
        await page
          .getByRole("button", { name: "Открыть учёбу и AITU", exact: true })
          .click();
        await page
          .getByRole("heading", { name: "Учёба", exact: true })
          .waitFor();
        await noOverflow(page);
        await page.goto(origin + "/tma/?screen=ideal-human");
        await page.getByLabel("Утренний вес, кг", { exact: true }).fill("51.8");
        page.once("dialog", (dialog) => dialog.dismiss());
        await page
          .getByRole("navigation")
          .getByRole("button", { name: "Учёба", exact: true })
          .click();
        assert.equal(
          await page
            .getByLabel("Утренний вес, кг", { exact: true })
            .inputValue(),
          "51.8",
        );
        page.once("dialog", (dialog) => dialog.accept());
        await page
          .getByLabel("День эксперимента", { exact: true })
          .selectOption("2026-12-02");
        assert.match(await page.locator("main").innerText(), /Day 30\/30/);
        assert.equal(
          await page
            .getByLabel("Утренний вес, кг", { exact: true })
            .inputValue(),
          "",
        );
        await page
          .getByLabel("День эксперимента", { exact: true })
          .selectOption("2026-11-03");
        assert.equal(
          await page
            .getByLabel("Утренний вес, кг", { exact: true })
            .inputValue(),
          "51.7",
        );
      },
    );
    await page.screenshot({
      path: resolve(artifacts, `ideal-human-${width}.png`),
      fullPage: true,
    });
    assert.deepEqual(f.errors, []);
    await f.context.close();
  }
  for (const width of [320, 390]) {
    const f = await fixture(width),
      { page } = f;
    await scenario(
      `daily-life ${width}: mobile navigation, unknown health and disabled provider fallback`,
      async () => {
        await page.goto(origin + "/tma/?screen=daily-life");
        await page
          .getByRole("heading", { name: "Твой день", exact: true })
          .waitFor();
        await page
          .getByRole("button", { name: "+250 мл", exact: true })
          .waitFor();
        await page.getByText("Нет данных", { exact: false }).first().waitFor();
        await noOverflow(page);
      },
    );
    await scenario(
      `daily-life ${width}: water add, reload and targeted undo persist`,
      async () => {
        await page
          .getByRole("button", { name: "+250 мл", exact: true })
          .click();
        await page.getByText("250 мл", { exact: true }).first().waitFor();
        await page.reload();
        await page.getByText("250 мл", { exact: true }).first().waitFor();
        await page
          .getByRole("button", { name: "Отменить", exact: true })
          .first()
          .click();
        await page.getByText("0 мл", { exact: true }).waitFor();
        await page.reload();
        await page.getByText("0 мл", { exact: true }).waitFor();
        assert.equal(f.saves(), 0);
      },
    );
    await scenario(
      `daily-life ${width}: reminders default off and explicit opt-in survives reload`,
      async () => {
        const morning = page.getByRole("checkbox", {
          name: "Утренний обзор",
          exact: true,
        });
        assert.equal(await morning.isChecked(), false);
        await morning.check();
        await page
          .getByRole("button", {
            name: "Сохранить настройки уведомлений",
            exact: true,
          })
          .click();
        await page
          .getByText("Настройки уведомлений сохранены.", { exact: true })
          .waitFor();
        await page.reload();
        assert.equal(await morning.isChecked(), true);
        await noOverflow(page);
      },
    );
    assert.deepEqual(f.errors, []);
    await f.context.close();
  }
  const failure = await fixture(320, { failLoad: true });
  await scenario(
    "load failure has safe retry and no fake journal",
    async () => {
      await failure.page.goto(origin + "/tma/?screen=ideal-human");
      const retry = failure.page
        .getByRole("button", { name: /Retry|Повторить/ })
        .first();
      await retry.waitFor({ timeout: 30000 });
      assert.equal(failure.saves(), 0);
      failure.failLoad(false);
      await retry.click();
      await failure.page
        .getByLabel("Утренний вес, кг", { exact: true })
        .waitFor();
      await noOverflow(failure.page);
    },
  );
  await failure.context.close();
  console.log(
    `Ideal Human browser: ${passed} scenarios passed; mocked local APIs, production artifact.`,
  );
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
