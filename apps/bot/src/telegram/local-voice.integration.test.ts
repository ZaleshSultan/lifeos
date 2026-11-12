import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LifeOSStore } from "@lifeos/db";
import { createBotServer } from "../server.js";
import { speechOgg } from "../capture-speech-provider.test-fixtures.js";
import { LocalVoiceService, readLocalVoiceConfig } from "./local-voice.js";
import type { CaptureTelegramPort } from "./capture.js";
import type {
  SendMessageInput,
  TelegramClient,
  TelegramInlineKeyboardMarkup,
  TelegramUpdate,
} from "./types.js";

const servers: Server[] = [];
const voices: LocalVoiceService[] = [];
const ownerId = 30;
const webhookSecret = "synthetic-webhook-secret";
const downloadUrl =
  "https://api.telegram.org/file/bot123:synthetic/voice/file.oga";
const initialNow = "2026-11-12T21:30:00.000Z";

afterEach(async () => {
  for (const voice of voices.splice(0)) voice.close();
  for (const server of servers.splice(0))
    await new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  vi.restoreAllMocks();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function fixture(
  options: { enabled?: boolean; transcript?: string } = {},
) {
  let now = new Date(initialNow);
  const user = {
    userId: "lifeos-owner",
    telegramUserId: ownerId,
    timezone: "Asia/Almaty",
    status: "active" as "active" | "pending" | "blocked",
  };
  const sent: SendMessageInput[] = [];
  const telegram: TelegramClient = {
    sendMessage: vi.fn(async (input) => {
      sent.push(input);
    }),
    answerCallbackQuery: vi.fn(async () => {}),
    getFileUrl: vi.fn(async () => downloadUrl),
  };
  const resolveTelegramUser = vi.fn(async () => user);
  const createReminder = vi.fn(
    async (input: Parameters<LifeOSStore["createReminder"]>[0]) => ({
      ...input,
      id: "reminder-1",
      status: "pending",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    }),
  );
  const getTmaStudySummary = vi.fn(async () => ({
    courses: [
      {
        id: "course-1",
        title: "Real DBMS course",
        schedules: [
          {
            dayOfWeek: "saturday",
            startTime: "09:00:00",
            endTime: "10:00:00",
            room: "C1.234",
            sessionType: "lecture",
          },
        ],
      },
    ],
  }));
  const store = {
    resolveTelegramUser,
    createReminder,
    getTmaStudySummary,
    getUserOAuthConnection: vi.fn(async () => null),
    updateReminderMetadata: vi.fn(async () => {}),
  } as unknown as LifeOSStore;
  const capture: CaptureTelegramPort = {
    ingestText: vi.fn(),
    ingestVoice: vi.fn(),
    setTranscript: vi.fn(),
  };
  let stt: () => Promise<Response> = async () =>
    new Response(
      JSON.stringify({
        text:
          options.transcript ?? "Напомни завтра в 9 утра подготовиться к DBMS",
        language: "ru",
        languageProbability: 0.98,
        durationSeconds: 3,
      }),
      { headers: { "content-type": "application/json" } },
    );
  const audio = speechOgg(150);
  const fetcher = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
    if (String(input) === downloadUrl)
      return new Response(Uint8Array.from(audio).buffer, {
        headers: { "content-type": "audio/ogg" },
      });
    return stt();
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
  const voice = new LocalVoiceService(
    readLocalVoiceConfig({
      LIFEOS_VOICE_ENABLED: String(options.enabled ?? true),
      LIFEOS_VOICE_WORKER_SECRET: "s".repeat(32),
    }),
    { fetcher, now: () => now },
  );
  voices.push(voice);
  const server = createBotServer({
    config: {
      telegramWebhookPath: "/telegram/webhook",
      telegramWebhookSecret: webhookSecret,
    },
    telegram,
    store,
    capture,
    voice,
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("not listening");
  const post = (body: unknown, secret = webhookSecret) =>
    fetch(`http://127.0.0.1:${address.port}/telegram/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": secret,
      },
      body: JSON.stringify(body),
    });
  const update: TelegramUpdate = {
    update_id: 200,
    message: {
      message_id: 100,
      date: now.getTime() / 1000,
      from: { id: ownerId },
      chat: { id: ownerId, type: "private" },
      voice: {
        file_id: "synthetic-file",
        file_unique_id: "synthetic-stable-file",
        duration: 3,
        file_size: audio.length,
        mime_type: "audio/ogg",
      },
    },
  };
  const callback = (data: string, fromId = ownerId): TelegramUpdate => ({
    update_id: 201,
    callback_query: {
      id: "synthetic-callback",
      from: { id: fromId },
      data,
      message: {
        message_id: 101,
        chat: { id: ownerId, type: "private" },
      },
    },
  });
  const button = (action: "confirm" | "cancel") => {
    for (const message of [...sent].reverse()) {
      const markup = message.replyMarkup as
        | TelegramInlineKeyboardMarkup
        | undefined;
      const found = markup?.inline_keyboard
        ?.flat()
        .find((item) => item.callback_data?.startsWith(`voice:${action}:`));
      if (found?.callback_data) return found.callback_data;
    }
    throw new Error(`missing ${action} button`);
  };
  return {
    voice,
    user,
    sent,
    telegram,
    fetcher,
    capture,
    resolveTelegramUser,
    createReminder,
    getTmaStudySummary,
    update,
    post,
    callback,
    button,
    setStt: (value: () => Promise<Response>) => {
      stt = value;
    },
    advance: (milliseconds: number) => {
      now = new Date(now.getTime() + milliseconds);
    },
  };
}

describe("direct voice through authenticated Telegram HTTP webhook", () => {
  it.each(["owner", "timezone"])(
    "rejects a changed %s while acknowledging confirmation",
    async (change) => {
      const f = await fixture();
      await f.post(f.update);
      await f.voice.waitForIdle();
      vi.mocked(f.telegram.answerCallbackQuery).mockImplementationOnce(
        async () => {
          if (change === "owner") f.user.userId = "different-owner";
          else f.user.timezone = "UTC";
        },
      );
      await f.post(f.callback(f.button("confirm")));
      expect(f.createReminder).not.toHaveBeenCalled();
      expect(f.sent.at(-1)?.text).toContain("изменился");
    },
  );
  it("returns the transcript and previews an absolute reminder before one confirmed write", async () => {
    const f = await fixture();
    expect((await f.post(f.update)).status).toBe(200);
    await f.voice.waitForIdle();
    expect(f.telegram.getFileUrl).toHaveBeenCalledOnce();
    expect(f.capture.ingestVoice).not.toHaveBeenCalled();
    expect(f.createReminder).not.toHaveBeenCalled();
    expect(f.sent.map((message) => message.text).join("\n")).toContain(
      "подготовиться к DBMS",
    );
    expect(f.sent.map((message) => message.text).join("\n")).toContain(
      "2026-11-14",
    );
    const data = f.button("confirm");
    expect(data.length).toBeLessThanOrEqual(64);
    expect(data).not.toContain("DBMS");
    expect((await f.post(f.callback(data))).status).toBe(200);
    await f.voice.waitForIdle();
    expect(f.createReminder).toHaveBeenCalledOnce();
    expect(f.createReminder).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "lifeos-owner",
        message: "подготовиться к DBMS",
        remindAt: "2026-11-14T04:00:00.000Z",
      }),
    );
    await f.post(f.callback(data));
    expect(f.createReminder).toHaveBeenCalledOnce();
  });

  it("uses the user's local tomorrow and real existing study data for a read", async () => {
    const f = await fixture({ transcript: "Какие у меня завтра пары?" });
    await f.post(f.update);
    await f.voice.waitForIdle();
    expect(f.getTmaStudySummary).toHaveBeenCalledWith(
      "lifeos-owner",
      "Asia/Almaty",
    );
    expect(f.sent.map((message) => message.text).join("\n")).toContain(
      "Real DBMS course",
    );
    expect(f.sent.map((message) => message.text).join("\n")).toContain(
      "14.11.2026",
    );
    expect(f.createReminder).not.toHaveBeenCalled();
  });

  it("rejects invalid webhook authentication before owner lookup and downloading", async () => {
    const f = await fixture();
    expect((await f.post(f.update, "wrong-secret")).status).toBe(401);
    expect(f.resolveTelegramUser).not.toHaveBeenCalled();
    expect(f.telegram.getFileUrl).not.toHaveBeenCalled();
    expect(f.sent).toHaveLength(0);
  });

  it.each(["blocked", "pending"] as const)(
    "does not download for a %s profile",
    async (status) => {
      const f = await fixture();
      f.user.status = status;
      await f.post(f.update);
      await f.voice.waitForIdle();
      expect(f.telegram.getFileUrl).not.toHaveBeenCalled();
      expect(f.fetcher).not.toHaveBeenCalled();
    },
  );

  it("rejects a mismatched mapped owner", async () => {
    const f = await fixture();
    f.user.telegramUserId = 99;
    await f.post(f.update);
    await f.voice.waitForIdle();
    expect(f.telegram.getFileUrl).not.toHaveBeenCalled();
  });

  it.each(["group", "foreign", "bot"] as const)(
    "rejects %s media before downloading",
    async (kind) => {
      const f = await fixture();
      if (kind === "group") f.update.message!.chat.type = "group";
      if (kind === "foreign") f.update.message!.from!.id = 99;
      if (kind === "bot") f.update.message!.from!.is_bot = true;
      await f.post(f.update);
      await f.voice.waitForIdle();
      expect(f.telegram.getFileUrl).not.toHaveBeenCalled();
      expect(f.fetcher).not.toHaveBeenCalled();
    },
  );

  it.each([
    { duration: 91 },
    { file_size: 4 * 1024 * 1024 + 1 },
    { duration: 0 },
  ])(
    "rejects excessive or empty metadata before downloading: %j",
    async (metadata) => {
      const f = await fixture();
      Object.assign(f.update.message!.voice!, metadata);
      await f.post(f.update);
      await f.voice.waitForIdle();
      expect(f.telegram.getFileUrl).not.toHaveBeenCalled();
      expect(f.createReminder).not.toHaveBeenCalled();
    },
  );

  it("deduplicates repeated deliveries of the same voice", async () => {
    const f = await fixture();
    await f.post(f.update);
    await f.voice.waitForIdle();
    await f.post(f.update);
    await f.voice.waitForIdle();
    expect(f.telegram.getFileUrl).toHaveBeenCalledOnce();
    expect(f.fetcher).toHaveBeenCalledTimes(2);
  });

  it("acknowledges immediately and admits only one in-flight recognition", async () => {
    const f = await fixture();
    const entered = deferred<void>();
    const release = deferred<Response>();
    f.setStt(async () => {
      entered.resolve();
      return release.promise;
    });
    expect((await f.post(f.update)).status).toBe(200);
    await entered.promise;
    const second = structuredClone(f.update);
    second.update_id++;
    second.message!.message_id++;
    expect((await f.post(second)).status).toBe(200);
    expect(f.telegram.getFileUrl).toHaveBeenCalledOnce();
    release.resolve(
      new Response(
        JSON.stringify({
          text: "Какие у меня завтра пары?",
          language: "ru",
          languageProbability: 0.98,
          durationSeconds: 3,
        }),
      ),
    );
    await f.voice.waitForIdle();
    expect(f.telegram.getFileUrl).toHaveBeenCalledOnce();
  });

  it("cancels pending writes and refuses replay", async () => {
    const f = await fixture();
    await f.post(f.update);
    await f.voice.waitForIdle();
    const confirm = f.button("confirm");
    await f.post(f.callback(f.button("cancel")));
    await f.post(f.callback(confirm));
    expect(f.createReminder).not.toHaveBeenCalled();
  });

  it("refuses another caller's confirmation while preserving the owner's button", async () => {
    const f = await fixture();
    await f.post(f.update);
    await f.voice.waitForIdle();
    const confirm = f.button("confirm");
    await f.post(f.callback(confirm, 99));
    expect(f.createReminder).not.toHaveBeenCalled();
    await f.post(f.callback(confirm));
    await f.voice.waitForIdle();
    expect(f.createReminder).toHaveBeenCalledOnce();
  });

  it("rechecks active authorization at confirmation", async () => {
    const f = await fixture();
    await f.post(f.update);
    await f.voice.waitForIdle();
    const confirm = f.button("confirm");
    f.user.status = "blocked";
    await f.post(f.callback(confirm));
    expect(f.createReminder).not.toHaveBeenCalled();
  });

  it("consumes concurrent confirmations before either can duplicate a write", async () => {
    const f = await fixture();
    await f.post(f.update);
    await f.voice.waitForIdle();
    const confirm = f.button("confirm");
    await Promise.all([
      f.post(f.callback(confirm)),
      f.post(f.callback(confirm)),
    ]);
    await f.voice.waitForIdle();
    expect(f.createReminder).toHaveBeenCalledOnce();
  });

  it("refuses confirmation after the Telegram account is linked to a different owner", async () => {
    const f = await fixture();
    await f.post(f.update);
    await f.voice.waitForIdle();
    const confirm = f.button("confirm");
    f.user.userId = "other-lifeos-owner";
    await f.post(f.callback(confirm));
    expect(f.createReminder).not.toHaveBeenCalled();
  });

  it("refuses confirmation when the preview's timezone has changed", async () => {
    const f = await fixture();
    await f.post(f.update);
    await f.voice.waitForIdle();
    const confirm = f.button("confirm");
    f.user.timezone = "UTC";
    await f.post(f.callback(confirm));
    expect(f.createReminder).not.toHaveBeenCalled();
  });

  it("expires confirmation after five minutes", async () => {
    const f = await fixture();
    await f.post(f.update);
    await f.voice.waitForIdle();
    const confirm = f.button("confirm");
    f.advance(300_001);
    await f.post(f.callback(confirm));
    expect(f.createReminder).not.toHaveBeenCalled();
  });

  it("does not deliver private recognized text after the owner is blocked during STT", async () => {
    const f = await fixture();
    f.setStt(async () => {
      f.user.status = "blocked";
      return new Response(
        JSON.stringify({
          text: "PRIVATE recognized content",
          language: "en",
          languageProbability: 0.98,
          durationSeconds: 3,
        }),
      );
    });
    await f.post(f.update);
    await f.voice.waitForIdle();
    expect(JSON.stringify(f.sent)).not.toContain("PRIVATE recognized content");
    expect(f.createReminder).not.toHaveBeenCalled();
  });

  it("suppresses private diagnostics from failed STT and asks the user to repeat", async () => {
    const logs = [
      vi.spyOn(console, "error").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(console, "log").mockImplementation(() => {}),
    ];
    const f = await fixture();
    f.setStt(async () => {
      throw new Error(`${downloadUrl} PRIVATE recognised note`);
    });
    await f.post(f.update);
    await f.voice.waitForIdle();
    const serialized = JSON.stringify([
      f.sent,
      logs.map((log) => log.mock.calls),
    ]);
    expect(serialized).not.toContain("PRIVATE recognised note");
    expect(serialized).not.toContain(downloadUrl);
    expect(serialized).not.toContain("123:synthetic");
    expect(f.sent.map((message) => message.text).join("\n")).toMatch(
      /повтор|ещ[её] раз/i,
    );
    expect(f.createReminder).not.toHaveBeenCalled();
    expect(f.capture.ingestVoice).not.toHaveBeenCalled();
    expect(f.capture.ingestText).not.toHaveBeenCalled();
  });

  it("rejects uncertain STT output without echoing or executing it", async () => {
    const f = await fixture();
    f.setStt(
      async () =>
        new Response(
          JSON.stringify({
            text: "PRIVATE uncertain transcription",
            language: "ru",
            languageProbability: 0.15,
            durationSeconds: 3,
          }),
        ),
    );
    await f.post(f.update);
    await f.voice.waitForIdle();
    expect(JSON.stringify(f.sent)).not.toContain(
      "PRIVATE uncertain transcription",
    );
    expect(f.createReminder).not.toHaveBeenCalled();
  });

  it("also recognizes an ordinary Ogg/Opus audio attachment", async () => {
    const f = await fixture({ transcript: "Какие у меня завтра пары?" });
    f.update.message!.audio = f.update.message!.voice;
    delete f.update.message!.voice;
    await f.post(f.update);
    await f.voice.waitForIdle();
    expect(f.telegram.getFileUrl).toHaveBeenCalledOnce();
    expect(f.getTmaStudySummary).toHaveBeenCalledOnce();
  });
});
