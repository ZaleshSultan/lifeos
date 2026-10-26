import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createWebLoginToken,
  createWebSessionToken,
  hashWebToken,
  isWebSessionToken,
  verifyWebLoginToken,
} from "./web-session.js";

const secret = "test-signing-secret";
const sign = (payload: unknown) => {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${createHmac("sha256", secret).update(encoded).digest("base64url")}`;
};
describe("web credentials", () => {
  it("bounds login tokens to 120 seconds and rejects the exact expiry", () => {
    const token = createWebLoginToken("user-1", secret, 120, 1000);
    expect(verifyWebLoginToken(token, secret, 1119)?.userId).toBe("user-1");
    expect(verifyWebLoginToken(token, secret, 1120)).toBeNull();
    expect(() => createWebLoginToken("user-1", secret, 121)).toThrow();
  });
  it("rejects invalid signatures and ambiguous encodings", () => {
    const token = createWebLoginToken("user-1", secret, 120, 1000);
    for (const invalid of [
      token + "x",
      token + ".",
      token + "=",
      "malformed",
      "a".repeat(1025),
    ]) {
      expect(verifyWebLoginToken(invalid, secret, 1001)).toBeNull();
    }
    expect(verifyWebLoginToken(token, "wrong-secret", 1001)).toBeNull();
    expect(verifyWebLoginToken(token, undefined, 1001)).toBeNull();
  });
  it("rejects old reusable sessions, wrong purpose, and invalid signed timestamps", () => {
    const valid = verifyWebLoginToken(
      createWebLoginToken("user-1", secret, 120, 1000),
      secret,
      1000,
    )!;
    for (const payload of [
      null,
      [],
      { userId: "user-1", issuedAt: 1000, expiresAt: 2000 },
      { ...valid, purpose: "web_session" },
      { ...valid, nonce: "" },
      { ...valid, expiresAt: 1121 },
      { ...valid, expiresAt: 999 },
      { ...valid, issuedAt: 1002 },
      { ...valid, issuedAt: 1000.5 },
      { ...valid, expiresAt: 1e100 },
      { ...valid, userId: 1 },
    ]) {
      expect(verifyWebLoginToken(sign(payload), secret, 1001)).toBeNull();
    }
  });
  it("generates independent random credentials and hashes", () => {
    const first = createWebLoginToken("user-1", secret, 120, 1000);
    const second = createWebLoginToken("user-1", secret, 120, 1000);
    expect(first).not.toBe(second);
    const sessions = Array.from({ length: 100 }, () => createWebSessionToken());
    expect(new Set(sessions).size).toBe(100);
    expect(sessions.every(isWebSessionToken)).toBe(true);
    expect(isWebSessionToken(first)).toBe(false);
    expect(verifyWebLoginToken(sessions[0], secret)).toBeNull();
    expect(hashWebToken(sessions[0])).toMatch(/^[a-f0-9]{64}$/);
  });
});
