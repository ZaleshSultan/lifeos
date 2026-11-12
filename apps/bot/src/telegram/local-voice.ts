import { randomBytes } from "node:crypto";
import {
  integerEnv,
  optionalEnv,
  planVoiceCommand,
  type EnvSource,
} from "@lifeos/core";
import type { TelegramUserRecord } from "@lifeos/db";
import type {
  SendMessageInput,
  TelegramBotRuntime,
  TelegramMessage,
  TelegramUpdate,
} from "./types.js";
import {
  downloadTelegramVoice,
  validateBoundedOggOpus,
  validateTelegramVoice,
} from "./voice.js";

export interface LocalVoiceConfig {
  enabled: boolean;
  workerUrl: string;
  secret?: string;
  language: "auto" | "ru" | "kk" | "en";
  maxBytes: number;
  maxSeconds: number;
  timeoutMs: number;
}

export function readLocalVoiceConfig(
  env: EnvSource = process.env,
): LocalVoiceConfig {
  const enabled = optionalEnv(env, "LIFEOS_VOICE_ENABLED", "false") === "true";
  const workerUrl = optionalEnv(
    env,
    "LIFEOS_VOICE_WORKER_URL",
    "http://127.0.0.1:8091/transcribe",
  )!;
  const secret = optionalEnv(env, "LIFEOS_VOICE_WORKER_SECRET");
  const language = optionalEnv(env, "LIFEOS_VOICE_LANGUAGE", "auto")!;
  const config = {
    enabled,
    workerUrl,
    secret,
    language,
    maxBytes: integerEnv(env, "LIFEOS_VOICE_MAX_BYTES", 4 * 1024 * 1024),
    maxSeconds: integerEnv(env, "LIFEOS_VOICE_MAX_SECONDS", 90),
    timeoutMs: integerEnv(env, "LIFEOS_VOICE_TIMEOUT_MS", 135_000),
  };
  validateConfig(config);
  return config as LocalVoiceConfig;
}

function validateConfig(
  config: Omit<LocalVoiceConfig, "language"> & { language: string },
) {
  let url: URL;
  try {
    url = new URL(config.workerUrl);
  } catch {
    throw new Error("voice_worker_url_invalid");
  }
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/transcribe"
  )
    throw new Error("voice_worker_url_must_be_loopback");
  if (!["auto", "ru", "kk", "en"].includes(config.language))
    throw new Error("voice_language_invalid");
  if (
    config.enabled &&
    (!config.secret || !/^[A-Za-z0-9_-]{32,256}$/.test(config.secret))
  )
    throw new Error("voice_worker_secret_required");
  for (const [value, minimum, maximum] of [
    [config.maxBytes, 47, 4 * 1024 * 1024],
    [config.maxSeconds, 1, 90],
    [config.timeoutMs, 1000, 180_000],
  ])
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
      throw new Error("voice_limit_invalid");
}

type Dispatch = (
  update: TelegramUpdate,
  runtime: TelegramBotRuntime,
) => Promise<void>;
interface Pending {
  userId: string;
  telegramUserId: number;
  timezone: string;
  expires: number;
  update: TelegramUpdate;
  command: string;
}
const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const positive = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const retryText =
  "Не удалось уверенно распознать голосовое. Повтори короткое сообщение без фонового шума или отправь команду текстом.";
const confirmationTtl = 300_000;
const maxRemembered = 1000;

async function boundedIo<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("voice_io_timeout")), 5000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** One in-flight job, no audio/transcript persistence and no provider/network logging. */
export class LocalVoiceService {
  private readonly fetcher: typeof fetch;
  private readonly now: () => Date;
  private running?: Promise<void>;
  private controller?: AbortController;
  private closed = false;
  private readonly seen = new Map<string, number>();
  private readonly pending = new Map<string, Pending>();
  private readonly cleanup: ReturnType<typeof setInterval>;

  constructor(
    private readonly config: LocalVoiceConfig,
    deps: { fetcher?: typeof fetch; now?: () => Date } = {},
  ) {
    validateConfig(config);
    this.fetcher = deps.fetcher ?? fetch;
    this.now = deps.now ?? (() => new Date());
    this.cleanup = setInterval(() => this.prune(), 30_000);
    this.cleanup.unref();
  }

