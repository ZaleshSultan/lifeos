import { afterEach, describe, it, expect, vi } from "vitest";
import { decryptSecret, type LmsSessionStore } from "@lifeos/db";
import {
  LmsSessionService,
  parseLmsValidationResult,
  safeLmsAuthDiagnostics,
  validLmsCookie,
} from "./lms-sessions.js";
const services: LmsSessionService[] = [];
afterEach(() => {
  for (const s of services.splice(0)) s.close();
  vi.unstubAllEnvs();
});
function service(
  options: ConstructorParameters<typeof LmsSessionService>[0] = {},
) {
  const s = new LmsSessionService(options);
  services.push(s);
  return s;
}
const key = Buffer.alloc(32, 7);

describe("LMS bridge diagnostic boundary", () => {
  const event = { stage: "oidc_form_post", reason: "callback_invalid" } as const;
  const diagnostics = { ...event, events: [event] };

  it("accepts enum-only diagnostics on success and all fixed authentication outcomes", () => {
    expect(parseLmsValidationResult({ ok: true, diagnostics })).toEqual({ ok: true, diagnostics });
    for (const errorCategory of ["session_expired", "interactive_login_required", "unsupported_auth_flow", "connection_failed"]) {
      expect(parseLmsValidationResult({ ok: false, errorCategory, diagnostics })).toEqual({ ok: false, errorCategory, diagnostics });
    }
    expect(parseLmsValidationResult({ ok: false, errorCategory: "private-cookie" })).toBeUndefined();
    expect(parseLmsValidationResult({ ok: "true" })).toBeUndefined();
    expect(parseLmsValidationResult([])).toBeUndefined();
  });

  it("projects only fixed codes and drops malformed, oversized, or secret-bearing diagnostics", () => {
    expect(safeLmsAuthDiagnostics({
      ...diagnostics,
      cookie: "private-cookie",
      url: "https://login.microsoftonline.com/?code=private-code",
      events: [{ ...event, body: "private-html", form: { code: "private-code" } }],
    })).toEqual(diagnostics);
    for (const unsafe of [
      { ...diagnostics, stage: "private-cookie" },
      { ...diagnostics, reason: "https://login.microsoftonline.com/?code=private-code" },
      { ...diagnostics, events: [{ ...event, reason: "private-cookie" }] },
      { ...diagnostics, events: Array(33).fill(event) },
      { ...diagnostics, events: [] },
      null,
      [],
    ]) {
      expect(safeLmsAuthDiagnostics(unsafe)).toBeUndefined();
      expect(parseLmsValidationResult({ ok: false, errorCategory: "unsupported_auth_flow", diagnostics: unsafe })).toEqual({ ok: false, errorCategory: "unsupported_auth_flow" });
    }
  });
});

