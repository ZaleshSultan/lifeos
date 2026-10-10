import { applyModeToFocusScoring, getModePriorityWeights } from "./modes.js";
import type { LifeMode } from "./types.js";

export interface PlannerTask {
  id: string;
  title: string;
  domain?: string;
  priority?: number;
  dueAt?: string | null;
  estimatedMinutes?: number | null;
}

export interface PlannerEvent {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
}

export interface DailyPlanInput {
  date: string;
  timezone: string;
  now: string;
  mode: LifeMode;
  priorityWeights?: Record<string, number>;
  tasks: PlannerTask[];
  events: PlannerEvent[];
  dayStartHour?: number;
  dayEndHour?: number;
}

export interface PlannerInterval {
  startsAt: string;
  endsAt: string;
}

export interface DailyPlanBlock extends PlannerInterval {
  taskId: string;
  title: string;
  estimated: boolean;
}

export interface DailyPlan {
  date: string;
  timezone: string;
  mode: LifeMode;
  window: PlannerInterval;
  availableMinutes: number;
  /** Availability before task blocks; calendar events and past time are excluded. */
  freeSlots: PlannerInterval[];
  conflicts: Array<{ eventIds: string[] }>;
  rankedTasks: Array<PlannerTask & { score: number; reasons: string[] }>;
  blocks: DailyPlanBlock[];
  unscheduledTaskIds: string[];
  warnings: string[];
}

export interface PlanSuggestion extends PlannerInterval {
  taskId: string;
}

export interface PlanSuggestionValidation {
  valid: boolean;
  errors: string[];
  blocks: DailyPlanBlock[];
}

export const DEFAULT_PLANNER_TASK_MINUTES = 30;

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
type Interval = { start: number; end: number };
type TimedEvent = Interval & { id: string };

