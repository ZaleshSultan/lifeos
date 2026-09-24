import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../telegram", () => ({
  telegram: { initData: "signed-telegram-session" },
}));

import {
  copyHealthConnectionValue,
  healthBridgeApiBaseUrl,
  issueHealthSessionToken,
} from "./health";
import { HealthBridgeConnection } from "../components/HealthBridgeConnection";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Health Bridge connection", () => {
  it("renders an explicit action without issuing a token on mount", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("window", {
      location: { href: "https://lifeos.example/tma/" },
    });
    const html = renderToStaticMarkup(createElement(HealthBridgeConnection));
    expect(html).toContain("Получить токен для Health Bridge");
    expect(html).not.toContain("textarea");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("issues a token through the authenticated POST endpoint without a client user id", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-24T12:00:00Z"));
    const fetch = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            token: "test-session-token",
            tokenType: "Bearer",
            expiresInSeconds: 3600,
          },
        }),
      });
    vi.stubGlobal("fetch", fetch);
    const connection = await issueHealthSessionToken();
    expect(fetch).toHaveBeenCalledWith("/api/tma/health/ingest-token", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-init-data": "signed-telegram-session",
      },
    });
    expect(connection).toMatchObject({
      token: "test-session-token",
      expiresAt: "2026-09-24T13:00:00.000Z",
    });
  });

  it("resolves the same-origin self-host and configured API paths for Android", () => {
    expect(
      healthBridgeApiBaseUrl("", "https://lifeos.example/tma/?screen=health"),
    ).toBe("https://lifeos.example");
    expect(
      healthBridgeApiBaseUrl("https://bot.example/", "https://tma.example/"),
    ).toBe("https://bot.example");
    expect(
      healthBridgeApiBaseUrl("/backend", "https://lifeos.example/tma/"),
    ).toBe("https://lifeos.example/backend");
  });

  it("reports denied clipboard access so the UI can offer manual selection", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("permission denied"));
    expect(await copyHealthConnectionValue("token", { writeText })).toBe(false);
    expect(writeText).toHaveBeenCalledWith("token");
    expect(
      await copyHealthConnectionValue("token", {
        writeText: vi.fn().mockResolvedValue(undefined),
      }),
    ).toBe(true);
  });

  it("does not treat a malformed issuance response as a usable connection", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            data: { token: "", tokenType: "Bearer", expiresInSeconds: 3600 },
          }),
        }),
    );
    await expect(issueHealthSessionToken()).rejects.toThrow(
      "Invalid health connection response",
    );
  });
});
