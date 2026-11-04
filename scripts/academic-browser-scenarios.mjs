import assert from "node:assert/strict";

export async function academicBrowserScenarios({
  page,
  fixture,
  open,
  test,
  prefix,
}) {
  const app = () => page.getByLabel("Учебный консьерж", { exact: true });
  const tab = (name) => app().getByRole("tab", { name, exact: true });
  const overflow = async () =>
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      "Academic UI must not overflow the viewport.",
    );
  await test(`${prefix} source clocks, separate exam codes, safe cached map and pending personal event`, async () => {
    await open();
    await app()
      .getByRole("tab", { name: "Экзамены AITU", exact: true })
      .waitFor({ state: "visible" });
    await tab("Уведомления").waitFor({ state: "visible" });
    await page.waitForFunction(() =>
      [
        ...document.querySelectorAll('[aria-label="Учебный консьерж"] button'),
      ].some(
        (button) => button.textContent === "Экзамены AITU" && !button.disabled,
      ),
    );
    assert.equal(
      await app()
        .getByText("Автоматическая учебная доставка выключена на сервере.", {
          exact: false,
        })
        .count(),
      1,
    );
    const next = app()
      .locator("section")
      .filter({
        has: page.getByRole("heading", {
          name: "Следующее подтверждённое занятие",
          exact: true,
        }),
      });
    assert((await next.innerText()).includes("09:00"));
    assert((await next.innerText()).includes("Asia/Almaty"));
    assert(!(await next.innerText()).includes("13:00"));
    const primary = app()
      .locator("article")
      .filter({
        has: page.getByRole("heading", {
          name: "Synthetic Systems examination",
          exact: true,
        }),
      });
    await primary.getByText(/Схема аудитории C1.3.319/).click();
    const image = primary.getByRole("img");
    await image.waitFor();
    await page.waitForFunction(() =>
      [...document.images].some(
        (img) =>
          img.alt.includes("C1.3.319P") &&
          img.complete &&
          img.naturalWidth === 720,
      ),
    );
    assert((await image.getAttribute("src")).endsWith("/C1.3.319P.png"));
    const additional = app()
      .locator("article")
      .filter({
        has: page.getByRole("heading", {
          name: "Synthetic Systems additional slot",
          exact: true,
        }),
      });
    assert((await additional.innerText()).includes("examfx"));
    assert.equal(await additional.getByRole("img").count(), 0);
    assert.equal(
      await additional
        .getByRole("link", { name: "Интерактивная карта AITU" })
        .getAttribute("href"),
      "https://yuujiso.github.io/aitumap/",
    );
    await tab("Личные экзамены").click();
    await app()
      .getByRole("heading", {
        name: "Synthetic personal theory event",
        exact: true,
      })
      .waitFor();
    assert((await app().innerText()).includes("16:00"));
    assert(
      (await app().innerText()).includes("Окончание и длительность неизвестны"),
    );
    assert((await app().innerText()).includes("Invented test street, 9"));
    assert.equal(await app().getByRole("img").count(), 0);
    assert.equal(
      await app()
        .getByRole("link", { name: "Интерактивная карта AITU" })
        .count(),
      0,
    );
    assert.equal(fixture.requests.filter((r) => r.method !== "GET").length, 0);
    await overflow();
  });
  await test(`${prefix} explicit personal confirmation, revision-aware edit and cancellation survive reload`, async () => {
    await app()
      .getByRole("button", { name: "Проверить и подтвердить", exact: true })
      .click();
    const dialog = app().getByRole("dialog");
    const save = dialog.getByRole("button", {
      name: "Да, подтвердить событие",
      exact: true,
    });
    assert(await save.isDisabled());
    assert(!(await dialog.getByRole("checkbox").isChecked()));
    await dialog.getByRole("checkbox").check();
    await save.click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(
      fixture.requests.filter(
        (r) => r.path.endsWith("/confirm") && r.path.includes("/events/"),
      ).length,
      1,
    );
    await app()
      .getByRole("button", { name: "Править событие", exact: true })
      .click();
    const editor = app().getByRole("form", {
      name: "Правка учебного события",
      exact: true,
    });
    await editor
      .getByRole("textbox", { name: "Название", exact: true })
      .fill("Synthetic personal event corrected");
    assert.equal(
      await editor.locator('input[type="datetime-local"]').nth(1).inputValue(),
      "",
    );
    await editor
      .getByRole("button", { name: "Сохранить ручную правку", exact: true })
      .click();
    await editor.waitFor({ state: "hidden" });
    await page.reload();
    await tab("Личные экзамены").click();
    await app()
      .getByRole("heading", {
        name: "Synthetic personal event corrected",
        exact: true,
      })
      .waitFor();
    assert(
      (await app().innerText()).includes("Окончание и длительность неизвестны"),
    );
    assert.equal(
      fixture.snapshot.events.find((e) => e.kind === "personal_exam").endsAt,
      null,
    );
    assert.equal(fixture.snapshot.preferences.personalAlertsEnabled, false);
    const beforeCancel = fixture.requests.filter((r) =>
      r.path.endsWith("/cancel"),
    ).length;
    await app()
      .getByRole("button", { name: "Отменить событие", exact: true })
      .click();
    const cancelDialog = app().getByRole("dialog");
    assert(
      await cancelDialog
        .getByRole("button", { name: "Да, отменить событие", exact: true })
        .isDisabled(),
    );
    await cancelDialog
      .getByRole("button", { name: "Вернуться без изменений", exact: true })
      .click();
    assert.equal(
      fixture.requests.filter((r) => r.path.endsWith("/cancel")).length,
      beforeCancel,
    );
    await app()
      .getByRole("button", { name: "Отменить событие", exact: true })
      .click();
    await app().getByRole("dialog").getByRole("checkbox").check();
    await app()
      .getByRole("dialog")
      .getByRole("button", { name: "Да, отменить событие", exact: true })
      .click();
    await app().getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal(
      fixture.snapshot.events.find((e) => e.kind === "personal_exam").status,
      "cancelled",
    );
    assert.equal(
      fixture.snapshot.events.filter(
        (e) => e.kind === "university_exam" && e.status === "confirmed",
      ).length,
      2,
    );
    await page.reload();
    await tab("Личные экзамены").click();
    await app().getByText("Отменено", { exact: true }).waitFor();
    await overflow();
  });
  await test(`${prefix} inclusive three-trimester calendar preserves overlapping periods and genuine assignment status`, async () => {
    await tab("Календарь").click();
    for (const n of [1, 2, 3])
      await app()
        .getByRole("heading", { name: "Триместр " + n, exact: true })
        .waitFor();
    await app()
      .getByRole("heading", { name: "Synthetic summer term", exact: true })
      .waitFor();
    await app()
      .getByRole("heading", {
        name: "Synthetic overlapping vacation",
        exact: true,
      })
      .waitFor();
    assert((await app().innerText()).includes("Последний день включён"));
    await tab("Задания LMS").click();
    await app()
      .getByRole("heading", {
        name: "Synthetic Moodle submission",
        exact: true,
      })
      .waitFor();
    assert.equal(
      await app()
        .getByRole("link", { name: "Открыть задание в Moodle" })
        .count(),
      1,
    );
    assert((await app().innerText()).includes("Подтверждена отправка"));
    fixture.setStale();
    await app()
      .getByRole("button", { name: "Обновить учебные события", exact: true })
      .click();
    await app()
      .getByText(/Данные LMS устарели или требуется повторный вход/)
      .waitFor();
    await overflow();
  });
  await test(`${prefix} notification preferences remain explicit and preserve failed-save drafts`, async () => {
    await tab("Уведомления").click();
    const form = app().getByRole("form", {
      name: "Настройки учебных уведомлений",
      exact: true,
    });
    const checkboxes = await form.getByRole("checkbox").all();
    assert.equal(checkboxes.length, 6);
    for (const checkbox of checkboxes) assert(!(await checkbox.isChecked()));
    await form
      .getByRole("checkbox", { name: "Подтверждённые занятия", exact: true })
      .check();
    await form
      .getByRole("spinbutton", {
        name: "За сколько минут до занятия",
        exact: true,
      })
      .fill("15");
    fixture.failPreferencesOnce();
    await form
      .getByRole("button", {
        name: "Сохранить настройки доставки",
        exact: true,
      })
      .click();
    await app().getByRole("alert").waitFor();
    assert(
      await form
        .getByRole("checkbox", { name: "Подтверждённые занятия", exact: true })
        .isChecked(),
    );
    assert.equal(await form.getByRole("spinbutton").inputValue(), "15");
    let discardAsked = false;
    page.once("dialog", async (dialog) => {
      discardAsked = true;
      await dialog.dismiss();
    });
    await tab("Календарь").click();
    assert(discardAsked);
    assert.equal(
      await tab("Уведомления").getAttribute("aria-selected"),
      "true",
    );
    assert.equal(await form.getByRole("spinbutton").inputValue(), "15");
    await form
      .getByRole("button", {
        name: "Сохранить настройки доставки",
        exact: true,
      })
      .click();
    await app()
      .getByRole("status")
      .filter({ hasText: "Предпочтения сохранены" })
      .waitFor();
    await page.reload();
    await tab("Уведомления").click();
    assert(
      await app()
        .getByRole("checkbox", { name: "Подтверждённые занятия", exact: true })
        .isChecked(),
    );
    assert.equal(await app().getByRole("spinbutton").inputValue(), "15");
    assert.equal(fixture.snapshot.preferences.examAlertsEnabled, false);
    assert.equal(fixture.snapshot.preferences.personalAlertsEnabled, false);
    assert.equal(fixture.snapshot.deliveryEnabled, false);
    await overflow();
  });
  await test(`${prefix} read-only import preview starts unchecked and saves only the selected proposal`, async () => {
    await tab("Импорт").click();
    const panel = app().getByLabel("Предпросмотр и импорт учебных событий", {
      exact: true,
    });
    await panel
      .getByRole("combobox", { name: /^Формат(?:\s|$)/ })
      .selectOption("csv");
    await panel
      .getByText("Вставить содержимое файла вручную", { exact: true })
      .click();
    const text =
      "date,start_local,end_local,course,room,source_type_code,timezone\n2090-11-12,10:00,11:00,Synthetic CSV selected,C1.3.323K,exam,Asia/Almaty\n2090-11-13,11:00,12:00,Synthetic CSV unselected,C1.1.227P,examfx,Asia/Almaty";
    await panel
      .getByRole("textbox", { name: "Текст таблицы", exact: true })
      .fill(text);
    const before = fixture.snapshot.events.length;
    await panel
      .getByRole("button", { name: "Проверить перед импортом", exact: true })
      .click();
    await panel
      .getByText("Предпросмотр: 2 записей. Выбрано: 0.", { exact: true })
      .waitFor();
    assert.equal(fixture.snapshot.events.length, before);
    for (const checkbox of await panel.getByRole("checkbox").all())
      assert(!(await checkbox.isChecked()));
    const confirm = panel.getByRole("button", {
      name: "Импортировать выбранные записи",
      exact: true,
    });
    assert(await confirm.isDisabled());
    await panel
      .getByRole("checkbox", {
        name: "Выбрать запись «Synthetic CSV selected»",
        exact: true,
      })
      .check();
    assert(await confirm.isDisabled());
    await panel
      .getByRole("checkbox", {
        name: /Я проверил выбранные записи и источники/,
      })
      .check();
    await confirm.click();
    await panel.getByRole("status").filter({ hasText: "Создано: 1" }).waitFor();
    assert.equal(fixture.snapshot.events.length, before + 1);
    assert.equal(
      fixture.snapshot.events.filter(
        (e) => e.title === "Synthetic CSV unselected",
      ).length,
      0,
    );
    assert.equal(
      fixture.requests.filter((r) => r.path.endsWith("/import/confirm")).length,
      1,
    );
    assert.equal(fixture.snapshot.preferences.examAlertsEnabled, false);
    await page.reload();
    await tab("Экзамены AITU").click();
    await app()
      .getByRole("heading", { name: "Synthetic CSV selected", exact: true })
      .waitFor();
    assert.equal(
      await app()
        .getByRole("heading", { name: "Synthetic CSV unselected", exact: true })
        .count(),
      0,
    );
    await overflow();
  });
}
