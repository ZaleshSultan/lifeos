// Browser interactions shared by staged TMA and real Next fixture-server tests.
import assert from "node:assert/strict";

export async function captureBrowserScenarios({
  page,
  fixture,
  open,
  test,
  prefix = "capture",
}) {
  const detail = () =>
    page.getByRole("region", { name: "Просмотр записи", exact: true });
  const composer = () =>
    page.getByLabel("Мысль, команда или ссылка", { exact: true });
  const saveCapture = () =>
    page.getByRole("button", {
      name: "Сохранить и подготовить просмотр",
      exact: true,
    });
  const confirm = () =>
    detail().getByRole("button", { name: /^Подтвердить выбранные действия/ });
  const taskText =
    "task: Capture fixture task; water 250 ml; remind me finish DBMS";
  let taskId;
  await test(`${prefix}: ambiguous ingest retry keeps one capture and all actions unapproved`, async () => {
    await open();
    await composer().waitFor();
    const stateFilter = await page
      .getByLabel("Состояние", { exact: false })
      .boundingBox();
    assert.ok(
      stateFilter && stateFilter.width >= 180,
      "Capture state filter must remain readable on narrow screens",
    );
    fixture.failCreateAfterCommitOnce = true;
    await composer().fill(taskText);
    await saveCapture().click();
    await page
      .getByRole("alert")
      .filter({ hasText: /недоступны|недоступна/ })
      .waitFor();
    assert.equal(await composer().inputValue(), taskText);
    assert.equal(fixture.createRequests.length, 1);
    await saveCapture().click();
    await detail().getByText("Выбрано действий: 0", { exact: true }).waitFor();
    assert.equal(fixture.createRequests.length, 2);
    assert.equal(
      fixture.createRequests[0].requestId,
      fixture.createRequests[1].requestId,
    );
    assert.equal(fixture.createRequests[1].retentionDays, null);
    assert.equal(fixture.captures.size, 2);
    assert.equal(fixture.domainWrites.length, 0);
    taskId = [...fixture.captures.values()].find(
      (item) => item.text === taskText,
    ).id;
    for (const checkbox of await detail().getByRole("checkbox").all())
      assert.equal(await checkbox.isChecked(), false);
    assert.equal(
      await detail()
        .getByLabel("Выбрать действие 3: Добавить напоминание")
        .isDisabled(),
      true,
    );
    await detail()
      .getByText(/Контекст и ограничения/)
      .click();
    await detail()
      .getByText(/LifeOS не придумывает время занятий/)
      .waitFor();
    await detail()
      .getByRole("heading", { name: "Сохранённые факты", exact: true })
      .waitFor();
    await detail()
      .getByText("Fixture: измерение сна не сохранено.", { exact: true })
      .waitFor();
    assert.equal(fixture.providerCalls, 0);
  });
  await test(`${prefix}: selective confirmation retries an ambiguous outcome without duplicate writes`, async () => {
    const water = detail().getByLabel("Выбрать действие 2: Записать воду");
    await water.check();
    fixture.failConfirmAfterCommitOnce = true;
    await confirm().click();
    await page
      .getByRole("alert")
      .filter({ hasText: /недоступны|недоступна/ })
      .waitFor();
    assert.equal(
      fixture.domainWrites.filter((item) => item.kind === "water.log").length,
      1,
    );
    await confirm().click();
    await detail()
      .getByText(/Сохранено ровно один раз: water\.log/)
      .waitFor();
    assert.equal(fixture.confirmRequests.length, 2);
    assert.equal(
      fixture.confirmRequests[0].requestId,
      fixture.confirmRequests[1].requestId,
    );
    assert.equal(
      fixture.domainWrites.filter((item) => item.kind === "water.log").length,
      1,
    );
    assert.equal(
      fixture.domainWrites.filter((item) => item.kind === "task.create").length,
      0,
    );
    assert.equal(await water.isDisabled(), true);
    await page.reload();
    await page
      .getByRole("button", { name: /task: Capture fixture task/ })
      .click();
    await detail()
      .getByText(/Сохранено ровно один раз: water\.log/)
      .waitFor();
    assert.equal(fixture.captures.get(taskId).actions[1].status, "succeeded");
  });
  await test(`${prefix}: edit failures retain fields, new revisions clear selection and expiry blocks approval`, async () => {
    await detail()
      .getByRole("button", { name: "Уточнить предложение 3", exact: true })
      .click();
    const time = detail().getByLabel("Когда напомнить · Asia/Almaty", {
      exact: true,
    });
    await time.fill("2026-11-04T16:00");
    fixture.failEditOnce = true;
    await detail()
      .getByRole("button", { name: "Сохранить предложение", exact: true })
      .click();
    await page
      .getByRole("alert")
      .filter({ hasText: /недоступны|недоступна/ })
      .waitFor();
    assert.equal(await time.inputValue(), "2026-11-04T16:00");
    await detail()
      .getByRole("button", { name: "Сохранить предложение", exact: true })
      .click();
    await detail().getByText("Выбрано действий: 0", { exact: true }).waitFor();
    const reminder = detail().getByLabel(
      "Выбрать действие 3: Добавить напоминание",
    );
    await reminder.check();
    await confirm().click();
    await detail()
      .getByText(/Сохранено ровно один раз: reminder\.create/)
      .waitFor();
    assert.equal(
      fixture.domainWrites.filter((item) => item.kind === "reminder.create")
        .length,
      1,
    );
    fixture.captures.get(taskId).reviewExpiresAt = new Date(
      Date.now() - 1000,
    ).toISOString();
    await detail()
      .getByRole("button", { name: "Обновить запись", exact: true })
      .click();
    await detail()
      .getByText(/Время подтверждения истекло/)
      .waitFor();
    assert.equal(
      await detail()
        .getByLabel("Выбрать действие 1: Создать задачу")
        .isDisabled(),
      true,
    );
    await detail()
      .getByRole("button", { name: "Обновить истёкший просмотр", exact: true })
      .click();
    await detail().getByText("Выбрано действий: 0", { exact: true }).waitFor();
    assert.equal(
      fixture.domainWrites.filter((item) => item.kind === "water.log").length,
      1,
    );
    assert.equal(
      fixture.domainWrites.filter((item) => item.kind === "reminder.create")
        .length,
      1,
    );
  });
  await test(`${prefix}: voice stays manual until transcript review and does not assume filming completed`, async () => {
    await page.getByRole("button", { name: /^Голосовое сообщение/ }).click();
    await detail()
      .getByLabel("Ручная расшифровка", { exact: true })
      .fill("filming idea: Library b-roll");
    await detail()
      .getByRole("button", { name: "Сохранить расшифровку", exact: true })
      .click();
    await detail()
      .getByRole("button", { name: "Подготовить предложения", exact: true })
      .click();
    await detail()
      .getByLabel("Выбрать действие 1: Сохранить идею съёмки")
      .waitFor();
    assert.equal(
      fixture.domainWrites.filter((item) => item.kind === "filming.idea")
        .length,
      0,
    );
    await detail()
      .getByLabel("Выбрать действие 1: Сохранить идею съёмки")
      .check();
    await confirm().click();
    await detail()
      .getByText(/Сохранено ровно один раз: filming\.idea/)
      .waitFor();
    assert.equal(fixture.providerCalls, 0);
    assert.equal(await page.locator("audio").count(), 0);
  });
  await test(`${prefix}: explicit memory create, update and archive each require separate capture approval`, async () => {
    await page
      .getByRole("button", { name: "Память по выбору", exact: true })
      .click();
    const memory = () =>
      page.getByRole("region", { name: "Явная память LifeOS", exact: true });
    await memory()
      .getByLabel("Ключ памяти", { exact: true })
      .fill("study.time");
    await memory()
      .getByLabel("Что явно запомнить", { exact: true })
      .fill("Prefer study in the morning");
    await memory()
      .getByRole("button", { name: "Подготовить запись в память", exact: true })
      .click();
    await detail()
      .getByLabel("Выбрать действие 1: Сохранить в память")
      .waitFor();
    assert.equal(fixture.memories.length, 0);
    await detail().getByLabel("Выбрать действие 1: Сохранить в память").check();
    await confirm().click();
    await detail()
      .getByText(/Сохранено ровно один раз: memory\.remember/)
      .waitFor();
    assert.equal(fixture.memories[0].content, "Prefer study in the morning");
    await page
      .getByRole("button", { name: "Память по выбору", exact: true })
      .click();
    await memory()
      .getByRole("button", { name: "Редактировать память", exact: true })
      .click();
    await memory()
      .getByLabel("Что явно запомнить", { exact: true })
      .fill("Prefer study in the evening");
    await memory()
      .getByRole("button", {
        name: "Подготовить изменение памяти",
        exact: true,
      })
      .click();
    await detail().getByLabel("Выбрать действие 1: Изменить память").check();
    await confirm().click();
    await detail()
      .getByText(/Сохранено ровно один раз: memory\.update/)
      .waitFor();
    assert.equal(fixture.memories[0].content, "Prefer study in the evening");
    await page
      .getByRole("button", { name: "Память по выбору", exact: true })
      .click();
    assert.equal(
      await memory()
        .getByRole("button", {
          name: "Подготовить удаление памяти",
          exact: true,
        })
        .count(),
      0,
    );
    await memory()
      .getByRole("button", { name: "Подготовить архивацию", exact: true })
      .click();
    await detail()
      .getByLabel("Выбрать действие 1: Архивировать память")
      .check();
    await confirm().click();
    await detail()
      .getByText(/Сохранено ровно один раз: memory\.archive/)
      .waitFor();
    assert.ok(fixture.memories[0].archivedAt);
  });
  await test(`${prefix}: private search, archive and confirmed history deletion preserve executed domain actions`, async () => {
    await page
      .getByLabel("Поиск по исходным записям", { exact: true })
      .fill("Capture fixture task");
    await page
      .getByRole("button", { name: "Найти записи", exact: true })
      .click();
    await page
      .getByRole("button", { name: /task: Capture fixture task/ })
      .click();
    await detail()
      .getByRole("button", { name: "Архивировать запись", exact: true })
      .click();
    await detail().getByText("Запись в архиве", { exact: true }).waitFor();
    await page.getByLabel("Включить архив", { exact: true }).check();
    await page
      .getByRole("button", { name: "Найти записи", exact: true })
      .click();
    await page
      .getByRole("button", { name: /task: Capture fixture task/ })
      .click();
    page.once("dialog", (dialog) => dialog.accept());
    await detail()
      .getByRole("button", { name: "Удалить запись и её историю", exact: true })
      .click();
    await page
      .getByText("Исходная запись и её история удалены.", { exact: false })
      .waitFor();
    assert.equal(fixture.captures.has(taskId), false);
    assert.equal(
      fixture.domainWrites.filter((item) => item.kind === "water.log").length,
      1,
    );
    assert.equal(
      fixture.domainWrites.filter((item) => item.kind === "reminder.create")
        .length,
      1,
    );
    assert.equal(
      fixture.domainWrites.filter((item) => item.kind === "task.create").length,
      0,
    );
    assert.equal(fixture.searchRequests.at(-1).query, "Capture fixture task");
    assert.equal(fixture.deleteRequests.at(-1).confirmed, true);
    assert.equal(fixture.providerCalls, 0);
    assert.equal(
      await page
        .getByText("PRIVATE FIXTURE DIAGNOSTIC", { exact: false })
        .count(),
      0,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
  });
  await test(`${prefix}: a slow older search cannot replace history after an accepted mutation`, async () => {
    await page
      .getByRole("button", { name: "Сбросить поиск", exact: true })
      .click();
    await page
      .getByRole("button", { name: /^filming idea: Library b-roll/ })
      .waitFor();
    const gate = fixture.deferNextSearch();
    try {
      await page
        .getByLabel("Поиск по исходным записям", { exact: true })
        .fill("missing stale fixture search");
      await page
        .getByRole("button", { name: "Найти записи", exact: true })
        .click();
      await gate.received;
      const newer = "task: Capture newer than slow search";
      await composer().fill(newer);
      await saveCapture().click();
      await detail()
        .getByText("Выбрано действий: 0", { exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: new RegExp("^" + newer) })
        .waitFor();
      gate.release();
      await page.waitForTimeout(100);
      assert.equal(
        await page
          .getByRole("button", { name: new RegExp("^" + newer) })
          .count(),
        1,
      );
      assert.equal(
        fixture.domainWrites.filter((item) => item.kind === "task.create")
          .length,
        0,
      );
    } finally {
      gate.release();
    }
  });
  const original =
    "Завтра после университета нужно потренироваться, закончить DBMS и снять пару кадров для Ideal Human.";
  const finalObjective =
    "Завтра после универа хочу в зал, потом закрыть DBMS и вечером снять видос для Ideal Human.";
  let mixedId;
  await test(`${prefix}: multilingual mixed intentions have independent unchecked review cards`, async () => {
    for (const [text, count] of [
      [original, 3],
      [
        "Завтра после университета нужно потренироваться, законч DBMS и снять пару кадров для Ideal Human.",
        3,
      ],
      ["Tomorrow finish DBMS, go to the gym and film my vlog.", 3],
      [
        "Ертең сабақтан кейін залға барамын, сосын DBMS тапсырмасын бітіру керек.",
        2,
      ],
      ["После пар зал потом DBMS вечером влог снять", 3],
      [finalObjective, 3],
    ]) {
      await composer().fill(text);
      await saveCapture().click();
      // A previous review can also have zero selected actions while ingest is
      // pending. Wait for this input's accepted view before reading its proposals.
      await detail().getByText(text, { exact: true }).waitFor();
      await detail()
        .getByText("Выбрано действий: 0", { exact: true })
        .waitFor();
      const current = [...fixture.captures.values()]
        .filter((item) => item.text === text)
        .at(-1);
      assert.equal(current.actions.length, count);
      for (const checkbox of await detail()
        .locator('article input[type="checkbox"]')
        .all())
        assert.equal(await checkbox.isChecked(), false);
      for (const action of current.actions)
        await detail()
          .getByText(action.presentation.title, { exact: true })
          .waitFor();
      assert.equal(
        fixture.domainWrites.filter((item) => item.captureId === current.id)
          .length,
        0,
      );
      if (text === original || text === finalObjective) {
        if (text === original) mixedId = current.id;
        const task = current.actions.find(
          (action) => action.kind === "task.create",
        );
        const workout = current.actions.find(
          (action) => action.kind === "planning.suggest",
        );
        const filming = current.actions.find(
          (action) => action.kind === "filming.idea",
        );
        assert.ok(task && workout && filming);
        assert.match(task.presentation.title, /DBMS/);
        assert.doesNotMatch(task.presentation.title, /снять|кадр|потренир/iu);
        assert.doesNotMatch(filming.args.content, /DBMS|потренир/iu);
        assert.equal(task.args.dueAt, null);
        assert.equal(workout.args.time, null);
        await detail()
          .getByText(/Точное время не назначено/)
          .first()
          .waitFor();
        if (text === finalObjective) {
          assert.equal(workout.presentation.relation, "после универа");
          assert.equal(filming.presentation.timeHint, "вечером");
          assert.ok(
            current.actions.every(
              (action) => action.presentation.suggestedDate === "2026-11-04",
            ),
          );
          await detail()
            .getByText(/Пожелание по времени: вечером/)
            .waitFor();
        }
      }
    }
    assert.equal(fixture.providerCalls, 0);
  });
  await test(`${prefix}: corrections and one-action rejection preserve partial receipts without implicit approval`, async () => {
    await page
      .getByRole("region", { name: "История входящих", exact: true })
      .getByText(original, { exact: true })
      .click();
    await detail().getByText(original, { exact: true }).waitFor();
    const instruction = detail().getByLabel("Уточнение предложений", {
      exact: true,
    });
    const originalRevision = fixture.captures.get(mixedId).revision;
    await instruction.fill("Остальные задачи сохрани");
    await detail()
      .getByRole("button", { name: "Применить уточнение", exact: true })
      .click();
    await page
      .getByRole("alert")
      .filter({ hasText: /Не удалось однозначно понять уточнение/ })
      .waitFor();
    assert.equal(await instruction.inputValue(), "Остальные задачи сохрани");
    assert.equal(fixture.captures.get(mixedId).revision, originalRevision);
    await instruction.fill("Нет, DBMS не завтра, а в пятницу.");
    fixture.failCorrectionOnce = true;
    await detail()
      .getByRole("button", { name: "Применить уточнение", exact: true })
      .click();
    await page
      .getByRole("alert")
      .filter({ hasText: /недоступны|недоступна/ })
      .waitFor();
    assert.equal(
      await instruction.inputValue(),
      "Нет, DBMS не завтра, а в пятницу.",
    );
    await detail()
      .getByRole("button", { name: "Применить уточнение", exact: true })
      .click();
    await detail().getByText("Выбрано действий: 0", { exact: true }).waitFor();
    await detail()
      .getByText(/6 ноября 2026/)
      .waitFor();
    const current = fixture.captures.get(mixedId),
      task = current.actions.find((action) => action.kind === "task.create");
    const index = current.actions.indexOf(task) + 1;
    await detail()
      .getByLabel(`Выбрать действие ${index}: Создать задачу`)
      .check();
    const before = fixture.confirmRequests.length;
    fixture.failConfirmAfterCommitOnce = true;
    await confirm().click();
    await page
      .getByRole("alert")
      .filter({ hasText: /недоступны|недоступна/ })
      .waitFor();
    await confirm().click();
    await detail()
      .getByText(/Сохранено ровно один раз: task\.create/)
      .waitFor();
    assert.equal(fixture.confirmRequests.length, before + 2);
    assert.equal(
      fixture.confirmRequests[before].requestId,
      fixture.confirmRequests[before + 1].requestId,
    );
    assert.deepEqual(fixture.confirmRequests[before].actionIds, [task.id]);
    const receipt = structuredClone(
      fixture.captures
        .get(mixedId)
        .actions.find((action) => action.id === task.id),
    );
    await instruction.fill("Тренировку убери, остальные задачи сохрани.");
    await detail()
      .getByRole("button", { name: "Применить уточнение", exact: true })
      .click();
    await page
      .getByRole("status")
      .filter({ hasText: "Предложения уточнены" })
      .waitFor();
    const after = fixture.captures.get(mixedId);
    assert.deepEqual(
      after.actions.find((action) => action.id === task.id),
      receipt,
    );
    assert.equal(
      after.actions.find((action) => action.kind === "planning.suggest").status,
      "cancelled",
    );
    assert.equal(
      after.actions.find((action) => action.kind === "filming.idea").status,
      "pending",
    );
    assert.equal(
      fixture.domainWrites.filter((item) => item.captureId === mixedId).length,
      1,
    );
    const filmingIndex =
      after.actions.findIndex((action) => action.kind === "filming.idea") + 1;
    await detail()
      .getByRole("button", {
        name: `Отклонить предложение ${filmingIndex}`,
        exact: true,
      })
      .click();
    await page
      .getByRole("status")
      .filter({ hasText: "Предложение отклонено" })
      .waitFor();
    assert.equal(
      fixture.captures
        .get(mixedId)
        .actions.find((action) => action.kind === "filming.idea").status,
      "cancelled",
    );
    assert.deepEqual(
      fixture.captures
        .get(mixedId)
        .actions.find((action) => action.id === task.id),
      receipt,
    );
    assert.equal(
      fixture.domainWrites.filter((item) => item.captureId === mixedId).length,
      1,
    );
  });
  await test(`${prefix}: external consent is separate and mocked voice stages retain manual fallback`, async () => {
    const voice = fixture.addVoiceCapture();
    fixture.capabilities.transcription = "configured_unverified";
    try {
      await page.reload();
      await page.getByRole("button", { name: /^Голосовое сообщение/ }).click();
      const external = detail().getByRole("region", {
        name: "Отдельное согласие на внешнюю обработку",
        exact: true,
      });
      const run = external.getByRole("button", {
        name: "Запросить расшифровку с моим согласием",
        exact: true,
      });
      assert.equal(await run.isDisabled(), true);
      assert.equal(fixture.externalRequests.length, 0);
      await detail()
        .getByLabel("Ручная расшифровка", { exact: true })
        .waitFor();
      await external
        .getByRole("checkbox", { name: /Разрешаю передать аудио этой записи/ })
        .check();
      fixture.failExternalOnce = "voice_quota_exceeded";
      await run.click();
      await page
        .getByRole("alert")
        .filter({ hasText: /Достигнут лимит внешней обработки/ })
        .waitFor();
      assert.equal(fixture.captures.has(voice), true);
      await run.click();
      await detail()
        .getByRole("heading", { name: "Расшифровываем голос", exact: true })
        .waitFor();
      assert.equal(fixture.externalRequests.length, 2);
      assert.equal(
        fixture.externalRequests[0].requestId,
        fixture.externalRequests[1].requestId,
      );
      assert.equal(fixture.externalRequests[1].confirmed, true);
      fixture.completeExternal(voice, original);
      await detail()
        .getByText("Расшифровка провайдера — проверь текст", { exact: true })
        .waitFor();
      await detail()
        .getByText("Выбрано действий: 0", { exact: true })
        .waitFor();
      assert.equal(fixture.captures.get(voice).actions.length, 3);
      assert.equal(
        fixture.domainWrites.filter((item) => item.captureId === voice).length,
        0,
      );
      assert.equal(fixture.mockExternalCompletions, 1);
      assert.equal(fixture.providerCalls, 0);
      assert.equal(await page.locator("audio").count(), 0);
      const cancelled = fixture.addVoiceCapture();
      await page.reload();
      await page.getByRole("button", { name: /^Голосовое сообщение/ }).click();
      const next = detail().getByRole("region", {
        name: "Отдельное согласие на внешнюю обработку",
        exact: true,
      });
      await next
        .getByRole("checkbox", { name: /Разрешаю передать аудио этой записи/ })
        .check();
      await next
        .getByRole("button", {
          name: "Запросить расшифровку с моим согласием",
          exact: true,
        })
        .click();
      await detail()
        .getByRole("heading", { name: "Расшифровываем голос", exact: true })
        .waitFor();
      await detail()
        .getByRole("button", { name: "Отменить обработку", exact: true })
        .click();
      await detail()
        .getByRole("heading", { name: "Отменено", exact: true })
        .waitFor();
      assert.equal(fixture.completeExternal(cancelled, original), false);
      assert.equal(fixture.captures.get(cancelled).state, "cancelled");
      assert.equal(fixture.captures.has(cancelled), true);
    } finally {
      fixture.capabilities.transcription = "unavailable";
    }
  });
}
