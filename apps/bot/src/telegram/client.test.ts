import { afterEach, describe, expect, it, vi } from "vitest";
import { TelegramHttpClient } from "./client.js";

afterEach(() => vi.useRealTimers());

describe("TelegramHttpClient button methods", () => {
  it("sends answerCallbackQuery with the Telegram callback id", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({ url: String(input), init });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const client = new TelegramHttpClient("test-token", fetchImpl);

    await client.answerCallbackQuery({
      callbackQueryId: "callback-123",
      text: "Кнопка устарела",
      showAlert: true,
    });

    expect(requests[0]?.url).toBe(
      "https://api.telegram.org/bottest-token/answerCallbackQuery",
    );
    expect(requests[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      callback_query_id: "callback-123",
      text: "Кнопка устарела",
      show_alert: true,
    });
  });

  it("passes a persistent reply keyboard to sendMessage", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({ url: String(input), init });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const client = new TelegramHttpClient("test-token", fetchImpl);

    await client.sendMessage({
      chatId: 30,
      text: "Выберите раздел",
      replyMarkup: {
        keyboard: [[{ text: "Учёба" }]],
        resize_keyboard: true,
        is_persistent: true,
      },
    });

    expect(requests[0]?.url).toBe(
      "https://api.telegram.org/bottest-token/sendMessage",
    );
    expect(JSON.parse(String(requests[0]?.init?.body))).toMatchObject({
      chat_id: 30,
      reply_markup: {
        keyboard: [[{ text: "Учёба" }]],
        resize_keyboard: true,
        is_persistent: true,
      },
    });
  });
});

describe("bounded private Telegram file client", () => {
  it("bounds getFile and validates the returned relative path", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            result: { file_path: "voice/file_12.oga", file_size: 47 },
          }),
        ),
    );
    const client = new TelegramHttpClient("synthetic-token", fetcher);
    await expect(client.getFileUrl("synthetic-file")).resolves.toBe(
      "https://api.telegram.org/file/botsynthetic-token/voice/file_12.oga",
    );
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.telegram.org/botsynthetic-token/getFile",
      expect.objectContaining({
        redirect: "error",
        signal: expect.any(AbortSignal),
      }),
    );
  });
  it.each([
    "../secret",
    "/absolute/file",
    "https://evil.example/file",
    "voice/../file",
    "voice/a?token=hidden",
    "voice/a#fragment",
    "voice/%2fsecret",
    "voice/a\\b",
  ])(
    "rejects malformed getFile paths without exposing upstream data",
    async (file_path) => {
      const client = new TelegramHttpClient(
        "synthetic-token",
        async () =>
          new Response(JSON.stringify({ ok: true, result: { file_path } })),
      );
      await expect(client.getFileUrl("file")).rejects.toMatchObject({
        message: "telegram_file_unavailable",
      });
    },
  );
  it("rejects oversized JSON and suppresses token-bearing provider diagnostics", async () => {
    const client = new TelegramHttpClient(
      "synthetic-token",
      async () => new Response("x".repeat(65_537)),
    );
    await expect(client.getFileUrl("file")).rejects.toMatchObject({
      message: "telegram_file_unavailable",
    });
    const failed = new TelegramHttpClient("synthetic-token", async () => {
      throw new Error("botsecret-token PRIVATE-NOTE");
    });
    await expect(failed.getFileUrl("file")).rejects.toMatchObject({
      message: "telegram_file_unavailable",
    });
  });
  it("does not request malformed file IDs", async () => {
    const fetcher = vi.fn(async () => new Response("{}"));
    const client = new TelegramHttpClient("synthetic-token", fetcher);
    await expect(client.getFileUrl("\nnot-a-file")).rejects.toThrowError(
      "telegram_file_id_invalid",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("honors timeout even if fetch ignores the abort signal", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => new Promise<Response>(() => {}));
    const client = new TelegramHttpClient("synthetic-token", fetcher);
    const rejected = expect(client.getFileUrl("file")).rejects.toMatchObject({
      message: "telegram_file_cancelled_or_timeout",
    });
    await vi.advanceTimersByTimeAsync(10_001);
    await rejected;
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("honors caller cancellation and cannot hang on reader cancellation", async () => {
    const controller = new AbortController();
    const body = new ReadableStream<Uint8Array>({
      start() {},
      cancel: () => new Promise<void>(() => {}),
    });
    const client = new TelegramHttpClient(
      "synthetic-token",
      async () => new Response(body),
    );
    const rejected = expect(
      client.getFileUrl("file", controller.signal),
    ).rejects.toMatchObject({ message: "telegram_file_cancelled_or_timeout" });
    controller.abort();
    await rejected;
  });
  it("downloads voice through the bounded validated audio path only", async () => {
    const bytes = new Uint8Array(47);
    bytes.set(Buffer.from("OggS"));
    bytes[5] = 2;
    bytes[26] = 1;
    bytes[27] = 19;
    bytes.set(Buffer.from("OpusHead"), 28);
    bytes[36] = 1;
    bytes[37] = 1;
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      requests.push(String(input));
      return requests.length === 1
        ? new Response(
            JSON.stringify({
              ok: true,
              result: { file_path: "voice/file.oga" },
            }),
          )
        : new Response(bytes.buffer);
    };
    const result = await new TelegramHttpClient(
      "synthetic-token",
      fetcher,
    ).downloadVoice("file");
    expect(result.bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(result.bytes)).toEqual(Array.from(bytes));
    expect(requests).toEqual([
      "https://api.telegram.org/botsynthetic-token/getFile",
      "https://api.telegram.org/file/botsynthetic-token/voice/file.oga",
    ]);
    expect(JSON.stringify(result)).not.toContain("synthetic-token");
  });
});
