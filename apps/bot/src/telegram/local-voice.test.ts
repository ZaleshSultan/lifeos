import { afterEach, describe, expect, it, vi } from "vitest";
import type { LifeOSStore } from "@lifeos/db";
import { speechOgg } from "../capture-speech-provider.test-fixtures.js";
import { loadBotConfig } from "../config.js";
import { LocalVoiceService, readLocalVoiceConfig } from "./local-voice.js";
import type { TelegramBotRuntime, TelegramUpdate } from "./types.js";

const voices: LocalVoiceService[] = [];
afterEach(() => {
  for (const voice of voices.splice(0)) voice.close();
  vi.useRealTimers();
});
const secret = "s".repeat(32);
const now = new Date("2026-11-12T12:00:00Z");
const destination =
  "https://api.telegram.org/file/bot123:synthetic/voice/test.oga";
const validResult = {
  text: "помощь",
  language: "ru",
  languageProbability: 0.99,
  durationSeconds: 2,
};

function fixture(
  result: unknown = validResult,
  overrides: Record<string, string> = {},
) {
  const config = readLocalVoiceConfig({
    LIFEOS_VOICE_ENABLED: "true",
    LIFEOS_VOICE_WORKER_SECRET: secret,
    ...overrides,
  });
  const bytes = speechOgg(100);
  let worker: () => Promise<Response> = async () =>
    new Response(JSON.stringify(result));
  const fetcher = vi.fn(async (url: Parameters<typeof fetch>[0]) =>
    String(url) === destination
      ? new Response(Uint8Array.from(bytes).buffer, {
          headers: { "content-type": "audio/ogg" },
        })
      : worker(),
  ) as typeof fetch & ReturnType<typeof vi.fn>;
  const voice = new LocalVoiceService(config, { fetcher, now: () => now });
  voices.push(voice);
  const runtime: TelegramBotRuntime = {
    telegram: {
      getFileUrl: vi.fn(async () => destination),
      sendMessage: vi.fn(async () => {}),
      answerCallbackQuery: vi.fn(async () => {}),
    },
    store: {
      resolveTelegramUser: vi.fn(async () => ({
        userId: "owner",
        telegramUserId: 30,
        status: "active",
        timezone: "Asia/Almaty",
      })),
    } as unknown as LifeOSStore,
  };
  const update: TelegramUpdate = {
    update_id: 1,
    message: {
      message_id: 2,
      from: { id: 30 },
      chat: { id: 30, type: "private" },
      date: now.getTime() / 1000,
      voice: {
        file_id: "file",
        file_unique_id: "unique",
        duration: 2,
        file_size: bytes.byteLength,
        mime_type: "audio/ogg",
      },
    },
  };
  const dispatch = vi.fn(async () => {});
  return {
    voice,
    fetcher,
    runtime,
    update,
    dispatch,
    setWorker: (next: typeof worker) => {
      worker = next;
    },
  };
}

describe("local voice configuration", () => {
  it("defaults off with bounded tiny-worker transport and propagates explicit config", () => {
    expect(readLocalVoiceConfig({})).toMatchObject({
      enabled: false,
      maxSeconds: 90,
      maxBytes: 4 * 1024 * 1024,
      language: "auto",
    });
    expect(
      loadBotConfig({
        LIFEOS_VOICE_ENABLED: "true",
        LIFEOS_VOICE_WORKER_SECRET: secret,
        LIFEOS_VOICE_LANGUAGE: "kk",
      }).voice,
    ).toMatchObject({ enabled: true, language: "kk" });
  });
  it.each([
    { LIFEOS_VOICE_WORKER_SECRET: "" },
    { LIFEOS_VOICE_WORKER_SECRET: "short" },
    { LIFEOS_VOICE_WORKER_URL: "https://example.com/transcribe" },
    {
      LIFEOS_VOICE_WORKER_URL:
        "http://127.0.0.1:8091/transcribe?secret=private",
    },
    { LIFEOS_VOICE_WORKER_URL: "http://user:secret@127.0.0.1:8091/transcribe" },
    { LIFEOS_VOICE_MAX_BYTES: "4194305" },
    { LIFEOS_VOICE_MAX_SECONDS: "91" },
    { LIFEOS_VOICE_TIMEOUT_MS: "180001" },
    { LIFEOS_VOICE_LANGUAGE: "de" },
  ])("rejects unsafe configuration %j", (change) => {
    expect(() =>
      readLocalVoiceConfig({
        LIFEOS_VOICE_ENABLED: "true",
        LIFEOS_VOICE_WORKER_SECRET: secret,
        ...change,
      }),
    ).toThrow();
  });
});

