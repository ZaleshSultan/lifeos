import {
  explainModeReason,
  healthModeLabel,
  looksLikeFinanceQuestion,
  looksLikeQuickFinanceInput,
  parseFinanceText,
  parseLifeMode,
  resolveHealthMode,
  scoreFocus,
  type FinanceParseResult,
  type HealthMetricType,
  type LifeMode,
  type LifeModeResolution,
} from "@lifeos/core";
import type {
  BankLineRecord,
  BudgetSummaryPayload,
  CreateLifeEntityInput,
  FinanceTransactionRecord,
  Json,
  LifeEntityRecord,
  LifeOSStore,
  MonthlyReviewRecord,
  ReminderRecord,
  ReminderMode,
  SourceRecord,
  StudyCourseRecord,
  SyncRunRecord,
  TelegramUserRecord,
  TmaHealthSummary,
  TmaFinanceSummary,
} from "@lifeos/db";
import type {
  TelegramBotRuntime,
  TelegramMessage,
  TelegramPhotoSize,
  TelegramUpdate,
} from "./types.js";
import { triggerFinanceAlerts } from "./alerts.js";

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

type ParsedHealthLogMetric = {
  type: HealthMetricType;
  value: number;
  unit: string;
};

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
  "/health",
  "/health_log steps:8000 sleep:7h rhr:62 weight:70.5 mood:7 energy:6",
  "/health_week",
  "/health_import",
  "/health_sources",
  "/healthsync_status",
  "/sources",
  "/sync [health|obsidian]",
  "/reminders",
  "/remind review notes at:2026-07-06 08:00",
  "/reminder cancel <short_id>",
  "/reminder snooze <short_id> 10m",
  "/reminder_mode [chill|normal|duolingo|war]",
  "/google_sync",
  "/ics_sync",
  "/mode",
  "/mode set <mode> [today|until:YYYY-MM-DD]",
  "/mode auto",
  "/mode clear",
  "/course",
  "/course progress <number>",
  "/course topic <text>",
  "/review review notes",
  "/spend 1200 шаурма",
  "Quick spend without slash: Такси 2700",
  "/income 20000 долг вернули",
  "/finance_ai потратил 3500 на такси",
  "/finance",
  "/finance_today",
  "/finance_week",
  "/finance_month",
  "/finance_categories",
  "/finance_confirm <short_id>",
  "/finance_cancel <short_id>",
  "/finance_fix <short_id> amount:1500 category:Еда",
  "/finance_ask На что ушли деньги в этом месяце?",
  "/monthly_review [YYYY-MM]",
  "/monthly_review_status",
  "/monthly_review_regenerate YYYY-MM",
  "/workout [title]",
  "",
  "Finance V2:",
  "/budget — budget overview with progress bars",
  "/budget_set <category> <amount> [monthly|quarterly|custom]",
  "/bank unmatched — list unmatched bank transactions",
  "/bank match <short_id> <entity_id>",
  "Photo upload — send a receipt photo to start OCR scan",
  "",
  "/status",
  "/healthz",
].join("\n");

type CommandHandler = (
  args: string,
  message: TelegramMessage,
  runtime: TelegramBotRuntime,
  user: TelegramUserRecord | null,
) => Promise<void>;

interface CommandConfig {
  handler: CommandHandler;
  requiresUser: boolean;
}

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
    note: "Read-only local OAuth worker.",
    implemented: true,
  },
  {
    sourceKey: "google_tasks",
    displayName: "Google Tasks",
    sourceType: "google",
    note: "Read-only local OAuth worker.",
    implemented: true,
  },
  {
    sourceKey: "health_connect",
    displayName: "Health Connect",
    sourceType: "android",
    note: "Existing health ingest status is reported separately.",
    implemented: true,
  },
  {
    sourceKey: "moodle_ics",
    displayName: "Moodle ICS",
    sourceType: "ics",
    note: "Official Moodle calendar export via local worker.",
    implemented: true,
  },
  {
    sourceKey: "personal_ics",
    displayName: "Personal ICS",
    sourceType: "ics",
    note: "Optional personal calendar feed via local worker.",
    implemented: true,
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

const LOCAL_TIMEZONE: string = process.env.LOCAL_TIMEZONE || "Asia/Qyzylorda";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

const BOT_COMMAND_PATTERN = /^\/[a-zA-Z][a-zA-Z0-9_]{0,30}$/;

function looksLikePathCommandToken(token: string): boolean {
  return token.indexOf("/", 1) !== -1;
}

function parseCommand(text: string): ParsedCommand | null {
  const trimmed = text.trim();
  const [head = "", ...rest] = trimmed.split(/\s+/);

  if (!head.startsWith("/")) {
    return {
      command: "cap",
      args: trimmed,
    };
  }

  const commandToken = head.split("@")[0] ?? "";

  if (
    looksLikePathCommandToken(commandToken) ||
    !BOT_COMMAND_PATTERN.test(commandToken)
  ) {
    return {
      command: "cap",
      args: trimmed,
    };
  }

  const command = commandToken.slice(1).toLowerCase();

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
  let entity: LifeEntityRecord;

  try {
    entity = await store.createLifeEntity({
      ...input,
      telegramChatId: message.chat.id,
      telegramMessageId: message.message_id,
    });
  } catch (entityError) {
    console.error(
      "[ERROR] Life entity creation failed before Obsidian sync queue:",
      entityError instanceof Error ? entityError.message : entityError,
    );
    throw entityError;
  }

  try {
    await store.enqueueObsidianSync({
      userId: input.userId,
      lifeEntityId: entity.id,
      payload: {
        entityType: input.entityType,
        title: input.title,
        sourceCommand: input.sourceCommand,
      },
    });
  } catch (syncError) {
    console.error(
      `[CRITICAL] Obsidian sync queue failed for entity ${entity.id}:`,
      syncError instanceof Error ? syncError.message : syncError,
    );
    throw new Error(
      `Entity ${entity.id} created but Obsidian sync queue insertion failed. ` +
        `Manual intervention required. Original error: ${
          syncError instanceof Error ? syncError.message : String(syncError)
        }`,
    );
  }

  return entity;
}

/*
Future Supabase migration template for an atomic RPC:

create or replace function public.create_life_entity_with_sync(
  p_entity jsonb,
  p_sync jsonb
) returns public.life_entities
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entity public.life_entities;
begin
  insert into public.life_entities (...)
  values (...)
  returning * into v_entity;

  insert into public.obsidian_sync_queue (...)
  values (..., v_entity.id, ...);

  return v_entity;
exception
  when others then
    raise;
end;
$$;
*/

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

function parseDurationMinutes(value: string): number | null {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)(h|m)?$/i);

  if (!match?.[1]) {
    return null;
  }

  const amount = Number(match[1]);

  if (!Number.isFinite(amount) || amount < 0) {
    return null;
  }

  return match[2]?.toLowerCase() === "m" ? amount : Math.round(amount * 60);
}

function parseHealthLogArgs(args: string): ParsedHealthLogMetric[] | null {
  const metrics: ParsedHealthLogMetric[] = [];
  const aliases: Record<string, { type: HealthMetricType; unit: string }> = {
    steps: { type: "steps", unit: "steps" },
    sleep: { type: "sleep_minutes", unit: "min" },
    sleep_minutes: { type: "sleep_minutes", unit: "min" },
    sleep_score: { type: "sleep_score", unit: "score" },
    rhr: { type: "resting_heart_rate", unit: "bpm" },
    resting_heart_rate: { type: "resting_heart_rate", unit: "bpm" },
    avg_hr: { type: "average_heart_rate", unit: "bpm" },
    active_kcal: { type: "active_energy_kcal", unit: "kcal" },
    kcal: { type: "active_energy_kcal", unit: "kcal" },
    total_kcal: { type: "total_energy_kcal", unit: "kcal" },
    workout: { type: "workout_minutes", unit: "min" },
    workout_minutes: { type: "workout_minutes", unit: "min" },
    distance: { type: "distance_m", unit: "m" },
    weight: { type: "weight_kg", unit: "kg" },
    weight_kg: { type: "weight_kg", unit: "kg" },
    spo2: { type: "spo2_percent", unit: "%" },
    stress: { type: "stress_score", unit: "score" },
    mood: { type: "mood_score", unit: "score" },
    energy: { type: "energy_score", unit: "score" },
  };

  for (const token of args.trim().split(/\s+/).filter(Boolean)) {
    const match = token.match(/^([a-zA-Z_]+):(.+)$/);

    if (!match?.[1] || !match[2]) {
      return null;
    }

    const alias = aliases[match[1].toLowerCase()];

    if (!alias) {
      return null;
    }

    const value =
      alias.type === "sleep_minutes" || alias.type === "workout_minutes"
        ? parseDurationMinutes(match[2])
        : Number(match[2]);

    if (value === null || !Number.isFinite(value)) {
      return null;
    }

    metrics.push({
      type: alias.type,
      value,
      unit: alias.unit,
    });
  }

  return metrics.length ? metrics : null;
}