/** Pure, deterministic planning. All instants have explicit offsets; the clock is supplied. */
export function buildDailyPlan(input: DailyPlanInput): DailyPlan {
  assertDate(input.date);
  const formatter = timezoneFormatter(input.timezone);
  const now = requireInstant(input.now, "now");
  const startHour = input.dayStartHour ?? 8;
  const endHour = input.dayEndHour ?? 22;
  if (
    !Number.isInteger(startHour) ||
    !Number.isInteger(endHour) ||
    startHour < 0 ||
    endHour > 24 ||
    startHour >= endHour
  ) {
    throw new RangeError("Planning hours must satisfy 0 <= start < end <= 24.");
  }

  const warnings: string[] = [];
  const dayStart = localBoundary(input.date, 0, formatter, "start");
  const dayEnd = localBoundary(addDate(input.date, 1), 0, formatter, "start");
  if (localDate(dayStart, formatter) !== input.date) {
    throw new RangeError("Planning date does not exist in this timezone.");
  }
  const workStart = localBoundary(input.date, startHour, formatter, "start");
  const workEnd =
    endHour === 24
      ? dayEnd
      : localBoundary(input.date, endHour, formatter, "end");
  const window = {
    start: Math.min(workEnd, Math.max(workStart, now)),
    end: workEnd,
  };
  const seenEvents = new Set<string>();
  const events: TimedEvent[] = input.events.map((event) => {
    if (!event.id || seenEvents.has(event.id)) {
      throw new RangeError("Calendar event IDs must be unique and nonempty.");
    }
    seenEvents.add(event.id);
    const start = requireInstant(event.startsAt, "event start");
    const end = requireInstant(event.endsAt, "event end");
    if (end <= start) {
      throw new RangeError("Calendar events must end after they start.");
    }
    return { id: event.id, start, end };
  });
  const dayEvents = events
    .filter((event) => event.start < dayEnd && event.end > dayStart)
    .sort(compareIntervals);
  const conflicts = calendarConflicts(dayEvents, dayStart, dayEnd);
  const free = subtractEvents(window, dayEvents);
  const weights = {
    ...getModePriorityWeights(input.mode),
    ...input.priorityWeights,
  };
  if (Object.values(weights).some((weight) => !Number.isFinite(weight))) {
    throw new RangeError("Priority weights must be finite numbers.");
  }
  const taskIds = new Set<string>();
  const rankedTasks = input.tasks
    .map((task) => {
      if (!task.id || taskIds.has(task.id)) {
        throw new RangeError("Task IDs must be unique and nonempty.");
      }
      taskIds.add(task.id);
      const matched = applyModeToFocusScoring([task], input.mode)[0];
      const keys = new Set(matched.modePriorityMatches);
      const domain = task.domain?.trim().toLowerCase().replace(/[ -]+/g, "_");
      if (domain && weights[domain] !== undefined) keys.add(domain);
      if (task.dueAt) {
        if (weights.deadline !== undefined) keys.add("deadline");
        if (weights.urgent !== undefined) keys.add("urgent");
      }
      const priority = Number.isFinite(task.priority)
        ? (task.priority ?? 0)
        : 0;
      const reasons = [`Explicit priority: ${priority}.`];
      let score = priority;
      for (const key of [...keys].sort()) {
        score += weights[key];
        reasons.push(`Mode ${input.mode}: ${key} ${signed(weights[key])}.`);
      }
      const deadline = taskDeadline(task, formatter);
      if (deadline !== null && Number.isFinite(deadline)) {
        const hoursLeft = (deadline - window.start) / (60 * MINUTE_MS);
        const urgency =
          hoursLeft < 0
            ? 300
            : hoursLeft <= 24
              ? 200
              : hoursLeft <= 72
                ? 100
                : hoursLeft <= 168
                  ? 40
                  : 10;
        score += urgency;
        reasons.push(
          hoursLeft < 0
            ? "Deadline is overdue."
            : `Deadline urgency: +${urgency}.`,
        );
      } else if (task.dueAt) {
        reasons.push(
          "Deadline is invalid; this task cannot be safely scheduled.",
        );
      }
      if (task.estimatedMinutes == null) {
        reasons.push(
          `Duration unknown: provisional ${DEFAULT_PLANNER_TASK_MINUTES}-minute estimate.`,
        );
      }
      return { ...task, score, reasons };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        compareTaskDeadlines(left, right, formatter) ||
        left.id.localeCompare(right.id),
    );

  const remaining = free.map((slot) => ({ ...slot }));
  const blocks: DailyPlanBlock[] = [];
  const unscheduledTaskIds: string[] = [];
  for (const task of rankedTasks) {
    const minutes = taskMinutes(task);
    const deadline = taskDeadline(task, formatter);
    if (minutes === null || (deadline !== null && !Number.isFinite(deadline))) {
      unscheduledTaskIds.push(task.id);
      warnings.push(
        `Task "${task.title}" has an invalid ${minutes === null ? "duration" : "deadline"}.`,
      );
      continue;
    }
    const duration = minutes * MINUTE_MS;
    const slot = remaining.find(
      (candidate) =>
        candidate.start + duration <=
        Math.min(candidate.end, deadline ?? Infinity),
    );
    if (!slot) {
      unscheduledTaskIds.push(task.id);
      warnings.push(
        `Task "${task.title}" has no continuous ${minutes}-minute slot${deadline === null ? "" : " before its deadline"}.`,
      );
      continue;
    }
    blocks.push({
      taskId: task.id,
      title: task.title,
      startsAt: iso(slot.start),
      endsAt: iso(slot.start + duration),
      estimated: task.estimatedMinutes == null,
    });
    slot.start += duration;
  }
  if (rankedTasks.some((task) => task.estimatedMinutes == null)) {
    warnings.push(
      `Tasks without recorded durations use provisional ${DEFAULT_PLANNER_TASK_MINUTES}-minute estimates.`,
    );
  }
  if (conflicts.length)
    warnings.push(
      "Calendar events overlap; their combined time is unavailable.",
    );
  return {
    date: input.date,
    timezone: input.timezone,
    mode: input.mode,
    window: serializeInterval(window),
    availableMinutes: free.reduce(
      (sum, slot) => sum + (slot.end - slot.start) / MINUTE_MS,
      0,
    ),
    freeSlots: free.map(serializeInterval),
    conflicts,
    rankedTasks,
    blocks: blocks.sort((left, right) =>
      left.startsAt.localeCompare(right.startsAt),
    ),
    unscheduledTaskIds,
    warnings,
  };
}

/** Suggestions replace task blocks and are validated against original calendar availability. */
export function validatePlanSuggestions(
  plan: DailyPlan,
  suggestions: unknown,
): PlanSuggestionValidation {
  if (!Array.isArray(suggestions)) {
    return {
      valid: false,
      errors: ["Suggestions must be an array."],
      blocks: [],
    };
  }
  const errors: string[] = [];
  const blocks: DailyPlanBlock[] = [];
  const formatter = timezoneFormatter(plan.timezone);
  const tasks = new Map(plan.rankedTasks.map((task) => [task.id, task]));
  const seen = new Set<string>();
  const intervals: Array<Interval & { taskId: string }> = [];
  const windowStart = parseInstant(plan.window.startsAt);
  const windowEnd = parseInstant(plan.window.endsAt);
  for (const suggestion of suggestions) {
    if (
      !suggestion ||
      typeof suggestion !== "object" ||
      Array.isArray(suggestion) ||
      typeof suggestion.taskId !== "string" ||
      typeof suggestion.startsAt !== "string" ||
      typeof suggestion.endsAt !== "string"
    ) {
      errors.push("Suggestion has an invalid shape.");
      continue;
    }
    const task = tasks.get(suggestion.taskId);
    if (!task) {
      errors.push("Suggestion references an unknown task.");
      continue;
    }
    if (seen.has(task.id))
      errors.push(`Task "${task.title}" is scheduled more than once.`);
    seen.add(task.id);
    const start = parseInstant(suggestion.startsAt);
    const end = parseInstant(suggestion.endsAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      errors.push(`Task "${task.title}" has an invalid interval.`);
      continue;
    }
    if (start < windowStart || end > windowEnd)
      errors.push(`Task "${task.title}" is outside the planning window.`);
    const available = plan.freeSlots.some(
      (slot) =>
        start >= parseInstant(slot.startsAt) &&
        end <= parseInstant(slot.endsAt),
    );
    if (!available)
      errors.push(`Task "${task.title}" overlaps unavailable calendar time.`);
    const minutes = taskMinutes(task);
    if (minutes === null || end - start !== minutes * MINUTE_MS)
      errors.push(`Task "${task.title}" has the wrong duration.`);
    const deadline = taskDeadline(task, formatter);
    if (deadline !== null && (!Number.isFinite(deadline) || end > deadline))
      errors.push(`Task "${task.title}" cannot finish before its deadline.`);
    intervals.push({ taskId: task.id, start, end });
    blocks.push({
      taskId: task.id,
      title: task.title,
      startsAt: iso(start),
      endsAt: iso(end),
      estimated: task.estimatedMinutes == null,
    });
  }
  intervals.sort(compareIntervals);
  for (let index = 1; index < intervals.length; index += 1) {
    if (intervals[index].start < intervals[index - 1].end)
      errors.push("Suggested task blocks overlap.");
  }
  return {
    valid: errors.length === 0,
    errors,
    blocks: errors.length
      ? []
      : blocks.sort((left, right) =>
          left.startsAt.localeCompare(right.startsAt),
        ),
  };
}

export interface ProductivityInput {
  startDate: string;
  endDate: string;
  timezone: string;
  tasks: Array<{ createdAt: string; completedAt: string | null }>;
  truncated?: boolean;
}

export interface ProductivitySummary {
  startDate: string;
  endDate: string;
  timezone: string;
  daily: Array<{ date: string; created: number; completed: number }>;
  totalCreated: number;
  totalCompleted: number;
  /** Fraction of tasks created in this period also completed in this period; null for incomplete data. */
  completionRate: number | null;
  truncated: boolean;
  warnings: string[];
}

/** Counts recorded completion timestamps, never status-derived or fabricated completions. */
export function summarizeProductivity(
  input: ProductivityInput,
): ProductivitySummary {
  assertDate(input.startDate);
  assertDate(input.endDate);
  const formatter = timezoneFormatter(input.timezone);
  const days =
    (Date.parse(`${input.endDate}T00:00:00Z`) -
      Date.parse(`${input.startDate}T00:00:00Z`)) /
      DAY_MS +
    1;
  if (days < 1 || days > 366)
    throw new RangeError(
      "Productivity range must contain between 1 and 366 days.",
    );
  const daily = Array.from({ length: days }, (_, index) => ({
    date: addDate(input.startDate, index),
    created: 0,
    completed: 0,
  }));
  const byDate = new Map(daily.map((day) => [day.date, day]));
  let completedCohort = 0;
  let invalidRecords = 0;
  for (const task of input.tasks) {
    const created = parseInstant(task.createdAt);
    const completed =
      task.completedAt === null ? null : parseInstant(task.completedAt);
    const createdDay = Number.isFinite(created)
      ? byDate.get(localDate(created, formatter))
      : undefined;
    if (createdDay) createdDay.created += 1;
    if (
      !Number.isFinite(created) ||
      (completed !== null &&
        (!Number.isFinite(completed) || completed < created))
    )
      invalidRecords += 1;
    if (
      completed === null ||
      !Number.isFinite(completed) ||
      (Number.isFinite(created) && completed < created)
    )
      continue;
    const completedDay = byDate.get(localDate(completed, formatter));
    if (completedDay) {
      completedDay.completed += 1;
      if (createdDay) completedCohort += 1;
    }
  }
  const totalCreated = daily.reduce((sum, day) => sum + day.created, 0);
  const totalCompleted = daily.reduce((sum, day) => sum + day.completed, 0);
  const warnings: string[] = [];
  if (input.truncated)
    warnings.push(
      "Task history is incomplete; counts include only available records.",
    );
  if (invalidRecords)
    warnings.push(
      `${invalidRecords} task record(s) have missing or invalid timestamps; unknown dates are excluded.`,
    );
  if (!input.tasks.length)
    warnings.push("No task history is available for this summary.");
  return {
    startDate: input.startDate,
    endDate: input.endDate,
    timezone: input.timezone,
    daily,
    totalCreated,
    totalCompleted,
    completionRate:
      totalCreated && !input.truncated && !invalidRecords
        ? completedCohort / totalCreated
        : null,
    truncated: input.truncated ?? false,
    warnings,
  };
}

function taskMinutes(task: PlannerTask): number | null {
  if (task.estimatedMinutes == null) return DEFAULT_PLANNER_TASK_MINUTES;
  return Number.isInteger(task.estimatedMinutes) &&
    task.estimatedMinutes > 0 &&
    task.estimatedMinutes <= 24 * 60
    ? task.estimatedMinutes
    : null;
}

function taskDeadline(
  task: PlannerTask,
  formatter: Intl.DateTimeFormat,
): number | null {
  if (!task.dueAt) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(task.dueAt)) {
    try {
      assertDate(task.dueAt);
      return localBoundary(addDate(task.dueAt, 1), 0, formatter, "start") - 1;
    } catch {
      return NaN;
    }
  }
  return parseInstant(task.dueAt);
}

