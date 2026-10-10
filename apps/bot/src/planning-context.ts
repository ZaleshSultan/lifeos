import { DateTime } from "luxon";
import {
  buildDailyPlan,
  summarizeProductivity,
  type DailyPlan,
  type PlannerEvent,
  type PlannerTask,
} from "@lifeos/core";
import type {
  LifeOSStore,
  PlanningSnapshot,
  TelegramUserRecord,
} from "@lifeos/db";

export class PlanningInputError extends Error {}

function dateInZone(date: string, timezone: string): DateTime {
  const day = DateTime.fromISO(date, { zone: timezone }).startOf("day");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !day.isValid ||
    day.toISODate() !== date
  )
    throw new PlanningInputError("Invalid planning date or timezone.");
  return day;
}

export function planningDate(
  user: TelegramUserRecord,
  requested: unknown,
  now: Date,
): string {
  const today = DateTime.fromJSDate(now, { zone: user.timezone }).startOf(
    "day",
  );
  if (!today.isValid) throw new PlanningInputError("Invalid profile timezone.");
  const date = requested === undefined ? today.toISODate()! : requested;
  if (typeof date !== "string")
    throw new PlanningInputError("Invalid planning date.");
  const day = dateInZone(date, user.timezone);
  const offset = day.diff(today, "days").days;
  if (offset < 0 || offset > 30)
    throw new PlanningInputError("Choose a date within the next 30 days.");
  return date;
}

/** Scrub unnecessary identifiers from free text before sending it to the provider. */
export function redactAiText(text: string, max = 180): string {
  return text
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[email]")
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      "[reference]",
    )
    .replace(/https?:\/\/\S+/gi, "[link]")
    .replace(
      /\b(?:AIza[\w-]{20,}|sk-[\w-]{12,}|eyJ[\w.-]{20,}|\d{6,}:[\w-]{20,})\b/g,
      "[credential]",
    )
    .replace(/[\u0000-\u001f]/g, " ")
    .slice(0, max);
}

const SENSITIVE =
  /\b(health|finance|medical|medication|doctor|therapy|diagnosis|blood|sleep|heart|hrv|spo2|calories|weight|bank|salary|balance|budget|payment|invoice|receipt|expense|loan|debt|transaction|insulin|prescription|rent|mortgage|transfer|pay|savings|account|password|secret|token)\b|здоров|финанс|врач|лекарств|банк|оплат|зарплат|баланс|калори|давлен|диагноз|медицин|плат[её]ж/i;
function permitted(title: string, domain = ""): boolean {
  return !SENSITIVE.test(`${domain.replace(/[_-]/g, " ")} ${title}`);
}
const PUBLIC_TASK_DOMAINS = new Set([
  "study",
  "academic",
  "education",
  "university",
  "coursework",
  "projects",
  "project",
  "work",
  "practice",
  "setup",
  "admin",
]);
function aiTask(task: PlannerTask): PlannerTask {
  const named = PUBLIC_TASK_DOMAINS.has(task.domain?.toLowerCase() ?? "");
  return {
    ...task,
    domain: named ? task.domain : "personal",
    title: named ? redactAiText(task.title, 120) : `Personal task ${task.id}`,
  };
}

export interface PlanningData {
  plan: DailyPlan;
  events: Array<{ title: string; startsAt: string; endsAt: string }>;
  reminders: Array<{ title: string; remindAt: string }>;
  productivity: ReturnType<typeof summarizeProductivity>;
  aiContext: unknown;
  aiPlan: DailyPlan;
  aiPlans: DailyPlan[];
}

/** Keep large but valid accounts inside the provider budget, with explicit omissions. */
function boundAiContext<
  T extends {
    tasks: unknown[];
    reminders: unknown[];
    projects: unknown[];
    truncated: boolean;
    plans: Array<{
      events: unknown[];
      freeSlots: unknown[];
      blocks: unknown[];
      warnings: unknown[];
      omitted: Record<string, number>;
    }>;
  },