function healthLogUsage(): string {
  return [
    "Usage:",
    "/health_log steps:8000 sleep:7h rhr:62 weight:70.5 mood:7 energy:6",
    "Optional keys: active_kcal, workout, stress, spo2, distance.",
  ].join("\n");
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

function buildModeUrl(tmaUrl: string): string | null {
  try {
    const url = new URL(tmaUrl);
    url.searchParams.set("screen", "mode");
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

function reminderModeUsage(): string {
  return [
    "Reminder mode:",
    "/reminder_mode",
    "/reminder_mode chill|normal|duolingo|war",
  ].join("\n");
}

function reminderActionUsage(): string {
  return [
    "Reminder actions:",
    "/reminder cancel <short_id>",
    "/reminder snooze <short_id> 10m",
  ].join("\n");
}

function reminderNotFound(shortId: string): string {
  return [
    `No upcoming reminder matches <code>${escapeHtml(shortId)}</code>.`,
    "Use /reminders to copy a current short ID.",
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

function formatMinutesValue(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "n/a";
  }

  const hours = Math.floor(value / 60);
  const minutes = Math.round(value % 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function formatNumberValue(
  value: number | null | undefined,
  unit = "",
): string {
  if (value === null || value === undefined) {
    return "n/a";
  }

  const formatted = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return unit ? `${formatted} ${unit}` : formatted;
}

function formatHealthToday(health: TmaHealthSummary): string {
  if (!health.hasMetrics) {
    return [
      "No Xiaomi Watch data yet.",
      "Connect Mi Fitness → Health Connect or use /health_log.",
    ].join("\n");
  }

  return [
    `Health today: <b>${escapeHtml(health.date)}</b>`,
    health.sourceLabel
      ? `Source: <b>${escapeHtml(health.sourceLabel)}</b>`
      : "",
    `Steps: <b>${escapeHtml(formatNumberValue(health.steps, "steps"))}</b>`,
    `Sleep: <b>${escapeHtml(formatMinutesValue(health.sleepMinutes))}</b>`,
    `Resting HR: <b>${escapeHtml(formatNumberValue(health.restingHeartRate, "bpm"))}</b>`,
    `Active kcal: <b>${escapeHtml(formatNumberValue(health.activeEnergyKcal, "kcal"))}</b>`,
    `Workout: <b>${escapeHtml(formatMinutesValue(health.workoutMinutes))}</b>`,
    `Stress: <b>${escapeHtml(formatNumberValue(health.stressScore))}</b>`,
    `Mood: <b>${escapeHtml(formatNumberValue(health.moodScore))}</b>`,
    `Energy: <b>${escapeHtml(formatNumberValue(health.energyScore))}</b>`,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatHealthWeek(health: TmaHealthSummary): string {
  const week = health.weekly;
  return [
    `Health week: <code>${escapeHtml(week.startDate)}</code> to <code>${escapeHtml(week.endDate)}</code>`,
    `Avg steps: <b>${escapeHtml(formatNumberValue(week.avgSteps, "steps"))}</b>`,
    `Avg sleep: <b>${escapeHtml(formatMinutesValue(week.avgSleepMinutes))}</b>`,
    `Avg RHR: <b>${escapeHtml(formatNumberValue(week.avgRestingHeartRate, "bpm"))}</b>`,
    `Workout total: <b>${escapeHtml(formatMinutesValue(week.totalWorkoutMinutes))}</b>`,
    `Missing days: <b>${week.missingDays.length}</b>${
      week.missingDays.length
        ? ` (${escapeHtml(week.missingDays.join(", "))})`
        : ""
    }`,
  ].join("\n");
}

function healthImportHelp(): string {
  return [
    "Health import JSON:",
    "<pre>{",
    '  "date": "2026-06-07",',
    '  "source": "xiaomi_health_connect",',
    '  "device": "Xiaomi Watch 4",',
    '  "metrics": [',
    '    {"type":"steps","value":8200,"unit":"steps"},',
    '    {"type":"sleep_minutes","value":420,"unit":"min"}',
    "  ],",
    '  "raw": {}',
    "}</pre>",
    "curl:",
    "<code>curl -X POST https://archlinux.tail2492c9.ts.net/api/health/ingest -H 'content-type: application/json' -H 'x-lifeos-health-secret: ***' --data @health.json</code>",
  ].join("\n");
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
      return `${index + 1}. <code>${escapeHtml(reminder.id.slice(0, 8))}</code> ${escapeHtml(reminder.message)}\n   <code>${escapeHtml(formatReminderDateTime(reminder.remindAt, timezone))}</code>`;
    })
    .join("\n");
}

function parseReminderMode(value: string): ReminderMode | null {
  const normalized = value.trim().toLowerCase();
  return normalized === "chill" ||
    normalized === "normal" ||
    normalized === "duolingo" ||
    normalized === "war"
    ? normalized
    : null;
}

function parseSnoozeMinutes(value: string): number | null {
  const match = value.trim().match(/^(\d+)(m|h)$/i);
  if (!match?.[1] || !match[2]) {
    return null;
  }
  const amount = Number(match[1]);
  return amount > 0 ? amount * (match[2].toLowerCase() === "h" ? 60 : 1) : null;
}

function formatSyncSourceStatus(
  sources: SourceRecord[],
  sourceKeys: string[],
): string {
  const rows = sources.filter((source) =>
    sourceKeys.includes(source.sourceKey),
  );
  if (!rows.length) {
    return "No source status recorded yet. Run the local sync worker once.";
  }
  return rows
    .map(
      (source) =>
        `${escapeHtml(source.displayName)}: <b>${escapeHtml(source.status)}</b>\nlast sync: <code>${escapeHtml(source.lastSyncAt ?? "never")}</code>`,
    )
    .join("\n\n");
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

function formatMoney(amount: number, currency = "KZT"): string {
  return `${amount.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ${currency}`;
}

const FINANCE_AMOUNT_PATTERN = String.raw`(?:\d{1,3}(?:[ \u00a0]\d{3})+|\d+)(?:[.,]\d{1,2})?`;
const FINANCE_CURRENCY_PATTERN = String.raw`(?:KZT|₸|тенге|USD|EUR|RUB|₽)`;
const FINANCE_CURRENCY_ADJACENT_AMOUNT_PATTERN = new RegExp(
  String.raw`(?:^|\s)(?:${FINANCE_AMOUNT_PATTERN}\s*${FINANCE_CURRENCY_PATTERN}|${FINANCE_CURRENCY_PATTERN}\s*${FINANCE_AMOUNT_PATTERN})(?:\s|$)`,
  "iu",
);
const FINANCE_FIRST_TOKEN_AMOUNT_PATTERN = new RegExp(
  String.raw`^${FINANCE_AMOUNT_PATTERN}(?:\s|$)`,
  "u",
);

function parseSpendArgs(args: string): {
  text: string;
  amountIsExplicit: boolean;
} {
  const text = args.trim();

  return {
    text,
    amountIsExplicit:
      FINANCE_CURRENCY_ADJACENT_AMOUNT_PATTERN.test(text) ||
      FINANCE_FIRST_TOKEN_AMOUNT_PATTERN.test(text),
  };
}

function enforceManualFinanceAmountRules(
  parsed: FinanceParseResult,
  args: string,
  sourceCommand: "spend" | "income" | "finance_ai" | "finance_quick",
): FinanceParseResult {
  if (
    sourceCommand === "finance_ai" ||
    sourceCommand === "finance_quick" ||
    parsed.amount === null
  ) {
    return parsed;
  }

  const spendArgs = parseSpendArgs(args);

  if (spendArgs.amountIsExplicit) {
    return parsed;
  }

  return {
    ...parsed,
    amount: null,
    confidence: Math.min(parsed.confidence, 0.3),
  };
}

function financeTransactionMessage(
  transaction: FinanceTransactionRecord,
): string {
  const verb =
    transaction.status === "draft"
      ? "Draft"
      : transaction.status === "cancelled"
        ? "Cancelled"
        : "Saved";

  return [
    `${verb}: <b>${escapeHtml(formatMoney(transaction.amount, transaction.currency))}</b>`,
    `Type: <b>${escapeHtml(transaction.transactionType)}</b>`,
    `Category: <b>${escapeHtml(transaction.categoryName ?? "Другое")}</b>`,
    `ID: <code>${escapeHtml(transaction.shortId)}</code>`,
    transaction.status === "draft"
      ? `Confirm: <code>/finance_confirm ${escapeHtml(transaction.shortId)}</code>`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function financeSummaryLines(
  summary: TmaFinanceSummary,
  period?: "today" | "week" | "month",
): string[] {
  const labels = {
    today: "Сегодня",
    week: "Неделя",
    month: "Месяц",
  };
  const periods = period
    ? ([period] as const)
    : (["today", "week", "month"] as const);
  const lines = periods.map((key) => {
    const item = summary[key];
    return `${labels[key]}: <b>${escapeHtml(formatMoney(item.amount, summary.currency))}</b> (${item.count})`;
  });
  const top = summary.topCategories
    .slice(0, 3)
    .map(
      (item) =>
        `${escapeHtml(item.category)}: ${escapeHtml(formatMoney(item.amount, summary.currency))}`,
    );

  if (top.length) {
    lines.push("", "Топ категорий:", ...top);
  }

  if (summary.drafts.length) {
    lines.push("", `Черновики: <b>${summary.drafts.length}</b>`);
  }

  return lines;
}

function previousMonth(now: Date, timezone: string): string {
  const today = localDateString(now, timezone);
  const current = new Date(`${today}T00:00:00.000Z`);
  current.setUTCDate(1);
  current.setUTCDate(0);
  return current.toISOString().slice(0, 7);
}

function parsePeriodMonth(value: string): string | null {
  const trimmed = value.trim();
  return /^\d{4}-\d{2}$/.test(trimmed) ? trimmed : null;
}

function monthlyReviewBullets(review: MonthlyReviewRecord): string[] {
  return review.reportMarkdown
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter(Boolean)
    .slice(0, 5);
}

function monthlyReviewMessage(review: MonthlyReviewRecord): string {
  const bullets = monthlyReviewBullets(review);

  return [
    `Monthly review: <b>${escapeHtml(review.periodMonth)}</b>`,
    `Status: <b>${escapeHtml(review.status)}</b>`,
    review.generatedAt
      ? `Generated: <code>${escapeHtml(review.generatedAt)}</code>`
      : "",
    `Obsidian: <code>${escapeHtml(review.obsidianPath ?? "pending")}</code>`,
    ...bullets.map((bullet) => `- ${escapeHtml(bullet)}`),
  ]
    .filter(Boolean)
    .join("\n");
}

function parseFinanceFixArgs(args: string):
  | {
      ok: true;
      shortId: string;
      amount?: number;
      category?: string;
    }
  | { ok: false; error: string } {
  const [shortId = ""] = args.trim().split(/\s+/, 1);
  const amountMatch = args.match(/\bamount:(\d+(?:[.,]\d{1,2})?)\b/i);
  const categoryMatch = args.match(/\bcategory:(.+?)(?=\s+\w+:|$)/i);
  const amount = amountMatch?.[1]
    ? Number(amountMatch[1].replace(",", "."))
    : undefined;
  const category = categoryMatch?.[1]?.trim();

  if (!shortId || (amount === undefined && !category)) {
    return {
      ok: false,
      error: "Usage: /finance_fix <short_id> amount:1500 category:Еда",
    };
  }

  if (amount !== undefined && (!Number.isFinite(amount) || amount <= 0)) {
    return {
      ok: false,
      error: "Finance amount must be greater than zero.",
    };
  }

  return {
    ok: true,
    shortId,
    amount,
    category,
  };
}

async function createFinanceEntry(
  runtime: TelegramBotRuntime,
  message: TelegramMessage,
  user: TelegramUserRecord,
  parsed: FinanceParseResult,
  sourceCommand: string,
  status: "draft" | "confirmed",
): Promise<FinanceTransactionRecord> {
  if (!runtime.store || parsed.amount === null) {
    throw new Error("Finance amount is required");
  }

  const occurredOn = localDateString(
    runtime.now?.() ?? new Date(),
    user.timezone || LOCAL_TIMEZONE,
  );
  const transaction = await runtime.store.createFinanceTransaction({
    userId: user.userId,
    transactionType: parsed.transactionType,
    amount: parsed.amount,
    currency: parsed.currency,
    category: parsed.category,
    merchant: parsed.merchant,
    description: parsed.description || parsed.category,
    tags: parsed.tags,
    occurredOn,
    status,
    rawText: parsed.redactedText,
    confidence: parsed.confidence,
    source: sourceCommand === "/finance_ai" ? parsed.parser : "telegram",
    metadata: metadata({
      parser: parsed.parser,
      sourceCommand,
    }),
  });
  const title =
    `${formatMoney(transaction.amount, transaction.currency)} ${transaction.description ?? transaction.categoryName ?? ""}`.trim();

  await createEntityAndQueueSync(runtime.store, message, {
    userId: user.userId,
    entityType: "finance",
    domain: "finance",
    status: transaction.status,
    title,
    body: parsed.redactedText,
    sourceCommand,
    linkedTable: "finance_transactions",
    linkedId: transaction.id,
    metadata: metadata({
      amount: transaction.amount,
      currency: transaction.currency,
      category: transaction.categoryName,
      transactionType: transaction.transactionType,
      financeStatus: transaction.status,
      occurredOn: transaction.occurredOn,
      shortId: transaction.shortId,
      confidence: transaction.confidence,
      parser: parsed.parser,
    }),
  });

  if (transaction.status === "confirmed") {
    void triggerFinanceAlerts(runtime.store, runtime.telegram, user.userId, occurredOn).catch(console.error);
  }

  return transaction;
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

// ---------------------------------------------------------------------------
// Command handlers — each extracted from the former if/else chains
// ---------------------------------------------------------------------------

async function handleHelpCommand(
  _args: string,
  message: TelegramMessage,
  runtime: TelegramBotRuntime,
  _user: TelegramUserRecord | null,
): Promise<void> {
  await runtime.telegram.sendMessage({
    chatId: message.chat.id,
    text: HELP_TEXT,
  });
}

async function handleStatusCommand(
  _args: string,
  message: TelegramMessage,
  runtime: TelegramBotRuntime,
  _user: TelegramUserRecord | null,
): Promise<void> {
  await runtime.telegram.sendMessage({
    chatId: message.chat.id,
    text: [
      "LifeOS bot status:",
      `Database: <b>${runtime.store ? "configured" : "missing"}</b>`,
      `TMA_URL: <b>${runtime.tmaUrl ? "configured" : "missing"}</b>`,
      "Polling: <b>disabled</b>",
    ].join("\n"),
  });
}

async function handleHealthzCommand(
  _args: string,
  message: TelegramMessage,
  runtime: TelegramBotRuntime,
  _user: TelegramUserRecord | null,
): Promise<void> {
  await runtime.telegram.sendMessage({
    chatId: message.chat.id,
    text: [
      "healthz is an HTTP endpoint. Use /status in Telegram.",
      "Backend: https://lifeosbot-production.up.railway.app/healthz",
    ].join("\n"),
  });
}

async function handleCapCommand(
  args: string,
  message: TelegramMessage,
  runtime: TelegramBotRuntime,
  user: TelegramUserRecord | null,
): Promise<void> {
  const text = requireText("cap", args, "quick capture");

  if (!text || text.startsWith("Usage:")) {
    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: text ?? "",
    });
    return;
  }

  const entity = await createEntityAndQueueSync(runtime.store!, message, {
    userId: user!.userId,
    entityType: "capture",
    title: text,
    body: text,
    sourceCommand: "/cap",
  });

  await runtime.telegram.sendMessage({
    chatId: message.chat.id,
    text: entitySummary(entity),
  });
}

async function handleLogCommand(
  args: string,
  message: TelegramMessage,
  runtime: TelegramBotRuntime,
  user: TelegramUserRecord | null,
): Promise<void> {
  if (!args.trim()) {
    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: "/log текст — быстро добавить запись в Obsidian Inbox",
    });
    return;
  }

  const text = args.trim();
  const now = runtime.now?.() ?? new Date();
  const rawPayload = metadata({
    telegram_user_id: message.from?.id ?? null,
    chat_id: message.chat.id,
    message_id: message.message_id,
    command: "/log",
  });
  const capture = await runtime.store!.createLifeCapture({
    userId: user!.userId,
    text,
    source: "telegram",
    status: "inbox",
    chatId: message.chat.id,
    messageId: message.message_id,
    metadata: rawPayload,
  });
  const entity = await runtime.store!.createLifeEntity({
    userId: user!.userId,
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

  await runtime.store!.enqueueObsidianSync({
    userId: user!.userId,
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
}

async function handleTaskCommand(
  args: string,
  message: TelegramMessage,
  runtime: TelegramBotRuntime,
  user: TelegramUserRecord | null,
): Promise<void> {
  const title = requireText("task", args, "task title");

  if (!title || title.startsWith("Usage:")) {
    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: title ?? "",
    });
    return;
  }

  const task = await runtime.store!.createTask({
    userId: user!.userId,
    title,
    source: "telegram",
  });
  const entity = await createEntityAndQueueSync(runtime.store!, message, {
    userId: user!.userId,
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
}

async function handleDeadlineCommand(
  args: string,
  message: TelegramMessage,
  runtime: TelegramBotRuntime,
  user: TelegramUserRecord | null,
): Promise<void> {
  const raw = requireText("deadline", args, "2026-05-20 task title");

  if (!raw || raw.startsWith("Usage:")) {
    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: raw ?? "",
    });
    return;
  }

  const deadline = extractDeadline(raw, runtime.now?.() ?? new Date());
  const task = await runtime.store!.createTask({
    userId: user!.userId,
    title: deadline.title,
    dueAt: deadline.dueAt,
    source: "telegram",
  });
  const entity = await createEntityAndQueueSync(runtime.store!, message, {
    userId: user!.userId,
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
}

async function handleHealthLogCommand(
  args: string,
  message: TelegramMessage,
  runtime: TelegramBotRuntime,
  user: TelegramUserRecord | null,
): Promise<void> {
  const metrics = parseHealthLogArgs(args);

  if (!metrics) {
    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: healthLogUsage(),
    });
    return;
  }

  const date = localDateString(runtime.now?.() ?? new Date(), user!.timezone);
  const result = await runtime.store!.upsertHealthMetrics({
    userId: user!.userId,
    date,
    source: "telegram",
    device: "manual",
    timezone: user!.timezone,
    metrics,
    raw: {
      command: "/health_log",
      telegram_user_id: message.from?.id ?? null,
      chat_id: message.chat.id,
      message_id: message.message_id,
    },
  });

  await runtime.telegram.sendMessage({
    chatId: message.chat.id,
    text: [
      `Health metrics logged for <code>${escapeHtml(date)}</code>.`,
      `Created: <b>${result.created}</b> Updated: <b>${result.updated}</b>`,
    ].join("\n"),
  });
}

async function handleReviewCommand(
  args: string,
  message: TelegramMessage,
  runtime: TelegramBotRuntime,
  user: TelegramUserRecord | null,
): Promise<void> {
  const text = requireText("review", args, "review notes");

  if (!text || text.startsWith("Usage:")) {
    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: text ?? "",
    });
    return;
  }

  const entity = await createEntityAndQueueSync(runtime.store!, message, {
    userId: user!.userId,
    entityType: "review",
    title: text.slice(0, 120),
    body: text,
    sourceCommand: "/review",
  });

  await runtime.telegram.sendMessage({
    chatId: message.chat.id,
    text: entitySummary(entity),
  });
}

function makeFinanceEntryHandler(
  sourceCommand: "spend" | "income" | "finance_ai" | "finance_quick",
): CommandHandler {
  const usageMap: Record<string, string> = {
    spend: "1200 шаурма",
    income: "20000 долг вернули",
    finance_ai: "потратил 3500 на такси",
    finance_quick: "Такси 2700",
  };

  return async (args, message, runtime, user) => {
    const text = requireText(sourceCommand, args, usageMap[sourceCommand]!);

    if (!text || text.startsWith("Usage:")) {
      await runtime.telegram.sendMessage({
        chatId: message.chat.id,
        text: text ?? "",
      });
      return;
    }

    const parsed = enforceManualFinanceAmountRules(
      await parseFinanceText(text, {
        transactionType:
          sourceCommand === "spend"
            ? "expense"
            : sourceCommand === "income"
              ? "income"
              : undefined,
        aiEnabled: sourceCommand === "finance_ai" && runtime.financeAi?.enabled,
        openRouterApiKey: runtime.financeAi?.openRouterApiKey,
        model: runtime.financeAi?.model,
      }),
      text,
      sourceCommand,
    );

    if (parsed.amount === null) {
      if (sourceCommand === "finance_ai") {
        await runtime.store!.recordFinanceParseRun({
          userId: user!.userId,
          inputText: parsed.redactedText,
          parsedJson: metadata({ ...parsed }),
          status: "failed",
          parser: parsed.parser,
          confidence: parsed.confidence,
          errorMessage: "amount_not_found",
        });
      }

      await runtime.telegram.sendMessage({
        chatId: message.chat.id,
        text: "Не нашёл сумму. Укажи её явно, например: <code>/spend 1200 шаурма</code>",
      });
      return;
    }

    const transaction = await createFinanceEntry(
      runtime,
      message,
      user!,
      parsed,
      `/${sourceCommand}`,
      sourceCommand === "finance_ai" && parsed.confidence < 0.75
        ? "draft"
        : "confirmed",
    );

    if (sourceCommand === "finance_ai") {
      await runtime.store!.recordFinanceParseRun({
        userId: user!.userId,
        inputText: parsed.redactedText,
        parsedJson: metadata({ ...parsed }),
        status: transaction.status,
        parser: parsed.parser,
        confidence: parsed.confidence,
        transactionId: transaction.id,
      });
    }

    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: financeTransactionMessage(transaction),
    });
  };
}

async function handleRemindCommand(
  args: string,
  message: TelegramMessage,
  runtime: TelegramBotRuntime,
  user: TelegramUserRecord | null,
): Promise<void> {
  const now = runtime.now?.() ?? new Date();
  const parsed = parseReminderArgs(args, now, user!.timezone || LOCAL_TIMEZONE);

  if (!parsed.ok) {
    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: parsed.error,
    });
    return;
  }

  if (new Date(parsed.remindAt).getTime() <= now.getTime()) {
    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: `Reminder time must be in the future.\n${remindUsage()}`,
    });
    return;
  }

  const reminder = await runtime.store!.createReminder({
    userId: user!.userId,
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
      `When: <code>${escapeHtml(formatReminderDateTime(reminder.remindAt, user!.timezone || LOCAL_TIMEZONE))}</code>`,
      `Message: ${escapeHtml(reminder.message)}`,
    ].join("\n"),
  });
}