function compareTaskDeadlines(
  left: PlannerTask,
  right: PlannerTask,
  formatter: Intl.DateTimeFormat,
): number {
  const leftDue = taskDeadline(left, formatter);
  const rightDue = taskDeadline(right, formatter);
  const leftValue =
    leftDue !== null && Number.isFinite(leftDue) ? leftDue : Infinity;
  const rightValue =
    rightDue !== null && Number.isFinite(rightDue) ? rightDue : Infinity;
  return leftValue === rightValue ? 0 : leftValue - rightValue;
}

function calendarConflicts(
  events: TimedEvent[],
  dayStart: number,
  dayEnd: number,
): Array<{ eventIds: string[] }> {
  const conflicts: Array<{ eventIds: string[] }> = [];
  let end = -Infinity;
  let ids: string[] = [];
  for (const event of events) {
    const start = Math.max(event.start, dayStart);
    if (start >= end) {
      if (ids.length > 1) conflicts.push({ eventIds: ids });
      ids = [];
      end = -Infinity;
    }
    ids.push(event.id);
    end = Math.max(end, Math.min(event.end, dayEnd));
  }
  if (ids.length > 1) conflicts.push({ eventIds: ids });
  return conflicts;
}

function subtractEvents(window: Interval, events: TimedEvent[]): Interval[] {
  const free: Interval[] = [];
  let cursor = window.start;
  for (const event of events) {
    if (event.end <= cursor || event.start >= window.end) continue;
    if (event.start > cursor) free.push({ start: cursor, end: event.start });
    cursor = Math.max(cursor, Math.min(event.end, window.end));
  }
  if (cursor < window.end) free.push({ start: cursor, end: window.end });
  return free;
}

