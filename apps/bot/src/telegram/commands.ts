import {
  explainModeReason,
  healthModeLabel,
  parseLifeMode,
  resolveHealthMode,
  scoreFocus,
  type LifeMode,
  type LifeModeResolution,
} from "@lifeos/core";
import type {
  CreateLifeEntityInput,
  Json,
  LifeEntityRecord,
  LifeOSStore,
  ReminderRecord,
  SourceRecord,
  StudyCourseRecord,
  SyncRunRecord,
  TelegramUserRecord,
} from "@lifeos/db";
import type {
  TelegramBotRuntime,
  TelegramMessage,
  TelegramUpdate,
} from "./types.js";

interface ParsedCommand {
  command: string;
  args: string;
}

interface HealthSignalArgs {
  sleepHours?: number;
  moodScore?: number;
  energyScore?: number;
  stressScore?: number;
}

const HELP_TEXT = [
  "LifeOS bot commands:",
  "",
  "Core commands:",
  "/cap quick capture",
  "/log текст — быстро добавить запись в Obsidian Inbox",
  "/task task title",
  "/deadline 2026-05-20 task title",
  "/today",
  "/focus [sleep 7 mood 8 energy 7 stress 3]",
  "/health [sleep 7 mood 8 energy 7 stress 3 notes]",
  "/healthsync_status",
  "/sources",
  "/sync [health|obsidian]",
  "/reminders",
  "/remind review notes at:2026-07-06 08:00",
  "/mode",
  "/mode set <mode> [today|until:YYYY-MM-DD]",
  "/mode auto",
  "/mode clear",
  "/course",
  "/course progress <number>",
  "/course topic <text>",
  "/review review notes",
  "/spend 1200 KZT lunch",
  "/finance",
  "/workout [title]",
  "/status",
  "/healthz",
].join("\n");

const CREATE_COMMANDS = new Set([
  "cap",
  "log",
  "task",
  "deadline",
  "health",
  "review",
  "spend",
  "workout",
  "remind",
]);

const SOURCE_CATALOG: Array<{
  sourceKey: string;
  displayName: string;
  sourceType: string;
  note: string;
  implemented: boolean;
}> = [
  {
    sourceKey: "obsidian_config",
    displayName: "Obsidian Config",
    sourceType: "obsidian",
    note: "Planned for local Arch worker config reads.",
    implemented: false,
  },
  {
    sourceKey: "google_calendar",
    displayName: "Google Calendar",
    sourceType: "google",
    note: "Planned; OAuth is not implemented yet.",
    implemented: false,
  },
  {
    sourceKey: "google_tasks",
    displayName: "Google Tasks",
    sourceType: "google",
    note: "Planned; OAuth is not implemented yet.",
    implemented: false,
  },
  {
    sourceKey: "health_connect",
    displayName: "Health Connect",
    sourceType: "android",
    note: "Existing health ingest status is reported separately.",
    implemented: true,
  },
  {
    sourceKey: "university_ics",
    displayName: "University ICS",
    sourceType: "university",
    note: "Planned import surface for academic calendar data.",
    implemented: false,
  },
  {
    sourceKey: "university_platform",
    displayName: "University Platform",
    sourceType: "university",
    note: "Planned server-side connector; no scraping here.",
    implemented: false,
  },
  {
    sourceKey: "manual",
    displayName: "Manual",
    sourceType: "manual",
    note: "Manual Telegram and TMA inputs.",
    implemented: true,
  },
];

const LOCAL_TIMEZONE = "Asia/Qyzylorda";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function parseCommand(text: string): ParsedCommand | null {
  const [head = "", ...rest] = text.trim().split(/\s+/);

  if (!head.startsWith("/")) {
    return {
      command: "cap",
      args: text.trim(),
    };
  }

  const command = head.slice(1).split("@")[0]?.toLowerCase();

  if (!command) {
    return null;
  }

  return {
    command,
    args: rest.join(" ").trim(),
  };
}

function requireText(
  command: string,
  args: string,
  usage: string,
): string | null {
  if (args.trim()) {
    return args.trim();
  }

  return `Usage: /${command} ${usage}`;
}

async function resolveUser(
  message: TelegramMessage,
  runtime: TelegramBotRuntime,
): Promise<TelegramUserRecord | null> {
  if (!runtime.store) {
    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: "Database is not configured for this bot instance yet.",
    });
    return null;
  }

  if (!message.from?.id) {
    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: "I could not identify the Telegram user for this message.",
    });
    return null;
  }

  const user = await runtime.store.resolveTelegramUser(message.from.id);

  if (!user) {
    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: [
        "Your Telegram account is not linked to LifeOS yet.",
        `Telegram user id: <code>${message.from.id}</code>`,
        "Link this id to your LifeOS profile, then try again.",
      ].join("\n"),
    });
    return null;
  }

  return user;
}

async function createEntityAndQueueSync(
  store: LifeOSStore,
  message: TelegramMessage,
  input: Omit<CreateLifeEntityInput, "telegramChatId" | "telegramMessageId">,
): Promise<LifeEntityRecord> {
  const entity = await store.createLifeEntity({
    ...input,
    telegramChatId: message.chat.id,
    telegramMessageId: message.message_id,
  });

  await store.enqueueObsidianSync({
    userId: input.userId,
    lifeEntityId: entity.id,
    payload: {
      entityType: input.entityType,
      title: input.title,
      sourceCommand: input.sourceCommand,
    },
  });

  return entity;
}