async function handleWorkoutCommand(
  args: string,
  message: TelegramMessage,
  runtime: TelegramBotRuntime,
  user: TelegramUserRecord | null,
): Promise<void> {
  const now = runtime.now?.() ?? new Date();
  const mode = await runtime.store!.resolveCurrentMode(user!.userId);
  const workout = await runtime.store!.getOrCreateCurrentWorkout({
    userId: user!.userId,
    title: args.trim() || null,
    now: now.toISOString(),
    lifeMode: mode.mode,
  });

  if (workout.created) {
    const entity = await createEntityAndQueueSync(runtime.store!, message, {
      userId: user!.userId,
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

async function handleModeCommand(
  args: string,
  message: TelegramMessage,
  runtime: TelegramBotRuntime,
  user: TelegramUserRecord | null,
): Promise<void> {
  const normalized = args.trim().toLowerCase();

  if (!normalized) {
    const mode = await runtime.store!.resolveCurrentMode(user!.userId);
    const modeUrl = runtime.tmaUrl ? buildModeUrl(runtime.tmaUrl) : null;

    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: formatModeResolution(mode),
      replyMarkup: modeUrl
        ? {
            inline_keyboard: [
              [
                {
                  text: "Open mode settings",
                  web_app: {
                    url: modeUrl,
                  },
                },
              ],
            ],
          }
        : undefined,
    });
    return;
  }

  if (normalized === "auto" || normalized === "clear") {
    const mode = await runtime.store!.clearManualMode(user!.userId);

    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: ["Manual mode override cleared.", formatModeResolution(mode)].join(
        "\n\n",
      ),
    });
    return;
  }

  if (normalized.startsWith("set ")) {
    const parsed = parseModeSetArgs(
      normalized,
      runtime.now?.() ?? new Date(),
      user!.timezone,
    );

    if (!parsed.ok) {
      await runtime.telegram.sendMessage({
        chatId: message.chat.id,
        text: parsed.error,
      });
      return;
    }

    const mode = await runtime.store!.setManualMode({
      userId: user!.userId,
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
}

async function handleReminderModeCommand(
  args: string,
  message: TelegramMessage,
  runtime: TelegramBotRuntime,
  user: TelegramUserRecord | null,
): Promise<void> {
  const requested = args.trim();
  if (!requested) {
    const mode = await runtime.store!.getReminderMode(user!.userId);
    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: `Reminder mode: <b>${escapeHtml(mode)}</b>`,
    });
    return;
  }
  const mode = parseReminderMode(requested);
  if (!mode) {
    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: reminderModeUsage(),
    });
    return;
  }
  await runtime.store!.setReminderMode(user!.userId, mode);
  await runtime.telegram.sendMessage({
    chatId: message.chat.id,
    text: `Reminder mode set to <b>${escapeHtml(mode)}</b>. Future provider syncs will use this policy.`,
  });
}

