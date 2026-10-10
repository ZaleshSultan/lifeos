import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../telegram", () => ({
  telegram: { initData: "signed-telegram-session", hapticImpact: vi.fn() },
}));

import {
  createManualLmsWork,
  deleteLmsSession,
  getLmsConnection,
  getLmsWork,
  lmsErrorCategoryMessage,
  requestLmsSync,
  saveLmsSession,
  validateLmsSession,
  type LmsConnection,
} from "./lms";
import {
  manualDeadlineInstant,
  takeLmsCookie,
} from "../components/study/lms-model";

const connection: LmsConnection = {
  configured: true,
  state: "connected",
  lastSyncSuccessAt: null,
  lastSyncAttemptAt: null,
  lastErrorCategory: null,
  sessionExpiresAt: null,
  syncRequestedAt: null,
  unsupportedFeatures: [],
};

afterEach(() => vi.unstubAllGlobals());

function mockResponse(data: unknown) {
  const fetch = vi
    .fn()
    .mockResolvedValue({ ok: true, status: 200, json: async () => ({ data }) });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("LMS frontend credential boundary", () => {
  it("distinguishes expired sessions, interactive Microsoft login, and unsupported SSO", async () => {
    const messages = [
      lmsErrorCategoryMessage("session_expired"),
      lmsErrorCategoryMessage("interactive_login_required"),
      lmsErrorCategoryMessage("unsupported_auth_flow"),
    ];
    expect(new Set(messages).size).toBe(3);
    expect(messages[0]).toContain("Сессия истекла");
    expect(messages[1]).toContain("Одной cookie недостаточно");
    expect(messages[1]).toContain("MFA");
    expect(messages[1]).toContain("Moodle Web Services");
    const fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => JSON.stringify({
        error: "interactive_login_required",
        message: "private-cookie raw upstream",
      }),
    });
    vi.stubGlobal("fetch", fetch);
    await expect(validateLmsSession("synthetic-session")).rejects.toThrow(messages[1]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("wipes the secret input before beginning validation and does not save automatically", async () => {
    const input = { value: "synthetic-session-value" };
    const fetch = mockResponse({
      validationToken: "synthetic-receipt",
      expiresAt: "2026-10-10T12:05:00Z",
    });
    const cookie = takeLmsCookie(input);
    expect(input.value).toBe("");
    await validateLmsSession(cookie);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "/api/tma/lms/session/validate",
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
        body: JSON.stringify({ cookie: "synthetic-session-value" }),
        headers: expect.objectContaining({
          "x-telegram-init-data": "signed-telegram-session",
        }),
      }),
    );
  });

  it("saves only the short-lived receipt without resending the raw cookie or a client identity", async () => {
    const fetch = mockResponse(connection);
    await saveLmsSession("synthetic-receipt");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      validationToken: "synthetic-receipt",
    });
    expect(fetch.mock.calls[0][0]).toBe("/api/tma/lms/session/save");
    expect(fetch.mock.calls[0][1].cache).toBe("no-store");
  });

  it("projects only credential-free connection metadata and validation receipts", async () => {
    mockResponse({
      ...connection,
      cookie: "unexpected-secret",
      encryptedSession: "unexpected-ciphertext",
      userId: "internal-user",
    });
    expect(await getLmsConnection()).toEqual(connection);
    expect(await saveLmsSession("receipt")).toEqual(connection);
    expect(await deleteLmsSession()).toEqual(connection);
    mockResponse({
      validationToken: "receipt",
      expiresAt: "2026-10-10T12:05:00Z",
      cookie: "unexpected-secret",
    });
    expect(await validateLmsSession("synthetic-session")).toEqual({
      validationToken: "receipt",
      expiresAt: "2026-10-10T12:05:00Z",
    });
  });

  it("keeps deletion and queued synchronization authenticated without including credentials", async () => {
    let fetch = mockResponse(connection);
    await deleteLmsSession();
    expect(fetch).toHaveBeenCalledWith(
      "/api/tma/lms/session",
      expect.objectContaining({
        method: "DELETE",
        cache: "no-store",
        headers: expect.objectContaining({
          "x-telegram-init-data": "signed-telegram-session",
        }),
      }),
    );
    expect(fetch.mock.calls[0][1].body).toBeUndefined();
    fetch = mockResponse({ requested: true });
    expect(await requestLmsSync()).toEqual({ requested: true });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({});
  });

  it("does not retain raw backend credential errors or retry secret requests", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue({
        ok: false,
        status: 409,
        text: async () =>
          JSON.stringify({
            error: "lms_sync_in_progress",
            message: "raw synthetic-cookie debug",
          }),
      });
    vi.stubGlobal("fetch", fetch);
    await expect(validateLmsSession("synthetic-session")).rejects.toThrow(
      "Сейчас идёт синхронизация",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "synthetic-cookie response",
    });
    try {
      await validateLmsSession("synthetic-session");
    } catch (failure) {
      expect(String(failure)).not.toContain("synthetic-cookie");
      expect(failure).not.toHaveProperty("cause");
    }
  });
});

describe("Manual study fallback", () => {
  it("preserves unknown submission state and absent dates without requiring LMS credentials", async () => {
    const fetch = mockResponse({ created: true });
    await createManualLmsWork({
      title: "Prepare report",
      kind: "assignment",
      dueAt: null,
      submissionStatus: "unknown",
    });
    expect(fetch.mock.calls[0][0]).toBe("/api/tma/lms/work/manual");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      title: "Prepare report",
      kind: "assignment",
      dueAt: null,
      submissionStatus: "unknown",
    });
    expect(manualDeadlineInstant("")).toBeNull();
    expect(() => manualDeadlineInstant("not-a-date")).toThrow();
    expect(() => manualDeadlineInstant("2026-02-30T12:00")).toThrow();
    expect(
      new Date(manualDeadlineInstant("2026-10-11T12:00")!).getHours(),
    ).toBe(12);
  });

  it("fetches work through the authenticated no-store API without fake fallbacks", async () => {
    const fetch = mockResponse({ items: [], stale: true });
    expect(await getLmsWork()).toEqual({ items: [], stale: true });
    expect(fetch).toHaveBeenCalledWith(
      "/api/tma/lms/work",
      expect.objectContaining({
        cache: "no-store",
        headers: expect.objectContaining({
          "x-telegram-init-data": "signed-telegram-session",
        }),
      }),
    );
    fetch.mockRejectedValue(new Error("offline"));
    await expect(getLmsWork()).rejects.toThrow("Запрос не выполнен");
  });
});
