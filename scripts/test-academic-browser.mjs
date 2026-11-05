// Staged TMA assets and invented fixture APIs only; no production requests or delivery.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { academicBrowserFixture } from "./academic-browser-fixtures.mjs";
import { academicBrowserScenarios } from "./academic-browser-scenarios.mjs";

if (!process.env.LIFEOS_TMA_DIST)
  throw new Error("Set LIFEOS_TMA_DIST to an isolated staged /tma build.");
const root = resolve(process.env.LIFEOS_TMA_DIST);
const firstCaseOnly = process.env.LIFEOS_ACADEMIC_BROWSER_DEBUG_FIRST === "1";
const importDebug = process.env.LIFEOS_ACADEMIC_BROWSER_DEBUG_IMPORT === "1";
if (firstCaseOnly && importDebug) throw new Error("Choose one debug scope.");
const viewports = firstCaseOnly || importDebug ? [320] : [320, 390, 768, 1440];
const artifacts = resolve(
  process.env.LIFEOS_ACADEMIC_BROWSER_ARTIFACTS ||
    "/tmp/lifeos-academic-browser",
);
await mkdir(artifacts, { recursive: true });
const { chromium } = await import(
  process.env.LIFEOS_PLAYWRIGHT_MODULE || "playwright"
);
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(
      new URL(request.url, "http://fixture").pathname,
    );
    if (pathname === "/favicon.ico") {
      response.writeHead(204);
      return response.end();
    }
    const path = resolve(
      root,
      pathname.replace(/^\/tma\/?/, "") || "index.html",
    );
    if (!path.startsWith(root + "/")) throw new Error("invalid_path");
    const data = await readFile(path);
    response.writeHead(200, {
      "content-type":
        {
          ".html": "text/html",
          ".js": "text/javascript",
          ".css": "text/css",
          ".png": "image/png",
        }[extname(path)] || "application/octet-stream",
    });
    response.end(data);
  } catch {
    response.writeHead(404);
    response.end("missing");
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = "http://127.0.0.1:" + server.address().port;
const failures = [],
  errors = [],
  consoleErrors = [],
  requestedResources = [],
  forbidden = [],
  unexpectedHttpFailures = [];
let browser,
  passed = 0,
  expectedFailureResponses = 0;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.LIFEOS_CHROMIUM_EXECUTABLE || undefined,
    args: ["--no-sandbox", "--renderer-process-limit=1"],
  });
  for (const width of viewports) {
    const fixture = academicBrowserFixture();
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      timezoneId: "Asia/Tokyo",
      isMobile: width < 1440,
      hasTouch: width < 1440,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await context.route("**/*", async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      if (url.pathname.startsWith("/api/tma/")) {
        const cors = {
          "access-control-allow-origin": origin,
          "access-control-allow-headers": "content-type,x-telegram-init-data",
          "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
          "cache-control": "no-store",
        };
        if (request.method() === "OPTIONS")
          return route.fulfill({ status: 204, headers: cors });
        const resource = url.pathname.slice("/api/tma/".length);
        requestedResources.push({ resource, method: request.method() });
        const input = request.postData() ? JSON.parse(request.postData()) : {};
        let result = await fixture.response(resource, request.method(), input);
        const answer = (data) => ({ status: 200, body: { data } });
        if (!result && resource === "session")
          result = answer({
            state: "active",
            telegramUserId: 12345,
            displayName: "Invented academic fixture owner",
            profile: { role: "user", status: "active" },
            integrations: {
              telegram: { connected: true },
              google: { connected: false },
              obsidian: { connected: false },
              health: { connected: false },
            },
          });
        if (!result && resource === "study")
          result = answer({
            timezone: "Asia/Almaty",
            courses: [
              {
                id: "fixture-course",
                code: "SYN",
                title: "Synthetic Systems",
                startsOn: null,
                endsOn: null,
                externalCourseKey: null,
                calculator: null,
                schedules: [],
              },
            ],
            records: [],
          });
        if (!result && resource === "lms/connection")
          result = answer({
            configured: false,
            state: "session_expired",
            lastSyncSuccessAt: null,
            lastSyncAttemptAt: null,
            lastErrorCategory: null,
            sessionExpiresAt: null,
            syncRequestedAt: null,
            unsupportedFeatures: [],
          });
        if (!result && resource === "lms/work")
          result = answer({
            timezone: "Asia/Almaty",
            lastSyncSuccessAt: null,
            lastSyncAttemptAt: null,
            stale: true,
            truncated: false,
            warnings: [],
            unsupportedFeatures: [],
            items: [],
          });
        if (!result) {
          forbidden.push(url.pathname);
          return route.abort();
        }
        if (result.status === 503 && resource.endsWith("/preferences"))
          expectedFailureResponses++;
        else if (result.status >= 400)
          unexpectedHttpFailures.push({ resource, status: result.status });
        return route.fulfill({
          status: result.status,
          headers: cors,
          contentType: "application/json",
          body: JSON.stringify(result.body),
        });
      }
      if (url.origin === origin) return route.continue();
      forbidden.push(url.origin + url.pathname);
      return route.abort();
    });
    const test = async (name, work) => {
      if (firstCaseOnly && passed === 1) return;
      if (
        importDebug &&
        !name.includes("source clocks") &&
        !name.includes("read-only import")
      )
        return;
      try {
        await work();
        passed++;
        console.log("PASS " + name);
      } catch (error) {
        failures.push({ name, error: error.message });
        await writeFile(
          resolve(artifacts, `failure-${width}-accessibility.txt`),
          await page
            .locator("body")
            .ariaSnapshot()
            .catch(() => "unavailable"),
        );
        await page
          .screenshot({
            path: resolve(artifacts, `failure-${width}.png`),
            fullPage: true,
          })
          .catch(() => {});
        throw error;
      }
    };
    try {
      await academicBrowserScenarios({
        page,
        fixture,
        prefix: `TMA ${width}px`,
        test,
        open: () => page.goto(origin + "/tma/?screen=study&studyTab=concierge"),
      });
      await page.screenshot({
        path: resolve(artifacts, `academic-${width}.png`),
        fullPage: true,
      });
    } finally {
      await context.close();
    }
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(forbidden, []);
  assert.deepEqual(unexpectedHttpFailures, []);
  assert.equal(passed, firstCaseOnly ? 1 : importDebug ? 2 : 20);
  assert.equal(expectedFailureResponses, firstCaseOnly || importDebug ? 0 : 4);
} finally {
  if (browser) await browser.close();
  await new Promise((done) => server.close(done));
  await writeFile(
    resolve(artifacts, "results.json"),
    JSON.stringify(
      {
        passed,
        failures,
        errors,
        consoleErrors,
        requestedResources,
        forbidden,
        unexpectedHttpFailures,
        expectedFailureResponses,
        viewports,
        scope: firstCaseOnly
          ? "first_case_debug_only"
          : importDebug
            ? "source_and_import_debug_only"
            : "complete_20_cases",
        api: "mocked_local_fixtures",
        productionVerified: false,
        telegramSends: 0,
        providerCalls: 0,
      },
      null,
      2,
    ),
  );
}
console.log(`Academic TMA browser: ${passed} scenarios passed; fixtures only.`);
