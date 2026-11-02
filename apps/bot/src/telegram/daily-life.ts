import { randomBytes } from "node:crypto";
import {
  DailyLifeInputError,
  parseHydrationInput,
  type HydrationSummary,
} from "@lifeos/core";
import type { TelegramUserRecord } from "@lifeos/db";
import { dailyLifeSummary } from "../daily-life-routes.js";
import type { TelegramMessage, TelegramBotRuntime } from "./types.js";
const escape = (v: string) =>
  v.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
/** Budget escaped output by whole Unicode characters, never by HTML fragments. */
function escapeWithin(value: string, limit: number) {
  let text = "";
  for (const character of value) {
    const escaped = escape(character);
    if (text.length + escaped.length > limit) return { text, truncated: true };
    text += escaped;
  }
  return { text, truncated: false };
}
function briefingMessage(title: string, lines: string[]) {
  const heading = escapeWithin(title, 250);
  const prefix = `<b>${heading.text}${heading.truncated ? "…" : ""}</b>\n`;
  const suffix = "\n… Обзор сокращён. Подробности — в LifeOS.";
  const body = escapeWithin(
    lines.join("\n"),
    3900 - prefix.length - suffix.length,
  );
  return prefix + body.text + (body.truncated ? suffix : "");
}
async function requirePrivateOwner(
  message: TelegramMessage,
  runtime: TelegramBotRuntime,
  user: TelegramUserRecord,
) {
  if (
    message.chat.type === "private" &&
    message.chat.id === message.from?.id &&
    message.chat.id === user.telegramUserId &&
    user.status === "active"
  )
    return true;
  await runtime.telegram.sendMessage({
    chatId: message.chat.id,
    text: "Личные записи и обзор дня доступны только в твоём личном чате с ботом.",
  });
  return false;
}
function dateFor(user: TelegramUserRecord, runtime: TelegramBotRuntime) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: user.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(runtime.now?.() ?? new Date());
}
const pattern =
  /^water:(?:add:(150|250|500):([a-f0-9]{16})|undo:([a-f0-9-]{36})|custom)$/;
export const isDailyLifeCallback = (data: unknown): data is string =>
  typeof data === "string" && pattern.test(data);
