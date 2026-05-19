import type { SendMessageInput, TelegramClient } from "./types.js";

interface TelegramSendMessagePayload {
  chat_id: number;
  text: string;
  parse_mode?: "HTML";
  reply_markup?: SendMessageInput["replyMarkup"];
}

export class TelegramHttpClient implements TelegramClient {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async sendMessage(input: SendMessageInput): Promise<void> {
    const payload: TelegramSendMessagePayload = {
      chat_id: input.chatId,
      text: input.text,
      parse_mode: "HTML",
      reply_markup: input.replyMarkup,
    };
    const response = await this.fetchImpl(
      `https://api.telegram.org/bot${this.token}/sendMessage`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Telegram sendMessage failed: ${response.status} ${body}`,
      );
    }
  }
}
