import {
  parseAssistantToolCall,
  isAssistantDate,
  type AssistantMemoryCategory,
  type AssistantRoutingContext,
  type AssistantToolCall,
  type AssistantToolName,
} from "./assistant.js";

const DAY = 86_400_000;
const MUTATION_START =
  /^(?:remember\b|запомни(?:\s|:|$)|update\s+memory\b|обнови\s+память(?:\s|:|$)|archive\s+memory\b|архивируй\s+память(?:\s|:|$)|delete\s+memory\b|удали\s+память(?:\s|:|$)|remind\s+me\b|напомни(?:\s|:|$)|create\s+(?:a\s+)?reminder\b|создай\s+напоминание(?:\s|:|$))/iu;
const UNSAFE_INSTRUCTION =
  /(?:ignore\s+(?:all\s+)?(?:previous|prior|system)|system\s*prompt|developer\s*(?:message|instruction)|игнорируй\s+(?:все\s+)?(?:предыдущ|инструкц)|обойди\s+(?:защит|огранич)|<\/?(?:system|assistant|tool)|\b(?:execute|run)\s+(?:sql|shell|bash)|\b(?:DROP|DELETE\s+FROM)\b)/iu;
const QUOTED = /["`“”«»]|(?:^|\s)'[^']+'/u;

function formatter(timezone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
}
function localParts(
  time: number,
  zone: Intl.DateTimeFormat,
): Record<string, string> {
  return Object.fromEntries(
    zone.formatToParts(new Date(time)).map((part) => [part.type, part.value]),
  );
}
export function assistantLocalDate(now: Date, timezone: string): string {
  if (!Number.isFinite(now.getTime()))
    throw new Error("Invalid assistant clock");
  const p = localParts(now.getTime(), formatter(timezone));
  return `${p.year}-${p.month}-${p.day}`;
}
export function addAssistantDays(date: string, days: number): string {
  if (!isAssistantDate(date) || !Number.isInteger(days))
    throw new Error("Invalid assistant date");
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY)
    .toISOString()
    .slice(0, 10);
}