describe("local STT result and lifetime boundaries", () => {
  it.each([
    { text: "" },
    { text: "x" },
    { text: "!?!" },
    { text: "x".repeat(1501) },
    { text: "private\ntext" },
    { language: "de" },
    { languageProbability: 0.49 },
    { languageProbability: null },
    { languageProbability: 1.01 },
    { durationSeconds: 0 },
    { durationSeconds: 91 },
  ])(
    "rejects invalid or uncertain STT output %j without dispatch",
    async (change) => {
      const f = fixture({ ...validResult, ...change });
      await f.voice.handleUpdate(f.update, f.runtime, f.dispatch);
      await f.voice.waitForIdle();
      expect(f.dispatch).not.toHaveBeenCalled();
      expect(f.runtime.telegram.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringContaining("Повтори") }),
      );
    },
  );
  it.each(["ru", "kk", "en"])(
    "passes a forced %s language to the private worker",
    async (language) => {
      const f = fixture(
        { ...validResult, language, languageProbability: 0 },
        { LIFEOS_VOICE_LANGUAGE: language },
      );
      await f.voice.handleUpdate(f.update, f.runtime, f.dispatch);
      await f.voice.waitForIdle();
      expect(f.fetcher).toHaveBeenCalledWith(
        "http://127.0.0.1:8091/transcribe",
        expect.objectContaining({
          redirect: "error",
          headers: expect.objectContaining({
            "x-voice-language": language,
            authorization: `Bearer ${secret}`,
          }),
        }),
      );
      expect(f.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.objectContaining({ text: "/help" }),
        }),
        expect.anything(),
      );
    },
  );
  it("bounds streamed STT response before JSON parsing", async () => {
    const f = fixture();
    f.setWorker(async () => new Response("x".repeat(16_385)));
    await f.voice.handleUpdate(f.update, f.runtime, f.dispatch);
    await f.voice.waitForIdle();
    expect(f.dispatch).not.toHaveBeenCalled();
  });
  it("cancels a stuck worker and prevents late text/commands", async () => {
    vi.useFakeTimers();
    const f = fixture(validResult, { LIFEOS_VOICE_TIMEOUT_MS: "1000" });
    let resolve!: (response: Response) => void;
    f.setWorker(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    await f.voice.handleUpdate(f.update, f.runtime, f.dispatch);
    await vi.advanceTimersByTimeAsync(1_001);
    await f.voice.waitForIdle();
    expect(f.dispatch).not.toHaveBeenCalled();
    resolve(new Response(JSON.stringify(validResult)));
    await vi.advanceTimersByTimeAsync(1);
    expect(f.dispatch).not.toHaveBeenCalled();
    expect(f.runtime.telegram.sendMessage).toHaveBeenCalledTimes(1);
  });
  it("revokes pending confirmation when preview delivery exceeds the deadline", async () => {
    vi.useFakeTimers();
    const f = fixture(
      { ...validResult, text: "создай задачу проверить DBMS" },
      { LIFEOS_VOICE_TIMEOUT_MS: "1000" },
    );
    let callback: string | undefined;
    let finish!: () => void;
    vi.mocked(f.runtime.telegram.sendMessage).mockImplementation(
      async (input) => {
        if (input.replyMarkup && "inline_keyboard" in input.replyMarkup) {
          callback = input.replyMarkup.inline_keyboard[0]?.[0]?.callback_data;
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
        }
      },
    );
    await f.voice.handleUpdate(f.update, f.runtime, f.dispatch);
    await vi.advanceTimersByTimeAsync(1_001);
    await f.voice.waitForIdle();
    expect(callback).toBeDefined();
    finish();
    await f.voice.handleUpdate(
      {
        update_id: 3,
        callback_query: {
          id: "cb",
          from: { id: 30 },
          message: f.update.message,
          data: callback,
        },
      },
      f.runtime,
      f.dispatch,
    );
    expect(f.dispatch).not.toHaveBeenCalled();
  });
});
