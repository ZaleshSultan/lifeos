import { describe, expect, it } from "vitest";
import {
  AITU_BROWSER_SIGN_IN_URL,
  aituAuthorizationGuidance,
  parseAituAuthorizationGuidance,
} from "./aitu-authorization.js";
const now = Date.parse("2026-11-03T03:00:00Z");
const connected = {
  configured: true,
  state: "connected",
  lastSyncSuccessAt: "2026-11-03T02:00:00Z",
  lastErrorCategory: null,
};
describe("AITU authorization capability and freshness", () => {
  it("separates genuine institutional sign-in from integration authorization", () => {
    const result = aituAuthorizationGuidance(connected, now);
    expect(result.automaticConnection).toBe("blocked");
    expect(result.browserSignInTransfersAccess).toBe(false);
    expect(result.browserSignInUrl).toBe(AITU_BROWSER_SIGN_IN_URL);
    expect(result.verification).toBe("public_unauthenticated_probe");
    expect(result.blockers).toContain("institution_api_grant_required");
    expect(result.reconnectRequired).toBe(false);
    expect(result.syncFreshness).toBe("recent");
  });
  it("keeps old sync evidence visible while marking expired access stale", () => {
    const result = aituAuthorizationGuidance(
      { ...connected, configured: false, state: "session_expired" },
      now,
    );
    expect(result.reconnectRequired).toBe(true);
    expect(result.syncFreshness).toBe("stale");
    expect(connected.lastSyncSuccessAt).toBe("2026-11-03T02:00:00Z");
  });
  it("does not infer missing or malformed synchronization timestamps", () => {
    expect(
      aituAuthorizationGuidance({ ...connected, lastSyncSuccessAt: null }, now)
        .syncFreshness,
    ).toBe("never_synced");
    expect(
      aituAuthorizationGuidance(
        { ...connected, lastSyncSuccessAt: "invalid" },
        now,
      ).syncFreshness,
    ).toBe("unknown");
    expect(
      aituAuthorizationGuidance(
        { ...connected, lastSyncSuccessAt: "2026-11-04T00:00:00Z" },
        now,
      ).syncFreshness,
    ).toBe("unknown");
    expect(
      aituAuthorizationGuidance(
        { ...connected, lastSyncSuccessAt: "2026-11-02T20:00:00Z" },
        now,
      ).syncFreshness,
    ).toBe("stale");
  });
  it("projects approved public metadata without raw fields", () => {
    const result = aituAuthorizationGuidance(connected, now);
    expect(
      parseAituAuthorizationGuidance({
        ...result,
        cookie: "secret",
        userId: "owner",
      }),
    ).toEqual(result);
  });
  it.each([
    { version: 2 },
    { browserSignInUrl: "https://evil.example/login" },
    { browserSignInTransfersAccess: true },
    { automaticConnection: "connected" },
    { blockers: ["cookie-secret"] },
    { verifiedAt: "unverified" },
  ])("rejects URL overrides and unverifiable capabilities %j", (patch) => {
    expect(
      parseAituAuthorizationGuidance({
        ...aituAuthorizationGuidance(connected, now),
        ...patch,
      }),
    ).toBeUndefined();
  });
});
