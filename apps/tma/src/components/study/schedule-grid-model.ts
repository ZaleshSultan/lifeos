import type {
  StudySchedule,
  StudyWeekday,
  StudyWorkspaceCourse,
} from "../../api/study";
import { studyDaySessions } from "./model";

export interface SchedulePeriod {
  key: string;
  startsOn: string | null;
  endsOn: string | null;
  courses: StudyWorkspaceCourse[];
}

function shiftDate(isoDate: string, days: number): string {
  const date = new Date(isoDate + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function localScheduleDate(timezone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function schedulePeriods(
  courses: StudyWorkspaceCourse[],
): SchedulePeriod[] {
  const scheduled = courses.filter((course) => course.schedules.length > 0);
  // Day after the inclusive end is the first day with a different weekly pattern.
  const changes = new Set<string>();
  for (const course of scheduled) {
    if (course.startsOn) changes.add(course.startsOn);
    if (course.endsOn) changes.add(shiftDate(course.endsOn, 1));
  }
  const starts = [null, ...Array.from(changes).sort()];
  const periods: SchedulePeriod[] = [];
  for (const [i, startsOn] of starts.entries()) {
    const next = starts[i + 1];
    const endsOn = next ? shiftDate(next, -1) : null;
    const active = scheduled.filter(
      (course) =>
        (!course.startsOn ||
          (startsOn !== null && course.startsOn <= startsOn)) &&
        (!course.endsOn || startsOn === null || startsOn <= course.endsOn),
    );
    if (active.length) {
      periods.push({
        key: [startsOn, endsOn].join("/"),
        startsOn,
        endsOn,
        courses: active,
      });
    }
  }
  return periods;
}

export function defaultSchedulePeriod(
  periods: SchedulePeriod[],
  today: string,
): string | null {
  // During a break the next published schedule is more useful than the previous one.
  return (
    (
      periods.find((period) => !period.endsOn || period.endsOn >= today) ??
      periods.at(-1)
    )?.key ?? null
  );
}

function timeInMinutes(time: string): number {
  const [hours, minutes, seconds = 0] = time.split(":").map(Number);
  return hours * 60 + minutes + seconds / 60;
}

export interface ScheduleDayItem {
  course: StudyWorkspaceCourse;
  schedule: StudySchedule;
  start: number;
  end: number;
  lane: number;
  laneCount: number;
}

export function layoutScheduleDay(
  courses: StudyWorkspaceCourse[],
  day: StudyWeekday,
): ScheduleDayItem[] {
  const items = studyDaySessions(courses, day).map(({ course, schedule }) => ({
    course,
    schedule,
    start: timeInMinutes(schedule.startTime),
    end: timeInMinutes(schedule.endTime),
    lane: 0,
    laneCount: 1,
  }));
  // A connected group of overlapping sessions shares the same column width.
  let groupStart = 0;
  let groupEnd = 0;
  let laneEnds: number[] = [];
  function finishGroup(endIndex: number) {
    for (let i = groupStart; i < endIndex; i++)
      items[i].laneCount = laneEnds.length;
  }
  for (const [index, item] of items.entries()) {
    if (item.start >= groupEnd) {
      finishGroup(index);
      groupStart = index;
      groupEnd = item.end;
      laneEnds = [];
    }
    const available = laneEnds.findIndex((end) => end <= item.start);
    item.lane = available < 0 ? laneEnds.length : available;
    laneEnds[item.lane] = item.end;
    groupEnd = Math.max(groupEnd, item.end);
  }
  finishGroup(items.length);
  return items;
}

export function scheduleHourBounds(courses: StudyWorkspaceCourse[]) {
  const slots = courses.flatMap((course) => course.schedules);
  if (!slots.length) return { first: 8, last: 20 };
  return {
    first: Math.floor(
      Math.min(...slots.map((slot) => timeInMinutes(slot.startTime))) / 60,
    ),
    last: Math.ceil(
      Math.max(...slots.map((slot) => timeInMinutes(slot.endTime))) / 60,
    ),
  };
}