async function handleReminderCommand(
  args: string,
  message: TelegramMessage,
  runtime: TelegramBotRuntime,
  user: TelegramUserRecord | null,
): Promise<void> {
  const [action = "", shortId = "", duration = ""] = args.trim().split(/\s+/);

  if (!["cancel", "snooze"].includes(action) || !shortId) {
    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: reminderActionUsage(),
    });
    return;
  }

  const reminders = await runtime.store!.listUpcomingReminders(
    user!.userId,
    100,
  );
  const matches = reminders.filter(
    (reminder) => reminder.id === shortId || reminder.id.startsWith(shortId),
  );

  if (matches.length === 0) {
    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: reminderNotFound(shortId),
    });
    return;
  }

  if (matches.length > 1) {
    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: `Short ID <code>${escapeHtml(shortId)}</code> is ambiguous. Use /reminders and provide more characters.`,
    });
    return;
  }

  const reminder = matches[0]!;
  if (action === "cancel") {
    await runtime.store!.cancelReminder(user!.userId, reminder.id);
    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: `Cancelled reminder <code>${escapeHtml(reminder.id.slice(0, 8))}</code>.`,
    });
    return;
  }
  if (action === "snooze") {
    const minutes = parseSnoozeMinutes(duration);
    if (!minutes) {
      await runtime.telegram.sendMessage({
        chatId: message.chat.id,
        text: reminderActionUsage(),
      });
      return;
    }
    const remindAt = new Date(
      (runtime.now?.() ?? new Date()).getTime() + minutes * 60_000,
    ).toISOString();
    await runtime.store!.snoozeReminder(user!.userId, reminder.id, remindAt);
    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: `Snoozed reminder <code>${escapeHtml(reminder.id.slice(0, 8))}</code> until <code>${escapeHtml(formatReminderDateTime(remindAt, user!.timezone))}</code>.`,
    });
    return;
  }
  await runtime.telegram.sendMessage({
    chatId: message.chat.id,
    text: reminderActionUsage(),
  });
}

