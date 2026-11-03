import { describe, expect, it } from "vitest";
import { WebApiError, webErrorMessage } from "./web-client.js";

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
