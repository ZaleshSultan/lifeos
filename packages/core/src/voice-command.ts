import {
  addAssistantDays,
  assistantLocalDate,
  assistantLocalInstant,
  routeAssistantIntent,
} from "./assistant-router.js";
import { isAssistantDate } from "./assistant.js";

export type VoiceCommandPlan =
  | {
      kind: "command";
      text: string;
      requiresConfirmation: boolean;
      preview: string;
    }
  | { kind: "unsupported"; message: string };

const UNSUPPORTED: VoiceCommandPlan = {
  kind: "unsupported",
  message:
    "Не удалось однозначно определить команду. Повторите голосовое или отправьте текстовую команду из /help. Для напоминания укажите дату, время и действие.",
};

function command(
  text: string,
  requiresConfirmation: boolean,
  preview = text,
): VoiceCommandPlan {
  return { kind: "command", text, requiresConfirmation, preview };
}

function localTime(instant: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get("hour")}:${get("minute")}`;
}

function reminder(
  title: string,
  instant: string,
  context: { now: Date; timezone: string },
): VoiceCommandPlan {
  if (!title.trim() || /[\r\n\u0000-\u001f\u007f]/u.test(title))
    return UNSUPPORTED;
  const delay = Date.parse(instant) - context.now.getTime();
  if (delay <= 0 || delay > 366 * 86_400_000) return UNSUPPORTED;
  const date = assistantLocalDate(new Date(instant), context.timezone);
  const time = localTime(instant, context.timezone);
  return command(
    `/remind ${title.trim()} at:${date} ${time}`,
    true,
    `Напоминание: ${title.trim()}\nКогда: ${date} ${time} (${context.timezone})`,
  );
}

/** Pure, deterministic voice grammar. Unknown speech never falls through to capture writes. */
export function planVoiceCommand(
  raw: string,
  context: { now: Date; timezone: string },
): VoiceCommandPlan {
  if (
    typeof raw !== "string" ||
    raw.length > 2000 ||
    /[\r\n\u0000-\u001f\u007f]/u.test(raw)
  )
    return UNSUPPORTED;
  const text = raw
    .normalize("NFKC")
    .trim()
    .replace(/[?!.]+$/u, "")
    .trim();
  if (!text) return UNSUPPORTED;
  try {
    const today = assistantLocalDate(context.now, context.timezone);
    const slash = text.match(/^\/([a-z][a-z0-9_]*)(?:\s+(.*))?$/iu);
    if (slash) {
      const name = slash[1].toLowerCase();
      const args = slash[2] ?? "";
      if (name === "remind") {
        const relative = args.match(/^(.+?)\s+in:(\d{1,4})(m|h)$/iu);
        if (relative) {
          const minutes =
            Number(relative[2]) * (relative[3].toLowerCase() === "h" ? 60 : 1);
          return reminder(
            relative[1],
            new Date(context.now.getTime() + minutes * 60_000).toISOString(),
            context,
          );
        }
        const absolute = args.match(
          /^(.+?)\s+(?:at:(\d{4}-\d{2}-\d{2})|(today|tomorrow))\s+(\d{1,2}:\d{2})$/iu,
        );
        if (!absolute) return UNSUPPORTED;
        const date =
          absolute[2] ??
          (absolute[3].toLowerCase() === "tomorrow"
            ? addAssistantDays(today, 1)
            : today);
        return reminder(
          absolute[1],
          assistantLocalInstant(
            date,
            absolute[4].padStart(5, "0"),
            context.timezone,
          ),
          context,
        );
      }
      // An allowlist is deliberate: new or argument-sensitive commands require confirmation.
      const read =
        (/^(?:help|reminders|deadlines|assignments)$/u.test(name) && !args) ||
        (/^(?:study|course)$/u.test(name) &&
          /^(?:today|schedule|grades|calculator|syllabi|map|deadlines|schedule \d{4}-\d{2}-\d{2})$/u.test(
            args,
          ));
      return command(`/${name}${args ? ` ${args}` : ""}`, !read);
    }

    // Normalize explicit spoken clock forms before reusing the existing reminder parser.
    const clockWords: Record<string, number> = {
      один: 1,
      два: 2,
      три: 3,
      четыре: 4,
      пять: 5,
      шесть: 6,
      семь: 7,
      восемь: 8,
      девять: 9,
      десять: 10,
      одиннадцать: 11,
      двенадцать: 12,
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      seven: 7,
      eight: 8,
      nine: 9,
      ten: 10,
      eleven: 11,
      twelve: 12,
    };
    let normalized = text
      .replace(
        /(^|\s)(at|в)\s+([\p{L}]+)(?=\s)/giu,
        (all, boundary: string, at: string, word: string) =>
          clockWords[word.toLowerCase()] === undefined
            ? all
            : `${boundary}${at} ${clockWords[word.toLowerCase()]}`,
      )
      .replace(
        /\b(at)\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\s+/iu,
        (
          _all,
          at: string,
          rawHour: string,
          rawMinute: string | undefined,
          marker: string,
        ) => {
          const hour = Number(rawHour);
          if (hour < 1 || hour > 12) throw new Error("Invalid clock");
          return `${at} ${String((hour % 12) + (/^p/iu.test(marker) ? 12 : 0)).padStart(2, "0")}:${rawMinute ?? "00"} `;
        },
      )
      .replace(
        /(в)\s+(\d{1,2})(?::(\d{2}))?\s+(утра|вечера|дня|ночи)\s+/iu,
        (
          _all,
          at: string,
          rawHour: string,
          rawMinute: string | undefined,
          marker: string,
        ) => {
          const hour = Number(rawHour);
          if (hour < 1 || hour > 12) throw new Error("Invalid clock");
          const converted =
            (hour % 12) + (/^(?:вечера|дня)$/iu.test(marker) ? 12 : 0);
          return `${at} ${String(converted).padStart(2, "0")}:${rawMinute ?? "00"} `;
        },
      )
      .replace(/(\b(?:at)|в)\s+(\d{1,2})\s+(?!\d)/iu, "$1 $2:00 ");

    const kazakhReminder =
      normalized.match(
        /^(?:еске\s+сал|ескерт)\s+(бүгін|ертең)\s+(?:сағат\s+)?(\d{1,2})(?::(\d{2}))?(?:-д[ае]|-т[ае])?\s+(.+)$/iu,
      ) ??
      normalized.match(
        /^(бүгін|ертең)\s+(?:сағат\s+)?(\d{1,2})(?::(\d{2}))?(?:-д[ае]|-т[ае])?\s+(.+?)\s+еске\s+сал$/iu,
      );
    if (kazakhReminder) {
      normalized = `remind me ${kazakhReminder[1].toLowerCase() === "ертең" ? "tomorrow" : "today"} at ${kazakhReminder[2]}:${kazakhReminder[3] ?? "00"} ${kazakhReminder[4]}`;
    }
    const intent = routeAssistantIntent(normalized, context);
    if (intent?.tool === "reminders.create") {
      return reminder(
        String(intent.args.title),
        String(intent.args.remindAt),
        context,
      );
    }
    if (
      intent?.tool === "classes.today" ||
      intent?.tool === "classes.tomorrow"
    ) {
      const date =
        intent.tool === "classes.tomorrow" ? addAssistantDays(today, 1) : today;
      return command(
        `/study schedule ${date}`,
        false,
        `Расписание: ${date} (${context.timezone})`,
      );
    }
    const kazakhSchedule = text.match(
      /^(?:(?:менде|менің)\s+)?(бүгін|ертең)(?:гі)?\s+(?:қандай\s+)?(?:сабақтар|сабақ|жұптар|кесте)(?:\s+(?:бар|қандай))?$/iu,
    );
    if (kazakhSchedule) {
      const date = /^ертең/iu.test(kazakhSchedule[1])
        ? addAssistantDays(today, 1)
        : today;
      return command(
        `/study schedule ${date}`,
        false,
        `Расписание: ${date} (${context.timezone})`,
      );
    }
    const dateSchedule = text.match(
      /^(?:пары|расписание|classes|schedule)(?:\s+(?:на|for|on))?\s+(\d{4}-\d{2}-\d{2})$/iu,
    );
    if (dateSchedule && isAssistantDate(dateSchedule[1])) {
      return command(
        `/study schedule ${dateSchedule[1]}`,
        false,
        `Расписание: ${dateSchedule[1]} (${context.timezone})`,
      );
    }
    const task = text.match(
      /^(?:создай\s+задачу|добавь\s+задачу|create\s+(?:a\s+)?task|add\s+(?:a\s+)?task|тапсырма\s+қос)\s*:?\s+(.+)$/iu,
    );
    if (task) return command(`/task ${task[1]}`, true, `Задача: ${task[1]}`);
    if (/^(?:напоминания|reminders)$/iu.test(text))
      return command("/reminders", false);
    if (/^(?:помощь|help)$/iu.test(text)) return command("/help", false);
    return UNSUPPORTED;
  } catch {
    return UNSUPPORTED;
  }
}