function parseHealthSignalArgs(args: string): HealthSignalArgs {
  const signals: HealthSignalArgs = {};
  const patterns: Array<[keyof HealthSignalArgs, RegExp]> = [
    ["sleepHours", /\bsleep\s*[:=]?\s*(\d+(?:\.\d+)?)/i],
    ["moodScore", /\bmood\s*[:=]?\s*(10|[1-9])\b/i],
    ["energyScore", /\benergy\s*[:=]?\s*(10|[1-9])\b/i],
    ["stressScore", /\bstress\s*[:=]?\s*(10|[1-9])\b/i],
  ];

  for (const [key, pattern] of patterns) {
    const match = args.match(pattern);

    if (match?.[1]) {
      signals[key] = Number(match[1]);
    }
  }

  return signals;
}

function parseSpendArgs(args: string): {
  amount: number | null;
  currency: string | null;
} {
  const amountMatch = args.match(/(?:^|\s)(\d+(?:[.,]\d{1,2})?)(?:\s|$)/);
  const currencyMatch = args.match(/\b([A-Z]{3})\b/);

  return {
    amount: amountMatch?.[1] ? Number(amountMatch[1].replace(",", ".")) : null,
    currency: currencyMatch?.[1] ?? null,
  };
}

function extractDeadline(
  args: string,
  now: Date,
): { title: string; dueAt: string | null } {
  const trimmed = args.trim();
  const isoDate = trimmed.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  const lower = trimmed.toLowerCase();
  const due = new Date(now);
  let dueAt: string | null = null;
  let title = trimmed;

  if (isoDate?.[1]) {
    dueAt = new Date(`${isoDate[1]}T23:59:00.000Z`).toISOString();
    title = title
      .replace(isoDate[1], "")
      .replace(/\bby\b/i, "")
      .trim();
  } else if (lower.includes("tomorrow")) {
    due.setUTCDate(due.getUTCDate() + 1);
    due.setUTCHours(23, 59, 0, 0);
    dueAt = due.toISOString();
    title = title
      .replace(/\btomorrow\b/i, "")
      .replace(/\bby\b/i, "")
      .trim();
  } else if (lower.includes("today")) {
    due.setUTCHours(23, 59, 0, 0);
    dueAt = due.toISOString();
    title = title
      .replace(/\btoday\b/i, "")
      .replace(/\bby\b/i, "")
      .trim();
  }

  return {
    title: title || trimmed,
    dueAt,
  };
}

function utcDayBounds(now: Date): { dayStart: string; dayEnd: string } {
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  return {
    dayStart: dayStart.toISOString(),
    dayEnd: dayEnd.toISOString(),
  };
}

function buildWorkoutUrl(tmaUrl: string, workoutId: string): string | null {
  try {
    const url = new URL(tmaUrl);
    url.searchParams.set("workoutId", workoutId);
    return url.toString();
  } catch {
    return null;
  }
}

function modeUsage(): string {
  return [
    "Usage:",
    "/mode",
    "/mode set exam_war",
    "/mode set practice today",
    "/mode set summer_term until:2026-08-15",
    "/mode auto",
    "/mode clear",
  ].join("\n");
}

function courseUsage(): string {
  return [
    "Usage:",
    "/course",
    "/course progress <number>",
    "/course topic <text>",
  ].join("\n");
}

function remindUsage(): string {
  return [
    "Usage:",
    "/remind Review graph theory at:2026-07-06 08:00",
    "/remind Review graph theory in:30m",
    "/remind Review graph theory in:2h",
    "/remind Review graph theory tomorrow 19:00",
  ].join("\n");
}

