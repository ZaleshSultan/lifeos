import { randomBytes } from "node:crypto";
import {
  idealHumanDayNumber,
  idealHumanLocalDate,
  type MealPhotoDraft,
} from "@lifeos/core";
import type { TelegramUserRecord } from "@lifeos/db";
import type { MealVisionService } from "../nutrition-routes.js";
import type { TelegramBotRuntime, TelegramMessage } from "./types.js";

type PendingPhoto = {
  owner: string;
  fileId: string;
  date: string;
  requestId: string;
  expires: number;
  running?: Promise<MealPhotoDraft>;
  discarded?: boolean;
};
const pending = new WeakMap<MealVisionService, Map<string, PendingPhoto>>();
const pattern = /^meal:(analyze|discard):([a-f0-9]{24})$/;
export const isMealPhotoCallback = (data: unknown): data is string =>
  typeof data === "string" && pattern.test(data);
export const isMealPhotoMessage = (message: TelegramMessage) =>
  Boolean(
    message.photo?.length &&
    /^\/meal(?:@\w+)?(?:\s|$)/i.test(message.caption?.trim() ?? ""),
  );
const escape = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
function escapeBounded(text: string, limit: number) {
  let result = "";
  for (const character of text) {
    const encoded = escape(character);
    if (result.length + encoded.length > limit) break;
    result += encoded;
  }
  return result;
}

function keyboard(
  runtime: TelegramBotRuntime,
  date: string,
  draft?: MealPhotoDraft,
) {
  if (!runtime.tmaUrl) return undefined;
  const url = new URL(runtime.tmaUrl);
  url.searchParams.set("screen", draft ? "daily-life" : "ideal-human");
  url.searchParams.set("date", date);
  if (draft) url.searchParams.set("mealDraft", draft.draftId);
  return {
    inline_keyboard: [
      [
        {
          text: draft
            ? "Проверить, исправить и сохранить"
            : "Записать еду вручную",
          web_app: { url: url.href },
        },
      ],
    ],
  };
}

/** Downloads only Telegram's authenticated file endpoint, after explicit consent. */
export async function downloadTelegramMeal(
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "api.telegram.org" ||
    parsed.port ||
    parsed.username ||
    parsed.password ||
    !parsed.pathname.startsWith("/file/bot") ||
    parsed.hash ||
    parsed.search
  )
    throw new Error("meal_download_origin_rejected");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetcher(parsed.href, {
      signal: controller.signal,
      redirect: "error",
    });
    if (
      !response.ok ||
      !response.body ||
      Number(response.headers.get("content-length") ?? 0) > 500000
    )
      throw new Error("meal_download_failed");
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 500000) throw new Error("meal_download_too_large");
      chunks.push(next.value);
    }
    const bytes = Buffer.concat(chunks);
    if (bytes[0] !== 255 || bytes[1] !== 216)
      throw new Error("meal_download_invalid_image");
    return bytes.toString("base64");
  } finally {
    controller.abort();
    clearTimeout(timer);
    await reader?.cancel().catch(() => {});
  }
}

