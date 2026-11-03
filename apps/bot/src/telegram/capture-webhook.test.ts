import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LifeOSStore } from "@lifeos/db";
import { createBotServer } from "../server.js";
import type { AssistantBrain } from "../assistant/brain.js";
import type { MealVisionService } from "../nutrition-routes.js";
import {
  CaptureTelegramIngestError,
  type CaptureTelegramPort,
  type CaptureTelegramResult,
} from "./capture.js";
import type {
  SendMessageInput,
  TelegramClient,
  TelegramUpdate,
} from "./types.js";

const servers: Server[] = [];
const captureId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
afterEach(async () => {
  for (const server of servers.splice(0))
    await new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  vi.restoreAllMocks();
});
async function fixture() {
  const seen = new Set<string>();
  const created: unknown[] = [];
  const receive = vi.fn(
    async (input: {
      userId: string;
      requestId: string;
    }): Promise<CaptureTelegramResult> => {
      const key = input.userId + ":" + input.requestId,
        duplicate = seen.has(key);
      if (!duplicate) created.push(input);
      seen.add(key);
      return { id: captureId, state: "needs_review", duplicate };
    },
  );
  const port: CaptureTelegramPort = {
    ingestText: receive,
    ingestVoice: receive,
    setTranscript: receive,
  };
  const sent: SendMessageInput[] = [];
  const telegram: TelegramClient = {
    sendMessage: vi.fn(async (input) => {
      sent.push(input);
    }),
    answerCallbackQuery: vi.fn(async () => {}),
    getFileUrl: vi.fn(async () => {
      throw new Error("unexpected media download");
    }),
  };
  const resolveTelegramUser = vi.fn(async () => ({
    userId: "owner",
    telegramUserId: 30,
    status: "active",
  }));
  const store = { resolveTelegramUser } as unknown as LifeOSStore;
  const assistant = {
    status: () => ({ assistantEnabled: true }),
    handle: vi.fn(async () => ({ answer: "legacy", sources: [] })),
  };
  const mealVision = {
    capability: () => ({ available: false }),
    analyze: vi.fn(async () => {
      throw new Error("unexpected provider call");
    }),
  };
  const options = {
    config: {
      telegramWebhookPath: "/telegram/webhook",
      telegramWebhookSecret: "synthetic-secret",
    },
    capture: port,
    telegram,
    store,
    assistant: assistant as unknown as AssistantBrain,
    mealVision: mealVision as unknown as MealVisionService,
  };
  const server = createBotServer(options);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("local test server not listening");
  const url = `http://127.0.0.1:${address.port}/telegram/webhook`;
  const post = (body: unknown, secret = "synthetic-secret") =>
    fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": secret,
      },
      body: JSON.stringify(body),
    });
  const update: TelegramUpdate = {
    update_id: 100,
    message: {
      message_id: 10,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 30, type: "private" },
      from: { id: 30 },
      text: "Tomorrow finish DBMS and drink water",
    },
  };
  return {
    created,
    receive,
    port,
    sent,
    telegram,
    resolveTelegramUser,
    assistant,
    mealVision,
    post,
    update,
  };
}

