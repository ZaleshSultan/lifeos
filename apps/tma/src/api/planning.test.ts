import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../telegram", () => ({
  telegram: { initData: "signed-telegram-session" },
}));

import { ApiError } from "./client";
import {
  aiUnavailableMessage,
  confirmAiChatRequest,
  completeAiConversation,
  getAiStatus,
  getToday,
  planningErrorMessage,
  prepareAiChatRequest,
  prepareAiMessages,
  sendAiChat,
  type AiMessage,
  type AiChatAnswer,
} from "./planning";

afterEach(() => vi.unstubAllGlobals());

describe("Today and AI API boundary", () => {
  it("loads the selected planning date with Telegram authentication", async () => {
    const data = { plan: { date: "2026-10-11" }, ai: { enabled: false } };
    const fetch = vi.fn().mockResolvedValue({
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
    const fetch = vi.fn().mockResolvedValue({
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
    const fetch = vi.fn().mockResolvedValue({
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

  it("confirms with a backend token and retries the original request identity", async () => {
    const response = {
      answer: "Reminder saved.",
      provider: "lifeos",
      readOnly: false,
      suggestions: [],
      tool: {
        name: "reminders.create",
        permission: "WRITE",
        status: "completed",
        summary: "Reminder saved.",
      },
    };
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("connection lost after saving"))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: response }),
      });
    vi.stubGlobal("fetch", fetch);
    const original = prepareAiChatRequest(
      [],
      "Remind me tomorrow at 09:00 to study",
      "2026-10-11",
    );
    const confirmed = confirmAiChatRequest(original, "backend-signed-token");
    expect(confirmed.requestId).toBe(original.requestId);
    expect(confirmed.messages).toBe(original.messages);
    expect(original.confirmationToken).toBeUndefined();

    await expect(sendAiChat(confirmed)).rejects.toThrow("connection lost");
    expect(await sendAiChat(confirmed)).toEqual(response);
    const firstBody = JSON.parse(fetch.mock.calls[0][1].body);
    const retryBody = JSON.parse(fetch.mock.calls[1][1].body);
    expect(firstBody).toEqual(retryBody);
    expect(firstBody).toEqual({
      messages: original.messages,
      date: "2026-10-11",
      requestId: original.requestId,
      confirmationToken: "backend-signed-token",
    });
    expect(firstBody).not.toHaveProperty("confirmed");
    expect(firstBody).not.toHaveProperty("userId");
  });
});

describe("AI conversation limits and safe error copy", () => {
  const routedAnswer: AiChatAnswer = {
    answer: "A completed routed answer",
    provider: "openrouter",
    readOnly: true,
    suggestions: [],
    modelRoute: {
      version: 1,
      requestId: "fixture",
      modelId: "approved-model",
      provider: "openrouter",
      model: "approved/model",
      billing: "api",
      estimatedCostMicros: 100,
      reportedCostMicros: 80,
      costSource: "provider_reported",
      latencyMs: 123,
      fallback: true,
      reason: "approved_fallback",
      privacy: "external",
    },
  };
  it("retains completed model receipts for display while outgoing history contains only role/text", async () => {
    const first = prepareAiChatRequest([], "First question");
    const display = completeAiConversation([], first, routedAnswer);
    expect(display.at(-1)?.modelRoute).toEqual(routedAnswer.modelRoute);
    const next = prepareAiChatRequest(
      display,
      "Next question",
      undefined,
      routedAnswer.modelRoute!.modelId,
    );
    expect(next.previousModelId).toBe("approved-model");
    expect(next.messages.at(-2)).toEqual({
      role: "assistant",
      text: routedAnswer.answer,
    });
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: routedAnswer }),
    });
    vi.stubGlobal("fetch", fetch);
    await sendAiChat({ ...next, messages: display });
    const sent = JSON.parse(fetch.mock.calls[0][1].body);
    expect(sent.previousModelId).toBe("approved-model");
    expect(
      sent.messages.every(
        (message: object) =>
          Object.keys(message).sort().join(",") === "role,text",
      ),
    ).toBe(true);
    expect(sent.messages.at(-1)).not.toHaveProperty("modelRoute");
    expect(confirmAiChatRequest(next, "signed-confirmation")).toMatchObject({
      requestId: next.requestId,
      previousModelId: "approved-model",
    });
  });
  it("keeps provenance aligned as bounded context shifts and confirmation replaces a pending answer", () => {
    const first = prepareAiChatRequest([], "First question");
    let display = completeAiConversation([], first, routedAnswer);
    for (let i = 0; i < 6; i++) {
      const request = prepareAiChatRequest(display, `Question ${i}`);
      display = completeAiConversation(display, request, {
        ...routedAnswer,
        answer: `Answer ${i}`,
        modelRoute: { ...routedAnswer.modelRoute!, modelId: `model-${i}` },
      });
    }
    expect(display).toHaveLength(12);
    expect(display.at(-3)?.modelRoute?.modelId).toBe("model-4");
    const request = prepareAiChatRequest(display, "Review an action");
    const pending = completeAiConversation(display, request, {
      answer: "Confirm it",
      suggestions: [],
      provider: "lifeos",
      readOnly: true,
    });
    const confirmed = completeAiConversation(
      pending,
      confirmAiChatRequest(request, "signed"),
      { answer: "Saved", suggestions: [], provider: "lifeos", readOnly: false },
    );
    expect(confirmed.at(-3)?.modelRoute?.modelId).toBe("model-5");
    expect(confirmed.at(-1)?.text).toBe("Saved");
  });
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

  it("generates a separate idempotency identity for each explicit request", () => {
    const history = [
      {
        role: "assistant" as const,
        text: "Your next class is DBMS.",
        confirmationToken: "must-not-be-conversation-metadata",
      },
    ];
    const first = prepareAiChatRequest(history, "  Show my tasks  ");
    const second = prepareAiChatRequest(history, "Show my tasks");
    expect(first.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(first.requestId).not.toBe(second.requestId);
    expect(first.messages).toEqual([
      { role: "assistant", text: "Your next class is DBMS." },
      { role: "user", text: "Show my tasks" },
    ]);
    expect(first).not.toHaveProperty("confirmationToken");
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
  it("distinguishes routing policy denials from an expired login", () => {
    for (const code of ["ai_router_blocked", "ai_router_consent_changed"]) {
      const message = planningErrorMessage(
        new ApiError(
          JSON.stringify({ error: code, message: "secret details" }),
          403,
        ),
      );
      expect(message).toContain("AI settings");
      expect(message).not.toContain("Reopen");
      expect(message).not.toContain("secret");
    }
    expect(
      planningErrorMessage(
        new ApiError('{"error":"invalid_web_session"}', 403),
      ),
    ).toContain("Reopen LifeOS");
  });

  it("explains assistant safety failures without exposing backend metadata", () => {
    const message = (code: string) =>
      planningErrorMessage(
        new ApiError(
          JSON.stringify({ error: code, message: "secret token debug" }),
          409,
        ),
      );
    expect(message("assistant_confirmation_invalid")).toContain("confirmation");
    expect(message("assistant_tool_unavailable")).toContain(
      "tool is unavailable",
    );
    expect(message("assistant_permission_denied")).toContain(
      "action is disabled",
    );
    expect(message("assistant_confirmation_unavailable")).toContain(
      "Changes are currently unavailable",
    );
    expect(message("assistant_sensitive_data")).toContain("sensitive data");
    expect(message("assistant_confirmation_invalid")).not.toContain("secret");
  });
});
