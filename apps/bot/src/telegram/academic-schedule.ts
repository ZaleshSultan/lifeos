import { createHash } from "node:crypto";
import { DateTime } from "luxon";
import {
  ACADEMIC_TIMEZONE,
  academicAgenda,
  buildDailyPlan,
  type AcademicOverview,
  type PlannerEvent,
} from "@lifeos/core";
import type { TelegramUserRecord } from "@lifeos/db";
import { buildPlanningInputs } from "../planning-context.js";
import type { TelegramBotRuntime, TelegramMessage } from "./types.js";

export type AcademicScheduleView =
  | "tomorrow"
  | "nextclass"
  | "afterclasses"
  | "deadlines";
const actions = new Map<string, AcademicScheduleView>([
  ["academic:tomorrow", "tomorrow"],
  ["academic:nextclass", "nextclass"],
  ["academic:afterclasses", "afterclasses"],
  ["academic:deadlines", "deadlines"],
]);
export const academicScheduleAction = (data: string | undefined) =>
  data === undefined ? undefined : actions.get(data);
export const ACADEMIC_SCHEDULE_BUTTONS = [
  [
    { text: "Завтра", callback_data: "academic:tomorrow" },
    { text: "Следующая пара", callback_data: "academic:nextclass" },
  ],
  [
    { text: "После пар", callback_data: "academic:afterclasses" },
    { text: "Проверенные дедлайны", callback_data: "academic:deadlines" },
  ],
];

// Escape whole characters before enforcing Telegram's limit; source text is never markup.
function messageText(title: string, lines: string[]) {
  const escape = (text: string) =>
    text
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  const prefix = `<b>${escape(title)}</b>\n`;
  let body = "";
  for (const character of lines.join("\n")) {
    const escaped = escape(character);
    if (prefix.length + body.length + escaped.length > 3750)
      return `${prefix}${body}\n… Обзор сокращён. Подробности — в Academic Concierge.`;
    body += escaped;
  }
  return prefix + body;
}
const label = (value: string) =>
  value.replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 160);
function clock(instant: string, timezone: string, date = false) {
  return DateTime.fromISO(instant, { setZone: true })
    .setZone(timezone)
    .toFormat(date ? "dd.MM HH:mm" : "HH:mm");
}
function scheduleWarning(agenda: ReturnType<typeof academicAgenda>) {
  return agenda.scheduleState === "unverified"
    ? "Расписание на эту дату не подтверждено или изменилось. Проверь его в Academic Concierge."
    : agenda.scheduleState === "holiday"
      ? "Подтверждён выходной: регулярные пары исключены."
      : agenda.scheduleState === "outside_teaching"
        ? "Учебный период на эту дату не подтверждён: регулярные пары не показаны."
        : null;
}

