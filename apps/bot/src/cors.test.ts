import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { LifeOSStore } from "@lifeos/db";
import { createBotServer } from "./server.js";
import { corsOrigins } from "./cors.js";
import { loadBotConfig } from "./config.js";
const servers: ReturnType<typeof createBotServer>[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections();
        }),
    ),
  );
});
async function fixture(dev = false) {
  const server = createBotServer({
    config: {
      corsAllowedOrigins: ["https://tma.example.com"],
      allowUnsafeTmaDevAuth: dev,
      lifeosDefaultUserId: "user-1",
    },
    store: {} as LifeOSStore,
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
describe("API CORS", () => {
  it("allows a configured origin but still requires authentication", async () => {
    const url = await fixture();
    const response = await fetch(`${url}/api/tma/home`, {
      headers: { origin: "https://tma.example.com" },
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://tma.example.com",
    );
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
    expect(response.headers.get("vary")).toContain("Origin");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it.each(["https://evil.example", "https://tma.example.com.evil", "null"])(
    "rejects untrusted origin %s",
    async (origin) => {
      const url = await fixture();
      const response = await fetch(`${url}/api/tma/home`, {
        headers: { origin },
      });
      expect(response.status).toBe(403);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
      expect(response.headers.get("vary")).toContain("Origin");
    },
  );
  it("preserves same-origin and no-Origin server requests with auth", async () => {
    const url = await fixture(true);
    // An authenticated unmatched TMA route reaches the router (404, not a CORS/auth error).
    for (const headers of [new Headers({ origin: url }), new Headers()]) {
      const response = await fetch(`${url}/api/tma/missing`, { headers });
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });
  it("allows required methods/headers on TMA preflight", async () => {
    const url = await fixture();
    const response = await fetch(`${url}/api/tma/workout/program`, {
      method: "OPTIONS",
      headers: {
        origin: "https://tma.example.com",
        "access-control-request-method": "PUT",
        "access-control-request-headers":
          "Authorization, Content-Type, X-Telegram-Init-Data",
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toContain(
      "PUT",
    );
    expect(response.headers.get("access-control-allow-headers")).not.toContain(
      "secret-token",
    );
    expect(response.headers.get("vary")).toContain(
      "Access-Control-Request-Headers",
    );
  });
  it.each([
    ["/api/health/ingest", "DELETE", "authorization"],
    ["/api/tma/home", "TRACE", "authorization"],
    ["/api/tma/home", "POST", "x-telegram-bot-api-secret-token"],
    ["/api/web/auth/exchange", "POST", "content-type"],
  ])("rejects unsupported preflight %s %s %s", async (path, method, header) => {
    const url = await fixture();
    expect(
      (
        await fetch(url + path, {
          method: "OPTIONS",
          headers: {
            origin: "https://tma.example.com",
            "access-control-request-method": method,
            "access-control-request-headers": header,
          },
        })
      ).status,
    ).toBe(403);
  });
  it("supports the health alias and preserves server-only web exchange", async () => {
    const url = await fixture();
    expect(
      (
        await fetch(`${url}/health/ingest`, {
          method: "OPTIONS",
          headers: {
            origin: "https://tma.example.com",
            "access-control-request-method": "POST",
            "access-control-request-headers": "authorization,content-type",
          },
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await fetch(`${url}/api/web/auth/exchange`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        })
      ).status,
    ).toBe(503); // reaches auth configuration
  });
  it("validates configured origins without wildcard or URL normalization surprises", () => {
    expect(
      loadBotConfig({
        LIFEOS_CORS_ALLOWED_ORIGINS:
          "https://tma.example.com, https://web.example.com",
      }).corsAllowedOrigins,
    ).toHaveLength(2);
    for (const value of [
      "*",
      "null",
      "https://x.test/",
      "https://x.test/path",
      "https://user@x.test",
      "http://x.test",
    ])
      expect(() => corsOrigins([value])).toThrow();
    expect(corsOrigins(["http://localhost:5173"], "development").size).toBe(1);
    expect(() =>
      corsOrigins(["http://localhost:5173"], "production"),
    ).toThrow();
  });
});