describe("actual HTTP Telegram capture ingress", () => {
  it("authenticates before capture ingress and preserves pending proposals without legacy auto-write", async () => {
    const f = await fixture();
    const response = await f.post(f.update);
    expect(response.status).toBe(200);
    expect(f.created).toHaveLength(1);
    expect(f.assistant.handle).not.toHaveBeenCalled();
    expect(f.sent.at(-1)?.text).toContain("подтверди");
  });
  it("does not write or reply when webhook authentication fails", async () => {
    const f = await fixture();
    expect((await f.post(f.update, "wrong")).status).toBe(401);
    expect(f.receive).not.toHaveBeenCalled();
    expect(f.resolveTelegramUser).not.toHaveBeenCalled();
    expect(f.sent).toHaveLength(0);
  });
  it("accepts a media-only private voice update without downloading when speech is unavailable", async () => {
    const f = await fixture();
    delete f.update.message!.text;
    f.update.message!.voice = {
      file_id: "file",
      file_unique_id: "stable",
      duration: 10,
      mime_type: "audio/ogg",
      file_size: 1000,
    };
    expect((await f.post(f.update)).status).toBe(200);
    expect(f.port.ingestVoice).toHaveBeenCalledOnce();
    expect(f.telegram.getFileUrl).not.toHaveBeenCalled();
    expect(f.assistant.handle).not.toHaveBeenCalled();
    expect(f.sent.at(-1)?.text).toContain(
      "Автоматическая расшифровка сейчас недоступна",
    );
  });
  it("retries scoped pre-persistence errors without producing duplicate captures on repeated updates", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const f = await fixture();
    f.receive.mockRejectedValueOnce(new CaptureTelegramIngestError());
    expect((await f.post(f.update)).status).toBe(503);
    expect(f.created).toHaveLength(0);
    expect((await f.post(f.update)).status).toBe(200);
    expect((await f.post(f.update)).status).toBe(200);
    expect(f.created).toHaveLength(1);
    expect(f.sent).toHaveLength(1);
  });
  it("refuses blocked, foreign and group media before ingest", async () => {
    const f = await fixture();
    delete f.update.message!.text;
    f.update.message!.voice = {
      file_id: "file",
      file_unique_id: "stable",
      duration: 10,
    };
    f.resolveTelegramUser.mockResolvedValueOnce({
      userId: "owner",
      telegramUserId: 30,
      status: "blocked",
    });
    expect((await f.post(f.update)).status).toBe(200);
    f.update.message!.chat = { id: -100, type: "group" };
    expect((await f.post(f.update)).status).toBe(200);
    f.update.message!.chat = { id: 99, type: "private" };
    expect((await f.post(f.update)).status).toBe(200);
    expect(f.receive).not.toHaveBeenCalled();
    expect(f.telegram.getFileUrl).not.toHaveBeenCalled();
  });
  it("rejects unsupported or malformed audio without any download or provider work", async () => {
    const f = await fixture();
    delete f.update.message!.text;
    for (const voice of [
      { file_id: "file", file_unique_id: "stable", duration: 121 },
      {
        file_id: "file",
        file_unique_id: "stable",
        duration: 10,
        mime_type: "audio/mpeg",
      },
      null,
      "unsafe",
    ]) {
      const update = { ...f.update, message: { ...f.update.message, voice } };
      expect((await f.post(update)).status).toBe(200);
    }
    expect(f.receive).not.toHaveBeenCalled();
    expect(f.telegram.getFileUrl).not.toHaveBeenCalled();
    expect(f.assistant.handle).not.toHaveBeenCalled();
  });
  it("admits captioned meal photos to the existing consent/manual flow", async () => {
    const f = await fixture();
    delete f.update.message!.text;
    f.update.message!.caption = "/meal";
    f.update.message!.photo = [
      {
        file_id: "photo",
        file_unique_id: "photo-stable",
        width: 100,
        height: 100,
        file_size: 1000,
      },
    ];
    expect((await f.post(f.update)).status).toBe(200);
    expect(f.sent.at(-1)?.text).toContain("Фото-анализ сейчас не подключён");
    expect(f.receive).not.toHaveBeenCalled();
    expect(f.telegram.getFileUrl).not.toHaveBeenCalled();
    expect(f.mealVision.analyze).not.toHaveBeenCalled();
  });
  it.each([
    { id: -100, type: "group" },
    { id: 99, type: "private" },
  ])(
    "does not expose photo handling to group or foreign private chats",
    async (chat) => {
      const f = await fixture();
      const message = {
        ...f.update.message!,
        chat,
        caption: "/meal",
        photo: [
          {
            file_id: "photo",
            file_unique_id: "stable",
            width: 100,
            height: 100,
          },
        ],
      };
      for (const text of [undefined, "/task an explicit legacy command"]) {
        expect(
          (await f.post({ ...f.update, message: { ...message, text } })).status,
        ).toBe(200);
      }
      expect(f.resolveTelegramUser).not.toHaveBeenCalled();
      expect(f.receive).not.toHaveBeenCalled();
      expect(f.telegram.getFileUrl).not.toHaveBeenCalled();
      expect(f.mealVision.analyze).not.toHaveBeenCalled();
      expect(f.sent).toHaveLength(0);
    },
  );
  it.each([undefined, "/task a legacy command with an unrelated attachment"])(
    "does not enable unsafe generic private-photo receipt handling",
    async (text) => {
      const f = await fixture();
      const message = {
        ...f.update.message!,
        text,
        photo: [
          {
            file_id: "photo",
            file_unique_id: "stable",
            width: 100,
            height: 100,
          },
        ],
      };
      expect((await f.post({ ...f.update, message })).status).toBe(200);
      expect(f.sent.at(-1)?.text).toContain("Файл не скачан");
      expect(f.receive).not.toHaveBeenCalled();
      expect(f.telegram.getFileUrl).not.toHaveBeenCalled();
      expect(f.assistant.handle).not.toHaveBeenCalled();
      expect(f.mealVision.analyze).not.toHaveBeenCalled();
    },
  );
  it.each(["audio", "document"])(
    "responds to unsupported %s attachments without downloading or persisting",
    async (kind) => {
      const f = await fixture();
      delete f.update.message!.text;
      const update = {
        ...f.update,
        message: {
          ...f.update.message,
          [kind]: {
            file_id: "unsupported",
            file_name: "private-note.exe",
            mime_type: "application/octet-stream",
            file_size: 1000,
          },
        },
      };
      expect((await f.post(update)).status).toBe(200);
      expect(f.sent.at(-1)?.text).toContain("Файл не скачан");
      expect(JSON.stringify(f.sent)).not.toContain("private-note.exe");
      expect(f.receive).not.toHaveBeenCalled();
      expect(f.telegram.getFileUrl).not.toHaveBeenCalled();
      expect(f.assistant.handle).not.toHaveBeenCalled();
    },
  );
});