function formatSignedWeight(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function formatTopWeights(mode: LifeModeResolution): string {
  return Object.entries(mode.priorityWeights)
    .sort((left, right) => Math.abs(right[1]) - Math.abs(left[1]))
    .slice(0, 6)
    .map(([key, value]) => `${key} ${formatSignedWeight(value)}`)
    .join(", ");
}

function formatModeResolution(mode: LifeModeResolution): string {
  return [
    `Mode: <b>${escapeHtml(mode.label)}</b>`,
    `Source: <b>${escapeHtml(mode.source)}</b>`,
    `Reason: ${escapeHtml(mode.reason)}`,
    mode.source === "manual" && mode.activeUntil
      ? `Active until: <code>${escapeHtml(mode.activeUntil)}</code>`
      : "",
    `Top weights: ${escapeHtml(formatTopWeights(mode))}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatCourseProgress(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatStudyCourse(course: StudyCourseRecord): string {
  const units =
    course.totalUnits === null
      ? ""
      : `Units: <b>${course.completedUnits}/${course.totalUnits}</b>`;

  return [
    `Course: <b>${escapeHtml(course.title)}</b>`,
    `Code: <code>${escapeHtml(course.code)}</code>`,
    course.term ? `Term: ${escapeHtml(course.term)}` : "",
    course.startsOn && course.endsOn
      ? `Dates: <code>${escapeHtml(course.startsOn)}</code> to <code>${escapeHtml(course.endsOn)}</code>`
      : "",
    `Status: <b>${escapeHtml(course.status)}</b>`,
    `Progress: <b>${formatCourseProgress(course.progressPercent)}%</b>`,
    units,
    course.lastStudiedOn
      ? `Last studied: <code>${escapeHtml(course.lastStudiedOn)}</code>`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatNullableDateTime(value?: string | null): string {
  return value ? value : "never";
}

function catalogWithSources(sources: SourceRecord[]) {
  const byKey = new Map(sources.map((source) => [source.sourceKey, source]));

  return SOURCE_CATALOG.map((catalog) => ({
    catalog,
    source: byKey.get(catalog.sourceKey),
  }));
}

function formatSources(sources: SourceRecord[]): string {
  const lines = catalogWithSources(sources).map(({ catalog, source }) => {
    const status = source?.status ?? "disabled";
    const lastSync = formatNullableDateTime(source?.lastSyncAt);
    const suffix = catalog.implemented ? "" : " (coming soon)";

    return [
      `<b>${escapeHtml(catalog.displayName)}</b>${suffix}`,
      `status: <code>${escapeHtml(status)}</code>`,
      `last sync: <code>${escapeHtml(lastSync)}</code>`,
      escapeHtml(catalog.note),
    ].join("\n");
  });

  return ["Data sources:", ...lines].join("\n\n");
}

function formatHealthSyncRuns(runs: SyncRunRecord[]): string {
  if (runs.length === 0) {
    return "No dynamic sync runs recorded yet.";
  }

  return runs
    .map((run, index) => {
      const finished = run.finishedAt ? ` finished=${run.finishedAt}` : "";
      return `${index + 1}. ${escapeHtml(run.sourceKey)} ${escapeHtml(run.status)} seen=${run.recordsSeen} created=${run.recordsCreated} updated=${run.recordsUpdated}${escapeHtml(finished)}`;
    })
    .join("\n");
}

function formatReminderDateTime(value: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone || LOCAL_TIMEZONE,
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatUpcomingReminders(
  reminders: ReminderRecord[],
  timezone: string,
): string {
  if (reminders.length === 0) {
    return "No upcoming reminders.";
  }

  return reminders
    .map((reminder, index) => {
      return `${index + 1}. ${escapeHtml(reminder.message)}\n   <code>${escapeHtml(formatReminderDateTime(reminder.remindAt, timezone))}</code>`;
    })
    .join("\n");
}

function localDateString(date: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const values = Object.fromEntries(
      parts
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value]),
    );

    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function parseCourseProgress(value: string): number | null {
  const match = value.trim().match(/^progress\s+(\d+(?:\.\d+)?)%?$/i);

  if (!match?.[1]) {
    return null;
  }

  const progress = Number(match[1]);

  if (!Number.isFinite(progress) || progress < 0 || progress > 100) {
    return null;
  }

  return progress;
}

function timezoneOffsetMs(date: Date, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(date);
    const values = Object.fromEntries(
      parts
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)]),
    );
    const hour = values.hour === 24 ? 0 : values.hour;
    const localAsUtc = Date.UTC(
      values.year,
      values.month - 1,
      values.day,
      hour,
      values.minute,
      values.second,
    );

    return localAsUtc - date.getTime();
  } catch {
    return 0;
  }
}

function zonedMidnightUtc(date: Date, timeZone: string): Date {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const values = Object.fromEntries(
      parts
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)]),
    );
    const nextLocalMidnight = Date.UTC(
      values.year,
      values.month - 1,
      values.day + 1,
      0,
      0,
      0,
      0,
    );
    let utcMs = nextLocalMidnight;

    for (let index = 0; index < 3; index += 1) {
      utcMs = nextLocalMidnight - timezoneOffsetMs(new Date(utcMs), timeZone);
    }

    return new Date(utcMs);
  } catch {
    const tomorrow = new Date(date);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 0, 0, 0);
    return tomorrow;
  }
}

function untilDateUtc(date: string, timeZone: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const localMidnight = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  let utcMs = localMidnight.getTime();

  for (let index = 0; index < 3; index += 1) {
    utcMs =
      localMidnight.getTime() - timezoneOffsetMs(new Date(utcMs), timeZone);
  }

  return new Date(utcMs).toISOString();
}

function localDateTimeUtc(
  date: string,
  time: string,
  timeZone: string,
): string {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const localDateTime = new Date(
    Date.UTC(year, month - 1, day, hour, minute, 0, 0),
  );
  let utcMs = localDateTime.getTime();

  for (let index = 0; index < 3; index += 1) {
    utcMs =
      localDateTime.getTime() - timezoneOffsetMs(new Date(utcMs), timeZone);
  }

  return new Date(utcMs).toISOString();
}

function parseReminderArgs(
  args: string,
  now: Date,
  timezone: string,
):
  | { ok: true; message: string; remindAt: string }
  | { ok: false; error: string } {
  const trimmed = args.trim();

  if (!trimmed) {
    return {
      ok: false,
      error: remindUsage(),
    };
  }

  const relativeMatch = trimmed.match(/^(.*?)\s+in:(\d+)(m|h)$/i);

  if (relativeMatch?.[1] && relativeMatch[2] && relativeMatch[3]) {
    const amount = Number(relativeMatch[2]);
    const multiplier = relativeMatch[3].toLowerCase() === "h" ? 60 : 1;

    if (amount <= 0) {
      return { ok: false, error: remindUsage() };
    }

    return {
      ok: true,
      message: relativeMatch[1].trim(),
      remindAt: new Date(
        now.getTime() + amount * multiplier * 60_000,
      ).toISOString(),
    };
  }

  const explicitMatch = trimmed.match(
    /^(.*?)\s+at:(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})$/i,
  );
  const relativeDayMatch = trimmed.match(
    /^(.*?)\s+(today|tomorrow)\s+(\d{1,2}:\d{2})$/i,
  );
  const message = (explicitMatch?.[1] ?? relativeDayMatch?.[1] ?? "").trim();
  const rawDate =
    explicitMatch?.[2] ?? relativeDayMatch?.[2]?.toLowerCase() ?? "";
  const time = explicitMatch?.[3] ?? relativeDayMatch?.[3] ?? "";

  if (!message || !rawDate || !time) {
    return { ok: false, error: remindUsage() };
  }

  const timeMatch = time.match(/^(\d{1,2}):(\d{2})$/);

  if (!timeMatch?.[1] || !timeMatch[2]) {
    return {
      ok: false,
      error: remindUsage(),
    };
  }

  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);

  if (hour > 23 || minute > 59) {
    return {
      ok: false,
      error: remindUsage(),
    };
  }

  const date =
    rawDate === "today"
      ? localDateString(now, timezone)
      : rawDate === "tomorrow"
        ? localDateString(new Date(now.getTime() + 86_400_000), timezone)
        : rawDate;

  return {
    ok: true,
    message,
    remindAt: localDateTimeUtc(
      date,
      `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
      timezone,
    ),
  };
}