  close(): void {
    this.closed = true;
    clearInterval(this.cleanup);
    this.controller?.abort();
    this.pending.clear();
    this.seen.clear();
  }

  async waitForIdle(): Promise<void> {
    await this.running;
  }

  private prune() {
    const now = this.now().getTime();
    for (const [key, expiry] of this.seen)
      if (expiry <= now) this.seen.delete(key);
    for (const [key, pending] of this.pending)
      if (pending.expires <= now) this.pending.delete(key);
  }

  private async reply(
    runtime: TelegramBotRuntime,
    message: TelegramMessage,
    text: string,
    replyMarkup?: SendMessageInput["replyMarkup"],
  ): Promise<boolean> {
    if (this.closed) return false;
    try {
      await boundedIo(
        runtime.telegram.sendMessage({
          chatId: message.chat.id,
          text,
          replyMarkup,
        }),
      );
      return true;
    } catch {
      return false;
    } // Telegram errors can contain token URLs or echoed private text.
  }

  private async owner(
    runtime: TelegramBotRuntime,
    message: TelegramMessage,
    expected?: string,
  ): Promise<TelegramUserRecord | null> {
    if (
      !runtime.store ||
      message.chat?.type !== "private" ||
      !positive(message.from?.id) ||
      message.from.is_bot === true ||
      message.chat.id !== message.from.id
    )
      return null;
    const user = await boundedIo(
      runtime.store.resolveTelegramUser(message.from.id),
    );
    return user?.status === "active" &&
      user.telegramUserId === message.from.id &&
      (!expected || user.userId === expected)
      ? user
      : null;
  }

  /** Runs before Capture so recognized speech cannot silently become a data write. */
  async handleUpdate(
    update: TelegramUpdate,
    runtime: TelegramBotRuntime,
    dispatch: Dispatch,
  ): Promise<boolean> {
    const callback = update.callback_query;
    if (
      typeof callback?.data === "string" &&
      callback.data.startsWith("voice:")
    ) {
      await this.confirm(update, runtime, dispatch);
      return true;
    }
    const message = update.message;
    if (
      !this.config.enabled ||
      !message ||
      (message.voice === undefined && message.audio === undefined)
    )
      return false;
    if (
      this.closed ||
      !positive(message.message_id) ||
      !Number.isSafeInteger(update.update_id) ||
      update.update_id < 0
    )
      return true;
    let user: TelegramUserRecord | null;
    try {
      user = await this.owner(runtime, message);
    } catch {
      user = null;
    }
    if (!user) return true;
    this.prune();
    const key = `${message.chat.id}:${message.message_id}`;
    if (this.seen.has(key)) return true;
    // Do not process stale Telegram retries or build an unbounded backlog.
    if (
      !positive(message.date) ||
      message.date * 1000 < this.now().getTime() - 600_000 ||
      message.date * 1000 > this.now().getTime() + 300_000
    ) {
      await this.reply(runtime, message, retryText);
      return true;
    }
    if (
      this.running ||
      this.seen.size >= maxRemembered ||
      this.pending.size >= 100
    ) {
      await this.reply(
        runtime,
        message,
        "Сейчас обрабатывается другое голосовое. Отправь сообщение чуть позже.",
      );
      return true;
    }
    this.seen.set(key, this.now().getTime() + 86_400_000);
    try {
      const ref = validateTelegramVoice(
        message.voice ?? message.audio,
        message.date,
        this.now(),
      );
      if (
        ref.durationSeconds > this.config.maxSeconds ||
        (ref.fileSize ?? 0) > this.config.maxBytes
      )
        throw new Error("voice_limit");
      const controller = new AbortController();
      this.controller = controller;
      // Starting a background job lets Telegram receive its webhook ACK immediately.
      this.running = this.process(
        update,
        runtime,
        dispatch,
        user,
        ref.fileId,
        controller,
      )
        .catch(async () => {
          if (!controller.signal.aborted || !this.closed) {
            try {
              if (await this.owner(runtime, message, user!.userId))
                await this.reply(runtime, message, retryText);
            } catch {
              /* fail closed */
            }
          }
        })
        .finally(() => {
          this.running = undefined;
          this.controller = undefined;
        });
    } catch {
      await this.reply(
        runtime,
        message,
        `Отправь OGG/Opus длительностью до ${this.config.maxSeconds} секунд и размером до ${Math.floor(this.config.maxBytes / 1024 / 1024)} МБ. ${retryText}`,
      );
    }
    return true;
  }

