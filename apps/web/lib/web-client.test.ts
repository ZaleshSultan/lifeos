import { afterEach, describe, expect, it, vi } from "vitest";
import { WebApiError, webErrorMessage, webRequest } from "./web-client.js";
afterEach(() => vi.unstubAllGlobals());

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
describe("authenticated draft invalidation", () => {
  it("clears retained memory when the authenticated session is rejected", async () => {
    const events = new EventTarget();
    let rejected = 0;
    events.addEventListener("lifeos:session-rejected", () => rejected++);
    vi.stubGlobal("window", events);
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify({ error: "invalid_web_session" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
    );
    await expect(webRequest("tasks")).rejects.toMatchObject({ status: 401 });
    expect(rejected).toBe(1);
  });
  it("preserves drafts after a model-policy denial within a valid session", async () => {
    const events = new EventTarget();
    let rejected = 0;
    events.addEventListener("lifeos:session-rejected", () => rejected++);
    vi.stubGlobal("window", events);
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify({ error: "ai_router_blocked" }), {
          status: 403,
          headers: { "content-type": "application/json" },
        }),
    );
    await expect(webRequest("ai/chat")).rejects.toMatchObject({ status: 403 });
    expect(rejected).toBe(0);
  });
});