async function afterClassLines(
  overview: AcademicOverview,
  agenda: ReturnType<typeof academicAgenda>,
  day: DateTime,
  now: Date,
  runtime: TelegramBotRuntime,
  user: TelegramUserRecord,
) {
  const disclaimer =
    "Окна только по сохранённым обязательствам до 21:00 (граница планировщика). Дорога и несогласованные задачи не учтены; это не гарантия свободного времени.";
  const warning = scheduleWarning(agenda);
  if (warning) return [warning, "Окна после пар вычислить нельзя."];
  if (!agenda.classes.length)
    return [
      "Подтверждённых оставшихся пар на эту дату нет. Время окончания прошедших пар неизвестно; окна после пар не вычислены.",
    ];
  if (agenda.incomplete)
    return ["Академические данные ограничены: доступное время не вычислено."];
  const lastEnd = Math.max(
    ...agenda.classes.map((item) => Date.parse(item.endsAt)),
  );
  const snapshot = await runtime.store!.getPlanningSnapshot(user.userId, {
    startsAt: day.toUTC().toISO()!,
    endsAt: day.plus({ days: 1 }).toUTC().toISO()!,
    historyStartsAt: now.toISOString(),
    historyEndsAt: now.toISOString(),
  });
  // Reuse the planner's fail-closed handling of incomplete calendars and unknown task durations.
  // Concierge supplies verified campus-zone occurrences instead of legacy weekly projections.
  const input = buildPlanningInputs({ ...snapshot, schedules: [] }, day);
  const exams: PlannerEvent[] = [];
  let unknownEnd = false;
  for (const event of overview.events) {
    if (
      event.status !== "confirmed" ||
      !event.startsAt ||
      (event.kind !== "university_exam" && event.kind !== "personal_exam")
    )
      continue;
    const start = Date.parse(event.startsAt);
    const end = event.endsAt ? Date.parse(event.endsAt) : NaN;
    if (
      start < day.plus({ days: 1 }).toMillis() &&
      (!Number.isFinite(end) || end > day.toMillis())
    ) {
      if (!Number.isFinite(end) || end <= start) unknownEnd = true;
      else
        exams.push({
          id: `academic:${event.key}`,
          title: "Confirmed examination",
          startsAt: event.startsAt,
          endsAt: event.endsAt!,
        });
    }
  }
  if (unknownEnd || input.warnings.length)
    return [
      "Есть неполные обязательства или неизвестная длительность: доступное время не вычислено.",
      disclaimer,
    ];
  const plan = buildDailyPlan({
    date: agenda.date,
    timezone: ACADEMIC_TIMEZONE,
    now: new Date(Math.max(now.getTime(), lastEnd)).toISOString(),
    mode: "maintenance",
    tasks: [],
    dayStartHour: 9,
    dayEndHour: 21,
    events: [
      ...input.events,
      ...agenda.classes.map((item) => ({
        ...item,
        id: `academic:${item.key}`,
      })),
      ...exams,
    ],
  });
  return [
    `Последняя известная пара заканчивается в ${clock(new Date(lastEnd).toISOString(), ACADEMIC_TIMEZONE)}.`,
    ...plan.freeSlots
      .slice(0, 8)
      .map(
        (slot) =>
          `${clock(slot.startsAt, ACADEMIC_TIMEZONE)}–${clock(slot.endsAt, ACADEMIC_TIMEZONE)}`,
      ),
    ...(plan.freeSlots.length > 8 ? ["Показаны первые 8 окон."] : []),
    ...(!plan.freeSlots.length
      ? ["Окон до 21:00 по сохранённым обязательствам нет."]
      : []),
    disclaimer,
  ];
}

