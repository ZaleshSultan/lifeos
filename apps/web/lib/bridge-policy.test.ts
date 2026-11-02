import { describe, expect, it } from "vitest";
import { bridgeQuery, bridgeResourceAllowed } from "./bridge-policy";
describe("web resource boundary", () => {
  it("allows existing scoped workflows and rejects credential/admin/arbitrary destinations", () => {
    expect(bridgeResourceAllowed("ideal-human/days", "PUT")).toBe(true);
    expect(bridgeResourceAllowed("lms/work", "GET")).toBe(true);
    expect(bridgeResourceAllowed("hydration/entry-1/undo", "POST")).toBe(true);
    for (const path of [
      "lms/session",
      "lms/validate",
      "health/ingest-token",
      "health/devices",
      "https://attacker.invalid",
      "../session",
      "users",
      "web/auth/exchange",
      "sources/token",
    ])
      for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"])
        expect(bridgeResourceAllowed(path, method)).toBe(false);
    expect(bridgeResourceAllowed("lms/connection", "POST")).toBe(false);
    expect(bridgeResourceAllowed("ideal-human/days", "DELETE")).toBe(false);
  });
  it("permits only one bounded date query and rejects identity or destination parameters", () => {
    expect(bridgeQuery(new URLSearchParams("date=2026-11-03"))).toBe(
      "date=2026-11-03",
    );
    expect(bridgeQuery(new URLSearchParams())).toBe("");
    for (const value of [
      "user_id=other",
      "url=https://attacker.invalid",
      "date=invalid",
      "date=2026-11-03&date=2026-11-04",
    ])
      expect(bridgeQuery(new URLSearchParams(value))).toBeNull();
  });
});
