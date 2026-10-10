import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../telegram", () => ({
  telegram: { initData: "signed-telegram-session" },
}));

import { ApiError } from "./client";
import {
  aiUnavailableMessage,
  getAiStatus,
  getToday,
  planningErrorMessage,
  prepareAiMessages,
  sendAiChat,
  type AiMessage,
} from "./planning";

afterEach(() => vi.unstubAllGlobals());

describe("Today and AI API boundary", () => {
  it("loads the selected planning date with Telegram authentication", async () => {
    const data = { plan: { date: "2026-10-11" }, ai: { enabled: false } };
    const fetch = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data }),
      });
    vi.stubGlobal("fetch", fetch);

    expect(await getToday("2026-10-11")).toEqual(data);
    expect(fetch).toHaveBeenCalledWith(
      "/api/tma/today?date=2026-10-11",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-telegram-init-data": "signed-telegram-session",
        }),
      }),
    );
  });

  it("checks actual AI status without initiating text generation", async () => {
    const data = {
      enabled: false,
      available: false,
      reason: "ai_disabled",
      liveEnabled: false,
    };
    const fetch = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data }),
      });
    vi.stubGlobal("fetch", fetch);

    expect(await getAiStatus()).toEqual(data);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe("/api/tma/ai/status");
  });

  it("sends only bounded conversation and date, without browser-supplied identity or records", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            answer: "Review the deadline.",
            suggestions: [],
            provider: "gemini",
            readOnly: true,
          },
        }),
      });
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    await sendAiChat({
      messages: [{ role: "user", text: "What is urgent?" }],
      date: "2026-10-11",
      signal: controller.signal,
    });

    expect(fetch).toHaveBeenCalledWith(
      "/api/tma/ai/chat",
      expect.objectContaining({
        method: "POST",
        signal: controller.signal,
        headers: expect.objectContaining({
          "x-telegram-init-data": "signed-telegram-session",
        }),
      }),
    );
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      messages: [{ role: "user", text: "What is urgent?" }],
      date: "2026-10-11",
    });
  });

  it("shows real failures without falling back to invented data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(getToday()).rejects.toThrow("offline");
    await expect(
      sendAiChat({ messages: [{ role: "user", text: "Plan today" }] }),
    ).rejects.toThrow("offline");
  });
});

describe("AI conversation limits and safe error copy", () => {
  it("retains whole recent exchanges and leaves room for the new answer", () => {
    const history: AiMessage[] = Array.from({ length: 12 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      text: `message ${index}`,
    }));
    const next = prepareAiMessages(history, "  New question  ");
    expect(next).toHaveLength(11);
    expect(next[0]).toEqual({ role: "user", text: "message 2" });
    expect(next.at(-1)).toEqual({ role: "user", text: "New question" });
    expect(
      prepareAiMessages(
        [{ role: "assistant", text: "a".repeat(6000) }],
        "u".repeat(2100),
      ).every((message) => message.text.length <= 2000),
    ).toBe(true);
  });

  it("explains disabled, missing-credential, and unsupported-model states", () => {
    expect(
      aiUnavailableMessage({
        enabled: false,
        available: false,
        reason: "ai_disabled",
        liveEnabled: false,
      }),
    ).toContain("disabled");
    expect(
      aiUnavailableMessage({
        enabled: true,
        available: false,
        reason: "ai_missing_credentials",
        liveEnabled: false,
      }),
    ).toContain("not configured");
    expect(
      aiUnavailableMessage({
        enabled: true,
        available: false,
        reason: "ai_unsupported_model",
        liveEnabled: false,
      }),
    ).toContain("model is unavailable");
  });

  it("provides clear quota, timeout, and credential failures without leaking raw responses", () => {
    expect(
      planningErrorMessage(
        new ApiError(
          '{"error":"ai_invalid_credentials","message":"secret debug payload"}',
          503,
        ),
      ),
    ).toContain("not configured correctly");
    expect(
      planningErrorMessage(new ApiError("secret debug payload", 429)),
    ).toContain("request limit");
    expect(
      planningErrorMessage(new ApiError("secret debug payload", 504)),
    ).toContain("too long");
    expect(
      planningErrorMessage(new ApiError("secret debug payload", 500)),
    ).not.toContain("secret");
  });
});