describe("LMS session validation receipts", () => {
  it("rejects malformed/header cookies without a network request", async () => {
    const validator = vi.fn(async () => ({ ok: true as const }));
    const s = service({ key, validator });
    for (const cookie of [
      "",
      null,
      "a;b",
      "a b",
      "a\nb",
      "a\\b",
      "a,b",
      '"abc"',
      "ESTSAUTHPERSISTENT=abc",
      "a".repeat(16385),
    ]) {
      expect(validLmsCookie(cookie)).toBe(false);
      await expect(s.validate("owner", cookie)).rejects.toMatchObject({
        code: "lms_invalid_session",
      });
    }
    expect(validator).not.toHaveBeenCalled();
    expect(validLmsCookie("a+/=_-.")).toBe(true);
  });
  it("fails closed on missing/invalid key before login or persistence", async () => {
    const validator = vi.fn(async () => ({ ok: true as const }));
    vi.stubEnv("ENCRYPTION_KEY", "invalid");
    await expect(
      service({ validator }).validate("owner", "cookie"),
    ).rejects.toMatchObject({ code: "encryption_unavailable" });
    vi.stubEnv("ENCRYPTION_KEY", "");
    await expect(
      service({ validator }).validate("owner", "cookie"),
    ).rejects.toMatchObject({ code: "encryption_unavailable" });
    expect(validator).not.toHaveBeenCalled();
    await expect(
      service({ key: Buffer.alloc(1), validator }).validate("owner", "cookie"),
    ).rejects.toMatchObject({ code: "encryption_unavailable" });
  });
  it("validates without a store write, then encrypts and binds one save to its owner", async () => {
    const s = service({ key, validator: async () => ({ ok: true }) });
    const receipt = await s.validate("owner", "private-cookie");
    expect(JSON.stringify(receipt)).not.toContain("private-cookie");
    const saveLmsSession = vi.fn(
      async (_input: {
        userId: string;
        encryptedCookie: string;
        expiresAt: string;
      }) => ({ configured: true }),
    );
    const store = { saveLmsSession } as unknown as LmsSessionStore;
    expect(saveLmsSession).not.toHaveBeenCalled();
    await expect(
      s.save("other", receipt.validationToken, store),
    ).rejects.toMatchObject({ code: "lms_validation_required" });
    await s.save("owner", receipt.validationToken, store);
    const input = saveLmsSession.mock.calls[0]![0] as unknown as {
      userId: string;
      encryptedCookie: string;
      expiresAt: string;
    };
    expect(input.userId).toBe("owner");
    expect(input.encryptedCookie).not.toContain("private-cookie");
    expect(JSON.parse(decryptSecret(input.encryptedCookie, key)!)).toEqual({
      version: 1,
      userId: "owner",
      platform: "aitu_moodle",
      cookie: "private-cookie",
    });
    await expect(
      s.save("owner", receipt.validationToken, store),
    ).rejects.toMatchObject({ code: "lms_validation_required" });
    expect(saveLmsSession).toHaveBeenCalledTimes(1);
  });
  it("does not offer a receipt for rejected login, nor return unsafe exception output", async () => {
    await expect(
      service({
        key,
        validator: async () => ({
          ok: false,
          errorCategory: "session_expired",
        }),
      }).validate("owner", "private-cookie"),
    ).rejects.toMatchObject({ code: "session_expired" });
    const s = service({
      key,
      validator: async () => {
        throw new Error("private-cookie");
      },
    });
    await expect(s.validate("owner", "private-cookie")).rejects.toThrow(
      "connection_failed",
    );
  });
  it("keeps an interactive-login diagnostic separate from expired credentials and cannot save it", async () => {
    const event = { stage: "microsoft_login_page", reason: "interactive_required" } as const;
    const s = service({
      key,
      validator: async () => ({
        ok: false,
        errorCategory: "interactive_login_required",
        diagnostics: { ...event, events: [event] },
      }),
    });
    await expect(s.validate("owner", "private-cookie")).rejects.toMatchObject({
      code: "interactive_login_required",
      statusCode: 422,
      diagnostics: { ...event, events: [event] },
    });
    const store = { saveLmsSession: vi.fn() } as unknown as LmsSessionStore;
    await expect(s.save("owner", "a".repeat(43), store)).rejects.toMatchObject({ code: "lms_validation_required" });
    expect(store.saveLmsSession).not.toHaveBeenCalled();
  });
  it("expires and replaces pending receipts and enforces bounded rate buckets", async () => {
    let now = 1000000;
    const s = service({
      key,
      now: () => now,
      validator: async () => ({ ok: true }),
    });
    const old = await s.validate("owner", "first");
    const current = await s.validate("owner", "second");
    const store = { saveLmsSession: vi.fn() } as unknown as LmsSessionStore;
    await expect(
      s.save("owner", old.validationToken, store),
    ).rejects.toMatchObject({ code: "lms_validation_required" });
    now += 300001;
    await expect(
      s.save("owner", current.validationToken, store),
    ).rejects.toMatchObject({ code: "lms_validation_required" });
    s.checkRate("owner", "validate", 1);
    expect(() => s.checkRate("owner", "validate", 1)).toThrow(
      "lms_rate_limited",
    );
    now += 60001;
    expect(() => s.checkRate("owner", "validate", 1)).not.toThrow();
  });
});
