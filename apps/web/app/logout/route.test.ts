import { afterEach, describe, expect, it, vi } from "vitest";
import * as logoutRoute from "./route";
import { NextRequest } from "next/server";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("web logout", () => {
  it("does not expose a GET handler that link prefetch can invoke", () => {
    expect(logoutRoute).not.toHaveProperty("GET");
  });

  it("redirects POST to the public access page with an uncached 303 response", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_WEB_APP_URL", "https://lifeos.example/web/");

    const response = await logoutRoute.POST(
      new NextRequest("https://lifeos.example/web/logout", { method: "POST" }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://lifeos.example/web/access",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("expires the production session cookie using the original cookie scope", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const response = await logoutRoute.POST(
      new NextRequest("https://lifeos.example/web/logout", { method: "POST" }),
    );

    expect(response.cookies.get("lifeos_web_session")).toMatchObject({
      name: "lifeos_web_session",
      value: "",
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
    const cookie = response.headers.get("set-cookie");
    expect(cookie).toContain("lifeos_web_session=;");
    expect(cookie).toContain("Path=/;");
    expect(cookie).toContain("Max-Age=0;");
    expect(cookie).toContain("HttpOnly;");
    expect(cookie).toContain("Secure;");
    expect(cookie).toContain("SameSite=lax");
  });

  it("keeps local HTTP logout usable outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");

    const response = await logoutRoute.POST(
      new NextRequest("https://lifeos.example/web/logout", { method: "POST" }),
    );

    expect(response.cookies.get("lifeos_web_session")).toMatchObject({
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
    expect(response.headers.get("set-cookie")).not.toMatch(
      /;\s*Secure(?:;|$)/i,
    );
  });

  it("uses the public /web base path when no public URL is configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_WEB_APP_URL", "");

    const response = await logoutRoute.POST(
      new NextRequest("https://lifeos.example/web/logout", { method: "POST" }),
    );

    expect(response.headers.get("location")).toBe(
      "https://lifeos.zalewko.me/web/access",
    );
  });
});

describe("server-side logout", () => {
  const token = `ws1_${"s".repeat(43)}`;
  const request = (origin = "https://lifeos.example") =>
    new NextRequest("https://lifeos.example/web/logout", {
      method: "POST",
      headers: { origin, cookie: `lifeos_web_session=${token}` },
    });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it("revokes the credential before clearing the cookie", async () => {
    vi.stubEnv("NEXT_PUBLIC_WEB_APP_URL", "https://lifeos.example/web");
    vi.stubEnv("LIFEOS_API_BASE_URL", "https://api.example");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await logoutRoute.POST(request());
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example/api/web/auth/logout",
      expect.objectContaining({
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
        redirect: "error",
      }),
    );
    expect(response.status).toBe(303);
    expect(response.cookies.get("lifeos_web_session")?.maxAge).toBe(0);
  });
  it("preserves the cookie and reports failure if revocation cannot complete", async () => {
    vi.stubEnv("NEXT_PUBLIC_WEB_APP_URL", "https://lifeos.example/web");
    vi.stubEnv("LIFEOS_API_BASE_URL", "https://api.example");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 503 })),
    );
    const response = await logoutRoute.POST(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).not.toContain(token);
  });
  it.each([
    "https://evil.example",
    "https://sibling.lifeos.example",
    "null",
    "",
  ])("rejects logout from origin %s", async (origin) => {
    vi.stubEnv("NEXT_PUBLIC_WEB_APP_URL", "https://lifeos.example/web");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await logoutRoute.POST(request(origin))).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
