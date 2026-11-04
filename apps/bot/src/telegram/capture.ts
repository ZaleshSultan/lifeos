import {
  CAPTURE_MAX_TEXT,
  CaptureInputError,
  type CaptureState,
} from "@lifeos/core";
import type {
  TelegramBotRuntime,
  TelegramMessage,
  TelegramUpdate,
} from "./types.js";
import {
  validateTelegramVoice,
  VoiceCaptureError,
  type CaptureVoiceReference,
} from "./voice.js";
import { isMealPhotoMessage } from "./meal-photo.js";

export interface CaptureTelegramSourceReference {
  chatId: number;
  messageId: number;
  updateId: number;
  occurredAt?: string;
}
export interface CaptureTelegramIngress {
  userId: string;
  requestId: string;
  sourceReference: CaptureTelegramSourceReference;
}
export interface CaptureTelegramResult {
  id: string;
  state: CaptureState;
  duplicate: boolean;
}
/** Implemented only by the trusted capture service, never browser input. */
export interface CaptureTelegramPort {
  ingestText(
    input: CaptureTelegramIngress & { text: string },
  ): Promise<CaptureTelegramResult>;
  ingestVoice(
    input: CaptureTelegramIngress & { voice: CaptureVoiceReference },
  ): Promise<CaptureTelegramResult>;
  setTranscript(input: {
    userId: string;
    captureId: string;
    text: string;
    requestId: string;
  }): Promise<CaptureTelegramResult>;
}
/** Only this pre-persistence category should produce a retryable webhook 503. */
export class CaptureTelegramIngestError extends Error {
  readonly durablePersisted = false;
  constructor(readonly code = "capture_ingest_unavailable") {
    super(code);
    this.name = "CaptureTelegramIngestError";
  }
}
/** Permanent, safely worded rejection; never asks Telegram to retry bad input. */
export class CaptureTelegramRequestError extends Error {
  constructor(
    readonly code:
      | "invalid_input"
      | "unavailable"
      | "conflict" = "invalid_input",
  ) {
    super(code);
    this.name = "CaptureTelegramRequestError";
  }
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const positive = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const nonnegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function reviewMarkup(runtime: TelegramBotRuntime, captureId?: string) {
  if (!runtime.tmaUrl) return undefined;
  try {
    const url = new URL(runtime.tmaUrl);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return undefined;
    url.searchParams.set("screen", "capture");
    if (captureId && uuid.test(captureId))
      url.searchParams.set("captureId", captureId);
    return {
      inline_keyboard: [
        [{ text: "Открыть входящие и проверить", web_app: { url: url.href } }],
      ],
    };
  } catch {
    return undefined;
  }
}

async function reply(
  runtime: TelegramBotRuntime,
  message: TelegramMessage,
  text: string,
  captureId?: string,
) {
  // A failed/ambiguous reply must not turn already persisted ingestion into a
  // second webhook write or an automatic model retry. The inbox remains durable.
  try {
    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text,
      replyMarkup: reviewMarkup(runtime, captureId),
    });
  } catch {
    // Never log token-bearing errors or private capture/transcript content.
  }
}

function request(
  message: TelegramMessage,
  update: TelegramUpdate,
  userId: string,
): CaptureTelegramIngress {
  const sourceReference: CaptureTelegramSourceReference = {
    chatId: message.chat.id,
    messageId: message.message_id,
    updateId: update.update_id,
  };
  if (positive(message.date) && message.date <= 253_402_300_799)
    sourceReference.occurredAt = new Date(message.date * 1000).toISOString();
  return {
    userId,
    requestId: `tg-capture:${message.chat.id}:${message.message_id}`,
    sourceReference,
  };
}