export async function handleMealPhoto(
  message: TelegramMessage,
  runtime: TelegramBotRuntime,
  user: TelegramUserRecord,
) {
  const date = idealHumanLocalDate(runtime.now?.() ?? new Date());
  if (
    !runtime.mealVision?.capability().available ||
    !idealHumanDayNumber(date)
  ) {
    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: "Фото-анализ сейчас не подключён. Фото не отправлено внешнему AI. Еду и примерные макросы можно записать вручную.",
      replyMarkup: keyboard(runtime, date),
    });
    return;
  }
  const photos = (message.photo ?? [])
    .filter(
      (p) =>
        p.width <= 1536 &&
        p.height <= 1536 &&
        (!p.file_size || p.file_size <= 500000),
    )
    .sort((a, b) => b.width * b.height - a.width * a.height);
  if (!photos[0]) {
    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: "Нужна небольшая фотография до 500 КБ. Можно выбрать фото прямо в приложении или записать еду вручную.",
      replyMarkup: keyboard(runtime, date),
    });
    return;
  }
  const service = runtime.mealVision;
  const items = pending.get(service) ?? new Map<string, PendingPhoto>();
  pending.set(service, items);
  const now = (runtime.now?.() ?? new Date()).getTime();
  for (const [key, value] of items) if (value.expires <= now) items.delete(key);
  if (items.size >= 50) items.delete(items.keys().next().value!);
  const nonce = randomBytes(12).toString("hex");
  items.set(nonce, {
    owner: user.userId,
    fileId: photos[0].file_id,
    date,
    requestId: `tg-meal:${message.chat.id}:${message.message_id}`,
    expires: now + 300000,
  });
  await runtime.telegram.sendMessage({
    chatId: message.chat.id,
    text: "Разрешить отправку этого фото подключённому внешнему AI для примерной оценки еды? Фото уже хранится в Telegram; LifeOS не сохраняет его в своей базе. Оценка может ошибаться. Результат останется черновиком до твоей проверки и сохранения. Ссылка действует 5 минут.",
    replyMarkup: {
      inline_keyboard: [
        [
          {
            text: "Разрешаю анализ этого фото",
            callback_data: `meal:analyze:${nonce}`,
          },
        ],
        [{ text: "Отменить", callback_data: `meal:discard:${nonce}` }],
      ],
    },
  });
}

export async function handleMealPhotoCallback(
  data: string,
  message: TelegramMessage,
  runtime: TelegramBotRuntime,
  user: TelegramUserRecord,
  download = downloadTelegramMeal,
) {
  const match = pattern.exec(data);
  const service = runtime.mealVision;
  const item =
    match && service ? pending.get(service)?.get(match[2]) : undefined;
  const reply = (text: string) =>
    runtime.telegram.sendMessage({ chatId: message.chat.id, text });
  if (
    !item ||
    item.owner !== user.userId ||
    item.expires <= (runtime.now?.() ?? new Date()).getTime() ||
    item.discarded
  ) {
    await reply(
      "Черновик истёк или недоступен. Отправь фото заново с подписью /meal.",
    );
    return;
  }
  if (match![1] === "discard") {
    item.discarded = true;
    pending.get(service!)?.delete(match![2]);
    await reply(
      "Черновик отменён, еда не сохранена. Если анализ уже начался, отправленное провайдеру фото отозвать нельзя.",
    );
    return;
  }
  try {
    if (!item.running)
      item.running = (async () => {
        const url = await runtime.telegram.getFileUrl(item.fileId);
        const imageBase64 = await download(url);
        if (item.discarded) throw new Error("meal_discarded");
        return service!.analyze(
          user.userId,
          {
            mimeType: "image/jpeg",
            imageBase64,
            requestId: item.requestId,
            consentToExternalAnalysis: true,
          },
          undefined,
          item.date,
        );
      })();
    const draft = await item.running;
    if (item.discarded) return;
    const lines = draft.items.map(
      (food) =>
        `• ${food.label}: ${food.caloriesKcal ?? "?"} ккал · Б ${food.proteinG ?? "?"} / Ж ${food.fatG ?? "?"} / У ${food.carbsG ?? "?"} г`,
    );
    // Escape whole Unicode characters before enforcing the raw HTML bound, so
    // truncation never splits an entity or surrogate pair. Keep review guidance.
    const text =
      escapeBounded(
        [
          "Примерная оценка · ещё не сохранено",
          ...lines,
          ...draft.uncertainty.map((v) => "⚠ " + v),
        ].join("\n"),
        3200,
      ) +
      "\n" +
      escape(
        "Открой приложение, проверь и исправь порции и значения, затем подтверди сохранение. Неизвестные значения можно оставить пустыми.",
      );
    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text,
      replyMarkup: keyboard(runtime, item.date, draft),
    });
  } catch {
    await reply(
      "Анализ не завершён: провайдер недоступен, превышен лимит или фото не подходит. Еда не сохранена. Открой приложение для ручной записи; повторный платный запрос автоматически не запускается.",
    );
  }
}
