import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
// Run after the production web build. Uses only local mock data and a clean env.
const workspace = fileURLToPath(new URL("..", import.meta.url));
const login = "test-only-initial-exchange";
const session = `ws1_${"s".repeat(43)}`;
let used = false,
  live = false,
  blocked = false;
const backend = createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  const auth = req.headers.authorization;
  if (req.url === "/healthz") return res.end("{}");
  if (req.url === "/api/web/auth/exchange") {
    if (auth !== `Bearer ${login}` || used) {
      res.writeHead(401);
      return res.end("{}");
    }
    used = true;
    live = true;
    return res.end(
      JSON.stringify({
        data: {
          token: session,
          expiresAt: new Date(Date.now() + 2592000000).toISOString(),
        },
      }),
    );
  }
  if (req.url === "/api/web/auth/logout") {
    live = false;
    res.writeHead(204);
    return res.end();
  }
  if (!live || blocked || auth !== `Bearer ${session}`) {
    res.writeHead(401);
    return res.end("{}");
  }
  if (req.url === "/api/tma/session")
    return res.end(
      JSON.stringify({
        data: {
          state: "active",
          displayName: "Smoke user",
          profile: { status: "active", role: "user" },
          integrations: {
            telegram: { connected: true },
            google: { connected: false },
          },
        },
      }),
    );
  if (req.url === "/api/tma/home")
    return res.end(
      JSON.stringify({
        data: {
          displayName: "Smoke user",
          localDate: "2026-10-22",
          modeLabel: "Normal",
          modeReason: "Smoke test",
          recoveryMode: "normal",
          focusScore: 10,
        },
      }),
    );
  res.writeHead(404);
  res.end("{}");
});
await new Promise((r) => backend.listen(0, "127.0.0.1", r));
const reservation = createServer();
await new Promise((r) => reservation.listen(0, "127.0.0.1", r));
const port = reservation.address().port;
await new Promise((r) => reservation.close(r));
const origin = `http://127.0.0.1:${port}`;
let logs = "";
const app = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "-H",
    "127.0.0.1",
    "-p",
    String(port),
  ],
  {
    cwd: `${workspace}/apps/web`,
    env: {
      PATH: process.env.PATH,
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      NEXT_PUBLIC_WEB_APP_URL: `${origin}/web`,
      LIFEOS_API_BASE_URL: `http://127.0.0.1:${backend.address().port}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
app.stdout.on("data", (data) => {
  logs += data;
});
app.stderr.on("data", (data) => {
  logs += data;
});
const location = (response) =>
  new URL(response.headers.get("location"), origin).href;
const request = (path, options = {}) =>
  fetch(origin + path, { redirect: "manual", ...options });
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await request("/web/access");
      if (r.status === 200) {
        ready = true;
        break;
      }
    } catch {}
    await delay(250);
  }
  assert.ok(ready, "production app started");
  for (const path of [
    "/web/today",
    "/web/finance",
    "/web/health",
    "/web/settings",
    "/web/study",
  ]) {
    const denied = await request(path);
    assert.equal(denied.status, 303);
    assert.equal(location(denied), origin + "/web/access");
  }
  const initial = await request("/web/login?token=" + login);
  assert.equal(initial.status, 303);
  assert.equal(location(initial), origin + "/web/today");
  assert.equal(initial.headers.get("referrer-policy"), "no-referrer");
  assert.equal(initial.headers.get("cache-control"), "no-store");
  const cookie = initial.headers.get("set-cookie");
  for (const attribute of ["HttpOnly", "Secure", "SameSite=lax", "Path=/"])
    assert.ok(cookie.includes(attribute));
  assert.ok(!cookie.includes(login));
  const headers = { cookie: `lifeos_web_session=${session}` };
  const dashboard = await request("/web/today", { headers });
  assert.equal(dashboard.status, 200);
  assert.ok((await dashboard.text()).includes("Smoke user"));
  const replay = await request("/web/login?token=" + login);
  assert.equal(location(replay), origin + "/web/access?error=invalid");
  assert.equal(replay.headers.get("set-cookie"), null);
  const csrf = await request("/web/logout", {
    method: "POST",
    headers: { ...headers, origin: "https://attacker.invalid" },
  });
  assert.equal(csrf.status, 403);
  assert.equal(live, true);
  blocked = true;
  const blockedResponse = await request("/web/today?_rsc=test", {
    headers: { ...headers, rsc: "1" },
  });
  assert.equal(blockedResponse.status, 303);
  blocked = false;
  const logout = await request("/web/logout", {
    method: "POST",
    headers: { ...headers, origin },
  });
  assert.equal(logout.status, 303);
  assert.ok(logout.headers.get("set-cookie").includes("Max-Age=0"));
  assert.equal(live, false);
  const revoked = await request("/web/today", { headers });
  assert.equal(revoked.status, 303);
  assert.ok(
    !logs.includes(login) && !logs.includes(session),
    "no raw tokens in production logs",
  );
  console.log(
    "PASS: built Next.js login, Secure/HttpOnly cookie, clean redirects, protected HTML/RSC, replay, CSRF, block, logout, revoked-cookie replay and no raw token logs (local mock backend only)",
  );
} finally {
  app.kill("SIGTERM");
  await new Promise((r) => (app.exitCode !== null ? r() : app.once("exit", r)));
  backend.closeAllConnections();
  await new Promise((r) => backend.close(r));
}