function parseModeSetArgs(
  args: string,
  now: Date,
  timezone: string,
):
  | { ok: true; mode: LifeMode; activeUntil: string | null }
  | { ok: false; error: string } {
  const parts = args.trim().split(/\s+/);
  const mode = parseLifeMode(parts[1] ?? "");

  if (!mode) {
    return {
      ok: false,
      error: `Unknown mode.\n${modeUsage()}`,
    };
  }

  const duration = parts[2];

  if (!duration) {
    return { ok: true, mode, activeUntil: null };
  }

  if (duration === "today") {
    return {
      ok: true,
      mode,
      activeUntil: zonedMidnightUtc(now, timezone).toISOString(),
    };
  }

  const untilMatch = duration.match(/^until:(\d{4}-\d{2}-\d{2})$/);

  if (untilMatch?.[1]) {
    return {
      ok: true,
      mode,
      activeUntil: untilDateUtc(untilMatch[1], timezone),
    };
  }

  return {
    ok: false,
    error: `Unsupported duration.\n${modeUsage()}`,
  };
}

function inboxLogTargetPath(now: Date): string {
  const iso = now.toISOString();
  const timestamp = `${iso.slice(0, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}`;

  return `00_Dashboard/Inbox/${timestamp}-log.md`;
}

function entitySummary(entity: LifeEntityRecord): string {
  return `Saved <b>${escapeHtml(entity.entityType)}</b>: ${escapeHtml(entity.title)}`;
}

function metadata(value: Record<string, unknown>): Json {
  return value as Json;
}

function bootstrapProfileSql(userId: string, telegramUserId: number): string {
  return [
    "insert into public.profiles (user_id, telegram_user_id, display_name, timezone, locale)",
    `values ('${userId}', ${telegramUserId}, 'LifeOS User', '${LOCAL_TIMEZONE}', 'en')`,
    "on conflict (user_id) do update set",
    "  telegram_user_id = excluded.telegram_user_id,",
    "  display_name = coalesce(public.profiles.display_name, excluded.display_name),",
    "  timezone = excluded.timezone,",
    "  locale = excluded.locale,",
    "  updated_at = now();",
  ].join("\n");
}

function bootstrapHint(message: TelegramMessage, runtime: TelegramBotRuntime) {
  if (!message.from?.id || !runtime.defaultUserId) {
    return [
      "Create or update a profile row in Supabase, then try again.",
      message.from?.id
        ? `Telegram user id: <code>${message.from.id}</code>`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    "Run this SQL after the auth.users row exists:",
    `<pre>${escapeHtml(
      bootstrapProfileSql(runtime.defaultUserId, message.from.id),
    )}</pre>`,
  ].join("\n");
}

async function handleStartCommand(
  message: TelegramMessage,
  runtime: TelegramBotRuntime,
): Promise<void> {
  const telegramUserId = message.from?.id;

  if (!telegramUserId) {
    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: "LifeOS bot is online, but I could not identify your Telegram user id.",
    });
    return;
  }

  if (!runtime.store) {
    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: [
        "LifeOS bot is online.",
        "Database is not configured, so I cannot link this Telegram account yet.",
        bootstrapHint(message, runtime),
      ].join("\n"),
    });
    return;
  }

  const existing = await runtime.store.resolveTelegramUser(telegramUserId);

  if (existing) {
    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: [
        "LifeOS bot is online.",
        `Linked profile: <code>${existing.userId}</code>`,
        "Use /help to see commands.",
      ].join("\n"),
    });
    return;
  }

  const canBootstrap =
    runtime.defaultUserId &&
    runtime.defaultTelegramUserId &&
    runtime.defaultTelegramUserId === telegramUserId;

  if (canBootstrap && runtime.defaultUserId) {
    try {
      const linked = await runtime.store.linkDefaultTelegramUser({
        userId: runtime.defaultUserId,
        telegramUserId,
        displayName: message.from?.first_name ?? null,
      });

      await runtime.telegram.sendMessage({
        chatId: message.chat.id,
        text: [
          "LifeOS bot is online.",
          `Linked this Telegram account to <code>${linked.userId}</code>.`,
          "Use /help to see commands.",
        ].join("\n"),
      });
      return;
    } catch (error) {
      await runtime.telegram.sendMessage({
        chatId: message.chat.id,
        text: [
          "LifeOS bot is online, but automatic linking failed.",
          error instanceof Error ? escapeHtml(error.message) : "Unknown error",
          bootstrapHint(message, runtime),
        ].join("\n"),
      });
      return;
    }
  }

  await runtime.telegram.sendMessage({
    chatId: message.chat.id,
    text: [
      "LifeOS bot is online.",
      "Your Telegram account is not linked yet.",
      bootstrapHint(message, runtime),
    ].join("\n"),
  });
}