/** Convert a local wall-clock time to one instant, rejecting DST gaps and overlaps. */
export function assistantLocalInstant(
  date: string,
  time: string,
  timezone: string,
): string {
  if (!isAssistantDate(date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(time))
    throw new Error("Invalid reminder date or time");
  const zone = formatter(timezone);
  const naive = Date.parse(`${date}T${time}:00.000Z`);
  // Sample offsets on both sides of a possible transition. No I/O or host timezone.
  const offsets = new Set<number>();
  for (const delta of [-2 * DAY, -DAY, 0, DAY, 2 * DAY]) {
    const stamp = naive + delta;
    const p = localParts(stamp, zone);
    offsets.add(
      Date.parse(
        `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}.000Z`,
      ) - stamp,
    );
  }
  const matches = [...offsets]
    .map((offset) => naive - offset)
    .filter((stamp) => {
      const p = localParts(stamp, zone);
      return (
        `${p.year}-${p.month}-${p.day}` === date &&
        `${p.hour}:${p.minute}` === time
      );
    });
  if (matches.length !== 1)
    throw new Error(
      "Reminder time is ambiguous or does not exist; choose another time",
    );
  return new Date(matches[0]).toISOString();
}
function dateFromToken(token: string, today: string): string | null {
  const normalized = token.toLowerCase();
  if (/^(?:today|сегодня)$/u.test(normalized)) return today;
  if (/^(?:tomorrow|завтра)$/u.test(normalized))
    return addAssistantDays(today, 1);
  return isAssistantDate(token) ? token : null;
}
function call(
  tool: AssistantToolName,
  args: Record<string, unknown> = {},
): AssistantToolCall {
  return parseAssistantToolCall({ tool, args });
}
function category(content: string): AssistantMemoryCategory {
  if (/^(?:i\s+(?:prefer|like)|я\s+предпочитаю|мне\s+нрав)/iu.test(content))
    return "preference";
  if (/^(?:my\s+goal|i\s+want\s+to|моя\s+цель|хочу)/iu.test(content))
    return "goal";
  if (
    /^(?:i\s+(?:cannot|can't|must\s+not)|я\s+не\s+могу|мне\s+нельзя)/iu.test(
      content,
    )
  )
    return "constraint";
  if (/^(?:i\s+learn|my\s+learning|я\s+учусь|мне\s+легче\s+уч)/iu.test(content))
    return "learning";
  return "fact";
}
function memoryWrite(text: string): AssistantToolCall | null {
  let match =
    text.match(/^(?:remember|запомни)\s*:?\s+(.+)$/iu) ??
    text.match(/^(?:remember|запомни):\s*(.+)$/iu);
  if (match) {
    const explicit = match[1].match(
      /^(preference|goal|constraint|learning|fact)(?:\s+([\p{L}\p{N}_.-]+))?\s*:\s*(.+)$/iu,
    );
    return call(
      "memory.remember",
      explicit
        ? {
            category: explicit[1].toLowerCase(),
            ...(explicit[2] ? { key: explicit[2] } : {}),
            content: explicit[3],
          }
        : { category: category(match[1]), content: match[1] },
    );
  }
  match = text.match(
    /^(?:update\s+memory|обнови\s+память)\s+([\p{L}\p{N}_.-]+)(?:\s+(preference|goal|constraint|learning|fact))?\s*:\s*(.+)$/iu,
  );
  if (match)
    return call("memory.update", {
      key: match[1],
      category: match[2]?.toLowerCase() ?? category(match[3]),
      content: match[3],
    });
  match = text.match(
    /^(archive\s+memory|архивируй\s+память|delete\s+memory|удали\s+память)\s+([\p{L}\p{N}_.-]+)$/iu,
  );
  if (match)
    return call(
      /^(?:delete|удали)/iu.test(match[1]) ? "memory.delete" : "memory.archive",
      { key: match[2] },
    );
  return null;
}
function reminderWrite(
  text: string,
  context: AssistantRoutingContext,
  today: string,
): AssistantToolCall | null {
  const prefix = text.match(
    /^(?:remind\s+me|напомни|create\s+(?:a\s+)?reminder|создай\s+напоминание)\s*:?[ \t]+(.+)$/iu,
  );
  if (!prefix) return null;
  const body = prefix[1];
  let title: string;
  let instant: string;
  const relative = body.match(
    /^(?:in|через)\s+(\d{1,4})\s*(minutes?|mins?|минут[уы]?|час(?:а|ов)?|hours?)\s+(?:to\s+)?(.+)$/iu,
  );
  if (relative) {
    const minutes =
      Number(relative[1]) * (/^(?:hour|час)/iu.test(relative[2]) ? 60 : 1);
    if (minutes < 1 || minutes > 10080)
      throw new Error("Reminder duration must be from 1 minute to 7 days");
    instant = new Date(context.now.getTime() + minutes * 60_000).toISOString();
    title = relative[3];
  } else {
    const first = body.match(
      /^(today|tomorrow|сегодня|завтра|\d{4}-\d{2}-\d{2})\s+(?:at|в)\s+(\d{1,2}:\d{2})\s+(?:to\s+)?(.+)$/iu,
    );
    const last = body.match(
      /^(.+?)\s+(today|tomorrow|сегодня|завтра|\d{4}-\d{2}-\d{2})\s+(?:at|в)\s+(\d{1,2}:\d{2})$/iu,
    );
    if (!first && !last)
      throw new Error("Provide an explicit reminder date, time and message");
    const date = dateFromToken(first ? first[1] : last![2], today);
    if (!date) throw new Error("Invalid reminder date");
    const time = (first ? first[2] : last![3]).padStart(5, "0");
    instant = assistantLocalInstant(date, time, context.timezone);
    title = first ? first[3] : last![1].replace(/^to\s+/iu, "");
  }
  const delay = Date.parse(instant) - context.now.getTime();
  if (delay <= 0 || delay > 366 * DAY)
    throw new Error("Reminder must be in the future within 366 days");
  return call("reminders.create", { title: title.trim(), remindAt: instant });
}

/** Only direct user grammar can authorize writes; model suggestions use the parser alone. */
export function routeAssistantIntent(
  raw: string,
  context: AssistantRoutingContext,
): AssistantToolCall | null {
  const text = raw
    .normalize("NFKC")
    .trim()
    .replace(/[?!.]+$/u, "")
    .trim();
  const mutation = MUTATION_START.test(text);
  if (
    !text ||
    text.length > 4000 ||
    /[\r\n\u0000-\u001f\u007f]/u.test(text) ||
    QUOTED.test(text) ||
    UNSAFE_INSTRUCTION.test(text)
  ) {
    if (mutation)
      throw new Error(
        "Use a single direct request without quoted or embedded instructions",
      );
    return null;
  }
  const today = assistantLocalDate(context.now, context.timezone);
  if (
    !isAssistantDate(today) ||
    (context.date !== undefined && !isAssistantDate(context.date))
  )
    throw new Error("Invalid assistant date context");
  const write = memoryWrite(text) ?? reminderWrite(text, context, today);
  if (write) return write;
  if (mutation)
    throw new Error("Provide a complete explicit memory or reminder request");
  const query = text
    .replace(
      /^(?:please\s+|пожалуйста[, ]+)?(?:show\s+(?:me\s+)?|list\s+(?:my\s+)?|покажи\s+(?:мои\s+)?|список\s+)?/iu,
      "",
    )
    .trim();
  if (
    /^(?:(?:what(?:'s|\s+is)\s+)?(?:my\s+)?next\s+class|(?:какая\s+)?(?:у\s+меня\s+)?(?:следующая|ближайшая)\s+пара)$/iu.test(
      query,
    )
  )
    return call("classes.next");
  const classes = query.match(
    /^(?:(?:what\s+are\s+)?(?:my\s+)?(?:classes|schedule)(?:\s+(?:for|on))?\s+(today|tomorrow)|(?:today|tomorrow)(?:'s)?\s+(?:classes|schedule)|(?:какие\s+)?(?:у\s+меня\s+)?(?:пары|занятия|расписание)(?:\s+на)?\s+(сегодня|завтра))$/iu,
  );
  if (classes)
    return call(
      /tomorrow|завтра/iu.test(classes[0])
        ? "classes.tomorrow"
        : "classes.today",
    );
  if (
    /^(?:(?:my|upcoming|study)\s+)?(?:deadlines|дедлайны|сроки\s+сдачи)$/iu.test(
      query,
    ) ||
    /^(?:мои|ближайшие)\s+дедлайны$/iu.test(query) ||
    /^(?:какие\s+(?:у\s+меня\s+)?дедлайны(?:\s+скоро)?|(?:what|which)\s+(?:are\s+my\s+deadlines|deadlines\s+are\s+(?:upcoming|urgent)))$/iu.test(
      query,
    )
  )
    return call("study.deadlines");
  if (
    /^(?:(?:recent|new)\s+(?:grade\s+changes|grades)|(?:grade\s+changes)|(?:новые\s+оценки|изменения\s+оценок|последние\s+изменения\s+оценок))$/iu.test(
      query,
    )
  )
    return call("study.changes");
  const grades = query.match(
    /^(?:(?:my|moodle)\s+)?(?:grades|оценки)(?:\s+(?:for|in|по)\s+(.+))?$/iu,
  );
  if (grades)
    return call("study.grades", grades[1] ? { course: grades[1] } : {});
  let forecast =
    query.match(
      /^what\s+do\s+i\s+need\s+to\s+score\s+in\s+(.+?)\s+to\s+(?:finish\s+with|get|achieve)\s+(\d{1,3}(?:\.\d+)?)$/iu,
    ) ??
    query.match(
      /^сколько\s+(?:мне\s+)?нужно\s+(?:набрать|получить)\s+по\s+(.+?)\s+(?:чтобы\s+(?:получить|закончить\s+с)|для)\s+(\d{1,3}(?:[.,]\d+)?)$/iu,
    );
  if (forecast)
    return call("study.forecast", {
      course: forecast[1],
      target: Number(forecast[2].replace(",", ".")),
    });
  forecast = query.match(
    /^(?:forecast\s+(?:for\s+)?|прогноз\s+(?:по\s+)?)(.+?)(?:\s+(?:target|цель)\s+(\d{1,3}(?:[.,]\d+)?))?$/iu,
  );
  if (forecast)
    return call("study.forecast", {
      course: forecast[1],
      ...(forecast[2] ? { target: Number(forecast[2].replace(",", ".")) } : {}),
    });
  if (
    /^(?:(?:my|current|active)\s+)?tasks$/iu.test(query) ||
    /^(?:(?:мои|текущие|активные)\s+)?задачи$/iu.test(query)
  )
    return call("productivity.tasks");
  if (
    /^(?:(?:my|upcoming)\s+)?reminders$/iu.test(query) ||
    /^(?:(?:мои|ближайшие)\s+)?напоминания$/iu.test(query)
  )
    return call("productivity.reminders");
  const calendar = query.match(
    /^(?:(?:my\s+)?(?:calendar|events)|(?:мой\s+)?календарь|события)(?:\s+(?:for|on|на))?(?:\s+(today|tomorrow|сегодня|завтра|\d{4}-\d{2}-\d{2}))?$/iu,
  );
  if (calendar)
    return call("productivity.calendar", {
      date: calendar[1]
        ? dateFromToken(calendar[1], today)
        : (context.date ?? today),
    });
  const availability = query.match(
    /^(?:find\s+(?:me\s+)?|найди\s+)(?:free\s+|свободн(?:ые|ое)\s+)?(\d{1,3})\s*(minutes?|mins?|минут[уы]?|hours?|час(?:а|ов)?)(?:\s+(?:free|свободного\s+времени))?\s+(today|tomorrow|сегодня|завтра|\d{4}-\d{2}-\d{2})(?:\s+(?:between|с)\s+(\d{2}:\d{2})\s+(?:and|до)\s+(\d{2}:\d{2}))?$/iu,
  );
  if (availability)
    return call("productivity.availability", {
      date: dateFromToken(availability[3], today),
      durationMinutes:
        Number(availability[1]) *
        (/^(?:hour|час)/iu.test(availability[2]) ? 60 : 1),
      ...(availability[4]
        ? { startTime: availability[4], endTime: availability[5] }
        : {}),
    });
  if (/^(?:archived\s+memories|архив\s+памяти)$/iu.test(query))
    return call("memory.list", { includeArchived: true });
  if (
    /^(?:(?:my|stored)\s+)?(?:memory|memories)$/iu.test(query) ||
    /^(?:что\s+ты\s+(?:помнишь|запомнил)|(?:моя\s+|сохран[её]нная\s+)?память)$/iu.test(
      query,
    )
  )
    return call("memory.list");
  const search = query.match(
    /^(?:search\s+memories(?:\s+for)?|find\s+memory|найди\s+в\s+памяти|поиск\s+в\s+памяти)\s*:?\s+(.+)$/iu,
  );
  if (search) return call("memory.search", { query: search[1] });
  return null;
}
