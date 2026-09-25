import { describe, expect, it } from "vitest";
import { TelegramHttpClient } from "./client.js";

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
