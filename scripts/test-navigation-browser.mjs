// Synthetic navigation checks. No production identity, provider or real API is used.
// Run with tsx; LIFEOS_TMA_DIST must point to an isolated production build.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { captureBrowserFixture } from "./capture-browser-fixtures.mjs";

if (!process.env.LIFEOS_TMA_DIST) throw new Error("Set LIFEOS_TMA_DIST.");
const root = resolve(process.env.LIFEOS_TMA_DIST);
const artifacts = resolve(process.env.LIFEOS_BROWSER_ARTIFACTS || "/tmp/lifeos-navigation-browser");
await mkdir(artifacts, { recursive: true });
const { chromium } = await import(process.env.LIFEOS_PLAYWRIGHT_MODULE || "playwright");
const server = createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, "http://fixture").pathname);
    const file = resolve(root, path.replace(/^\/tma\/?/, "") || "index.html");
    if (!file.startsWith(root + "/")) throw new Error("invalid_path");
    response.setHeader("content-type", { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" }[extname(file)] || "application/octet-stream");
    response.end(await readFile(file));
  } catch {
    response.writeHead(404);
    response.end("missing");
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const errors = [], forbidden = [], checks = [];
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.LIFEOS_CHROMIUM_EXECUTABLE || undefined, args: ["--no-sandbox", "--renderer-process-limit=1"] });
  for (const width of [320, 360, 390, 430]) {
    const fixture = captureBrowserFixture();
    const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on("pageerror", (error) => errors.push(error.message));
    // Full reloads in the legacy-link checks intentionally end the local draft.
    // Internal section switches must never show this dialog.
    let dialogs = 0;
    page.on("dialog", async (dialog) => { dialogs++; await dialog.accept(); });
    const chunks = [];
    await page.route("**/*", async (route) => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin) { forbidden.push("external"); return route.abort(); }
      if (!url.pathname.startsWith("/api/tma/")) {
        if (request.method() !== "GET") { forbidden.push("asset_write"); return route.abort(); }
        chunks.push(url.pathname);
        return route.continue();
      }
      if (request.method() !== "GET") { forbidden.push("api_write"); return route.abort(); }
      let result;
      if (url.pathname === "/api/tma/session") result = { status: 200, body: { data: { state: "active", telegramUserId: 12345, displayName: "Navigation fixture", profile: { role: "user", status: "active" }, integrations: { telegram: { connected: true }, google: { connected: false }, obsidian: { connected: false }, health: { connected: false } } } } };
      else if (url.pathname === "/api/tma/study") result = { status: 200, body: { data: { timezone: "Asia/Almaty", courses: [], records: [] } } };
      else result = await fixture.response(url.pathname.slice("/api/tma/".length), "GET");
      // Other modules expose their real unavailable-data states in this shell test.
      result ??= { status: 503, body: { error: "fixture_unavailable" } };
      return route.fulfill({ status: result.status, contentType: "application/json", body: JSON.stringify(result.body) });
    });
    const primary = page.getByRole("navigation", { name: "Разделы LifeOS", exact: true });
    const checkShell = async (active) => {
      await primary.waitFor();
      assert.equal(await primary.getByRole("button").count(), 4);
      assert.equal(await primary.locator('[aria-current="page"]').getAttribute("aria-label"), active);
      assert.equal(await page.getByRole("button", { name: "Ещё", exact: true }).count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "horizontal overflow");
      for (const box of await primary.getByRole("button").all()) {
        const bounds = await box.boundingBox();
        assert.ok(bounds && bounds.height >= 44 && bounds.width >= 44);
      }
    };
    try {
      await page.goto(`${origin}/tma/?screen=capture&courseId=fixture-course&date=2026-01-02`);
      const compose = page.getByRole("textbox", { name: "Мысль, команда или ссылка" });
      await compose.fill("Invented unsaved navigation draft");
      await checkShell("Главная");
      assert.equal(chunks.some((path) => /StudyScreen-/.test(path)), false, "study eagerly loaded");
      await primary.getByRole("button", { name: "Здоровье", exact: true }).click();
      await checkShell("Здоровье");
      await primary.getByRole("button", { name: "Настройки", exact: true }).click();
      await page.getByRole("heading", { name: "Настройки", exact: true }).waitFor();
      await checkShell("Настройки");
      await primary.getByRole("button", { name: "Главная", exact: true }).click();
      await page.getByRole("navigation", { name: "Внутри раздела «Главная»" }).getByRole("button", { name: "Входящие", exact: true }).click();
      assert.equal(await compose.inputValue(), "Invented unsaved navigation draft");
      assert.equal(dialogs, 0, "internal switch discarded or warned about retained draft");
      const url = new URL(page.url());
      assert.equal(url.searchParams.get("courseId"), "fixture-course");
      assert.equal(url.searchParams.get("date"), "2026-01-02");
      await page.screenshot({ path: resolve(artifacts, `tma-${width}.png`), fullPage: true });
      checks.push({ width, check: "four sections, lazy modules, context and retained capture draft", passed: true });
      await page.goto(`${origin}/tma/?screen=workout&workoutId=fixture-workout`);
      await checkShell("Здоровье");
      await primary.getByRole("button", { name: "Настройки", exact: true }).click();
      await page.goBack();
      await checkShell("Здоровье");
      assert.equal(new URL(page.url()).searchParams.get("workoutId"), "fixture-workout");
      checks.push({ width, check: "legacy workout and history context", passed: true });
      await page.goto(`${origin}/tma/?screen=lms&courseId=fixture-course`);
      await checkShell("Учёба");
      await primary.getByRole("button", { name: "Настройки", exact: true }).click();
      await checkShell("Настройки");
      checks.push({ width, check: "legacy LMS grouping and settings", passed: true });
    } finally { await context.close(); }
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(forbidden, []);
  console.log(`PASS ${checks.length} synthetic navigation checks; no external requests or writes.`);
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
  await writeFile(resolve(artifacts, "results.json"), JSON.stringify({ checks, errors, forbidden }, null, 2));
}
