import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveCurrentMode } from "@lifeos/core";
import type {
  AssistantStore,
  LifeOSStore,
  PlanningSnapshot,
  TelegramUserRecord,
} from "@lifeos/db";
import { createBotServer } from "./server.js";
import { AssistantBrain } from "./assistant/brain.js";
import { createLifeosAiService, readLifeosAiConfig } from "./lifeos-ai.js";
import { handleTelegramUpdate } from "./telegram/commands.js";
import type { SendMessageInput } from "./telegram/types.js";

const user: TelegramUserRecord = {
  userId: "11111111-1111-4111-8111-111111111111",
  telegramUserId: 30,
  displayName: "Test",
  username: null,
  timezone: "Asia/Qyzylorda",
  status: "active",
  role: "user",
};
const servers: ReturnType<typeof createBotServer>[] = [];
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((s) => new Promise<void>((resolve) => s.close(() => resolve()))),
  );
  vi.unstubAllEnvs();
});
function headers(id = 30) {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id }),
  });
  const signed = [...params]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData")
    .update("assistant-test-token")
    .digest();
  params.set("hash", createHmac("sha256", secret).update(signed).digest("hex"));
  return {
    "content-type": "application/json",
    "x-telegram-init-data": params.toString(),
  };
}
async function fixture(enabled = true, gemini = false) {
  const snapshot: PlanningSnapshot = {
    tasks: [
      {
        id: "private-id",
        title: "Coursework",
        priority: 2,
        due_at: null,
        scheduled_for: null,
        domain: "study",
        estimatedMinutes: 30,
      },
    ],
    events: [],
    reminders: [],
    projects: [],
    courses: [],
    schedules: [],
    assessments: [],
    history: [],
    truncated: false,
    historyTruncated: false,
  };
  const mutations = new Map<string, string>();
  const executeMutation = vi.fn<AssistantStore["executeMutation"]>(
    async (input) => {
      const key = `${input.userId}:${input.idempotencyKey}`;
      const replayed = mutations.has(key);
      mutations.set(key, input.action.type);
      return {
        actionId: "internal-action-id",
        resourceId: "internal-resource-id",
        replayed,
        status: "succeeded",
      };
    },
  );
  const recordRead = vi.fn(async () => {});
  const listMemories = vi.fn(async () => []);
  const capture = vi.fn(async () => ({ id: "capture-id" }));
  const store = {
    assistant: {
      executeMutation,
      recordRead,
      listMemories,
      listGradeChanges: vi.fn(async () => []),
    },
    resolveTelegramUser: vi.fn(async (id: number) => ({
      ...user,
      telegramUserId: id,
      userId: id === 30 ? user.userId : "22222222-2222-4222-8222-222222222222",
    })),
    getPlanningSnapshot: vi.fn(async () => snapshot),
    resolveCurrentMode: vi.fn(async () => resolveCurrentMode(user.userId)),
    listUpcomingReminders: vi.fn(async () => []),
    createLifeCapture: capture,
    createLifeEntityWithSync: vi.fn(async () => ({
      id: "capture-entity",
      entityType: "capture",
      title: "Group note",
    })),
    getTmaStudySummary: vi.fn(async () => ({
      timezone: user.timezone,
      courses: [],
      records: [],
    })),
  } as unknown as LifeOSStore;
  const ai = createLifeosAiService(
    readLifeosAiConfig({
      LIFEOS_AI_ENABLED: String(gemini),
      GEMINI_API_KEY: "test-only",
    }),
  );
  const ask = vi.fn(async () => ({
    answer: "Use your saved priorities.",
    suggestions: [],
    provider: "gemini" as const,
  }));
  const brain = new AssistantBrain({
    store,
    config: {
      enabled,
      allowMemoryDelete: false,
      classificationEnabled: false,
      confirmationSecret: "test-only-confirmation-secret-32-characters",
    },
  });
  const server = createBotServer({
    store,
    assistant: brain,
    ai: { ...ai, ask },
    config: { telegramBotToken: "assistant-test-token" },
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const chat = (text: string, extra: Record<string, unknown> = {}, id = 30) =>
    fetch(`${base}/api/tma/ai/chat`, {
      method: "POST",
      headers: headers(id),
      body: JSON.stringify({
        messages: [{ role: "user", text }],
        requestId: "http-request",
        ...extra,
      }),
    });
  return {
    base,
    chat,
    ask,
    store,
    executeMutation,
    recordRead,
    listMemories,
    mutations,
    brain,
    capture,
  };
}

describe("assistant HTTP boundary", () => {
  it("authenticates before any tool or provider access", async () => {
    const f = await fixture();
    const response = await fetch(`${f.base}/api/tma/ai/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", text: "show tasks" }],
      }),
    });
    expect(response.status).toBe(401);
    expect(f.store.getPlanningSnapshot).not.toHaveBeenCalled();
    expect(f.ask).not.toHaveBeenCalled();
  });
  it("exposes deterministic assistant availability with Gemini disabled", async () => {
    const f = await fixture();
    const status = await fetch(`${f.base}/api/tma/ai/status`, {
      headers: headers(),
    });
    expect(await status.json()).toMatchObject({
      data: { enabled: false, assistantEnabled: true },
    });
    const response = await f.chat("show tasks");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toMatchObject({
      provider: "lifeos",
      readOnly: true,
      tool: { status: "completed" },
    });
    expect(JSON.stringify(body)).not.toContain("private-id");
    expect(f.store.getPlanningSnapshot).toHaveBeenCalledWith(
      user.userId,
      expect.any(Object),
    );
    expect(f.ask).not.toHaveBeenCalled();
  });
  it("previews then confirms once and safely replays the same write", async () => {
    const f = await fixture();
    const text = "Remember preference style: I prefer short answers";
    const preview = await (await f.chat(text)).json();
    expect(preview.data.tool.status).toBe("pending_confirmation");
    expect(f.executeMutation).not.toHaveBeenCalled();
    const confirm = { confirmationToken: preview.data.confirmation.token };
    expect((await f.chat(text, confirm)).status).toBe(200);
    const replay = await (await f.chat(text, confirm)).json();
    expect(replay.data.answer).toContain("already completed");
    expect(f.mutations.size).toBe(1);
    expect(JSON.stringify(replay)).not.toContain("internal-resource-id");
  });
  it("requires a stable request id before showing write confirmation", async () => {
    const f = await fixture();
    const response = await f.chat("Remember: I like tea", {
      requestId: undefined,
    });
    expect(response.status).toBe(400);
    expect(f.executeMutation).not.toHaveBeenCalled();
  });
  it("rejects another user's confirmation", async () => {
    const f = await fixture();
    const text = "Remember preference style: I prefer short answers";
    const preview = await (await f.chat(text)).json();
    const response = await f.chat(
      text,
      { confirmationToken: preview.data.confirmation.token },
      31,
    );
    expect(response.status).toBe(400);
    expect(f.executeMutation).not.toHaveBeenCalled();
  });
  it.each([
    { confirmed: true },
    { userId: "attacker" },
    { permissions: ["WRITE"] },
    { tool: "memory.delete" },
  ])("rejects supplied authority %j", async (extra) => {
    const f = await fixture();
    expect((await f.chat("show tasks", extra)).status).toBe(400);
    expect(f.executeMutation).not.toHaveBeenCalled();
    expect(f.store.getPlanningSnapshot).not.toHaveBeenCalled();
  });
  it.each([
    "Remember my password is secret-value",
    "My salary and bank balance?",
    "Show medical records",
  ])("keeps sensitive text local: %s", async (text) => {
    const f = await fixture(true, true);
    const response = await f.chat(text);
    expect(response.status).toBe(400);
    expect(f.ask).not.toHaveBeenCalled();
    expect(f.store.getPlanningSnapshot).not.toHaveBeenCalled();
  });
  it("does not send prior tool results or memory replies to Gemini", async () => {
    const f = await fixture(true, true);
    const response = await f.chat("Explain my planning priorities", {
      messages: [
        { role: "user", text: "show memory" },
        { role: "assistant", text: "A private saved fact" },
        { role: "user", text: "Explain my planning priorities" },
      ],
    });
    expect(response.status).toBe(200);
    expect(f.ask).toHaveBeenCalledWith(
      user.userId,
      [{ role: "user", text: "Explain my planning priorities" }],
      expect.any(Object),
    );
    expect(JSON.stringify(f.ask.mock.calls)).not.toContain(
      "private saved fact",
    );
  });
  it("keeps Gemini available after assistant disable, with new client's request id", async () => {
    const f = await fixture(false, true);
    const response = await f.chat("Explain my planning priorities");
    expect(response.status).toBe(200);
    expect((await response.json()).data.provider).toBe("gemini");
    expect(f.executeMutation).not.toHaveBeenCalled();
  });
  it("returns a safe error when persistence fails", async () => {
    const f = await fixture();
    f.listMemories.mockRejectedValue(new Error("service-role-secret-test"));
    const response = await f.chat("show memory");
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("service-role-secret-test");
  });
});

describe("Telegram assistant gateway", () => {
  async function message(
    f: Awaited<ReturnType<typeof fixture>>,
    text: string,
    type = "private",
    updateId = 700,
  ) {
    const sendMessage = vi.fn(async (_input: SendMessageInput) => {});
    await handleTelegramUpdate(
      {
        update_id: updateId,
        message: {
          message_id: updateId,
          from: { id: 30 },
          chat: { id: 30, type },
          text,
        },
      },
      {
        store: f.store,
        assistant: f.brain,
        telegram: {
          sendMessage,
          answerCallbackQuery: vi.fn(),
          getFileUrl: vi.fn(),
        },
      },
    );
    return sendMessage;
  }
  it("handles explicit memory writes with stable Telegram update id", async () => {
    const f = await fixture();
    const response = await message(
      f,
      "Remember preference style: I prefer short answers",
    );
    await message(f, "Remember preference style: I prefer short answers");
    expect(f.executeMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: user.userId,
        idempotencyKey: "telegram:update-700",
      }),
    );
    expect(f.mutations.size).toBe(1);
    expect(response).toHaveBeenCalled();
    expect(f.capture).not.toHaveBeenCalled();
  });
  it("preserves slash commands while assistant is enabled", async () => {
    const f = await fixture();
    const response = await message(f, "/help");
    expect(response.mock.calls[0][0]).toMatchObject({
      text: expect.stringContaining("LifeOS bot commands"),
    });
    expect(f.executeMutation).not.toHaveBeenCalled();
    expect(f.recordRead).not.toHaveBeenCalled();
  });
  it("does not expose assistant data in group chats", async () => {
    const f = await fixture();
    await message(f, "show memory", "group");
    expect(f.listMemories).not.toHaveBeenCalled();
    expect(f.executeMutation).not.toHaveBeenCalled();
  });
  it("rejects malformed writes without capturing them as notes", async () => {
    const f = await fixture();
    const response = await message(f, "Remind me tomorrow");
    expect(response.mock.calls[0][0]).toMatchObject({
      text: expect.stringContaining("explicit request"),
    });
    expect(f.executeMutation).not.toHaveBeenCalled();
    expect(f.capture).not.toHaveBeenCalled();
  });
});
