import { afterEach, describe, expect, it, vi } from "vitest";
import { publicWebUrl } from "./web-auth";
afterEach(() => vi.unstubAllEnvs());
describe("trusted runtime web origin", () => {
  it("uses the server-only runtime base before the public build fallback", () => {
    vi.stubEnv("LIFEOS_WEB_APP_URL", "https://runtime.fixture.invalid/web");
    vi.stubEnv("NEXT_PUBLIC_WEB_APP_URL", "https://build.fixture.invalid/web");
    expect(publicWebUrl("today").href).toBe(
      "https://runtime.fixture.invalid/web/today",
    );
  });
  it("retains the existing public base when no server override is configured", () => {
    vi.stubEnv("LIFEOS_WEB_APP_URL", "");
    vi.stubEnv("NEXT_PUBLIC_WEB_APP_URL", "https://build.fixture.invalid/web");
    expect(publicWebUrl("access").href).toBe(
      "https://build.fixture.invalid/web/access",
    );
  });
  it("rejects credential-bearing, executable and query-bearing configuration without echoing it", () => {
    for (const base of [
      "https://username:private@fixture.invalid/web",
      "javascript:alert(1)",
      "https://username:private @invalid",
      "https://fixture.invalid/web?private=1",
    ]) {
      vi.stubEnv("LIFEOS_WEB_APP_URL", base);
      expect(() => publicWebUrl("access")).toThrow(
        "Invalid public web base configuration",
      );
    }
  });
});
