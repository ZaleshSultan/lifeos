import { describe, expect, it } from "vitest";
import { bridgeQuery, bridgeResourceAllowed } from "./bridge-policy";
describe("web resource boundary", () => {
  it("allows existing scoped workflows and rejects credential/admin/arbitrary destinations", () => {
    expect(bridgeResourceAllowed("ideal-human/days", "PUT")).toBe(true);
    expect(bridgeResourceAllowed("ideal-human/reflection/clear", "POST")).toBe(
      true,
    );
    for (const method of ["GET", "PUT", "PATCH", "DELETE"])
      expect(
        bridgeResourceAllowed("ideal-human/reflection/clear", method),
      ).toBe(false);
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

  it("allows router policy and offline preview but never keys, OAuth or inference-control endpoints", () => {
    for (const method of ["GET", "PUT"])
      expect(bridgeResourceAllowed("ai/router/settings", method)).toBe(true);
    expect(bridgeResourceAllowed("ai/router/preview", "POST")).toBe(true);
    for (const method of ["POST", "PATCH", "DELETE"])
      expect(bridgeResourceAllowed("ai/router/settings", method)).toBe(false);
    for (const method of ["GET", "PUT", "PATCH", "DELETE"])
      expect(bridgeResourceAllowed("ai/router/preview", method)).toBe(false);
    for (const path of [
      "ai/router/credentials",
      "ai/router/keys",
      "ai/router/connect",
      "ai/router/execute",
      "ai/router/admin",
      "ai/router/oauth/callback",
      "ai/router/settings/other-owner",
      "ai/router/settings?user_id=other",
      "https://untrusted.example/ai/router/settings",
    ])
      for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"])
        expect(bridgeResourceAllowed(path, method)).toBe(false);
  });

  it("allows only owned capture workflow resources with private search in a POST body", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    for (const method of ["GET", "POST"])
      expect(bridgeResourceAllowed("captures", method)).toBe(true);
    for (const resource of ["captures/capabilities", "captures/memories"]) {
      expect(bridgeResourceAllowed(resource, "GET")).toBe(true);
      expect(bridgeResourceAllowed(resource, "POST")).toBe(false);
    }
    expect(bridgeResourceAllowed("captures/search", "POST")).toBe(true);
    expect(bridgeResourceAllowed("captures/search", "GET")).toBe(false);
    for (const method of ["GET", "PATCH", "DELETE"])
      expect(bridgeResourceAllowed(`captures/${id}`, method)).toBe(true);
    for (const verb of ["process", "confirm", "cancel", "retry", "archive"]) {
      expect(bridgeResourceAllowed(`captures/${id}/${verb}`, "POST")).toBe(
        true,
      );
      expect(bridgeResourceAllowed(`captures/${id}/${verb}`, "GET")).toBe(
        false,
      );
    }
    for (const path of [
      "captures/voice/upload",
      "captures/admin",
      "captures/keys",
      `captures/${id}/execute`,
      `captures/${id}/audio`,
      "captures/../session",
      `captures/${"-".repeat(36)}`,
      `captures/${id}/confirm/extra`,
    ]) {
      for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"])
        expect(bridgeResourceAllowed(path, method)).toBe(false);
    }
    expect(
      bridgeQuery(new URLSearchParams("query=private-thought")),
    ).toBeNull();
    expect(bridgeQuery(new URLSearchParams("captureId=" + id))).toBeNull();
  });
});