async function handleCourseCommand(
  args: string,
  message: TelegramMessage,
  runtime: TelegramBotRuntime,
  user: TelegramUserRecord | null,
): Promise<void> {
  const now = runtime.now?.() ?? new Date();
  const today = localDateString(now, user!.timezone);
  const trimmed = args.trim();

  if (!trimmed) {
    const course = await runtime.store!.getActiveStudyCourse(
      user!.userId,
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
    const course = await runtime.store!.getActiveStudyCourse(
      user!.userId,
      today,
    );

    if (!course) {
      await runtime.telegram.sendMessage({
        chatId: message.chat.id,
        text: `No active study course for <code>${escapeHtml(today)}</code>.`,
      });
      return;
    }

    const updated = await runtime.store!.updateStudyCourseProgress({
      userId: user!.userId,
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

    const course = await runtime.store!.getActiveStudyCourse(
      user!.userId,
      today,
    );

    if (!course) {
      await runtime.telegram.sendMessage({
        chatId: message.chat.id,
        text: `No active study course for <code>${escapeHtml(today)}</code>.`,
      });
      return;
    }

    const entity = await createEntityAndQueueSync(runtime.store!, message, {
      userId: user!.userId,
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
}

async function handleSourcesCommand(
  _args: string,
  message: TelegramMessage,
  runtime: TelegramBotRuntime,
  user: TelegramUserRecord | null,
): Promise<void> {
  const sources = await runtime.store!.listExternalSources(user!.userId);

  await runtime.telegram.sendMessage({
    chatId: message.chat.id,
    text: formatSources(sources),
  });
}

function makeSyncSourceHandler(sourceKeys: string[]): CommandHandler {
  return async (_args, message, runtime, user) => {
    const sources = await runtime.store!.listExternalSources(user!.userId);
    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: formatSyncSourceStatus(sources, sourceKeys),
    });
  };
}

async function handleSyncCommand(
  args: string,
  message: TelegramMessage,
  runtime: TelegramBotRuntime,
  user: TelegramUserRecord | null,
): Promise<void> {
  const normalized = args.trim().toLowerCase();

  if (!normalized) {
    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: [
        "Sync commands:",
        "/sync health — latest Health Connect ingest status",
        "/sync obsidian — Obsidian config sync status",
        "",
        "Google Calendar, Google Tasks, Moodle ICS, and Personal ICS run as local Arch workers.",
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
      runtime.store!.getHealthSyncStatus(user!.userId),
      runtime.store!.getTmaSourcesSummary(user!.userId),
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
}

async function handleRemindersCommand(
  _args: string,
  message: TelegramMessage,
  runtime: TelegramBotRuntime,
  user: TelegramUserRecord | null,
): Promise<void> {
  const reminders = await runtime.store!.listUpcomingReminders(
    user!.userId,
    10,
  );

  await runtime.telegram.sendMessage({
    chatId: message.chat.id,
    text: [
      `Upcoming reminders (${escapeHtml(user!.timezone || LOCAL_TIMEZONE)}):`,
      formatUpcomingReminders(reminders, user!.timezone || LOCAL_TIMEZONE),
    ].join("\n"),
  });
}

async function handleTodayCommand(
  _args: string,
  message: TelegramMessage,
  runtime: TelegramBotRuntime,
  user: TelegramUserRecord | null,
): Promise<void> {
  const bounds = utcDayBounds(runtime.now?.() ?? new Date());
  const [mode, entities] = await Promise.all([
    runtime.store!.resolveCurrentMode(user!.userId),
    runtime.store!.listTodayEntities({
      userId: user!.userId,
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
}

async function handleFocusCommand(
  args: string,
  message: TelegramMessage,
  runtime: TelegramBotRuntime,
  user: TelegramUserRecord | null,
): Promise<void> {
  const [mode, signals] = await Promise.all([
    runtime.store!.resolveCurrentMode(user!.userId),
    args.trim()
      ? Promise.resolve(parseHealthSignalArgs(args))
      : runtime.store!.getLatestDailyLog(user!.userId).then((log) => ({
          moodScore: log?.moodScore ?? undefined,
          energyScore: log?.energyScore ?? undefined,
        })),
  ]);
  const result = scoreFocus({
    ...signals,
    healthMode: mode.mode === "recovery" ? "recovery" : undefined,
  });
  const topItems = await runtime.store!.listModeAwareFocusItems({
    userId: user!.userId,
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
}

async function handleHealthCommand(
  _args: string,
  message: TelegramMessage,
  runtime: TelegramBotRuntime,
  user: TelegramUserRecord | null,
): Promise<void> {
  const health = await runtime.store!.getTmaHealthSummary(user!.userId);

  await runtime.telegram.sendMessage({
    chatId: message.chat.id,
    text: formatHealthToday(health),
  });
}

async function handleHealthWeekCommand(
  _args: string,
  message: TelegramMessage,
  runtime: TelegramBotRuntime,
  user: TelegramUserRecord | null,
): Promise<void> {
  const health = await runtime.store!.getTmaHealthSummary(user!.userId);

  await runtime.telegram.sendMessage({
    chatId: message.chat.id,
    text: formatHealthWeek(health),
  });
}

async function handleHealthImportCommand(
  _args: string,
  message: TelegramMessage,
  runtime: TelegramBotRuntime,
  _user: TelegramUserRecord | null,
): Promise<void> {
  await runtime.telegram.sendMessage({
    chatId: message.chat.id,
    text: healthImportHelp(),
  });
}

async function handleHealthSourcesCommand(
  _args: string,
  message: TelegramMessage,
  runtime: TelegramBotRuntime,
  user: TelegramUserRecord | null,
): Promise<void> {
  const sources = await runtime.store!.getHealthMetricSources(user!.userId);
  const lines = sources.map((source) => {
    return `${escapeHtml(source.label)}: <code>${escapeHtml(source.latestMetricAt ?? "never")}</code>`;
  });

  await runtime.telegram.sendMessage({
    chatId: message.chat.id,
    text: ["Health sources:", ...lines].join("\n"),
  });
}

async function handleMonthlyReviewCommand(
  args: string,
  message: TelegramMessage,
  runtime: TelegramBotRuntime,
  user: TelegramUserRecord | null,
): Promise<void> {
  const month =
    parsePeriodMonth(args) ??
    previousMonth(
      runtime.now?.() ?? new Date(),
      user!.timezone || LOCAL_TIMEZONE,
    );
  const review = await runtime.store!.generateMonthlyReview({
    userId: user!.userId,
    periodMonth: month,
  });

  await runtime.telegram.sendMessage({
    chatId: message.chat.id,
    text: monthlyReviewMessage(review),
  });
}

async function handleMonthlyReviewRegenerateCommand(
  args: string,
  message: TelegramMessage,
  runtime: TelegramBotRuntime,
  user: TelegramUserRecord | null,
): Promise<void> {
  const month = parsePeriodMonth(args);

  if (!month) {
    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: "Usage: /monthly_review_regenerate YYYY-MM",
    });
    return;
  }

  const review = await runtime.store!.generateMonthlyReview({
    userId: user!.userId,
    periodMonth: month,
    regenerate: true,
  });

  await runtime.telegram.sendMessage({
    chatId: message.chat.id,
    text: monthlyReviewMessage(review),
  });
}

async function handleMonthlyReviewStatusCommand(
  _args: string,
  message: TelegramMessage,
  runtime: TelegramBotRuntime,
  user: TelegramUserRecord | null,
): Promise<void> {
  const review = await runtime.store!.getLatestMonthlyReview(user!.userId);

  await runtime.telegram.sendMessage({
    chatId: message.chat.id,
    text: review
      ? monthlyReviewMessage(review)
      : "No monthly reviews generated yet.",
  });
}

async function handleHealthSyncStatusCommand(
  _args: string,
  message: TelegramMessage,
  runtime: TelegramBotRuntime,
  user: TelegramUserRecord | null,
): Promise<void> {
  const status = await runtime.store!.getHealthSyncStatus(user!.userId);
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
}

function makeFinanceSummaryHandler(
  period?: "today" | "week" | "month",
): CommandHandler {
  return async (_args, message, runtime, user) => {
    const summary = await runtime.store!.getTmaFinanceSummary({
      userId: user!.userId,
      today: localDateString(
        runtime.now?.() ?? new Date(),
        user!.timezone || LOCAL_TIMEZONE,
      ),
    });

    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: ["Finance:", ...financeSummaryLines(summary, period)].join("\n"),
    });
  };
}

async function handleFinanceCategoriesCommand(
  _args: string,
  message: TelegramMessage,
  runtime: TelegramBotRuntime,
  user: TelegramUserRecord | null,
): Promise<void> {
  const categories = await runtime.store!.listFinanceCategories(user!.userId);
  const lines = categories.map(
    (category) =>
      `${category.transactionType === "income" ? "+" : "−"} ${escapeHtml(category.name)}`,
  );

  await runtime.telegram.sendMessage({
    chatId: message.chat.id,
    text: ["Finance categories:", ...lines].join("\n"),
  });
}

async function handleFinanceAskCommand(
  args: string,
  message: TelegramMessage,
  runtime: TelegramBotRuntime,
  user: TelegramUserRecord | null,
): Promise<void> {
  const question = args.trim() || message.text?.trim() || "";

  if (!question) {
    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: "Usage: /finance_ask <question>",
    });
    return;
  }

  const today = localDateString(
    runtime.now?.() ?? new Date(),
    user!.timezone || LOCAL_TIMEZONE,
  );
  const result = await runtime.store!.askFinanceAssistant({
    userId: user!.userId,
    question,
    today,
    ai: runtime.financeAi,
  });
  const lines = [
    result.answer,
    result.recommendations.length
      ? ["", "Recommendations:", ...result.recommendations.map((item) => `- ${item}`)]
          .flat()
          .join("\n")
      : "",
    result.risks.length
      ? ["", "Risks:", ...result.risks.map((item) => `- ${item}`)].flat().join("\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  await runtime.telegram.sendMessage({
    chatId: message.chat.id,
    text: lines,
  });
}

function makeFinanceStatusHandler(
  commandName: string,
  targetStatus: "confirmed" | "cancelled",
): CommandHandler {
  return async (args, message, runtime, user) => {
    const shortId = args.trim().split(/\s+/)[0] ?? "";

    if (!shortId) {
      await runtime.telegram.sendMessage({
        chatId: message.chat.id,
        text: `Usage: /${commandName} <short_id>`,
      });
      return;
    }

    try {
      const transaction = await runtime.store!.updateFinanceTransaction({
        userId: user!.userId,
        shortId,
        status: targetStatus,
      });

      await runtime.telegram.sendMessage({
        chatId: message.chat.id,
        text: financeTransactionMessage(transaction),
      });

      if (targetStatus === "confirmed") {
        const today = localDateString(
          runtime.now?.() ?? new Date(),
          user!.timezone || LOCAL_TIMEZONE,
        );
        void triggerFinanceAlerts(runtime.store!, runtime.telegram, user!.userId, today).catch(console.error);
      }
    } catch (error) {
      await runtime.telegram.sendMessage({
        chatId: message.chat.id,
        text: escapeHtml(
          error instanceof Error ? error.message : "Finance update failed",
        ),
      });
    }
  };
}

async function handleFinanceFixCommand(
  args: string,
  message: TelegramMessage,
  runtime: TelegramBotRuntime,
  user: TelegramUserRecord | null,
): Promise<void> {
  const parsed = parseFinanceFixArgs(args);

  if (!parsed.ok) {
    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: parsed.error,
    });
    return;
  }

  try {
    const transaction = await runtime.store!.updateFinanceTransaction({
      userId: user!.userId,
      shortId: parsed.shortId,
      amount: parsed.amount,
      category: parsed.category,
    });

    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: financeTransactionMessage(transaction),
    });

    if (transaction.status === "confirmed") {
      const today = localDateString(
        runtime.now?.() ?? new Date(),
        user!.timezone || LOCAL_TIMEZONE,
      );
      void triggerFinanceAlerts(runtime.store!, runtime.telegram, user!.userId, today).catch(console.error);
    }
  } catch (error) {
    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: escapeHtml(
        error instanceof Error ? error.message : "Finance update failed",
      ),
    });
  }
}