async function handleCreateCommand(
  command: string,
  args: string,
  message: TelegramMessage,
  runtime: TelegramBotRuntime,
): Promise<void> {
  if (command === "log" && !args.trim()) {
    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: "/log текст — быстро добавить запись в Obsidian Inbox",
    });
    return;
  }

  const user = await resolveUser(message, runtime);

  if (!user || !runtime.store) {
    return;
  }

  if (command === "cap") {
    const text = requireText(command, args, "quick capture");

    if (!text || text.startsWith("Usage:")) {
      await runtime.telegram.sendMessage({
        chatId: message.chat.id,
        text: text ?? "",
      });
      return;
    }

    const entity = await createEntityAndQueueSync(runtime.store, message, {
      userId: user.userId,
      entityType: "capture",
      title: text,
      body: text,
      sourceCommand: "/cap",
    });

    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: entitySummary(entity),
    });
    return;
  }

  if (command === "log") {
    const text = args.trim();
    const now = runtime.now?.() ?? new Date();
    const rawPayload = metadata({
      telegram_user_id: message.from?.id ?? null,
      chat_id: message.chat.id,
      message_id: message.message_id,
      command: "/log",
    });
    const capture = await runtime.store.createLifeCapture({
      userId: user.userId,
      text,
      source: "telegram",
      status: "inbox",
      chatId: message.chat.id,
      messageId: message.message_id,
      metadata: rawPayload,
    });
    const entity = await runtime.store.createLifeEntity({
      userId: user.userId,
      entityType: "capture",
      domain: "personal",
      status: "inbox",
      source: "telegram",
      sourceCommand: "/log",
      title: text.slice(0, 80),
      description: text,
      body: text,
      telegramChatId: message.chat.id,
      telegramMessageId: message.message_id,
      linkedTable: "life_captures",
      linkedId: capture.id,
      metadata: metadata({
        captureId: capture.id,
        rawPayload,
      }),
      rawPayloadJson: rawPayload,
    });

    await runtime.store.enqueueObsidianSync({
      userId: user.userId,
      lifeEntityId: entity.id,
      entityType: "capture",
      action: "upsert",
      targetPath: inboxLogTargetPath(now),
      payloadJson: metadata({
        entity,
        capture,
        originalText: text,
      }),
    });

    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: "✅ Добавил в Inbox.",
    });
    return;
  }

  if (command === "task") {
    const title = requireText(command, args, "task title");

    if (!title || title.startsWith("Usage:")) {
      await runtime.telegram.sendMessage({
        chatId: message.chat.id,
        text: title ?? "",
      });
      return;
    }

    const task = await runtime.store.createTask({
      userId: user.userId,
      title,
      source: "telegram",
    });
    const entity = await createEntityAndQueueSync(runtime.store, message, {
      userId: user.userId,
      entityType: "task",
      title,
      sourceCommand: "/task",
      linkedTable: "tasks",
      linkedId: task.id,
    });

    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: `${entitySummary(entity)}\nTask id: <code>${task.id}</code>`,
    });
    return;
  }

  if (command === "deadline") {
    const raw = requireText(command, args, "2026-05-20 task title");

    if (!raw || raw.startsWith("Usage:")) {
      await runtime.telegram.sendMessage({
        chatId: message.chat.id,
        text: raw ?? "",
      });
      return;
    }

    const deadline = extractDeadline(raw, runtime.now?.() ?? new Date());
    const task = await runtime.store.createTask({
      userId: user.userId,
      title: deadline.title,
      dueAt: deadline.dueAt,
      source: "telegram",
    });
    const entity = await createEntityAndQueueSync(runtime.store, message, {
      userId: user.userId,
      entityType: "deadline",
      title: deadline.title,
      body: raw,
      dueAt: deadline.dueAt,
      sourceCommand: "/deadline",
      linkedTable: "tasks",
      linkedId: task.id,
      metadata: metadata({ dueAt: deadline.dueAt }),
    });

    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: `${entitySummary(entity)}${deadline.dueAt ? `\nDue: <code>${deadline.dueAt}</code>` : ""}`,
    });
    return;
  }

  if (command === "health") {
    const signals = parseHealthSignalArgs(args);
    const mode = resolveHealthMode(signals);
    const focus = scoreFocus({ ...signals, healthMode: mode });
    const entity = await createEntityAndQueueSync(runtime.store, message, {
      userId: user.userId,
      entityType: "health",
      title: args.trim() || `Health check: ${healthModeLabel(mode)}`,
      body: args.trim() || null,
      sourceCommand: "/health",
      metadata: metadata({ ...signals, mode, focusScore: focus.score }),
    });

    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: `${entitySummary(entity)}\nMode: <b>${healthModeLabel(mode)}</b>\nFocus score: <b>${focus.score}</b>`,
    });
    return;
  }

  if (command === "review") {
    const text = requireText(command, args, "review notes");

    if (!text || text.startsWith("Usage:")) {
      await runtime.telegram.sendMessage({
        chatId: message.chat.id,
        text: text ?? "",
      });
      return;
    }

    const entity = await createEntityAndQueueSync(runtime.store, message, {
      userId: user.userId,
      entityType: "review",
      title: text.slice(0, 120),
      body: text,
      sourceCommand: "/review",
    });

    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: entitySummary(entity),
    });
    return;
  }

  if (command === "spend") {
    const text = requireText(command, args, "1200 KZT lunch");

    if (!text || text.startsWith("Usage:")) {
      await runtime.telegram.sendMessage({
        chatId: message.chat.id,
        text: text ?? "",
      });
      return;
    }

    const parsedSpend = parseSpendArgs(text);
    const entity = await createEntityAndQueueSync(runtime.store, message, {
      userId: user.userId,
      entityType: "spend",
      title: text,
      body: text,
      sourceCommand: "/spend",
      metadata: metadata(parsedSpend),
    });

    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: entitySummary(entity),
    });
    return;
  }

  if (command === "remind") {
    const parsed = parseReminderArgs(
      args,
      runtime.now?.() ?? new Date(),
      user.timezone,
    );

    if (!parsed.ok) {
      await runtime.telegram.sendMessage({
        chatId: message.chat.id,
        text: parsed.error,
      });
      return;
    }

    const reminder = await runtime.store.createReminder({
      userId: user.userId,
      message: parsed.message,
      remindAt: parsed.remindAt,
      channel: "telegram",
      metadataJson: metadata({
        source: "telegram",
        command: "/remind",
        telegram_user_id: message.from?.id ?? null,
        chat_id: message.chat.id,
        message_id: message.message_id,
      }),
    });

    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: [
        "Reminder scheduled.",
        `When: <code>${escapeHtml(formatReminderDateTime(reminder.remindAt, user.timezone || LOCAL_TIMEZONE))}</code>`,
        `Message: ${escapeHtml(reminder.message)}`,
      ].join("\n"),
    });
    return;
  }

  if (command === "workout") {
    const now = runtime.now?.() ?? new Date();
    const mode = await runtime.store.resolveCurrentMode(user.userId);
    const workout = await runtime.store.getOrCreateCurrentWorkout({
      userId: user.userId,
      title: args.trim() || null,
      now: now.toISOString(),
      lifeMode: mode.mode,
    });

    if (workout.created) {
      const entity = await createEntityAndQueueSync(runtime.store, message, {
        userId: user.userId,
        entityType: "workout",
        title: workout.title ?? "Workout",
        sourceCommand: "/workout",
        linkedTable: "workouts",
        linkedId: workout.id,
        metadata: metadata({ workoutId: workout.id, lifeMode: mode.mode }),
      });
      void entity;
    }

    const workoutUrl = runtime.tmaUrl
      ? buildWorkoutUrl(runtime.tmaUrl, workout.id)
      : null;

    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: [
        workout.created ? "Workout started." : "Current workout loaded.",
        `Mode: <b>${escapeHtml(mode.label)}</b>`,
        `Workout id: <code>${workout.id}</code>`,
      ].join("\n"),
      replyMarkup: workoutUrl
        ? {
            inline_keyboard: [
              [
                {
                  text: "Open workout",
                  web_app: {
                    url: workoutUrl,
                  },
                },
              ],
            ],
          }
        : undefined,
    });
  }
}

