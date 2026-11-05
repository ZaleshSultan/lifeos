import assert from "node:assert/strict";
import {
  V6_FOREIGN_COURSE_ID,
  V6_SELECTED_DAY,
} from "./v6-browser-fixtures.mjs";

const text = (value) => value.replace(/\s+/g, " ").trim();
export function v6BrowserDriver(page, platform, origin) {
  const tma = platform === "tma";
  const primaryName = tma ? "Разделы LifeOS" : "Основные разделы LifeOS";
  return {
    platform,
    primary: () =>
      page.getByRole("navigation", { name: primaryName, exact: true }),
    async section(name) {
      await this.primary()
        .getByRole(tma ? "button" : "link", { name, exact: true })
        .click();
      const active = this.primary().locator('[aria-current="page"]');
      await active.filter({ hasText: name }).waitFor();
      assert.equal(
        tma
          ? await active.getAttribute("aria-label")
          : text(await active.innerText()),
        name,
      );
    },
    async study(courseId, tab = "grades") {
      const params = new URLSearchParams({ studyTab: tab });
      if (courseId) params.set("courseId", courseId);
      await page.goto(
        tma
          ? `${origin}/tma/?screen=study&${params}`
          : `${origin}/web/study?${params}`,
      );
      await this.primary().waitFor();
    },
    async studyDestination(courseId, tab) {
      await page.waitForURL(
        (url) =>
          (tma
            ? url.searchParams.get("screen") === "study"
            : url.pathname === "/web/study") &&
          url.searchParams.get("courseId") === (courseId ?? null) &&
          url.searchParams.get("studyTab") === tab,
      );
    },
    async home() {
      await page.goto(
        tma ? `${origin}/tma/?screen=home` : `${origin}/web/today`,
      );
      await page
        .getByRole("region", { name: "Академический обзор дня", exact: true })
        .waitFor();
    },
    async settings() {
      await page.goto(
        tma ? `${origin}/tma/?screen=settings` : `${origin}/web/notifications`,
      );
      await this.settingsPanel();
    },
    async settingsPanel() {
      if (tma) {
        const summary = page.getByText(
          "Оценки и дедлайны · согласие и интервалы",
          { exact: true },
        );
        const details = summary.locator("..");
        if ((await details.getAttribute("open")) === null)
          await summary.click();
      }
      await page
        .getByRole("form", { name: "Академические уведомления", exact: true })
        .waitFor();
    },
    async restoreSettings() {
      await this.section("Настройки");
      if (!tma) {
        await page
          .getByRole("navigation", {
            name: /^(?:Внутри|Модули) раздела «Настройки»$/,
          })
          .getByRole("link", { name: "Уведомления", exact: true })
          .click();
      }
      await this.settingsPanel();
    },
    async day(date) {
      await page.goto(
        tma
          ? `${origin}/tma/?screen=planner&date=${date}`
          : `${origin}/web/calendar?date=${date}`,
      );
      const input = page.getByLabel(
        tma ? "Planning date" : "Дата в Asia/Almaty",
        { exact: true },
      );
      await input.waitFor();
      assert.equal(await input.inputValue(), date);
    },
    async gradesTab() {
      await page
        .getByRole(tma ? "tab" : "button", {
          name: tma ? "Оценки" : "Оценки и цель 70+",
          exact: true,
        })
        .click();
    },
    async calculatorTab() {
      await page
        .getByRole(tma ? "tab" : "button", {
          name: tma ? "Калькулятор" : "Симулятор по предмету",
          exact: true,
        })
        .click();
    },
    async overflow() {
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        "V6 page overflows viewport",
      );
      assert.equal(
        await this.primary()
          .getByRole(tma ? "button" : "link")
          .count(),
        4,
      );
    },
  };
}

function card(page, course) {
  return page.getByRole("region", {
    name: `План до цели: ${course.title}`,
    exact: true,
  });
}
function field(page, label) {
  return page.getByLabel(label, { exact: true });
}
async function actualAverage(page, course, expected) {
  const row = card(page, course)
    .locator("dl > div")
    .filter({ has: page.getByText("Среднее по оценённому", { exact: true }) });
  assert.equal(text(await row.locator("dd").innerText()), expected);
}
function assertNoRealSideEffects(fixture) {
  assert.equal(fixture.providerCalls, 0);
  assert.equal(fixture.telegramSends, 0);
  assert.equal(fixture.deliveryJobs, 0);
  assert.equal(fixture.feed.deliveryEnabled, false);
}

