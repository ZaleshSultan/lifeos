// Staged production TMA only; every API call is fulfilled by local private fixtures.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { captureBrowserFixture } from "./capture-browser-fixtures.mjs";
import { captureBrowserScenarios } from "./capture-browser-scenarios.mjs";
const { chromium } = await import(
  process.env.LIFEOS_PLAYWRIGHT_MODULE || "playwright"
);
if (!process.env.LIFEOS_TMA_DIST)
  throw new Error("Set LIFEOS_TMA_DIST to the staged /tma/ build.");
const root = resolve(process.env.LIFEOS_TMA_DIST);
const artifacts = resolve(
  process.env.LIFEOS_CAPTURE_BROWSER_ARTIFACTS || "/tmp/lifeos-capture-browser",
);
await mkdir(artifacts, { recursive: true });
const server = createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(
      new URL(request.url, "http://fixture").pathname,
    );
    const file = resolve(root, path.replace(/^\/tma\/?/, "") || "index.html");
    if (!file.startsWith(root + "/")) throw new Error("invalid_path");
    const body = await readFile(file);
    response.writeHead(200, {
      "content-type":
        { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" }[
          extname(file)
        ] || "application/octet-stream",
    });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("missing");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
let passed = 0;
const errors = [],
  forbidden = [],
  failures = [];
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.LIFEOS_CHROMIUM_EXECUTABLE || undefined,
    timeout: 180000,
    args: ["--no-sandbox", "--renderer-process-limit=1"],
  });
  for (const width of [320, 390]) {
    const fixture = captureBrowserFixture();
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      timezoneId: "Asia/Almaty",
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.on("pageerror", (error) => errors.push(error.message));
    await context.addInitScript(() => {
      window.__captureMicCalls = 0;
      if (navigator.mediaDevices)
        navigator.mediaDevices.getUserMedia = () => {
          window.__captureMicCalls++;
          throw new Error("microphone_requested_without_consent");
        };
    });
    await page.route("**/*", async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      if (!url.pathname.startsWith("/api/tma/")) {
        if (url.origin === origin) return route.continue();
        forbidden.push(url.origin + url.pathname);
        return route.abort();
      }
      const cors = {
        "access-control-allow-origin": origin,
        "access-control-allow-headers": "content-type,x-telegram-init-data",
        "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
      };
      if (request.method() === "OPTIONS")
        return route.fulfill({ status: 204, headers: cors });
      let result;
      if (url.pathname === "/api/tma/session")
        result = {
          status: 200,
          body: {
            data: {
              state: "active",
              telegramUserId: 12345,
              displayName: "Capture fixture owner",
              profile: { role: "user", status: "active" },
              integrations: {
                telegram: { connected: true },
                google: { connected: false },
                obsidian: { connected: false },
                health: { connected: false },
              },
            },
          },
        };
      else
        result = await fixture.response(
          url.pathname.slice("/api/tma/".length),
          request.method(),
          request.postData() ? JSON.parse(request.postData()) : {},
        );
      if (!result) {
        forbidden.push(url.pathname);
        return route.abort();
      }
      return route.fulfill({
        status: result.status,
        contentType: "application/json",
        headers: { ...cors, "cache-control": "no-store" },
        body: JSON.stringify(result.body),
      });
    });
    const test = async (name, work) => {
      try {
        await work();
        passed++;
        console.log("PASS " + name);
      } catch (error) {
        failures.push({ name, error: error.message });
        throw error;
      }
    };
    try {
      await captureBrowserScenarios({
        page,
        fixture,
        prefix: `TMA ${width}px`,
        test,
        open: () => page.goto(origin + "/tma/?screen=capture"),
      });
      assert.equal(await page.evaluate(() => window.__captureMicCalls), 0);
      await page.screenshot({
        path: resolve(artifacts, `capture-${width}.png`),
        fullPage: true,
      });
    } finally {
      await context.close();
    }
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(forbidden, []);
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await writeFile(
    resolve(artifacts, "results.json"),
    JSON.stringify(
      {
        passed,
        failures,
        errors,
        forbidden,
        providerCalls: 0,
        api: "mocked_local_fixtures",
        productionVerified: false,
      },
      null,
      2,
    ),
  );
}
console.log(
  `Capture TMA browser: ${passed} scenarios passed; mocked APIs, no provider calls.`,
);
