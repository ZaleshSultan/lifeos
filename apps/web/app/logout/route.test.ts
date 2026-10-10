import { afterEach, describe, expect, it, vi } from "vitest";
import * as logoutRoute from "./route";

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

    const response = await logoutRoute.POST();

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://lifeos.example/web/access",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("expires the production session cookie using the original cookie scope", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const response = await logoutRoute.POST();

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

    const response = await logoutRoute.POST();

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

    const response = await logoutRoute.POST();

    expect(response.headers.get("location")).toBe(
      "https://lifeos.zalewko.me/web/access",
    );
  });
});