>(context: T): T {
  const lists = [
    {
      items: context.tasks,
      minimum: 1,
      omitted: () => {
        for (const p of context.plans) p.omitted.tasks += 1;
      },
    },
    { items: context.reminders, minimum: 0, omitted: () => {} },
    { items: context.projects, minimum: 0, omitted: () => {} },
    ...context.plans.flatMap((p) =>
      ["events", "freeSlots", "blocks", "warnings"].map((key) => ({
        items: p[key as "events" | "freeSlots" | "blocks" | "warnings"],
        minimum: key === "freeSlots" ? 1 : 0,
        omitted: () => {
          p.omitted[key] = (p.omitted[key] ?? 0) + 1;
        },
      })),
    ),
  ];
  while (JSON.stringify(context).length > 28_000) {
    const largest = lists
      .filter((list) => list.items.length > list.minimum)
      .sort(
        (a, b) =>
          JSON.stringify(b.items).length - JSON.stringify(a.items).length,
      )[0];
    if (!largest) break;
    largest.items.pop();
    largest.omitted();
    context.truncated = true;
  }
  return context;
}

function buildInputs(snapshot: PlanningSnapshot, day: DateTime) {
  const tasks: PlannerTask[] = snapshot.tasks.map((t, i) => ({
    id: `task-${i + 1}`,
    title: t.title.slice(0, 240),
    domain: t.domain,
    priority: t.priority,
    dueAt: t.due_at,
    estimatedMinutes: t.estimatedMinutes,
  }));
  const events: PlannerEvent[] = [];
  const warnings: string[] = [];
  let uncertain = snapshot.truncated;
  const start = day.toMillis(),
    end = day.plus({ days: 1 }).toMillis();
  for (const [i, e] of snapshot.events.entries()) {
    if (e.due_at && /deadline|assignment|assessment|exam/i.test(e.event_type)) {
      tasks.push({
        id: `deadline-${i + 1}`,
        title: e.title?.slice(0, 240) || "Untitled deadline",
        domain: "study",
        dueAt: e.due_at,
      });
    }
    if (!e.starts_at) continue;
    const a = Date.parse(e.starts_at),
      b = e.ends_at ? Date.parse(e.ends_at) : NaN;
    if (!Number.isFinite(a)) {
      uncertain = true;
      warnings.push(
        "An event has an invalid start time; availability cannot be verified.",
      );
      continue;
    }
    if (a < end && (b > start || !Number.isFinite(b) || b <= a)) {
      if (!Number.isFinite(b) || b <= a) {
        uncertain = true;
        warnings.push(
          "An event has no valid end time; availability cannot be verified.",
        );
        continue;
      }
      events.push({
        id: `event-${i + 1}`,
        title: e.title?.slice(0, 240) || "Calendar event",
        startsAt: e.starts_at,
        endsAt: e.ends_at!,
      });
    }
  }
  const owned = new Map(snapshot.courses.map((c) => [c.id, c]));
  for (const [i, a] of snapshot.assessments.entries()) {
    const course = owned.get(a.study_course_id);
    if (!course) continue;
    tasks.push({
      id: `assignment-${i + 1}`,
      title: `${course.title}: ${a.title}`.slice(0, 240),
      domain: "study",
      dueAt: a.due_at ?? a.syllabus_due_at,
    });
  }
  const weekdays = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  for (const [i, slot] of snapshot.schedules.entries()) {
    const course = owned.get(slot.study_course_id);
    if (
      !course ||
      (course.starts_on && day.toISODate()! < course.starts_on) ||
      (course.ends_on && day.toISODate()! > course.ends_on)
    )
      continue;
    if (
      slot.day_of_week.toLowerCase().slice(0, 3) !== weekdays[day.weekday % 7]
    )
      continue;
    // The course's stored local timetable is interpreted in the user's configured timezone.
    const a = DateTime.fromISO(`${day.toISODate()}T${slot.start_time}`, {
      zone: day.zoneName!,
    });
    const b = DateTime.fromISO(`${day.toISODate()}T${slot.end_time}`, {
      zone: day.zoneName!,
    });
    if (!a.isValid || !b.isValid || b <= a) {
      uncertain = true;
      warnings.push(
        "A class has invalid times; availability cannot be verified.",
      );
      continue;
    }
    events.push({
      id: `class-${i + 1}`,
      title: course.title.slice(0, 240),
      startsAt: a.toISO()!,
      endsAt: b.toISO()!,
    });
  }
  const scheduledIds = new Set<string>();
  for (const [i, t] of snapshot.tasks.entries()) {
    if (!t.scheduled_for) continue;
    // Preserve existing commitments on every date; AI never reschedules them.
    scheduledIds.add(`task-${i + 1}`);
    const a = Date.parse(t.scheduled_for);
    if (!Number.isFinite(a)) {
      uncertain = true;
      warnings.push(
        "A scheduled task has an invalid start time; availability cannot be verified.",
      );
      continue;
    }
    const validDuration =
      Number.isInteger(t.estimatedMinutes) &&
      t.estimatedMinutes! > 0 &&
      t.estimatedMinutes! <= 480;
    const b = a + (validDuration ? t.estimatedMinutes! : 0) * 60000;
    if (a < end && (b > start || a >= start)) {
      if (!validDuration) {
        uncertain = true;
        warnings.push(
          "A scheduled task has no valid duration; availability cannot be verified.",
        );
      } else
        events.push({
          id: `scheduled-${i + 1}`,
          title: t.title.slice(0, 240),
          startsAt: t.scheduled_for,
          endsAt: new Date(b).toISOString(),
        });
    }
  }
  if (uncertain) {
    events.push({
      id: "availability-unverified",
      title: "Availability unverified",
      startsAt: day.toISO()!,
      endsAt: day.plus({ days: 1 }).toISO()!,
    });
    if (snapshot.truncated)
      warnings.push(
        "Planning input exceeded the safety limit. Availability and priorities are incomplete.",
      );
  }
  return {
    tasks: tasks.filter((t) => !scheduledIds.has(t.id)),
    events,
    warnings: [...new Set(warnings)],
  };
}

