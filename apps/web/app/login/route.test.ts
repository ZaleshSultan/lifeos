import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const loginToken = "initial-signed-login-token";
const sessionToken = `ws1_${"a".repeat(43)}`;
const expiresAt = new Date(Date.now() + 29 * 24 * 60 * 60 * 1000).toISOString();
const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("LIFEOS_API_BASE_URL", "https://api.example");
  vi.stubEnv("NEXT_PUBLIC_WEB_APP_URL", "https://lifeos.example/web");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
});
const request = (token: string = loginToken) =>
  new NextRequest(
    `https://internal.invalid/web/login?token=${encodeURIComponent(token)}&next=https://attacker.invalid`,
    {
      headers: { cookie: "lifeos_web_session=attacker-chosen-value" },
    },
  );
describe("web login exchange route", () => {
  it("sets a fresh secure host-only cookie and strips credentials from the redirect", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ data: { token: sessionToken, expiresAt } }),
    );
    const response = await GET(request());
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example/api/web/auth/exchange",
      expect.objectContaining({
        method: "POST",
        headers: { authorization: `Bearer ${loginToken}` },
        cache: "no-store",
        redirect: "error",
      }),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://lifeos.example/web/today",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    const cookie = response.cookies.get("lifeos_web_session");
    expect(cookie).toMatchObject({
      value: sessionToken,
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    });
    expect(cookie?.maxAge).toBeLessThanOrEqual(30 * 24 * 60 * 60);
    expect(cookie?.domain).toBeUndefined();
    expect(response.headers.get("set-cookie")).not.toContain(loginToken);
    expect(response.headers.get("set-cookie")).not.toContain(
      "attacker-chosen-value",
    );
  });
  it.each([401, 403, 503])(
    "rejects expired/reused/invalid or unavailable exchanges (%s)",
    async (status) => {
      fetchMock.mockResolvedValue(
        Response.json({ error: "invalid_web_login" }, { status }),
      );
      const response = await GET(request());
      expect(response.headers.get("location")).toBe(
        "https://lifeos.example/web/access?error=invalid",
      );
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(response.headers.get("cache-control")).toBe("no-store");
    },
  );
  it("fails closed on malformed responses or network failures", async () => {
    for (const data of [
      { token: loginToken, expiresAt },
      { token: sessionToken, expiresAt: "invalid" },
      { token: sessionToken, expiresAt: new Date(0).toISOString() },
    ]) {
      fetchMock.mockResolvedValueOnce(Response.json({ data }));
      expect((await GET(request())).headers.get("set-cookie")).toBeNull();
    }
    fetchMock.mockRejectedValueOnce(new Error(loginToken));
    expect((await GET(request())).headers.get("set-cookie")).toBeNull();
  });
  it("rejects missing and oversized tokens without contacting the backend", async () => {
    await GET(request(""));
    await GET(request("a".repeat(1025)));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
