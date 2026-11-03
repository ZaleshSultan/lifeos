import type {
  AnswerCallbackQueryInput,
  SendMessageInput,
  TelegramClient,
} from "./types.js";
import { downloadTelegramVoice, type TelegramVoiceAudio } from "./voice.js";

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

  async answerCallbackQuery(input: AnswerCallbackQueryInput): Promise<void> {
    const response = await this.fetchImpl(
      `https://api.telegram.org/bot${this.token}/answerCallbackQuery`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          callback_query_id: input.callbackQueryId,
          text: input.text,
          show_alert: input.showAlert,
        }),
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Telegram answerCallbackQuery failed: ${response.status} ${body}`,
      );
    }
  }

  async getFileUrl(fileId: string, signal?: AbortSignal): Promise<string> {
    if (typeof fileId !== "string" || !/^[\x21-\x7e]{1,1024}$/.test(fileId))
      throw new Error("telegram_file_id_invalid");
    const controller = new AbortController();
    const stop = () => controller.abort(new Error("telegram_file_cancelled"));
    if (signal?.aborted) stop();
    signal?.addEventListener("abort", stop, { once: true });
    const timer = setTimeout(
      () => controller.abort(new Error("telegram_file_timeout")),
      10_000,
    );
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let rejectAbort: (() => void) | undefined;
    const cancelReader = () => {
      try {
        void reader?.cancel().catch(() => {});
      } catch {
        /* do not retain upstream errors */
      }
    };
    const abort = new Promise<never>((_resolve, reject) => {
      rejectAbort = () => reject(controller.signal.reason);
      if (controller.signal.aborted) rejectAbort();
      else
        controller.signal.addEventListener("abort", rejectAbort, {
          once: true,
        });
    });
    const work = (async () => {
      try {
        controller.signal.throwIfAborted();
        const response = await this.fetchImpl(
          `https://api.telegram.org/bot${this.token}/getFile`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ file_id: fileId }),
            signal: controller.signal,
            redirect: "error",
          },
        );
        if (response.body) reader = response.body.getReader();
        controller.signal.throwIfAborted();
        const length = response.headers.get("content-length");
        if (
          !response.ok ||
          !reader ||
          (length !== null &&
            (!/^\d+$/.test(length) || Number(length) > 65_536))
        )
          throw new Error("telegram_file_unavailable");
        const chunks: Uint8Array[] = [];
        let size = 0;
        for (;;) {
          controller.signal.throwIfAborted();
          const part = await reader.read();
          controller.signal.throwIfAborted();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 65_536) throw new Error("telegram_file_unavailable");
          chunks.push(part.value);
        }
        const json = JSON.parse(
          Buffer.concat(chunks, size).toString("utf8"),
        ) as TelegramGetFileResponse;
        const path = json?.result?.file_path;
        const bytes = json?.result?.file_size;
        if (
          json?.ok !== true ||
          typeof path !== "string" ||
          path.length > 512 ||
          !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(path) ||
          path.split("/").some((part) => part === "." || part === "..") ||
          (bytes !== undefined &&
            (!Number.isSafeInteger(bytes) ||
              bytes < 1 ||
              bytes > 20 * 1024 * 1024))
        )
          throw new Error("telegram_file_unavailable");
        return `https://api.telegram.org/file/bot${this.token}/${path}`;
      } finally {
        cancelReader();
      }
    })();
    try {
      return await Promise.race([work, abort]);
    } catch {
      // Token-bearing URLs and upstream response bodies never escape this client.
      throw new Error(
        controller.signal.aborted
          ? "telegram_file_cancelled_or_timeout"
          : "telegram_file_unavailable",
      );
    } finally {
      clearTimeout(timer);
      controller.abort();
      if (rejectAbort)
        controller.signal.removeEventListener("abort", rejectAbort);
      signal?.removeEventListener("abort", stop);
      cancelReader();
    }
  }

  async downloadVoice(
    fileId: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<TelegramVoiceAudio> {
    const url = await this.getFileUrl(fileId, options.signal);
    return downloadTelegramVoice(url, {
      signal: options.signal,
      fetcher: this.fetchImpl,
    });
  }
}
