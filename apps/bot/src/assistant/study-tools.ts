import { DateTime } from "luxon";
import {
  calculateStudyScenario,
  calculateStudyTargetPlan,
  matchSyllabusProfile,
  parseAssistantToolCall,
  resolveStudyCalculator,
  validateAssistantToolOutput,
  type AssistantToolCall,
  type AssistantToolOutput,
} from "@lifeos/core";
import type {
  LifeOSStore,
  StudyWorkspaceCourse,
  TelegramUserRecord,
} from "@lifeos/db";

type StudyStore = Pick<
  LifeOSStore,
  "getTmaStudySummary" | "getLmsWork" | "assistant"
>;
type StudyUser = Pick<TelegramUserRecord, "userId" | "timezone">;
function visible(value: string, maximum = 240): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maximum);
}
function instant(value: string | null): string | null {
  return value && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : null;
}
function response(
  text: string,
  name: string,
  updatedAt: string | null = null,
): AssistantToolOutput {
  return validateAssistantToolOutput({
    text:
      text.length > 14000
        ? `${text.slice(0, 13880)}\nResults are limited; check Study for the full list.`
        : text,
    sources: [{ name, updatedAt: instant(updatedAt) }],
  });
}
function clock(value: string, timezone: string): string {
  const time = DateTime.fromISO(value, { zone: timezone });
  return time.isValid ? time.toFormat("yyyy-MM-dd HH:mm") : "unknown time";
}
interface ClassOccurrence {
  title: string;
  room: string | null;
  start: DateTime;
  end: DateTime;
}
/** Saved recurring timetable, constrained to each course's actual date range. */
export function assistantClassOccurrences(
  courses: StudyWorkspaceCourse[],
  day: DateTime,
): ClassOccurrence[] {
  const date = day.toISODate();
  if (!date || !day.isValid) throw new Error("Invalid study date");
  const weekday = day.toFormat("cccc").toLowerCase().slice(0, 3);
  return courses
    .flatMap((course) => {
      if (
        (course.startsOn && date < course.startsOn) ||
        (course.endsOn && date > course.endsOn)
      )
        return [];
      return course.schedules.flatMap((slot) => {
        if (slot.dayOfWeek.toLowerCase().slice(0, 3) !== weekday) return [];
        const start = DateTime.fromISO(`${date}T${slot.startTime}`, {
          zone: day.zoneName!,
        });
        const end = DateTime.fromISO(`${date}T${slot.endTime}`, {
          zone: day.zoneName!,
        });
        if (!start.isValid || !end.isValid || end <= start) return [];
        return [
          {
            title: visible(course.title),
            room: slot.room ? visible(slot.room, 100) : null,
            start,
            end,
          },
        ];
      });
    })
    .sort((a, b) => a.start.toMillis() - b.start.toMillis());
}
function chooseCourse(
  courses: StudyWorkspaceCourse[],
  query: string,
): StudyWorkspaceCourse {
  const normalized = query.trim().toLocaleLowerCase();
  const exact = courses.filter(
    (course) =>
      course.code.toLocaleLowerCase() === normalized ||
      course.title.toLocaleLowerCase() === normalized,
  );
  if (exact.length === 1) return exact[0];
  const profile = matchSyllabusProfile(query, query);
  const matches = courses.filter(
    (course) =>
      course.title.toLocaleLowerCase().includes(normalized) ||
      course.code.toLocaleLowerCase().includes(normalized) ||
      (profile &&
        matchSyllabusProfile(course.title, course.code)?.id === profile.id),
  );
  if (!matches.length)
    throw new Error(
      "No saved course matches that name; specify its course code",
    );
  if (matches.length !== 1)
    throw new Error("Several courses match that name; specify its course code");
  return matches[0];
}
const score = (value: number) => String(Math.round(value * 10) / 10);