  private async process(
    update: TelegramUpdate,
    runtime: TelegramBotRuntime,
    dispatch: Dispatch,
    user: TelegramUserRecord,
    fileId: string,
    controller: AbortController,
  ): Promise<void> {
    const message = update.message!;
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    let audio: Uint8Array | undefined;
    let pendingToken: string | undefined;
    let succeeded = false;
    // Race even transports that ignore AbortSignal; the real worker kills timed-out inference.
    const onAbort = () => rejectAbort?.(new Error("voice_cancelled"));
    let rejectAbort: ((reason: Error) => void) | undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAbort = reject;
    });
    controller.signal.addEventListener("abort", onAbort, { once: true });
    const work = async () => {
      const url = await runtime.telegram.getFileUrl(fileId, controller.signal);
      controller.signal.throwIfAborted();
      const downloaded = await downloadTelegramVoice(url, {
        fetcher: this.fetcher,
        signal: controller.signal,
        maxBytes: this.config.maxBytes,
      });
      audio = downloaded.bytes;
      controller.signal.throwIfAborted();
      if (validateBoundedOggOpus(audio) > this.config.maxSeconds)
        throw new Error("voice_too_long");
      if (!(await this.owner(runtime, message, user.userId)))
        throw new Error("voice_access_revoked");
      controller.signal.throwIfAborted();
      const response = await this.fetcher(this.config.workerUrl, {
        method: "POST",
        redirect: "error",
        signal: controller.signal,
        headers: {
          "content-type": "audio/ogg",
          authorization: `Bearer ${this.config.secret}`,
          "x-voice-language": this.config.language,
        },
        body: Uint8Array.from(audio).buffer,
      });
      controller.signal.throwIfAborted();
      const result = await this.readResult(response, controller.signal);
      const text = result.text;
      const currentUser = await this.owner(runtime, message, user.userId);
      if (!currentUser) return;
      controller.signal.throwIfAborted();
      const plan = planVoiceCommand(text, {
        now: this.now(),
        timezone: currentUser.timezone,
      });
      if (
        !(await this.reply(
          runtime,
          message,
          `Распознано:\n${escapeHtml(text)}`,
        ))
      )
        return;
      controller.signal.throwIfAborted();
      if (plan.kind === "unsupported") {
        await this.reply(runtime, message, escapeHtml(plan.message));
        return;
      }
      if (plan.requiresConfirmation) {
        const token = randomBytes(18).toString("base64url");
        pendingToken = token;
        this.pending.set(token, {
          userId: user.userId,
          telegramUserId: message.chat.id,
          timezone: currentUser.timezone,
          expires: this.now().getTime() + confirmationTtl,
          update,
          command: plan.text,
        });
        const sent = await this.reply(
          runtime,
          message,
          `Проверь команду:\n${escapeHtml(plan.preview)}\n<code>${escapeHtml(plan.text)}</code>\n\nВыполнить? Подтверждение действует 5 минут.`,
          {
            inline_keyboard: [
              [
                {
                  text: "Подтвердить",
                  callback_data: `voice:confirm:${token}`,
                },
                { text: "Отмена", callback_data: `voice:cancel:${token}` },
              ],
            ],
          },
        );
        if (!sent) this.pending.delete(token);
      } else
        await this.execute(update, plan.text, runtime, dispatch, currentUser);
    };
    try {
      await Promise.race([work().finally(() => audio?.fill(0)), aborted]);
      succeeded = true;
    } finally {
      if (!succeeded && pendingToken) this.pending.delete(pendingToken);
      clearTimeout(timer);
      controller.abort();
      controller.signal.removeEventListener("abort", onAbort);
      audio?.fill(0);
    }
  }

  private async readResult(
    response: Response,
    signal: AbortSignal,
  ): Promise<{ text: string }> {
    if (!response.ok || !response.body) {
      void response.body?.cancel().catch(() => {});
      throw new Error("voice_worker_unavailable");
    }
    const reader = response.body.getReader();
    const stop = () => {
      void reader.cancel().catch(() => {});
    };
    signal.addEventListener("abort", stop, { once: true });
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        signal.throwIfAborted();
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 16_384) throw new Error("voice_result_large");
        chunks.push(part.value);
      }
      const result = JSON.parse(
        Buffer.concat(chunks, size).toString("utf8"),
      ) as Record<string, unknown>;
      if (
        typeof result.text !== "string" ||
        result.text.trim().length < 2 ||
        result.text.length > 1500 ||
        /[\u0000-\u001f\u007f]/.test(result.text) ||
        !/[\p{L}\p{N}]/u.test(result.text) ||
        !["ru", "kk", "en"].includes(String(result.language)) ||
        typeof result.languageProbability !== "number" ||
        !Number.isFinite(result.languageProbability) ||
        result.languageProbability <
          (this.config.language === "auto" ? 0.5 : 0) ||
        result.languageProbability > 1 ||
        typeof result.durationSeconds !== "number" ||
        !Number.isFinite(result.durationSeconds) ||
        result.durationSeconds <= 0 ||
        result.durationSeconds > this.config.maxSeconds
      )
        throw new Error("voice_result_invalid");
      return { text: result.text.trim() };
    } finally {
      signal.removeEventListener("abort", stop);
      stop();
    }
  }

  private async execute(
    update: TelegramUpdate,
    command: string,
    runtime: TelegramBotRuntime,
    dispatch: Dispatch,
    expectedOwner: { userId: string; timezone: string },
  ) {
    if (this.closed) return;
    const message = update.message!;
    await dispatch(
      {
        update_id: update.update_id,
        message: {
          message_id: message.message_id,
          from: message.from,
          chat: message.chat,
          date: message.date,
          text: command,
        },
      },
      {
        ...runtime,
        voice: undefined,
        voiceCommandOwner: {
          userId: expectedOwner.userId,
          timezone: expectedOwner.timezone,
        },
        now: this.now,
      },
    );
  }

  private async confirm(
    update: TelegramUpdate,
    runtime: TelegramBotRuntime,
    dispatch: Dispatch,
  ) {
    const callback = update.callback_query!;
    if (!callback.id) return;
    const answer = async (text?: string) => {
      try {
        await boundedIo(
          runtime.telegram.answerCallbackQuery({
            callbackQueryId: callback.id!,
            text,
            showAlert: Boolean(text),
          }),
        );
      } catch {
        /* private upstream errors */
      }
    };
    const match = /^voice:(confirm|cancel):([A-Za-z0-9_-]{24})$/.exec(
      callback.data ?? "",
    );
    const message = callback.message;
    const pending = match ? this.pending.get(match[2]!) : undefined;
    if (
      !this.config.enabled ||
      this.closed ||
      !pending ||
      pending.expires <= this.now().getTime()
    ) {
      this.prune();
      await answer(
        "Подтверждение недоступно или истекло. Отправь голосовое заново.",
      );
      return;
    }
    if (
      !message ||
      message.chat?.type !== "private" ||
      callback.from?.is_bot === true ||
      callback.from?.id !== pending.telegramUserId ||
      message.chat.id !== pending.telegramUserId
    ) {
      await answer("Эта команда принадлежит другому пользователю.");
      return;
    }
    // Consume synchronously before authorization awaits; retries cannot repeat a mutation.
    this.pending.delete(match![2]!);
    let user: TelegramUserRecord | null;
    try {
      user = await this.owner(
        runtime,
        { ...message, from: callback.from },
        pending.userId,
      );
    } catch {
      user = null;
    }
    if (!user) {
      await answer("Доступ недоступен. Отправь /start в личном чате.");
      return;
    }
    if (user.timezone !== pending.timezone) {
      await answer(
        "Часовой пояс изменился. Отправь голосовое заново, чтобы проверить время.",
      );
      return;
    }
    await answer();
    if (match![1] === "cancel") {
      await this.reply(runtime, message, "Команда отменена.");
      return;
    }
    try {
      await this.execute(
        pending.update,
        pending.command,
        runtime,
        dispatch,
        pending,
      );
    } catch {
      await this.reply(
        runtime,
        message,
        "Не удалось выполнить команду. Проверь результат в LifeOS перед повтором.",
      );
    }
  }
}
