import { describe, expect, it } from "vitest";
import { bridgeQuery, bridgeResourceAllowed } from "./bridge-policy";

describe("academic concierge same-origin bridge allowlist", () => {
  it("allows only the reviewed owner API and methods", () => {
    const base = "study/concierge";
    const id = "11111111-1111-4111-8111-111111111111";
    for (const [path, method] of [
      [base, "GET"],
      [base + "/preferences", "PUT"],
      [base + "/import/preview", "POST"],
      [base + "/import/confirm", "POST"],
      [base + "/schedule/verify", "POST"],
      [base + `/events/${id}`, "PATCH"],
      [base + `/events/${id}/confirm`, "POST"],
      [base + `/events/${id}/cancel`, "POST"],
    ])
      expect(bridgeResourceAllowed(path, method)).toBe(true);
    for (const path of [
      base + "/credentials",
      base + "/events/other/confirm",
      base + `/events/${id}/delete`,
      base + "/../ai/chat",
      base + "/import/confirm/other",
      "https://evil.invalid/" + base,
      base + "/events/" + id + "%2fconfirm",
    ])
      expect(bridgeResourceAllowed(path, "POST")).toBe(false);
    expect(bridgeResourceAllowed(base + "/preferences", "GET")).toBe(false);
    expect(bridgeResourceAllowed(base + "/import/confirm", "DELETE")).toBe(
      false,
    );
    expect(bridgeQuery(new URLSearchParams("user_id=other"))).toBeNull();
  });
});