/** Two bounded cases at every viewport; precise labels shared by both real frontends. */
export async function v6CourseAndHomeScenarios({
  page,
  fixture,
  driver,
  test,
  prefix,
}) {
  const [alpha, beta] = fixture.workspace.courses;
  await test(`${prefix} exact course facts/history, foreign rejection, what-if separation and retained drafts`, async () => {
    const original = structuredClone(fixture.workspace.records);
    for (const [course, average, other] of [
      [alpha, "50", beta],
      [beta, "80", alpha],
    ]) {
      await driver.study(course.id, "grades");
      const grades = page.getByRole("region", {
        name: "Оценки из Moodle",
        exact: true,
      });
      await card(page, course).waitFor();
      assert.equal(
        await page.getByLabel("Курс для оценок", { exact: true }).inputValue(),
        course.id,
      );
      assert.equal(
        await card(page, other).count(),
        0,
        "another course's fact card leaked into selected course",
      );
      await actualAverage(page, course, average);
      const observedTitle = fixture.workspace.records.find(
        (row) =>
          row.rawJson.moodle_course_id ===
          Number(course.externalCourseKey.slice(7)),
      ).courseTitle;
      const otherObservedTitle = fixture.workspace.records.find(
        (row) =>
          row.rawJson.moodle_course_id ===
          Number(other.externalCourseKey.slice(7)),
      ).courseTitle;
      const raw = grades.locator("details").filter({
        has: page.locator("summary").filter({ hasText: observedTitle }),
      });
      await raw.locator("summary").click();
      await raw
        .getByText(course === alpha ? "15 / 30" : "24 / 30", { exact: true })
        .waitFor();
      const history = page.getByRole("region", {
        name: `История оценок: ${course.title}`,
        exact: true,
      });
      await history.waitFor();
      assert.ok(
        (await history.innerText()).includes(
          course === alpha
            ? "Synthetic Alpha checkpoint"
            : "Synthetic Beta checkpoint",
        ),
      );
      assert.equal(await history.locator("li").count(), 1);
      assert.ok(
        !(await history.innerText()).includes(
          other === alpha
            ? "Synthetic Alpha checkpoint"
            : "Synthetic Beta checkpoint",
        ),
      );
      assert.ok(
        (await history.innerText()).includes(
          course === alpha ? "Новая оценка" : "Исправление",
        ),
      );
      assert.equal(
        await grades
          .locator("details > summary")
          .filter({ hasText: otherObservedTitle })
          .count(),
        0,
      );
      await driver.overflow();
    }
    await driver.study(V6_FOREIGN_COURSE_ID, "grades");
    const unavailable = page.getByRole("region", {
      name: "Оценки из Moodle",
      exact: true,
    });
    await unavailable
      .getByRole("status")
      .filter({ hasText: /Запрошенный курс недоступен/ })
      .waitFor();
    assert.equal(
      await page.getByRole("region", { name: /^План до цели:/ }).count(),
      0,
    );
    assert.equal(await unavailable.locator("details").count(), 0);
    assert.equal(
      await unavailable
        .getByRole("region", { name: /^История оценок:/ })
        .count(),
      0,
    );
    await driver.study(V6_FOREIGN_COURSE_ID, "calculator");
    await page
      .getByRole("status")
      .filter({ hasText: /Запрошенный курс недоступен/ })
      .waitFor();
    assert.equal(
      await field(page, "Synthetic ATT1 total").count(),
      0,
      "foreign ID fell back to the first owned simulator",
    );
    await driver.study(alpha.id, "calculator");
    const first = field(page, "Synthetic ATT1 total"),
      second = field(page, "Synthetic ATT2 total"),
      exam = field(page, "Synthetic final total");
    await first.waitFor();
    assert.equal(
      await first.inputValue(),
      "100",
      "manual saved values are an independent scenario",
    );
    await actualAverage(page, alpha, "50");
    assert.ok((await card(page, alpha).innerText()).includes("Условный план"));
    await first.fill("88");
    await page.getByLabel("Предмет", { exact: true }).selectOption(beta.id);
    await card(page, beta).waitFor();
    assert.equal(await first.inputValue(), "100");
    await first.fill("77");
    await page.getByLabel("Предмет", { exact: true }).selectOption(alpha.id);
    await card(page, alpha).waitFor();
    assert.equal(await first.inputValue(), "88");
    await driver.section("Здоровье");
    await driver.section("Настройки");
    await driver.section("Главная");
    await driver.section("Учёба");
    await driver.calculatorTab();
    assert.equal(
      await page.getByLabel("Предмет", { exact: true }).inputValue(),
      alpha.id,
    );
    assert.equal(await first.inputValue(), "88");
    await page
      .getByRole("button", {
        name: "Вернуть фактические наблюдения в сценарий",
        exact: true,
      })
      .click();
    assert.equal(await first.inputValue(), "50");
    assert.equal(await second.inputValue(), "");
    assert.equal(await exam.inputValue(), "");
    await actualAverage(page, alpha, "50");
    assert.deepEqual(
      fixture.workspace.records,
      original,
      "what-if mutated observed records",
    );
    assert.equal(fixture.workspace.courses[0].calculator.values.att1, 100);
    assert.equal(
      fixture.writes.calculator,
      0,
      "restoring observations must not autosave",
    );
    assertNoRealSideEffects(fixture);
    await driver.overflow();
  });
  await test(`${prefix} Home links choose the exact course/work/calendar and the legacy day loads its requested API date`, async () => {
    await driver.home();
    let home = page.getByRole("region", {
      name: "Академический обзор дня",
      exact: true,
    });
    await home
      .getByRole("button", {
        name: new RegExp(alpha.title + " · Synthetic Alpha checkpoint"),
      })
      .click();
    await driver.studyDestination(alpha.id, "grades");
    await card(page, alpha).waitFor();
    assert.equal(new URL(page.url()).searchParams.get("courseId"), alpha.id);
    assert.equal(new URL(page.url()).searchParams.get("studyTab"), "grades");
    assert.equal(await card(page, beta).count(), 0);
    await driver.home();
    home = page.getByRole("region", {
      name: "Академический обзор дня",
      exact: true,
    });
    await home
      .getByRole("button", { name: /Synthetic Beta unfinished assignment/ })
      .click();
    await driver.studyDestination(beta.id, "work");
    assert.equal(new URL(page.url()).searchParams.get("courseId"), beta.id);
    assert.equal(new URL(page.url()).searchParams.get("studyTab"), "work");
    await page
      .getByRole("heading", {
        name:
          driver.platform === "tma"
            ? "Работа из LMS и ручные записи"
            : "Работы и дедлайны",
        exact: true,
      })
      .waitFor();
    await page
      .getByText("Synthetic Beta unfinished assignment", { exact: true })
      .waitFor();
    await driver.home();
    home = page.getByRole("region", {
      name: "Академический обзор дня",
      exact: true,
    });
    await home
      .getByRole("button", { name: /Synthetic Systems examination/ })
      .click();
    await driver.studyDestination(null, "concierge");
    assert.equal(
      new URL(page.url()).searchParams.has("courseId"),
      false,
      "a global calendar event must not inherit another course ID",
    );
    assert.equal(new URL(page.url()).searchParams.get("studyTab"), "concierge");
    await page
      .getByLabel("Учебный консьерж", { exact: true })
      .getByRole("tab", { name: "Экзамены AITU", exact: true })
      .waitFor();
    const requestStart = fixture.requests.length;
    await driver.day(V6_SELECTED_DAY);
    await page.waitForFunction(() =>
      document.body.textContent.includes("2031-04-07"),
    );
    assert.ok(
      fixture.requests
        .slice(requestStart)
        .some(
          (request) =>
            request.path === "today" &&
            request.method === "GET" &&
            request.date === V6_SELECTED_DAY,
        ),
      "requested day was carried in URL but not sent to the read model",
    );
    await driver.section("Здоровье");
    await driver.section("Главная");
    assert.equal(new URL(page.url()).searchParams.get("date"), V6_SELECTED_DAY);
    assertNoRealSideEffects(fixture);
    await driver.overflow();
  });
}