/** Academic tools use existing scoped reads and existing calculator functions only. */
export async function executeStudyTool(
  store: StudyStore,
  user: StudyUser,
  input: AssistantToolCall,
  now: Date,
): Promise<AssistantToolOutput> {
  const call = parseAssistantToolCall(input);
  const local = DateTime.fromJSDate(now, { zone: user.timezone }).setLocale(
    "en",
  );
  if (!local.isValid) throw new Error("Invalid study timezone or clock");
  const limit = typeof call.args.limit === "number" ? call.args.limit : 20;
  if (call.tool.startsWith("classes.")) {
    const workspace = await store.getTmaStudySummary(
      user.userId,
      user.timezone,
    );
    if (call.tool === "classes.next") {
      for (let offset = 0; offset <= 7; offset++) {
        const next = assistantClassOccurrences(
          workspace.courses,
          local.plus({ days: offset }),
        ).find(
          (item) =>
            item.start >= local && item.start <= local.plus({ days: 7 }),
        );
        if (next)
          return response(
            `Next class: ${next.title}\n${next.start.toFormat("yyyy-MM-dd HH:mm")}–${next.end.toFormat("HH:mm")} (${user.timezone})${next.room ? ` · ${next.room}` : ""}`,
            "Saved study timetable",
          );
      }
      return response(
        "No upcoming class is recorded in the next 7 days.",
        "Saved study timetable",
      );
    }
    const day =
      call.tool === "classes.tomorrow" ? local.plus({ days: 1 }) : local;
    const items = assistantClassOccurrences(workspace.courses, day);
    return response(
      items.length
        ? `Classes · ${day.toISODate()} (${user.timezone})\n${items
            .slice(0, 50)
            .map(
              (item) =>
                `${item.start.toFormat("HH:mm")}–${item.end.toFormat("HH:mm")} · ${item.title}${item.room ? ` · ${item.room}` : ""}`,
            )
            .join("\n")}`
        : `No classes are recorded for ${day.toISODate()}.`,
      "Saved study timetable",
    );
  }
  if (call.tool === "study.forecast") {
    const workspace = await store.getTmaStudySummary(
      user.userId,
      user.timezone,
    );
    const course = chooseCourse(workspace.courses, call.args.course as string);
    const current = resolveStudyCalculator(course);
    if (!current)
      throw new Error("This course has no configured study calculator");
    const state = {
      ...current,
      target:
        typeof call.args.target === "number"
          ? call.args.target
          : current.target,
    };
    const scenario = calculateStudyScenario(state);
    const plan = calculateStudyTargetPlan(state);
    const lines = [
      `${visible(course.title)} · target ${score(state.target)}`,
      `Current final grade: ${scenario.finalScore === null ? "unknown (unfinished assessments)" : score(scenario.finalScore)}`,
      `Possible final range: ${score(plan.minimumFinal)}–${score(plan.maximumFinal)}`,
      `Remaining assessment weight: ${score(plan.remainingFinalWeight)}%`,
      plan.requiredAverage === null
        ? scenario.targetStatus === "achieved"
          ? "The target is already achieved."
          : "No remaining assessment can change this grade."
        : `Required average on remaining work: ${score(plan.requiredAverage)}%${plan.targetPossible ? "" : " (target cannot be reached with the saved scores)"}`,
      ...(scenario.requiredExamScore === null
        ? []
        : [`Required final exam score: ${score(scenario.requiredExamScore)}%`]),
      ...plan.missing
        .slice(0, 30)
        .map(
          (item) =>
            `${visible(item.label, 140)}: unknown · ${score(item.weightInFinal)}% of final grade`,
        ),
      ...plan.attestationWarnings,
      "Uses the existing saved study calculator and its configured formula. Missing grades remain unknown; this is a what-if forecast, not a live Moodle grade.",
    ];
    return response(lines.join("\n"), "Saved study calculator");
  }
  if (call.tool === "study.changes") {
    if (!store.assistant)
      throw new Error("Recorded grade changes are unavailable");
    const changes = await store.assistant.listGradeChanges(user.userId, {
      since: new Date(now.getTime() - 7 * 86400000).toISOString(),
      limit,
    });
    return response(
      changes.length
        ? `Recorded grade changes · last 7 days\n${changes.map((item) => `${clock(item.createdAt, user.timezone)} · ${visible(item.message, 500)}`).join("\n")}`
        : "No grade changes were recorded in the last 7 days.",
      "Recorded grade notifications",
      changes[0]?.createdAt ?? null,
    );
  }
  if (call.tool === "study.grades" || call.tool === "study.deadlines") {
    const work = await store.getLmsWork(user.userId, user.timezone);
    let items = work.items;
    if (call.tool === "study.grades") {
      items = items.filter((item) => item.source === "moodle");
      if (typeof call.args.course === "string")
        items = items.filter((item) =>
          item.courseTitle
            ?.toLocaleLowerCase()
            .includes((call.args.course as string).toLocaleLowerCase()),
        );
      const lines = items.slice(0, limit).map((item) => {
        const value =
          item.score !== null
            ? `${score(item.score)}${item.maxScore !== null ? `/${score(item.maxScore)}` : " (maximum unknown)"}`
            : item.percentage !== null
              ? `${score(item.percentage)}%`
              : "unknown";
        return `${item.courseTitle ? `${visible(item.courseTitle, 160)} · ` : ""}${visible(item.title, 180)}: ${value}`;
      });
      return response(
        [
          lines.length
            ? `Saved Moodle grades\n${lines.join("\n")}`
            : "No saved Moodle grades match this request.",
          ...(work.stale
            ? [
                "The saved Moodle data is stale; sync it through the existing Study connection.",
              ]
            : []),
          ...(work.truncated || items.length > limit
            ? ["Results are limited; check Study for the full list."]
            : []),
        ].join("\n"),
        "Moodle sync",
        work.lastSyncSuccessAt,
      );
    }
    items = items
      .filter(
        (item) =>
          item.dueAt &&
          (item.category === "upcoming" ||
            item.category === "overdue" ||
            item.category === "exams" ||
            item.category === "unknown"),
      )
      .sort((a, b) => Date.parse(a.dueAt!) - Date.parse(b.dueAt!));
    const lines = items
      .slice(0, limit)
      .map(
        (item) =>
          `${clock(item.dueAt!, user.timezone)} · ${item.courseTitle ? `${visible(item.courseTitle, 140)} · ` : ""}${visible(item.title, 180)}${Date.parse(item.dueAt!) < now.getTime() ? " (past due; check submission status)" : ""}${item.source === "manual" ? " (manual)" : ""}`,
      );
    return response(
      [
        lines.length
          ? `Saved deadlines (${user.timezone})\n${lines.join("\n")}`
          : "No pending deadlines are recorded.",
        ...(work.stale
          ? [
              "The saved Moodle data is stale; sync it through the existing Study connection.",
            ]
          : []),
        ...(work.truncated || items.length > limit
          ? ["Results are limited; check Study for the full list."]
          : []),
      ].join("\n"),
      "Saved study work / Moodle sync",
      work.lastSyncSuccessAt,
    );
  }
  throw new Error("Unsupported study tool");
}
