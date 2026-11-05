import { describe, expect, it } from "vitest";
import { aiProviderRetryAfter } from "./ai-provider-quota.js";
const NOW = Date.parse("2026-11-04T08:00:00Z");
describe("bounded Retry-After interpretation", () => {
  it("honors seconds and exact HTTP dates without logging a header", () => {
    expect(aiProviderRetryAfter("120", NOW)).toEqual({
      retryAt: "2026-11-04T08:02:00.000Z",
      reviewRequired: false,
    });
    expect(
      aiProviderRetryAfter("Wed, 04 Nov 2026 08:03:00 GMT", NOW).retryAt,
    ).toBe("2026-11-04T08:03:00.000Z");
    expect(
      aiProviderRetryAfter("Wednesday, 04-Nov-26 08:03:00 GMT", NOW).retryAt,
    ).toBe("2026-11-04T08:03:00.000Z");
    expect(aiProviderRetryAfter("Wed Nov  4 08:03:00 2026", NOW).retryAt).toBe(
      "2026-11-04T08:03:00.000Z",
    );
    expect(aiProviderRetryAfter("0", NOW).retryAt).toBe(
      "2026-11-04T08:00:01.000Z",
    );
  });
  it.each([null, "", "-1", "1.5", "private-provider-body", "2026-11-04"])(
    "uses a conservative bound for %s",
    (value) => {
      expect(aiProviderRetryAfter(value, NOW)).toEqual({
        retryAt: "2026-11-04T08:01:00.000Z",
        reviewRequired: false,
      });
    },
  );
  it("requires review instead of shortening a very long valid wait", () => {
    expect(aiProviderRetryAfter("999999999999999999999", NOW)).toEqual({
      retryAt: null,
      reviewRequired: true,
    });
    expect(aiProviderRetryAfter("40000000", NOW)).toEqual({
      retryAt: null,
      reviewRequired: true,
    });
    expect(aiProviderRetryAfter("x".repeat(129), NOW)).toEqual({
      retryAt: null,
      reviewRequired: true,
    });
    expect(() => aiProviderRetryAfter("1", NaN)).toThrow("invalid_quota_clock");
  });
});
