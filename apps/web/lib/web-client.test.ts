import { afterEach, describe, expect, it, vi } from "vitest";
import { WebApiError, webErrorMessage, webRequest } from "./web-client.js";

describe("web AI routing policy errors", () => {
  it("explains saved policy denials without sending the owner through login again", () => {
    expect(
      webErrorMessage(new WebApiError(403, "ai_router_blocked")),
    ).toContain("настройки AI");
    expect(
      webErrorMessage(new WebApiError(403, "ai_router_consent_changed")),
    ).toContain("Настройки AI изменились");
    expect(
      webErrorMessage(new WebApiError(403, "ai_router_blocked")),
    ).not.toContain("/web");
  });
  it("retains login guidance for genuine and unknown authorization errors", () => {
    for (const status of [401, 403])
      expect(
        webErrorMessage(new WebApiError(status, "invalid_web_session")),
      ).toContain("/web");
    expect(
      webErrorMessage(new WebApiError(403, "secret raw error")),
    ).not.toContain("secret");
    expect(
      webErrorMessage(new WebApiError(401, "ai_router_blocked")),
    ).toContain("/web");
  });
});

describe("web bridge response handling", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("keeps an HTML outage distinct from an expired browser session", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response("Service unavailable", {
          status: 503,
          headers: { "content-type": "text/html" },
        }),
    );
    await expect(webRequest("study")).rejects.toMatchObject({
      status: 503,
      code: "invalid_api_response",
    });
  });
  it("recognizes the access page after a session expires", async () => {
    vi.stubGlobal("window", { location: { origin: "https://lifeos.example" } });
    vi.stubGlobal("fetch", async () => ({
      redirected: true,
      url: "https://lifeos.example/web/access",
    }));
    await expect(webRequest("study")).rejects.toMatchObject({
      status: 401,
      code: "invalid_web_session",
    });
  });
});