async function handleReadCommand(
  command: string,
  args: string,
  message: TelegramMessage,
  runtime: TelegramBotRuntime,
): Promise<void> {
  if (command === "start") {
    await handleStartCommand(message, runtime);
    return;
  }

  if (command === "help" || command === "hepl") {
    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: HELP_TEXT,
    });
    return;
  }

  if (command === "status") {
    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: [
        "LifeOS bot status:",
        `Database: <b>${runtime.store ? "configured" : "missing"}</b>`,
        `TMA_URL: <b>${runtime.tmaUrl ? "configured" : "missing"}</b>`,
        "Polling: <b>disabled</b>",
      ].join("\n"),
    });
    return;
  }

  if (command === "healthz") {
    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: [
        "healthz is an HTTP endpoint. Use /status in Telegram.",
        "Backend: https://lifeosbot-production.up.railway.app/healthz",
      ].join("\n"),
    });
    return;
  }

  const user = await resolveUser(message, runtime);

  if (!user || !runtime.store) {
    return;
  }

  if (command === "mode") {
    const normalized = args.trim().toLowerCase();

    if (!normalized) {
      const mode = await runtime.store.resolveCurrentMode(user.userId);

      await runtime.telegram.sendMessage({
        chatId: message.chat.id,
        text: formatModeResolution(mode),
      });
      return;
    }

    if (normalized === "auto" || normalized === "clear") {
      const mode = await runtime.store.clearManualMode(user.userId);

      await runtime.telegram.sendMessage({
        chatId: message.chat.id,
        text: [
          "Manual mode override cleared.",
          formatModeResolution(mode),
        ].join("\n\n"),
      });
      return;
    }

    if (normalized.startsWith("set ")) {
      const parsed = parseModeSetArgs(
        normalized,
        runtime.now?.() ?? new Date(),
        user.timezone,
      );

      if (!parsed.ok) {
        await runtime.telegram.sendMessage({
          chatId: message.chat.id,
          text: parsed.error,
        });
        return;
      }

      const mode = await runtime.store.setManualMode({
        userId: user.userId,
        mode: parsed.mode,
        activeUntil: parsed.activeUntil,
        reason: parsed.activeUntil
          ? `Telegram override until ${parsed.activeUntil}`
          : "Telegram override until cleared.",
      });

      await runtime.telegram.sendMessage({
        chatId: message.chat.id,
        text: formatModeResolution(mode),
      });
      return;
    }

    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: modeUsage(),
    });
    return;
  }

  if (command === "course") {
    const now = runtime.now?.() ?? new Date();
    const today = localDateString(now, user.timezone);
    const trimmed = args.trim();

    if (!trimmed) {
      const course = await runtime.store.getActiveStudyCourse(
        user.userId,
        today,
      );

      await runtime.telegram.sendMessage({
        chatId: message.chat.id,
        text: course
          ? formatStudyCourse(course)
          : `No active study course for <code>${escapeHtml(today)}</code>.`,
      });
      return;
    }

    const progress = parseCourseProgress(trimmed);

    if (progress !== null) {
      const course = await runtime.store.getActiveStudyCourse(
        user.userId,
        today,
      );

      if (!course) {
        await runtime.telegram.sendMessage({
          chatId: message.chat.id,
          text: `No active study course for <code>${escapeHtml(today)}</code>.`,
        });
        return;
      }

      const updated = await runtime.store.updateStudyCourseProgress({
        userId: user.userId,
        courseId: course.id,
        progressPercent: progress,
        lastStudiedOn: today,
      });

      await runtime.telegram.sendMessage({
        chatId: message.chat.id,
        text: ["Course progress updated.", formatStudyCourse(updated)].join(
          "\n\n",
        ),
      });
      return;
    }

    if (trimmed.toLowerCase().startsWith("topic ")) {
      const topic = trimmed.slice("topic ".length).trim();

      if (!topic) {
        await runtime.telegram.sendMessage({
          chatId: message.chat.id,
          text: courseUsage(),
        });
        return;
      }

      const course = await runtime.store.getActiveStudyCourse(
        user.userId,
        today,
      );

      if (!course) {
        await runtime.telegram.sendMessage({
          chatId: message.chat.id,
          text: `No active study course for <code>${escapeHtml(today)}</code>.`,
        });
        return;
      }

      const entity = await createEntityAndQueueSync(runtime.store, message, {
        userId: user.userId,
        entityType: "review",
        domain: "study",
        status: "inbox",
        title: `${course.title}: ${topic}`.slice(0, 120),
        body: topic,
        sourceCommand: "/course topic",
        linkedTable: "study_courses",
        linkedId: course.id,
        metadata: metadata({
          courseId: course.id,
          courseCode: course.code,
          courseTitle: course.title,
          priorityKey: "coursework",
          tags: ["study", "course"],
          topic,
        }),
      });

      await runtime.telegram.sendMessage({
        chatId: message.chat.id,
        text: [
          "Course topic saved.",
          `Course: <b>${escapeHtml(course.title)}</b>`,
          `Topic: ${escapeHtml(topic)}`,
          `Entity id: <code>${escapeHtml(entity.id)}</code>`,
        ].join("\n"),
      });
      return;
    }

    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: courseUsage(),
    });
    return;
  }

  if (command === "sources") {
    const sources = await runtime.store.listExternalSources(user.userId);

    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: formatSources(sources),
    });
    return;
  }

  if (command === "sync") {
    const normalized = args.trim().toLowerCase();

    if (!normalized) {
      await runtime.telegram.sendMessage({
        chatId: message.chat.id,
        text: [
          "Sync commands:",
          "/sync health — latest Health Connect ingest status",
          "/sync obsidian — Obsidian config sync status",
          "",
          "Google Calendar, Google Tasks, University ICS, and University Platform sync are planned.",
        ].join("\n"),
      });
      return;
    }

    if (normalized === "obsidian") {
      await runtime.telegram.sendMessage({
        chatId: message.chat.id,
        text: "Obsidian config sync is planned for local Arch worker.",
      });
      return;
    }

    if (normalized === "health") {
      const [healthStatus, sourcesSummary] = await Promise.all([
        runtime.store.getHealthSyncStatus(user.userId),
        runtime.store.getTmaSourcesSummary(user.userId),
      ]);
      const latest = healthStatus.latestRun;

      await runtime.telegram.sendMessage({
        chatId: message.chat.id,
        text: [
          "Health sync:",
          latest
            ? `Latest health bridge run: <b>${escapeHtml(latest.status)}</b> on <code>${escapeHtml(latest.syncDate)}</code>`
            : "No health bridge runs yet.",
          formatHealthSyncRuns(
            sourcesSummary.syncRuns.filter(
              (run) => run.sourceKey === "health_connect",
            ),
          ),
        ].join("\n"),
      });
      return;
    }

    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: "Unknown sync target. Try /sync, /sync health, or /sync obsidian.",
    });
    return;
  }

  if (command === "reminders") {
    const reminders = await runtime.store.listUpcomingReminders(
      user.userId,
      10,
    );

    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: [
        `Upcoming reminders (${escapeHtml(user.timezone || LOCAL_TIMEZONE)}):`,
        formatUpcomingReminders(reminders, user.timezone || LOCAL_TIMEZONE),
      ].join("\n"),
    });
    return;
  }

  if (command === "today") {
    const bounds = utcDayBounds(runtime.now?.() ?? new Date());
    const [mode, entities] = await Promise.all([
      runtime.store.resolveCurrentMode(user.userId),
      runtime.store.listTodayEntities({
        userId: user.userId,
        ...bounds,
      }),
    ]);
    const lines = entities.map((entity, index) => {
      return `${index + 1}. ${entity.entityType}: ${escapeHtml(entity.title)}`;
    });

    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: [
        `Mode: <b>${escapeHtml(mode.label)}</b>`,
        lines.length
          ? `Today:\n${lines.join("\n")}`
          : "No LifeOS entries captured today yet.",
      ].join("\n\n"),
    });
    return;
  }

  if (command === "focus") {
    const [mode, signals] = await Promise.all([
      runtime.store.resolveCurrentMode(user.userId),
      args.trim()
        ? Promise.resolve(parseHealthSignalArgs(args))
        : runtime.store.getLatestDailyLog(user.userId).then((log) => ({
            moodScore: log?.moodScore ?? undefined,
            energyScore: log?.energyScore ?? undefined,
          })),
    ]);
    const result = scoreFocus({
      ...signals,
      healthMode: mode.mode === "recovery" ? "recovery" : undefined,
    });
    const topItems = await runtime.store.listModeAwareFocusItems({
      userId: user.userId,
      mode: mode.mode,
      limit: 5,
    });
    const itemLines = topItems.map((item, index) => {
      const matches = item.modePriorityMatches.length
        ? ` (${item.modePriorityMatches.join(", ")})`
        : "";
      return `${index + 1}. ${escapeHtml(item.title)} ${formatSignedWeight(item.modePriorityDelta)}${escapeHtml(matches)}`;
    });

    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: [
        `Focus score: <b>${result.score}</b>`,
        `Band: <b>${result.band}</b>`,
        `Mode: <b>${escapeHtml(mode.label)}</b>`,
        `Why: ${escapeHtml(explainModeReason(mode))}`,
        result.reasons.length ? `Reasons: ${result.reasons.join(", ")}` : "",
        itemLines.length ? `Top focus:\n${itemLines.join("\n")}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    });
    return;
  }

  if (command === "health") {
    const health = await runtime.store.getTmaHealthSummary(user.userId);

    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: [
        `Health date: <b>${health.date}</b>`,
        `Recovery mode: <b>${healthModeLabel(health.recoveryMode)}</b>`,
        `Data completeness: <b>${health.dataCompletenessScore}</b>`,
        `Samples: <b>${health.samplesCount}</b>`,
      ].join("\n"),
    });
    return;
  }

  if (command === "healthsync_status") {
    const status = await runtime.store.getHealthSyncStatus(user.userId);
    const counts = status.counts;
    const runs = status.runs;
    const runLines = runs.map((run, index) => {
      const missing = Object.entries(run.missingMetrics)
        .filter(([, isMissing]) => isMissing)
        .map(([name]) => name)
        .join(", ");

      return `${index + 1}. ${escapeHtml(run.syncDate)} ${escapeHtml(run.syncReason)} ${escapeHtml(run.status)} score=${run.dataCompletenessScore ?? "n/a"} missing=${missing || "none"}`;
    });

    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: [
        "Health sync runs:",
        `Success: <b>${counts.success ?? 0}</b>`,
        `Failed: <b>${counts.failed ?? 0}</b>`,
        runLines.length ? runLines.join("\n") : "No health sync runs yet.",
      ]
        .filter(Boolean)
        .join("\n"),
    });
    return;
  }

  if (command === "finance") {
    const since = new Date(runtime.now?.() ?? new Date());
    since.setUTCDate(since.getUTCDate() - 30);
    const summary = await runtime.store.getFinanceSummary({
      userId: user.userId,
      since: since.toISOString(),
    });

    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: [
        "Finance summary, last 30 days:",
        `Spend captures: <b>${summary.capturedSpendCount}</b>`,
        summary.capturedSpendTotal === null
          ? "Captured total: unavailable"
          : `Captured total: <b>${summary.capturedSpendTotal}</b>`,
      ].join("\n"),
    });
    return;
  }

  await runtime.telegram.sendMessage({
    chatId: message.chat.id,
    text: `Unknown command: /${escapeHtml(command)}\nUse /help.`,
  });
}

export async function handleTelegramUpdate(
  update: TelegramUpdate,
  runtime: TelegramBotRuntime,
): Promise<void> {
  const message = update.message;

  if (!message?.text) {
    return;
  }

  const parsed = parseCommand(message.text);

  if (!parsed) {
    return;
  }

  const shouldCreate =
    CREATE_COMMANDS.has(parsed.command) &&
    !(parsed.command === "mode" && !parsed.args) &&
    !(parsed.command === "health" && !parsed.args);

  if (shouldCreate) {
    await handleCreateCommand(parsed.command, parsed.args, message, runtime);
    return;
  }

  await handleReadCommand(parsed.command, parsed.args, message, runtime);
}
