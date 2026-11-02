import { describe, expect, it } from "vitest";
import { createBotDependencies } from "./dependencies.js";

const url = "https://example.supabase.co";

describe("production backend database identity", () => {
  it("rejects anon-only production configuration instead of silently reading an RLS-filtered database", () => {
    expect(() =>
      createBotDependencies({
        NODE_ENV: "production",
        SUPABASE_URL: url,
        SUPABASE_ANON_KEY: "test-only-anon-key",
      }),
    ).toThrow("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("creates the configured production service-role boundary without an anon key", () => {
    const dependencies = createBotDependencies({
      NODE_ENV: "production",
      SUPABASE_URL: url,
      SUPABASE_SERVICE_ROLE_KEY: "test-only-service-role-key",
    });
    expect(dependencies.supabase).toBeDefined();
    expect(dependencies.store).toBeDefined();
  });

  it("preserves explicitly unconfigured health-only and local development behavior", () => {
    expect(createBotDependencies({ NODE_ENV: "production" })).toEqual({});
    expect(
      createBotDependencies({
        NODE_ENV: "development",
        SUPABASE_URL: url,
        SUPABASE_ANON_KEY: "test-only-anon-key",
      }).store,
    ).toBeDefined();
  });
});