/** Run only at 390/1440, keeping policy/consent mutations bounded and fixture-only. */
export async function v6PolicyAndPreferenceScenarios({
  page,
  fixture,
  driver,
  test,
  prefix,
}) {
  const [alpha, beta] = fixture.workspace.courses;
  await test(`${prefix} exact explicit policy review confirms fresh observations and stale sources downgrade again`, async () => {
    await driver.study(beta.id, "calculator");
    await card(page, beta)
      .getByText("Политика и сопоставления проверены владельцем", {
        exact: true,
      })
      .waitFor();
    await driver.study(alpha.id, "calculator");
    const plan = card(page, alpha);
    await plan.getByText(/Условный план/).waitFor();
    await plan
      .getByText("Проверить политику текущего курса", { exact: true })
      .click();
    const approve = plan.getByRole("button", {
      name: "Подтвердить точную политику и сопоставления",
      exact: true,
    });
    assert.equal(await approve.isDisabled(), true);
    await plan
      .getByLabel("Силабус, версия и страница", { exact: true })
      .fill("Invented current Alpha syllabus edition p2");
    assert.equal(await approve.isDisabled(), true);
    await plan.getByRole("checkbox").check();
    await approve.click();
    await plan
      .getByText("Политика и сопоставления проверены владельцем", {
        exact: true,
      })
      .waitFor();
    assert.equal(fixture.writes.policy, 1);
    const review = fixture.feed.preferences.courseReviews[alpha.id];
    assert.equal(review.definitionKey, fixture.reviewFor(alpha).definitionKey);
    assert.equal(review.bindingsKey, fixture.reviewFor(alpha).bindingsKey);
    assert.equal(review.contextKey, fixture.reviewFor(alpha).contextKey);
    fixture.setStale();
    await driver.study(alpha.id, "calculator");
    await card(page, alpha)
      .getByText(/Условный план/)
      .waitFor();
    assert.ok(
      (await card(page, alpha).innerText()).match(/устар|свеж|синхронизац/i),
    );
    fixture.setStale(false);
    assertNoRealSideEffects(fixture);
  });
  await test(`${prefix} new academic categories stay OFF on read and require confirmation; CAS rejection retains the local draft`, async () => {
    await driver.settings();
    let form = page.getByRole("form", {
      name: "Академические уведомления",
      exact: true,
    });
    for (const label of [
      "Новые оценки и исправления",
      "Дедлайны несданных заданий",
      "Подтверждённое закрытие незавершённых тестов",
    ])
      assert.equal(
        await form.getByLabel(label, { exact: true }).isChecked(),
        false,
      );
    assert.equal(fixture.writes.preferences, 0);
    await form
      .getByLabel("Новые оценки и исправления", { exact: true })
      .check();
    const submit = () =>
      form.getByRole("button", { name: "Сохранить предпочтения", exact: true });
    assert.equal(await submit().isDisabled(), true);
    assert.equal(fixture.writes.preferences, 0);
    await form
      .getByLabel("Подтверждаю выбранные категории и интервалы.", {
        exact: true,
      })
      .check();
    await submit().click();
    await form
      .getByRole("status")
      .filter({ hasText: "Предпочтения сохранены." })
      .waitFor();
    assert.equal(fixture.writes.preferences, 1);
    assert.equal(fixture.feed.preferences.gradeAlertsEnabled, true);
    await form
      .getByLabel("Смещения напоминаний заданий", { exact: true })
      .fill("4320, 1440, 180");
    fixture.remotePreferenceChange();
    await driver.section("Здоровье");
    await driver.restoreSettings();
    form = page.getByRole("form", {
      name: "Академические уведомления",
      exact: true,
    });
    assert.equal(
      await form
        .getByLabel("Смещения напоминаний заданий", { exact: true })
        .inputValue(),
      "4320, 1440, 180",
    );
    // A retained draft never carries approval across a remount. TMA may retain the
    // mounted form; editing the intervals above reset approval there as well.
    assert.equal(
      await form
        .getByLabel("Подтверждаю выбранные категории и интервалы.", {
          exact: true,
        })
        .isChecked(),
      false,
    );
    await form
      .getByLabel("Подтверждаю выбранные категории и интервалы.", {
        exact: true,
      })
      .check();
    const response = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.endsWith(
          "/study/academic-preferences",
        ) && response.request().method() === "PUT",
    );
    await submit().click();
    assert.equal((await response).status(), 409);
    await form
      .getByRole("status")
      .filter({ hasText: /Не удалось сохранить/ })
      .waitFor();
    assert.equal(
      await form
        .getByLabel("Смещения напоминаний заданий", { exact: true })
        .inputValue(),
      "4320, 1440, 180",
    );
    assert.equal(fixture.writes.preferences, 1);
    assertNoRealSideEffects(fixture);
    await driver.overflow();
  });
}
