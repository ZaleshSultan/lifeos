import { describe, expect, it } from "vitest";
import {
  createWebLoginToken,
  createWebSessionToken,
  verifyWebLoginToken,
  verifyWebSessionToken,
} from "./web-session.js";

describe("web session tokens", () => {
  it("binds a signed session token to one user and expires it", () => {
    const token = createWebSessionToken("user-1", "secret", 60, 1_000);

    expect(verifyWebSessionToken(token, "secret", 1_001)?.userId).toBe(
      "user-1",
    );
    expect(
      verifyWebSessionToken(token, "wrong-secret", 1_001),
    ).toBeNull();
    expect(verifyWebSessionToken(token, "secret", 1_061)).toBeNull();
  });

  it("separates short login tokens from browser sessions", () => {
    const login = createWebLoginToken("user-1", "secret", 300, 1_000);
    const session = createWebSessionToken("user-1", "secret", 3_600, 1_000);

    expect(verifyWebLoginToken(login, "secret", 1_001)?.userId).toBe(
      "user-1",
    );
    expect(verifyWebSessionToken(login, "secret", 1_001)).toBeNull();

    expect(verifyWebSessionToken(session, "secret", 1_001)?.userId).toBe(
      "user-1",
    );
    expect(verifyWebLoginToken(session, "secret", 1_001)).toBeNull();
  });

  it("rejects tampering", () => {
    const token = createWebSessionToken("user-1", "secret", 60, 1_000);
    expect(
      verifyWebSessionToken(`${token}x`, "secret", 1_001),
    ).toBeNull();
  });
});
