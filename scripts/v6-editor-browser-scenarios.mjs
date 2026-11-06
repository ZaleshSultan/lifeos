import assert from "node:assert/strict";

const ORIGINAL_START = "2026-11-01T01:30:12.345-05:00";
const ORIGINAL_END = "2026-11-01T02:30:45.678-05:00";
const ZONE = "America/New_York";
const iso = (value) => new Date(value).toISOString();

/** The same real UI interactions run against both frontends at 320 and 390px. */
export async function v6EditorBrowserScenarios({
  page,
  fixture,
  driver,
  test,
  prefix,
  defaultDialogHandler,
}) {
  const app = () => page.getByLabel("Учебный консьерж", { exact: true });
  const personalTab = () =>
    app().getByRole("tab", { name: "Личные экзамены", exact: true });
  const editor = () =>
    app().getByRole("form", {
      name: "Правка учебного события",
      exact: true,
    });
  const title = () => editor().getByLabel("Название", { exact: true });
  const start = () => editor().locator('input[type="datetime-local"]').first();
  const end = () => editor().locator('input[type="datetime-local"]').nth(1);
  const save = () =>
    editor().getByRole("button", {
      name: "Сохранить ручную правку",
      exact: true,
    });
  const personal = () =>
    fixture.snapshot.events.find((event) => event.kind === "personal_exam");
  const unchanged = (actual, expected) => {
    assert.equal(Date.parse(actual), Date.parse(expected));
    assert.equal(actual, iso(expected), "preserve exact seconds/milliseconds");
  };
  const assertDeliveryOff = () => {
    assert.equal(fixture.snapshot.deliveryEnabled, false);
    assert.equal(fixture.snapshot.preferences.personalAlertsEnabled, false);
    assert.equal(fixture.snapshot.preferences.examAlertsEnabled, false);
  };
  const openCurrent = async () => {
    await driver.study(null, "concierge");
    await personalTab().click();
    await app()
      .getByRole("heading", { name: personal().title, exact: true })
      .waitFor();
  };
  const edit = async () => {
    await app()
      .getByRole("button", { name: "Править событие", exact: true })
      .click();
    await editor().waitFor();
  };
  const sectionRoundTrip = async () => {
    for (const name of ["Главная", "Здоровье", "Настройки", "Учёба"])
      await driver.section(name);
    await editor().waitFor();
    await driver.overflow();
  };
  const dialogs = [];
  const handleDialog = async (dialog) => {
    if (dialog.type() === "beforeunload") return dialog.accept();
    dialogs.push({ type: dialog.type(), message: dialog.message() });
    // Every application confirmation in these cases must be declined.
    await dialog.dismiss();
  };
  if (defaultDialogHandler) page.off("dialog", defaultDialogHandler);
  page.on("dialog", handleDialog);
  try {
    await test(`${prefix} title-only save preserves the exact offset-derived instants, seconds and milliseconds after reload`, async () => {
      await fixture.configureClock(ORIGINAL_START, ORIGINAL_END, ZONE);
      await openCurrent();
      const before = personal();
      await edit();
      assert.equal(await start().inputValue(), "2026-11-01T01:30");
      assert.equal(await end().inputValue(), "2026-11-01T02:30");
      const correctedTitle = `${prefix} exact reviewed title`;
      await title().fill(correctedTitle);
      assert.equal(fixture.browserWrites.length, 0);
      await save().click();
      await editor().waitFor({ state: "hidden" });
      const writes = fixture.browserWrites;
      assert.equal(writes.length, 1);
      assert.equal(writes[0].method, "PATCH");
      assert.equal(writes[0].status, 200);
      assert.equal(writes[0].body.expectedRevision, before.revision);
      assert.equal(writes[0].body.confirmed, true);
      assert.equal(writes[0].body.patch.title, correctedTitle);
      unchanged(writes[0].body.patch.startsAt, ORIGINAL_START);
      unchanged(writes[0].body.patch.endsAt, ORIGINAL_END);
      assert.equal(personal().revision, before.revision + 1);
      assert.equal(personal().timezone, ZONE);
      await page.reload();
      await app()
        .getByRole("heading", { name: correctedTitle, exact: true })
        .waitFor();
      assert.equal(await editor().count(), 0);
      unchanged(personal().startsAt, ORIGINAL_START);
      unchanged(personal().endsAt, ORIGINAL_END);
      assert.equal(personal().title, correctedTitle);
      assert.equal(personal().manuallyEdited, true);
      assert.deepEqual(dialogs, []);
      assertDeliveryOff();
      await driver.overflow();
    });

    await test(`${prefix} an edited ambiguous daylight-saving clock is rejected without an API write`, async () => {
      await edit();
      const before = personal();
      const writesBefore = fixture.browserWrites.length;
      await start().fill("2026-11-01T01:31");
      await save().click();
      await editor()
        .getByRole("alert")
        .filter({ hasText: "повторяется при переводе часов" })
        .waitFor();
      assert.equal(fixture.browserWrites.length, writesBefore);
      assert.deepEqual(personal(), before);
      assert.equal(await start().inputValue(), "2026-11-01T01:31");
      assert.equal(await end().inputValue(), "2026-11-01T02:30");
      assert.deepEqual(dialogs, []);
      assertDeliveryOff();
      await driver.overflow();
    });

    await test(`${prefix} declining discard and four-section navigation retain the dirty edit and original CAS revision`, async () => {
      const originalRevision = personal().revision;
      const retainedTitle = `${prefix} retained unsaved review`;
      const writesBefore = fixture.browserWrites.length;
      await title().fill(retainedTitle);
      await start().fill("2026-11-01T01:30");
      await app().getByRole("tab", { name: "Календарь", exact: true }).click();
      assert.equal(dialogs.length, 1);
      assert.equal(dialogs[0].type, "confirm");
      assert.match(dialogs[0].message, /несохранённые правки/);
      assert.equal(await personalTab().getAttribute("aria-selected"), "true");
      assert.equal(
        new URL(page.url()).searchParams.get("academicTab"),
        "personal",
      );
      assert.equal(await title().inputValue(), retainedTitle);
      assert.equal(fixture.browserWrites.length, writesBefore);
      const concurrent = await fixture.concurrentEdit({
        title: `${prefix} concurrently saved review`,
      });
      assert.equal(concurrent.revision, originalRevision + 1);
      await sectionRoundTrip();
      assert.equal(
        dialogs.length,
        1,
        "SPA navigation must retain without discard",
      );
      assert.equal(await title().inputValue(), retainedTitle);
      assert.equal(await start().inputValue(), "2026-11-01T01:30");
      assert.equal(await end().inputValue(), "2026-11-01T02:30");
      assert.equal(
        fixture.browserWrites.length,
        writesBefore,
        "navigation must not save",
      );
      // A retry after another SPA round trip must not adopt the newer revision.
      for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt) await sectionRoundTrip();
        await save().click();
        await editor().getByRole("alert").waitFor();
        const rejected = fixture.browserWrites.at(-1);
        assert.equal(rejected.status, 409);
        assert.equal(rejected.method, "PATCH");
        assert.equal(rejected.body.expectedRevision, originalRevision);
        assert.equal(rejected.body.patch.title, retainedTitle);
        assert.equal(rejected.body.confirmed, true);
        assert.equal(await title().inputValue(), retainedTitle);
        assert.deepEqual(personal(), concurrent);
      }
      assert.equal(fixture.browserWrites.length, writesBefore + 2);
      assert.equal(dialogs.length, 1);
      assertDeliveryOff();
      await driver.overflow();
    });

    await test(`${prefix} a fresh explicit reviewed save uses the current revision and persists after reload`, async () => {
      const before = personal();
      const writesBefore = fixture.browserWrites.length;
      await page.reload(); // Explicitly reload the saved version after stale CAS rejection.
      await app()
        .getByRole("heading", { name: before.title, exact: true })
        .waitFor();
      assert.equal(await editor().count(), 0);
      await edit();
      assert.equal(await title().inputValue(), before.title);
      assert.equal(await start().inputValue(), "2026-11-01T01:30");
      const reviewedTitle = `${prefix} explicitly reviewed final edit`;
      await title().fill(reviewedTitle);
      await start().fill("2026-11-01T02:15");
      assert.equal(fixture.browserWrites.length, writesBefore);
      await save().click();
      await editor().waitFor({ state: "hidden" });
      const saved = fixture.browserWrites.at(-1);
      assert.equal(fixture.browserWrites.length, writesBefore + 1);
      assert.equal(saved.status, 200);
      assert.equal(saved.body.expectedRevision, before.revision);
      assert.equal(saved.body.confirmed, true);
      assert.equal(saved.body.patch.startsAt, "2026-11-01T07:15:00.000Z");
      unchanged(saved.body.patch.endsAt, ORIGINAL_END);
      assert.equal(personal().revision, before.revision + 1);
      assert.equal(personal().timezone, ZONE);
      await page.reload();
      await app()
        .getByRole("heading", { name: reviewedTitle, exact: true })
        .waitFor();
      await edit();
      assert.equal(await title().inputValue(), reviewedTitle);
      assert.equal(await start().inputValue(), "2026-11-01T02:15");
      assert.equal(await end().inputValue(), "2026-11-01T02:30");
      await editor()
        .getByRole("button", { name: "Отменить правку", exact: true })
        .click();
      await editor().waitFor({ state: "hidden" });
      assert.equal(fixture.browserWrites.length, writesBefore + 1);
      assert.equal(
        fixture.controlWrites,
        2,
        "clock setup and concurrent review only",
      );
      assert.equal(personal().startsAt, "2026-11-01T07:15:00.000Z");
      unchanged(personal().endsAt, ORIGINAL_END);
      assert.equal(dialogs.length, 1);
      assertDeliveryOff();
      await driver.overflow();
    });
  } finally {
    page.off("dialog", handleDialog);
    if (defaultDialogHandler) page.on("dialog", defaultDialogHandler);
  }
}