/** Handles only the new capture surface; explicit legacy slash commands pass through. */
export async function handleCaptureTelegramUpdate(
  update: TelegramUpdate,
  runtime: TelegramBotRuntime,
): Promise<boolean> {
  const port = runtime.capture;
  const message = update.message;
  if (!port || !message) return false;
  const text = typeof message.text === "string" ? message.text.trim() : "";
  const command =
    /^\/(cap|capture|inbox|transcript)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(text);
  const voice = message.voice !== undefined;
  const genericPhoto =
    Array.isArray(message.photo) &&
    message.photo.length > 0 &&
    (!isMealPhotoMessage(message) || Boolean(text));
  const unsupportedAttachment =
    !voice &&
    (message.audio !== undefined ||
      message.document !== undefined ||
      genericPhoto);
  if (
    !voice &&
    !unsupportedAttachment &&
    !command &&
    (!text || text.startsWith("/"))
  )
    return false;
  if (
    !message.chat ||
    message.chat.type !== "private" ||
    !positive(message.chat.id) ||
    !positive(message.from?.id) ||
    message.from.is_bot === true ||
    message.chat.id !== message.from.id ||
    !positive(message.message_id) ||
    !nonnegative(update.update_id)
  )
    return true;
  if (!runtime.store) throw new CaptureTelegramIngestError();
  let user;
  try {
    user = await runtime.store.resolveTelegramUser(message.from.id);
  } catch {
    throw new CaptureTelegramIngestError("capture_owner_lookup_unavailable");
  }
  if (
    !user ||
    user.status !== "active" ||
    user.telegramUserId !== message.from.id
  ) {
    await reply(
      runtime,
      message,
      "Доступ к входящим недоступен. Отправь /start в личном чате.",
    );
    return true;
  }
  if (unsupportedAttachment) {
    await reply(
      runtime,
      message,
      "Этот тип файла пока не поддерживается. Файл не скачан и не отправлен внешнему AI. Для фото еды используй подпись /meal; для голоса — короткое Ogg/Opus или вставь текст вручную.",
    );
    return true;
  }
  const kind = command?.[1].toLowerCase();
  const args = command?.[2]?.trim() ?? "";
  if (kind === "inbox") {
    await reply(
      runtime,
      message,
      "Входящие: проверь предложения, исправь их и выбери действия для подтверждения. Ничего не выполняется автоматически.",
    );
    return true;
  }
  if (!voice && (kind === "cap" || kind === "capture") && !args) {
    await reply(
      runtime,
      message,
      "Напиши /capture и мысль, отправь обычный текст или короткое голосовое сообщение. Задачи и другие действия появятся только после твоего подтверждения.",
    );
    return true;
  }
  const value = kind ? args : text;
  if (
    !voice &&
    ((kind !== "transcript" && value.length > CAPTURE_MAX_TEXT) ||
      /\u0000/.test(value))
  ) {
    await reply(
      runtime,
      message,
      "Слишком длинная или неподдерживаемая запись. Отправь текст до 8000 символов.",
    );
    return true;
  }
  let result: CaptureTelegramResult;
  const permanent = async (error: unknown) => {
    if (
      !(error instanceof CaptureTelegramRequestError) &&
      !(error instanceof CaptureInputError)
    )
      return false;
    await reply(
      runtime,
      message,
      "Не удалось принять запись или расшифровку. Проверь текст и доступ к записи во входящих приложения; автоматический повтор не выполняется.",
    );
    return true;
  };
  if (kind === "transcript") {
    const parts = /^(\S+)\s+([\s\S]+)$/.exec(args);
    if (
      !parts ||
      !uuid.test(parts[1]) ||
      !parts[2].trim() ||
      parts[2].trim().length > CAPTURE_MAX_TEXT
    ) {
      await reply(
        runtime,
        message,
        "Используй /transcript ID_записи текст расшифровки или введи расшифровку во входящих приложения.",
      );
      return true;
    }
    try {
      result = await port.setTranscript({
        userId: user.userId,
        captureId: parts[1],
        text: parts[2].trim(),
        requestId: `tg-transcript:${message.chat.id}:${message.message_id}`,
      });
    } catch (error) {
      if (await permanent(error)) return true;
      if (error instanceof CaptureTelegramIngestError) throw error;
      throw new CaptureTelegramIngestError("capture_transcript_unavailable");
    }
  } else if (voice) {
    let reference: CaptureVoiceReference;
    try {
      reference = validateTelegramVoice(
        message.voice,
        message.date,
        runtime.now?.() ?? new Date(),
      );
    } catch (error) {
      const explanation =
        error instanceof VoiceCaptureError && error.code === "voice_too_large"
          ? "Нужна запись до 5 МиБ и 120 секунд."
          : "Поддерживаются короткие голосовые Ogg/Opus до 120 секунд. Можно отправить текст вручную.";
      await reply(runtime, message, explanation);
      return true;
    }
    try {
      result = await port.ingestVoice({
        ...request(message, update, user.userId),
        voice: reference,
      });
    } catch (error) {
      if (await permanent(error)) return true;
      if (error instanceof CaptureTelegramIngestError) throw error;
      throw new CaptureTelegramIngestError();
    }
  } else {
    try {
      result = await port.ingestText({
        ...request(message, update, user.userId),
        text: value,
      });
    } catch (error) {
      if (await permanent(error)) return true;
      if (error instanceof CaptureTelegramIngestError) throw error;
      throw new CaptureTelegramIngestError();
    }
  }
  if (result.duplicate) return true;
  await reply(
    runtime,
    message,
    voice
      ? "Голосовая запись добавлена во входящие. Аудио не скачано и не отправлено внешнему AI. Открой запись в приложении: там можно добавить текст вручную или отдельно согласиться на распознавание, если оно настроено. Предложения потребуют твоего подтверждения."
      : kind === "transcript"
        ? "Расшифровка сохранена. Проверь предложения во входящих; действия ещё не выполнены."
        : "Сохранил во входящие. Проверь и исправь предложения, затем подтверди только нужные действия.",
    result.id,
  );
  return true;
}
