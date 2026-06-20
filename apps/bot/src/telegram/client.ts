import type { SendMessageInput, TelegramClient } from "./types.js";

interface TelegramSendMessagePayload {
  chat_id: number;
  text: string;
  parse_mode?: "HTML";
  reply_markup?: SendMessageInput["replyMarkup"];
}

interface TelegramGetFileResponse {
  ok: boolean;
  result?: {
    file_id: string;
    file_unique_id: string;
    file_size?: number;
    file_path?: string;
  };
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

  async getFileUrl(fileId: string): Promise<string> {
    const response = await this.fetchImpl(
      `https://api.telegram.org/bot${this.token}/getFile`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ file_id: fileId }),
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Telegram getFile failed: ${response.status} ${body}`,
      );
    }

    const json = (await response.json()) as TelegramGetFileResponse;

    if (!json.ok || !json.result?.file_path) {
      throw new Error(
        "Telegram getFile returned no file_path",
      );
    }

    return `https://api.telegram.org/file/bot${this.token}/${json.result.file_path}`;
  }
}