// ---------------------------------------------------------------------------
// Declarative Command Registry
// ---------------------------------------------------------------------------

const COMMAND_REGISTRY: Record<string, CommandConfig> = {
  start: {
    handler: async (_args, message, runtime, _user) => {
      await handleStartCommand(message, runtime);
    },
    requiresUser: false,
  },
  help: { handler: handleHelpCommand, requiresUser: false },
  hepl: { handler: handleHelpCommand, requiresUser: false },
  status: { handler: handleStatusCommand, requiresUser: false },
  healthz: { handler: handleHealthzCommand, requiresUser: false },

  cap: { handler: handleCapCommand, requiresUser: true },
  log: { handler: handleLogCommand, requiresUser: true },
  task: { handler: handleTaskCommand, requiresUser: true },
  deadline: { handler: handleDeadlineCommand, requiresUser: true },
  health_log: { handler: handleHealthLogCommand, requiresUser: true },
  review: { handler: handleReviewCommand, requiresUser: true },
  spend: { handler: makeFinanceEntryHandler("spend"), requiresUser: true },
  income: { handler: makeFinanceEntryHandler("income"), requiresUser: true },
  finance_ai: {
    handler: makeFinanceEntryHandler("finance_ai"),
    requiresUser: true,
  },
  finance_quick: {
    handler: makeFinanceEntryHandler("finance_quick"),
    requiresUser: true,
  },
  remind: { handler: handleRemindCommand, requiresUser: true },
  workout: { handler: handleWorkoutCommand, requiresUser: true },

  mode: { handler: handleModeCommand, requiresUser: true },
  reminder_mode: { handler: handleReminderModeCommand, requiresUser: true },
  reminder: { handler: handleReminderCommand, requiresUser: true },
  course: { handler: handleCourseCommand, requiresUser: true },
  sources: { handler: handleSourcesCommand, requiresUser: true },
  google_sync: {
    handler: makeSyncSourceHandler(["google_calendar", "google_tasks"]),
    requiresUser: true,
  },
  ics_sync: {
    handler: makeSyncSourceHandler(["moodle_ics", "personal_ics"]),
    requiresUser: true,
  },
  sync: { handler: handleSyncCommand, requiresUser: true },
  reminders: { handler: handleRemindersCommand, requiresUser: true },
  today: { handler: handleTodayCommand, requiresUser: true },
  focus: { handler: handleFocusCommand, requiresUser: true },
  health: { handler: handleHealthCommand, requiresUser: true },
  health_week: { handler: handleHealthWeekCommand, requiresUser: true },
  health_import: { handler: handleHealthImportCommand, requiresUser: true },
  health_sources: { handler: handleHealthSourcesCommand, requiresUser: true },
  monthly_review: {
    handler: handleMonthlyReviewCommand,
    requiresUser: true,
  },
  monthly_review_regenerate: {
    handler: handleMonthlyReviewRegenerateCommand,
    requiresUser: true,
  },
  monthly_review_status: {
    handler: handleMonthlyReviewStatusCommand,
    requiresUser: true,
  },
  healthsync_status: {
    handler: handleHealthSyncStatusCommand,
    requiresUser: true,
  },
  finance: { handler: makeFinanceSummaryHandler(), requiresUser: true },
  finance_today: {
    handler: makeFinanceSummaryHandler("today"),
    requiresUser: true,
  },
  finance_week: {
    handler: makeFinanceSummaryHandler("week"),
    requiresUser: true,
  },
  finance_month: {
    handler: makeFinanceSummaryHandler("month"),
    requiresUser: true,
  },
  finance_categories: {
    handler: handleFinanceCategoriesCommand,
    requiresUser: true,
  },
  finance_confirm: {
    handler: makeFinanceStatusHandler("finance_confirm", "confirmed"),
    requiresUser: true,
  },
  finance_cancel: {
    handler: makeFinanceStatusHandler("finance_cancel", "cancelled"),
    requiresUser: true,
  },
  finance_fix: { handler: handleFinanceFixCommand, requiresUser: true },
  finance_ask: { handler: handleFinanceAskCommand, requiresUser: true },
  budget: { handler: handleBudgetCommand, requiresUser: true },
  budget_set: { handler: handleBudgetSetCommand, requiresUser: true },
  bank: { handler: handleBankCommand, requiresUser: true },
};