export async function loadPlanningData(
  store: LifeOSStore,
  user: TelegramUserRecord,
  date: string,
  now = new Date(),
): Promise<PlanningData> {
  const day = dateInZone(date, user.timezone);
  const today = DateTime.fromJSDate(now, { zone: user.timezone }).startOf(
    "day",
  );
  const weekStart = today.minus({ days: 6 });
  const monthStart = today.minus({ days: 29 });
  const [snapshot, mode] = await Promise.all([
    store.getPlanningSnapshot(user.userId, {
      startsAt: day.toUTC().toISO()!,
      endsAt: day.plus({ days: 7 }).toUTC().toISO()!,
      historyStartsAt: monthStart.toUTC().toISO()!,
      historyEndsAt: now.toISOString(),
    }),
    store.resolveCurrentMode(user.userId),
  ]);
  const makePlan = (d: DateTime, filtered: boolean): DailyPlan => {
    const input = buildInputs(snapshot, d);
    const p = buildDailyPlan({
      date: d.toISODate()!,
      timezone: user.timezone,
      now: now.toISOString(),
      mode: mode.mode,
      priorityWeights: mode.priorityWeights,
      dayStartHour: 9,
      dayEndHour: 21,
      tasks: filtered
        ? input.tasks.filter((t) => permitted(t.title, t.domain)).map(aiTask)
        : input.tasks,
      // All commitments block time, but sensitive event names never leave the backend.
      events: filtered
        ? input.events.map((e) => ({
            ...e,
            title: e.id.startsWith("class-")
              ? redactAiText(e.title)
              : "Private commitment",
          }))
        : input.events,
    });
    p.warnings.push(...input.warnings);
    return p;
  };
  const plan = makePlan(day, false);
  const aiPlan = makePlan(day, true);
  const productivity = summarizeProductivity({
    startDate: weekStart.toISODate()!,
    endDate: today.toISODate()!,
    timezone: user.timezone,
    tasks: snapshot.history,
    truncated: snapshot.historyTruncated,
  });
  const monthly = summarizeProductivity({
    startDate: monthStart.toISODate()!,
    endDate: today.toISODate()!,
    timezone: user.timezone,
    tasks: snapshot.history,
    truncated: snapshot.historyTruncated,
  });
  const weekPlans = Array.from({ length: 7 }, (_, i) =>
    makePlan(day.plus({ days: i }), true),
  );
  const reminderDate = (value: string) =>
    DateTime.fromISO(value, { zone: user.timezone }).toISODate();
  return {
    plan,
    aiPlan,
    aiPlans: weekPlans,
    events: buildInputs(snapshot, day)
      .events.filter((e) => e.id !== "availability-unverified")
      .map(({ title, startsAt, endsAt }) => ({ title, startsAt, endsAt })),
    reminders: snapshot.reminders
      .filter((r) => reminderDate(r.remind_at) === date)
      .map((r) => ({ title: r.message.slice(0, 240), remindAt: r.remind_at })),
    productivity,
    aiContext: boundAiContext({
      asOf: now.toISOString(),
      timezone: user.timezone,
      mode: mode.mode,
      selectedDate: date,
      tasks: aiPlan.rankedTasks.slice(0, 25).map((t) => ({
        ...t,
        reasons: t.reasons.slice(0, 4).map((r) => r.slice(0, 160)),
      })),
      plans: weekPlans.map((p, i) => ({
        date: p.date,
        window: p.window,
        availableMinutes: p.availableMinutes,
        freeSlots: p.freeSlots.slice(0, 12),
        events: buildInputs(snapshot, day.plus({ days: i }))
          .events.slice(0, 12)
          .map((e) => ({
            title: e.id.startsWith("class-")
              ? redactAiText(e.title, 80)
              : "Private commitment",
            startsAt: e.startsAt,
            endsAt: e.endsAt,
          })),
        blocks: p.blocks
          .slice(0, 8)
          .map(({ taskId, startsAt, endsAt, estimated }) => ({
            taskId,
            startsAt,
            endsAt,
            estimated,
          })),
        warnings: p.warnings.slice(0, 5).map((w) => w.slice(0, 200)),
        omitted: {
          tasks: Math.max(0, p.rankedTasks.length - 25),
          freeSlots: Math.max(0, p.freeSlots.length - 12),
          events: Math.max(
            0,
            buildInputs(snapshot, day.plus({ days: i })).events.length - 12,
          ),
          blocks: Math.max(0, p.blocks.length - 8),
          warnings: Math.max(0, p.warnings.length - 5),
        },
      })),
      reminders: snapshot.reminders
        .filter((r) => permitted(r.message))
        .slice(0, 20)
        .map((r, i) => ({ title: `Reminder ${i + 1}`, remindAt: r.remind_at })),
      projects: snapshot.projects
        .filter((p) => permitted(p.name))
        .slice(0, 10)
        .map((p, i) => ({ title: `Project ${i + 1}`, dueOn: p.due_on })),
      productivity: { lastSevenDays: productivity, lastThirtyDays: monthly },
      limitations: [
        "Read-only recommendations; no changes have been made.",
        "Working hours 09:00–21:00 are planning assumptions, not a saved schedule.",
        "Missing task durations use labeled estimates.",
        "Plans use the current mode; future mode transitions are not forecast.",
        "These are independent daily candidates, not a saved weekly schedule. Schedule each task at most once across a week.",
        "Availability uses stored commitments only; unsynced calendars are unknown.",
        "Health and finance details are excluded; productivity contains aggregate task counts only.",
        "Uncategorized task, project, reminder, and calendar titles are masked for privacy.",
        "Context lists may omit records to fit the privacy and usage budget; omitted records must not be inferred.",
      ],
      truncated: snapshot.truncated,
    }),
  };
}
