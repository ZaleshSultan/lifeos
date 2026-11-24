import { describe, expect, it } from "vitest";
import type { StudySchedule, StudyWorkspaceCourse } from "../../api/study";
import {
  defaultSchedulePeriod,
  layoutScheduleDay,
  localScheduleDate,
  scheduleHourBounds,
  schedulePeriods,
} from "./schedule-grid-model";

function slot(startTime: string, endTime: string): StudySchedule {
  return {
    id: startTime + "/" + endTime,
    startTime,
    endTime,
    dayOfWeek: "monday",
    room: null,
    sessionType: null,
    instructorName: null,
  };
}

function course(
  id: string,
  startsOn: string | null,
  endsOn: string | null,
  schedules = [slot("08:00", "08:50")],
): StudyWorkspaceCourse {
  return {
    id,
    code: id,
    title: id,
    startsOn,
    endsOn,
    schedules,
    calculator: null,
    externalCourseKey: null,
  };
}

describe("weekly schedule periods", () => {
  it("selects the next published period during a break and keeps inclusive end dates", () => {
    const periods = schedulePeriods([
      course("winter", "2026-12-07", "2027-02-13"),
      course("autumn", "2026-09-07", "2026-11-14"),
      course("without lessons", null, null, []),
    ]);
    expect(periods.map((p) => p.courses.map((c) => c.id))).toEqual([
      ["autumn"],
      ["winter"],
    ]);
    expect(defaultSchedulePeriod(periods, "2026-11-14")).toBe(periods[0].key);
    expect(defaultSchedulePeriod(periods, "2026-11-24")).toBe(periods[1].key);
    expect(defaultSchedulePeriod(periods, "2027-03-01")).toBe(periods[1].key);
    expect(defaultSchedulePeriod([], "2026-11-24")).toBeNull();
  });

  it("includes overlapping and undated classes without mixing disjoint periods", () => {
    const periods = schedulePeriods([
      course("always", null, null),
      course("ending", null, "2027-01-05"),
      course("new", "2027-01-04", null),
    ]);
    expect(
      periods.map((p) => [p.startsOn, p.endsOn, p.courses.map((c) => c.id)]),
    ).toEqual([
      [null, "2027-01-03", ["always", "ending"]],
      ["2027-01-04", "2027-01-05", ["always", "ending", "new"]],
      ["2027-01-06", null, ["always", "new"]],
    ]);
    expect(
      localScheduleDate("Asia/Almaty", new Date("2026-12-06T22:00:00Z")),
    ).toBe("2026-12-07");
  });
});

describe("weekly time grid", () => {
  it("keeps exact minute offsets, reuses lanes, and resets width after a conflict group", () => {
    const courses = [
      course("test", null, null, [
        slot("14:00:00", "14:50:00"),
        slot("13:05:00", "13:55:00"),
        slot("13:15:00", "13:30:00"),
        slot("13:30:00", "14:00:00"),
        slot("19:00:00", "19:50:00"),
      ]),
    ];
    expect(
      layoutScheduleDay(courses, "monday").map(
        ({ start, end, lane, laneCount }) => [start, end, lane, laneCount],
      ),
    ).toEqual([
      [785, 835, 0, 2],
      [795, 810, 1, 2],
      [810, 840, 1, 2],
      [840, 890, 0, 1],
      [1140, 1190, 0, 1],
    ]);
    expect(layoutScheduleDay(courses, "thursday")).toEqual([]);
    expect(scheduleHourBounds(courses)).toEqual({ first: 13, last: 20 });
    expect(scheduleHourBounds([])).toEqual({ first: 8, last: 20 });
  });
});