// ---------------------------------------------------------------------------
// Single-point Telegram update dispatcher
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Finance V2 — Budget overview command
// ---------------------------------------------------------------------------

function buildProgressBar(percentUsed: number): string {
  const clamped = Math.max(0, Math.min(100, percentUsed));
  const filled = Math.round(clamped / 10);
  const empty = 10 - filled;
  const filledChar = "█";
  const emptyChar = "░";
  return `[${filledChar.repeat(filled)}${emptyChar.repeat(empty)}]`;
}

function formatBudgetPayload(payload: BudgetSummaryPayload): string {
  const bar = buildProgressBar(payload.percentUsed);
  const sign = payload.isOverspent ? "⚠️ " : "";
  return [
    `${sign}<b>${escapeHtml(payload.category)}</b>`,
    `  ${bar} ${payload.percentUsed}%`,
    `  Limit: <b>${escapeHtml(formatMoney(payload.limitAmount, payload.currency))}</b>`,
    `  Spent: <b>${escapeHtml(formatMoney(payload.actualSpent, payload.currency))}</b>`,
    `  Remaining: <b>${escapeHtml(formatMoney(payload.remainingBalance, payload.currency))}</b>`,
  ].join("\n");
}

async function handleBudgetCommand(
  _args: string,
  message: TelegramMessage,
  runtime: TelegramBotRuntime,
  user: TelegramUserRecord | null,
): Promise<void> {
  try {
    const now = runtime.now?.() ?? new Date();
    const today = localDateString(now, user!.timezone || LOCAL_TIMEZONE);

    const payloads = await runtime.store!.getActiveBudgetsWithPeriods(
      user!.userId,
      user!.userId,
      today,
    );

    if (payloads.length === 0) {
      await runtime.telegram.sendMessage({
        chatId: message.chat.id,
        text: [
          "No active budgets found.",
          "Create one with: <code>/budget_set Food 50000 monthly</code>",
        ].join("\n"),
      });
      return;
    }

    const grouped = new Map<string, BudgetSummaryPayload[]>();
    for (const payload of payloads) {
      const key = payload.budgetId;
      const group = grouped.get(key) ?? [];
      group.push(payload);
      grouped.set(key, group);
    }

    const sections: string[] = [];
    for (const [, group] of grouped) {
      const first = group[0]!;
      const header = [
        `📊 <b>${escapeHtml(first.name ?? "Budget")}</b>`,
        `Period: <code>${escapeHtml(first.periodStart)}</code> → <code>${escapeHtml(first.periodEnd)}</code> (${escapeHtml(first.period)})`,
      ].join("\n");

      const categoryLines = group.map((p) => formatBudgetPayload(p));

      const totalSpent = group.reduce((s, p) => s + p.actualSpent, 0);
      const totalLimit = group.reduce((s, p) => s + p.limitAmount, 0);
      const totalRemaining = totalLimit - totalSpent;
      const totalPercent = totalLimit > 0 ? Math.round((totalSpent / totalLimit) * 100) : 0;

      const footer = [
        "",
        `Total: ${buildProgressBar(totalPercent)} ${totalPercent}%`,
        `<b>${escapeHtml(formatMoney(totalSpent, first.currency))}</b> / <b>${escapeHtml(formatMoney(totalLimit, first.currency))}</b> (${escapeHtml(formatMoney(totalRemaining, first.currency))} left)`,
      ].join("\n");

      sections.push([header, ...categoryLines, footer].join("\n"));
    }

    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: sections.join("\n\n"),
    });
  } catch (error) {
    console.error(
      "[CRITICAL] /budget command failed:",
      error instanceof Error ? error.message : error,
    );
    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: "Failed to load budget overview. Please try again.",
    });
  }
}

async function handleBudgetSetCommand(
  args: string,
  message: TelegramMessage,
  runtime: TelegramBotRuntime,
  user: TelegramUserRecord | null,
): Promise<void> {
  const parts = args.trim().split(/\s+/);
  const category = parts[0] ?? "";
  const amountStr = parts[1] ?? "";
  const periodType = parts[2] ?? "monthly";

  if (!category || !amountStr) {
    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: "Usage: /budget_set <category> <amount> [monthly|quarterly|custom]",
    });
    return;
  }

  const amount = Number(amountStr.replace(",", "."));

  if (!Number.isFinite(amount) || amount <= 0) {
    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: "Budget amount must be a positive number.",
    });
    return;
  }

  try {
    await runtime.store!.updateBudgetLimit(
      user!.userId,
      user!.userId,
      category,
      amount,
      periodType,
    );

    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: [
        "✅ Budget updated.",
        `Category: <b>${escapeHtml(category)}</b>`,
        `Limit: <b>${escapeHtml(formatMoney(amount))}</b>`,
        `Period: <b>${escapeHtml(periodType)}</b>`,
      ].join("\n"),
    });
  } catch (error) {
    console.error(
      "[CRITICAL] /budget_set command failed:",
      error instanceof Error ? error.message : error,
    );
    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: escapeHtml(
        error instanceof Error ? error.message : "Failed to update budget.",
      ),
    });
  }
}