async function waterMenu(
  message: TelegramMessage,
  runtime: TelegramBotRuntime,
  user: TelegramUserRecord,
  summary?: HydrationSummary,
) {
  if (!runtime.store?.dailyLife) {
    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: "Учёт воды временно недоступен. Попробуй позже.",
    });
    return;
  }
  const day =
    summary ??
    (await runtime.store.dailyLife.hydration(
      user.userId,
      dateFor(user, runtime),
      user.timezone,
    ));
  const nonce = randomBytes(8).toString("hex");
  const last = day.entries.find((entry) => entry.undoneAt === null);
  const rows = [
    [
      { text: "+150 мл", callback_data: `water:add:150:${nonce}` },
      { text: "+250 мл", callback_data: `water:add:250:${nonce}` },
      { text: "+500 мл", callback_data: `water:add:500:${nonce}` },
    ],
    [{ text: "Свое количество", callback_data: "water:custom" }],
  ];
  if (last)
    rows.push([
      {
        text: "Отменить последнюю запись",
        callback_data: `water:undo:${last.id}`,
      },
    ]);
  await runtime.telegram.sendMessage({
    chatId: message.chat.id,
    text: `<b>Вода · ${escape(day.date)}</b>\nЗаписано: <b>${day.totalMl} мл</b>${day.truncated ? " (история ограничена)" : ""}.\nЭто журнал выпитой воды, без медицинской нормы.\nДля своей порции: <code>/water 300</code>. Повторное нажатие старой кнопки не дублирует запись.`,
    replyMarkup: { inline_keyboard: rows },
  });
}
export async function handleWaterCommand(
  args: string,
  message: TelegramMessage,
  runtime: TelegramBotRuntime,
  user: TelegramUserRecord,
) {
  if (!(await requirePrivateOwner(message, runtime, user))) return;
  if (args.trim()) {
    let parsed: ReturnType<typeof parseHydrationInput>;
    try {
      parsed = parseHydrationInput({
        amountMl: /^\d{1,4}$/.test(args.trim()) ? Number(args.trim()) : null,
        requestId: `tg-water:${message.chat.id}:${message.message_id}`,
      });
    } catch (error) {
      if (!(error instanceof DailyLifeInputError)) throw error;
      await runtime.telegram.sendMessage({
        chatId: message.chat.id,
        text: "Укажи целое количество воды от 1 до 5000 мл за запись, например <code>/water 300</code>. Это журнал, без обязательной нормы.",
      });
      return;
    }
    if (!runtime.store?.dailyLife) throw new Error("daily_life_unavailable");
    const date = await runtime.store.dailyLife.logWater(
      user.userId,
      parsed.amountMl,
      parsed.requestId,
      "telegram",
    );
    await waterMenu(
      message,
      runtime,
      user,
      await runtime.store.dailyLife.hydration(user.userId, date, user.timezone),
    );
  } else await waterMenu(message, runtime, user);
}
export async function handleDailyLifeCallback(
  data: string,
  message: TelegramMessage,
  runtime: TelegramBotRuntime,
  user: TelegramUserRecord,
) {
  // The shared update boundary checks callback.from. Callback message.from is
  // the bot itself, so it must not be used as the user's identity here.
  if (
    message.chat.type !== "private" ||
    message.chat.id !== user.telegramUserId ||
    user.status !== "active"
  )
    return;
  const match = pattern.exec(data);
  if (!match || !runtime.store?.dailyLife) return;
  if (data === "water:custom") {
    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: "Напиши количество в миллилитрах: <code>/water 300</code>. Запись сохранится только после твоей команды.",
    });
    return;
  }
  let date: string;
  if (match[3])
    date = await runtime.store.dailyLife.undoWater(user.userId, match[3]);
  else
    date = await runtime.store.dailyLife.logWater(
      user.userId,
      Number(match[1]),
      `tg-water:${match[2]}:${match[1]}`,
      "telegram",
    );
  await waterMenu(
    message,
    runtime,
    user,
    await runtime.store.dailyLife.hydration(user.userId, date, user.timezone),
  );
}
export async function handleBriefingCommand(
  kind: "morning" | "evening" | "documentary",
  message: TelegramMessage,
  runtime: TelegramBotRuntime,
  user: TelegramUserRecord,
) {
  if (!(await requirePrivateOwner(message, runtime, user))) return;
  if (!runtime.store) return;
  const data = await dailyLifeSummary(
    runtime.store,
    user,
    dateFor(user, runtime),
    runtime.now?.() ?? new Date(),
  );
  const title =
    kind === "documentary"
      ? "План съёмки · предложения"
      : `${data[kind].title} · ${data.date}`;
  const lines =
    kind === "documentary"
      ? [
          ...data.sourceWarnings.map((warning) => "⚠ " + warning),
          ...data.documentary.shots.map((s) => `• ${s.title} — ${s.reason}`),
          "Кадры и резервные копии отмечай только по факту в Ideal Human.",
        ]
      : (() => {
          const view = data[kind];
          return [
            ...data.sourceWarnings.map((warning) => "⚠ " + warning),
            ...view.warnings.map((warning) => "⚠ " + warning),
            "Факты:",
            ...view.facts.map((f) => "• " + f),
            "Предложения (ничего не изменено):",
            ...view.suggestions.map((f) => "• " + f),
            ...view.questions.map((f) => "• " + f),
          ];
        })();
  await runtime.telegram.sendMessage({
    chatId: message.chat.id,
    text: briefingMessage(title, lines),
    ...(runtime.tmaUrl
      ? {
          replyMarkup: {
            inline_keyboard: [
              [
                {
                  text: "Открыть дневник",
                  web_app: {
                    url: (() => {
                      const u = new URL(runtime.tmaUrl!);
                      u.searchParams.set("screen", "ideal-human");
                      return u.href;
                    })(),
                  },
                },
              ],
            ],
          },
        }
      : {}),
  });
}