/** Caller resolves the active owner. Callback ownership is checked by the shared boundary. */
export async function handleAcademicScheduleCommand(
  view: AcademicScheduleView,
  message: TelegramMessage,
  runtime: TelegramBotRuntime,
  user: TelegramUserRecord,
  tomorrow = false,
) {
  if (
    message.chat.type !== "private" ||
    message.chat.id !== user.telegramUserId ||
    user.status !== "active" ||
    (message.from &&
      !message.from.is_bot &&
      message.from.id !== user.telegramUserId)
  ) {
    await runtime.telegram.sendMessage({
      chatId: message.chat.id,
      text: "Академический обзор доступен только в твоём личном чате с ботом.",
    });
    return;
  }
  let title = "Academic Concierge";
  let lines: string[];
  try {
    if (!runtime.store?.academicConcierge)
      throw new Error("academic_unavailable");
    const overview = await runtime.store.academicConcierge.overview(
      user.userId,
    );
    const now = runtime.now?.() ?? new Date();
    const day = DateTime.fromJSDate(now, { zone: ACADEMIC_TIMEZONE })
      .startOf("day")
      .plus({ days: view === "tomorrow" || tomorrow ? 1 : 0 });
    // Schema 58 omits active status from Concierge assignments. Intersect its
    // freshness/provenance with the existing owner-scoped active deadline reader.
    let activeDeadlines: Map<string, number> | undefined;
    if (view === "deadlines") {
      const current = await runtime.store.listUpcomingAssignmentDeadlines(
        user.userId,
        now.toISOString(),
      );
      activeDeadlines = new Map(
        current.upcoming
          .filter(
            (item) =>
              item.status === "active" &&
              item.score === null &&
              item.percentage === null,
          )
          .map((item) => [
            `assignment:${createHash("sha256").update(JSON.stringify(item.id)).digest("hex")}`,
            Date.parse(item.dueAt),
          ]),
      );
    }
    const agenda = academicAgenda(
      overview,
      day.toISODate()!,
      now.toISOString(),
      activeDeadlines,
    );
    title = `${view === "tomorrow" ? "Завтра" : view === "nextclass" ? "Следующая пара" : view === "afterclasses" ? "После пар" : "Проверенные дедлайны"} · ${agenda.date} · ${ACADEMIC_TIMEZONE}`;
    if (view === "deadlines") {
      lines = !agenda.lmsFresh
        ? [
            "LMS не подключён или данные устарели. Проверенные дедлайны недоступны; это не означает, что заданий нет. Обнови подключение в LifeOS.",
          ]
        : [
            ...agenda.assignments
              .slice(0, 8)
              .map(
                (item) =>
                  `${clock(item.dueAt, ACADEMIC_TIMEZONE, true)} — ${label(item.title)}${item.courseTitle ? ` · ${label(item.courseTitle)}` : ""}`,
              ),
            ...(!agenda.assignments.length
              ? ["В текущей выборке нет будущих проверенных несданных заданий."]
              : []),
            ...(agenda.assignments.length > 8
              ? ["Показаны первые 8 дедлайнов."]
              : []),
            ...(agenda.uncertainAssignments
              ? [
                  "Непроверенные записи и неизвестный статус сдачи исключены. Сданные и оценённые задания не показаны.",
                ]
              : []),
            `Последняя успешная синхронизация: ${overview.lms.lastSuccessfulSyncAt}. Горизонт: 30 дней.`,
          ];
    } else if (view === "afterclasses") {
      lines = await afterClassLines(overview, agenda, day, now, runtime, user);
    } else if (view === "nextclass") {
      const candidates = overview.classes
        .filter((item) => Date.parse(item.startsAt) >= now.getTime())
        .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
      const next = candidates.find((item) => {
        const date = DateTime.fromISO(item.startsAt, { setZone: true })
          .setZone(ACADEMIC_TIMEZONE)
          .toISODate()!;
        return academicAgenda(overview, date, now.toISOString()).classes.some(
          (entry) => entry.key === item.key,
        );
      });
      lines = next
        ? [
            `Ближайшая известная подтверждённая пара: ${clock(next.startsAt, ACADEMIC_TIMEZONE, true)}–${clock(next.endsAt, ACADEMIC_TIMEZONE)} — ${label(next.title)}${next.location ? ` · ${label(next.location)}` : ""}`,
          ]
        : [
            scheduleWarning(agenda) ??
              "В текущей подтверждённой выборке ближайшая пара не найдена.",
          ];
      lines.push(
        `Горизонт Concierge: до 14 дней, не позднее ${overview.scheduleVerification.validThrough ?? "неподтверждённой границы"}.`,
      );
    } else {
      const warning = scheduleWarning(agenda);
      lines = [
        ...(warning ? [warning] : []),
        ...agenda.classes
          .slice(0, 8)
          .map(
            (item) =>
              `${clock(item.startsAt, ACADEMIC_TIMEZONE)}–${clock(item.endsAt, ACADEMIC_TIMEZONE)} — ${label(item.title)}${item.location ? ` · ${label(item.location)}` : ""}`,
          ),
        ...(!agenda.classes.length && !warning
          ? ["В текущей подтверждённой выборке пар нет."]
          : []),
        ...(agenda.classes.length > 8 ? ["Показаны первые 8 пар."] : []),
        ...agenda.events
          .slice(0, 8)
          .map(
            (event) =>
              `${event.kind === "personal_exam" ? "Личный экзамен" : `Университетский экзамен${event.sourceTypeCode ? ` (${event.sourceTypeCode})` : ""}`}: ${clock(event.startsAt!, ACADEMIC_TIMEZONE)}${event.endsAt ? `–${clock(event.endsAt, ACADEMIC_TIMEZONE)}` : " · окончание неизвестно"} — ${label(event.title)}`,
          ),
        ...(agenda.events.length > 8 ? ["Показаны первые 8 экзаменов."] : []),
      ];
    }
    if (agenda.incomplete)
      lines.unshift("Выборка ограничена: это неполный обзор.");
  } catch {
    // Never disclose raw store/provider errors, and never silently fall back to an unverified timetable.
    lines = [
      "Академические данные временно недоступны. Попробуй позже; отсутствие ответа не означает отсутствие пар или дедлайнов.",
    ];
  }
  await runtime.telegram.sendMessage({
    chatId: message.chat.id,
    text: messageText(title, lines),
    replyMarkup: { inline_keyboard: ACADEMIC_SCHEDULE_BUTTONS },
  });
}