function compareIntervals(left: Interval, right: Interval): number {
  return left.start - right.start || left.end - right.end;
}

function signed(value: number): string {
  return value >= 0 ? `+${value}` : String(value);
}

function serializeInterval(value: Interval): PlannerInterval {
  return { startsAt: iso(value.start), endsAt: iso(value.end) };
}

function iso(value: number): string {
  return new Date(value).toISOString();
}

function requireInstant(value: string, label: string): number {
  const result = parseInstant(value);
  if (!Number.isFinite(result))
    throw new RangeError(
      `Invalid ${label}; use an ISO timestamp with a timezone offset.`,
    );
  return result;
}

function parseInstant(value: string): number {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(
      value,
    )
  )
    return NaN;
  try {
    assertDate(value.slice(0, 10));
  } catch {
    return NaN;
  }
  return Date.parse(value);
}

function assertDate(date: string): void {
  const instant = Date.parse(`${date}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(instant) ||
    iso(instant).slice(0, 10) !== date
  )
    throw new RangeError("Use a valid YYYY-MM-DD date.");
}

function addDate(date: string, days: number): string {
  return iso(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).slice(0, 10);
}

function timezoneFormatter(timezone: string): Intl.DateTimeFormat {
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
  instant: number,
  formatter: Intl.DateTimeFormat,
): Record<string, string> {
  return Object.fromEntries(
    formatter
      .formatToParts(new Date(instant))
      .map((part) => [part.type, part.value]),
  );
}

function localDate(instant: number, formatter: Intl.DateTimeFormat): string {
  const parts = localParts(instant, formatter);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function localEpoch(instant: number, formatter: Intl.DateTimeFormat): number {
  const parts = localParts(instant, formatter);
  return Date.parse(
    `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`,
  );
}

/** Resolve both sides of a DST fold, and move nonexistent local times forward across a gap. */
function localBoundary(
  date: string,
  hour: number,
  formatter: Intl.DateTimeFormat,
  edge: "start" | "end",
): number {
  const target = Date.parse(`${date}T00:00:00Z`) + hour * 60 * MINUTE_MS;
  const offsets = new Set<number>();
  for (let delta = -48; delta <= 48; delta += 6) {
    const sample = target + delta * 60 * MINUTE_MS;
    offsets.add(localEpoch(sample, formatter) - sample);
  }
  const candidates = [...offsets].map((offset) => target - offset);
  const exact = candidates.filter(
    (candidate) => localEpoch(candidate, formatter) === target,
  );
  if (exact.length)
    return edge === "start" ? Math.min(...exact) : Math.max(...exact);
  const after = candidates
    .filter((candidate) => localEpoch(candidate, formatter) > target)
    .sort(
      (left, right) =>
        localEpoch(left, formatter) - localEpoch(right, formatter),
    );
  if (after.length) return after[0];
  throw new RangeError("Cannot resolve the local planning window.");
}