// ---------------------------------------------------------------------------
// Finance V2 — Bank reconciliation commands
// ---------------------------------------------------------------------------

function formatBankLine(line: BankLineRecord, index: number): string {
  return [
    `${index + 1}. <code>${escapeHtml(line.shortId)}</code>`,
    `   ${escapeHtml(formatMoney(line.amount, line.currency))}`,
    `   ${escapeHtml(line.description ?? line.merchant ?? "—")}`,
    `   <code>${escapeHtml(line.bookingDate)}</code>`,
  ].join("\n");
}

async function handleBankCommand(
  args: string,
  message: TelegramMessage,
  runtime: TelegramBotRuntime,
  user: TelegramUserRecord | null,
): Promise<void> {
  const trimmed = args.trim().toLowerCase();
  const parts = args.trim().split(/\s+/);
  const subcommand = parts[0]?.toLowerCase() ?? "";

  if (!trimmed || subcommand === "unmatched") {
    try {
      const lines = await runtime.store!.listUnmatchedBankLines(
        user!.userId,
        user!.userId,
      );

      if (lines.length === 0) {
        await runtime.telegram.sendMessage({
          chatId: message.chat.id,
          text: "No unmatched bank transactions found. All clear! ✅",
        });
        return;
      }

      const PAGE_SIZE = 5;
      const page = lines.slice(0, PAGE_SIZE);
      const remaining = lines.length - PAGE_SIZE;

      const lineTexts = page.map((line, index) =>
        formatBankLine(line, index),
      );

      const footer =
        remaining > 0
          ? `\n\n<i>${remaining} more unmatched transaction${remaining === 1 ? "" : "s"}.</i>`
          : "";

      const inlineButtons = page.map((line) => ({
        text: `${line.shortId} — ${formatMoney(line.amount, line.currency)}`,
        callback_data: `bank_match:${line.shortId}`,
      }));

      await runtime.telegram.sendMessage({
        chatId: message.chat.id,
        text: [
          `<b>Unmatched bank transactions</b> (${lines.length} total):`,
          "",
          ...lineTexts,
          footer,
          "",
          "Match with: <code>/bank match &lt;short_id&gt; &lt;entity_id&gt;</code>",
        ].join("\n"),
        replyMarkup:
          inlineButtons.length > 0
            ? {
                inline_keyboard: inlineButtons.map((btn) => [btn]),
              }
            : undefined,
      });
    } catch (error) {
      console.error(
        "[CRITICAL] /bank unmatched command failed:",
        error instanceof Error ? error.message : error,
      );
      await runtime.telegram.sendMessage({
        chatId: message.chat.id,
        text: "Failed to list unmatched bank transactions.",
      });
    }
    return;
  }

  if (subcommand === "match") {
    const lineShortId = parts[1] ?? "";
    const entityId = parts[2] ?? "";

    if (!lineShortId || !entityId) {
      await runtime.telegram.sendMessage({
        chatId: message.chat.id,
        text: "Usage: /bank match <short_id> <entity_id>",
      });
      return;
    }

    try {
      await runtime.store!.reconcileBankLine(
        user!.userId,
        lineShortId,
        entityId,
      );

      await runtime.telegram.sendMessage({
        chatId: message.chat.id,
        text: [
          "✅ Bank line matched.",
          `Line: <code>${escapeHtml(lineShortId)}</code>`,
          `Linked to: <code>${escapeHtml(entityId)}</code>`,
        ].join("\n"),
      });
    } catch (error) {
      console.error(
        "[CRITICAL] /bank match command failed:",
        error instanceof Error ? error.message : error,
      );
      await runtime.telegram.sendMessage({
        chatId: message.chat.id,
        text: escapeHtml(
          error instanceof Error ? error.message : "Bank match failed.",
        ),
      });
    }
    return;
  }

  await runtime.telegram.sendMessage({
    chatId: message.chat.id,
    text: [
      "Bank commands:",
      "/bank unmatched — list unmatched transactions",
      "/bank match <short_id> <entity_id> — match a transaction",
    ].join("\n"),
  });
}

// ---------------------------------------------------------------------------
// Finance V2 — Photo upload handler for receipt OCR
// ---------------------------------------------------------------------------

async function handlePhotoUpload(
  message: TelegramMessage,
  runtime: TelegramBotRuntime,
  user: TelegramUserRecord,
): Promise<void> {
  const photos = message.photo;

  if (!photos || photos.length === 0) {
    return;
  }

  const bestPhoto: TelegramPhotoSize = photos.reduce(
    (best: TelegramPhotoSize, current: TelegramPhotoSize) =>
      (current.file_size ?? 0) > (best.file_size ?? 0) ? current : best,
    photos[0]!,
  );

  try {
    const fileUrl = await runtime.telegram.getFileUrl(bestPhoto.file_id);

    const fileResponse = await fetch(fileUrl);

    if (!fileResponse.ok) {
      throw new Error(
        `Failed to download photo from Telegram: ${fileResponse.status}`,
      );
    }

    const arrayBuffer = await fileResponse.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const contentType = fileResponse.headers.get("content-type") ?? "image/jpeg";

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `receipt-${timestamp}.jpg`;
    const objectPath = `${user.userId}/${crypto.randomUUID()}-${fileName}`;

    const receipt = await runtime.store!.uploadReceiptImage({
      userId: user.userId,
      fileName,
      mimeType: contentType,
      bytes,
    });

    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: [
        "📸 Receipt photo received.",
        `Status: <b>processing</b>`,
        `Receipt ID: <code>${escapeHtml(receipt.id)}</code>`,
        `File: <code>${escapeHtml(fileName)}</code>`,
        "",
        "OCR processing will extract amount, currency, and category.",
      ].join("\n"),
    });
  } catch (error) {
    console.error(
      "[CRITICAL] Photo upload receipt processing failed:",
      error instanceof Error ? error.message : error,
    );
    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: [
        "Failed to process receipt photo.",
        escapeHtml(
          error instanceof Error ? error.message : "Unknown error",
        ),
      ].join("\n"),
    });
  }
}

// ---------------------------------------------------------------------------
// Single-point Telegram update dispatcher
// ---------------------------------------------------------------------------

export async function handleTelegramUpdate(
  update: TelegramUpdate,
  runtime: TelegramBotRuntime,
): Promise<void> {
  const message = update.message;

  if (!message) {
    return;
  }

  // Handle photo uploads (receipt OCR)
  if (message.photo && message.photo.length > 0 && !message.text) {
    const user = await resolveUser(message, runtime);

    if (!user || !runtime.store) {
      return;
    }

    try {
      await handlePhotoUpload(message, runtime, user);
    } catch (error) {
      console.error("[ERROR] Photo upload handler failed", {
        errorType: error instanceof Error ? error.name : typeof error,
      });
      throw error;
    }

    return;
  }

  if (!message.text) {
    return;
  }

  const parsed = parseCommand(message.text);

  if (!parsed) {
    return;
  }

  if (
    !message.text.trim().startsWith("/") &&
    looksLikeQuickFinanceInput(message.text)
  ) {
    parsed.command = "finance_quick";
    parsed.args = message.text.trim();
  }

  if (
    !message.text.trim().startsWith("/") &&
    looksLikeFinanceQuestion(message.text)
  ) {
    parsed.command = "finance_ask";
    parsed.args = message.text.trim();
  }

  const config = COMMAND_REGISTRY[parsed.command];

  if (!config) {
    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: `Unknown command: /${escapeHtml(parsed.command)}\nUse /help.`,
    });
    return;
  }

  let user: TelegramUserRecord | null = null;

  if (config.requiresUser) {
    user = await resolveUser(message, runtime);

    if (!user || !runtime.store) {
      return;
    }
  }

  try {
    await config.handler(parsed.args, message, runtime, user);
  } catch (error) {
    console.error(`[ERROR] Command /${parsed.command} failed`, {
      errorType: error instanceof Error ? error.name : typeof error,
    });
    throw error;
  }
}
