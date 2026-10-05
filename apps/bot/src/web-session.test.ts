import { describe, expect, it } from "vitest";
import { createWebSessionToken, verifyWebSessionToken } from "./web-session.js";

describe("web session tokens", () => {
  it("binds a signed token to one user and expires it", () => {
    const token = createWebSessionToken("user-1", "secret", 60, 1_000);

    expect(verifyWebSessionToken(token, "secret", 1_001)?.userId).toBe("user-1");
    expect(verifyWebSessionToken(token, "wrong-secret", 1_001)).toBeNull();
    expect(verifyWebSessionToken(token, "secret", 1_061)).toBeNull();
  });

  it("rejects tampering", () => {
    const token = createWebSessionToken("user-1", "secret", 60, 1_000);
    expect(verifyWebSessionToken(`${token}x`, "secret", 1_001)).toBeNull();
  });
});
