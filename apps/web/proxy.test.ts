import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config, proxy } from "./proxy";

const token = `ws1_${"p".repeat(43)}`;
const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubEnv("LIFEOS_API_BASE_URL", "https://api.example");
  vi.stubEnv("NEXT_PUBLIC_WEB_APP_URL", "https://lifeos.example/web");
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
});
const request = () =>
  new NextRequest("https://lifeos.example/web/today?_rsc=test", {
    headers: { cookie: `lifeos_web_session=${token}`, rsc: "1" },
  });
describe("web authorization proxy", () => {
  it("matches dashboard, future routes and RSC requests while allowing public login/assets", () => {
    for (const path of [
      "/",
      "/today",
      "/health",
      "/finance",
      "/study",
      "/settings",
      "/future",
      "/today?_rsc=test",
      "/access-extra",
    ]) {
      expect(
        unstable_doesMiddlewareMatch({
          config,
          nextConfig: { basePath: "/web" },
          url: `/web${path}`,
        }),
      ).toBe(true);
    }
    for (const path of [
      "/access",
      "/login?token=test",
      "/logout",
      "/_next/static/a.js",
      "/favicon.ico",
    ]) {
      expect(
        unstable_doesMiddlewareMatch({
          config,
          nextConfig: { basePath: "/web" },
          url: `/web${path}`,
        }),
      ).toBe(false);
    }
  });
  it("checks every request and rejects a session revoked between requests", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ data: { state: "active" } }),
    );
    const allowed = await proxy(request());
    expect(allowed.headers.get("x-middleware-next")).toBe("1");
    expect(allowed.headers.get("cache-control")).toBe("no-store");
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    expect((await proxy(request())).headers.get("location")).toBe(
      "https://lifeos.example/web/access",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it.each(["blocked", "pending", "unregistered"])(
    "rejects state %s even on an HTTP 200 response",
    async (state) => {
      fetchMock.mockResolvedValue(Response.json({ data: { state } }));
      expect((await proxy(request())).headers.get("location")).toBe(
        "https://lifeos.example/web/access",
      );
    },
  );
  it("fails closed without a cookie or when verification is unavailable", async () => {
    expect(
      (await proxy(new NextRequest("https://lifeos.example/web/finance")))
        .status,
    ).toBe(303);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRejectedValue(new Error("offline"));
    expect((await proxy(request())).status).toBe(303);
  });
});
