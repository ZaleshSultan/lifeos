import { describe, expect, it } from "vitest";
import {
  defaultIdealHumanPlan,
  clearIdealHumanReflection,
  emptyIdealHumanDay,
  hasIdealHumanObservation,
  hasIdealHumanReflection,
  idealHumanAdherence,
  idealHumanDate,
  idealHumanDayNumber,
  idealHumanExperimentStatus,
  idealHumanLocalDate,
  idealHumanStats,
  idealHumanStudyMinutes,
  parseIdealHumanDay,
  parseIdealHumanReflectionClear,
  parseStoredIdealHumanDay,
} from "./ideal-human.js";

describe("Ideal Human calendar", () => {
  it("uses November 3 through December 2, inclusive", () => {
    expect(idealHumanDayNumber("2026-11-03")).toBe(1);
    expect(idealHumanDayNumber("2026-12-02")).toBe(30);
    expect(idealHumanDate(30)).toBe("2026-12-02");
    expect(
      new Set(Array.from({ length: 30 }, (_, i) => idealHumanDate(i + 1))).size,
    ).toBe(30);
    expect(idealHumanDayNumber("2026-11-02")).toBeNull();
    expect(idealHumanDayNumber("2026-12-03")).toBeNull();
    expect(idealHumanDayNumber("2026-11-31")).toBeNull();
    expect(idealHumanDayNumber("2026-11-03T00:00Z")).toBeNull();
    expect(() => idealHumanDate(0)).toThrow();
    expect(() => idealHumanDate(1.5)).toThrow();
    expect(() => idealHumanDate(31)).toThrow();
  });
  it("switches days at midnight Asia/Almaty (UTC+05)", () => {
    expect(idealHumanLocalDate(new Date("2026-11-02T18:59:59.999Z"))).toBe(
      "2026-11-02",
    );
    expect(idealHumanLocalDate(new Date("2026-11-02T19:00:00Z"))).toBe(
      "2026-11-03",
    );
    expect(idealHumanLocalDate(new Date("2026-12-02T18:59:59Z"))).toBe(
      "2026-12-02",
    );
    expect(idealHumanLocalDate(new Date("2026-12-02T19:00:00Z"))).toBe(
      "2026-12-03",
    );
    expect(() => idealHumanLocalDate(new Date("invalid"))).toThrow();
  });
  it("separates preview, active and complete without a fake current day", () => {
    expect(idealHumanExperimentStatus("2026-11-02")).toEqual({
      phase: "upcoming",
      day: null,
      daysRemaining: 30,
    });
    expect(idealHumanExperimentStatus("2026-11-03")).toEqual({
      phase: "active",
      day: 1,
      daysRemaining: 29,
    });
    expect(idealHumanExperimentStatus("2026-12-02")).toEqual({
      phase: "active",
      day: 30,
      daysRemaining: 0,
    });
    expect(idealHumanExperimentStatus("2026-12-03")).toEqual({
      phase: "complete",
      day: null,
      daysRemaining: 0,
    });
    expect(() => idealHumanExperimentStatus("2026-11-31")).toThrow();
  });
});

describe("Ideal Human privacy-safe journal input", () => {
  it("clears only private reflection history and preserves factual records and tomorrow's draft", () => {
    const day = parseIdealHumanDay({
      date: "2026-11-03",
      revision: 3,
      energy: 4,
      mood: 3,
      whatWorked: "A private reflection",
      whatDidNotWork: "An obstacle",
      highlights: "Personal highlight",
      notes: "Private notes",
      weightKg: 51.2,
      scienceMinutes: 20,
      sleepMinutes: 430,
      tomorrowPlan: "A draft to approve",
      workoutNotes: "Recorded workout",
      storyboard: "Episode idea",
      footageCaptured: true,
      meals: [{ id: "meal", label: "Actual meal", estimated: false }],
    });
    const next = clearIdealHumanReflection(day);
    expect(hasIdealHumanReflection(next)).toBe(false);
    expect(next).toEqual({
      ...day,
      energy: null,
      mood: null,
      whatWorked: "",
      whatDidNotWork: "",
      highlights: "",
      notes: "",
    });
    expect(hasIdealHumanReflection(day)).toBe(true);
    expect(hasIdealHumanObservation(next)).toBe(true);
  });
  it("reads the intentionally cleared last reflection without fabricating check-ins or permitting empty client saves", () => {
    const cleared = clearIdealHumanReflection(
      parseIdealHumanDay({
        date: "2026-11-03",
        notes: "Last reflection",
        revision: 1,
      }),
    );
    const stored = parseStoredIdealHumanDay(cleared);
    expect(hasIdealHumanObservation(stored)).toBe(false);
    expect(idealHumanStats([stored])).toMatchObject({
      checkins: 0,
      journalDays: 0,
    });
    expect(() => parseIdealHumanDay(cleared)).toThrow("Record at least");
    expect(() => parseIdealHumanDay({ ...cleared, revision: 999 })).toThrow(
      "Record at least",
    );
    expect(() => parseStoredIdealHumanDay({ ...cleared, revision: 0 })).toThrow(
      "stored revision",
    );
  });
  it("requires explicit confirmation, an existing-row revision and a valid experiment day to clear", () => {
    const valid = { date: "2026-11-03", expectedRevision: 1, confirmed: true };
    expect(parseIdealHumanReflectionClear(valid)).toEqual(valid);
    for (const patch of [
      { confirmed: false },
      { confirmed: "true" },
      { confirmed: undefined },
      { expectedRevision: 0 },
      { expectedRevision: -1 },
      { expectedRevision: 1.5 },
      { expectedRevision: 2_147_483_647 },
      { date: "2026-11-02" },
      { userId: "other" },
    ])
      expect(() =>
        parseIdealHumanReflectionClear({ ...valid, ...patch }),
      ).toThrow();
  });
  it("accepts partial measurements, preserves explicit zero, leaves unknown data unknown", () => {
    const value = parseIdealHumanDay({
      date: "2026-11-03",
      scienceMinutes: 0,
      sleepMinutes: null,
    });
    expect(value.scienceMinutes).toBe(0);
    expect(value.sleepMinutes).toBeNull();
    expect(value.mood).toBeNull();
    expect(value.footageBackedUp).toBeNull();
    expect(value.weightKg).toBeNull();
    expect(value.baselineHeightCm).toBeNull();
    expect(idealHumanStats([value]).avgWeightKg).toBeNull();
  });
  it("prepares flexible ordered Day 1 activities with no completions or invented timestamps", () => {
    const day = emptyIdealHumanDay("2026-11-03");
    expect(day.plan.map((b) => b.kind)).toEqual([
      "morning",
      "university",
      "gym",
      "social",
      "evening",
    ]);
    expect(day.plan[2].title).toContain("Алинур");
    expect(day.plan[3].title).toContain("Мафия");
    expect(
      day.plan.every(
        (b) => b.time === null && b.tasks.every((t) => t.completed === null),
      ),
    ).toBe(true);
    expect(hasIdealHumanObservation(day)).toBe(false);
    expect(idealHumanAdherence(day)).toBeNull();
    expect(day.training).toBeNull();
    expect(
      defaultIdealHumanPlan("2026-11-04").some((b) => b.kind === "university"),
    ).toBe(false);
  });
  it("persists changed plans without claiming a check-in or journal", () => {
    const day = emptyIdealHumanDay("2026-11-03");
    expect(() => parseIdealHumanDay(day)).toThrow("Record at least");
    day.plan[2].notes = "Confirm with Alinur after classes";
    const parsed = parseIdealHumanDay(day);
    expect(parsed.plan[2].notes).toContain("Confirm");
    const stats = idealHumanStats([parsed]);
    expect(stats.checkins).toBe(0);
    expect(stats.journalDays).toBe(0);
    expect(stats.studyMinutes).toBeNull();
    expect(stats.avgSleepMinutes).toBeNull();
    expect(stats.adherence).toBeNull();
  });
  it.each([
    { weightKg: "52" },
    { weightKg: NaN },
    { weightKg: Infinity },
    { energy: 7 },
    { mood: 0 },
    { sleepMinutes: 90.5 },
    { revision: -1 },
    { revision: 0.5 },
    { notes: "x".repeat(2001) },
    { userId: "other" },
    { bedtime: "25:01" },
    { wakeTime: "8:30" },
    { training: { toString: () => "gym" } },
    { footageBackedUp: "true" },
    { meals: [{ id: "x", label: "", estimated: true }] },
    { meals: [{ id: "x", label: "Meal", estimated: true, secret: "no" }] },
    { learningSessions: [{ id: "x", category: "medicine", minutes: 20 }] },
  ])("rejects invalid or unexpected input %j", (fields) => {
    expect(() =>
      parseIdealHumanDay({
        date: "2026-11-03",
        notes: "observation",
        ...fields,
      }),
    ).toThrow();
  });
  it("does not coerce a backup or editing status into completion", () => {
    const day = parseIdealHumanDay({
      date: "2026-11-03",
      footageCaptured: true,
      aRoll: true,
      footageBackedUp: false,
      editingStatus: "not_started",
    });
    expect(day.footageBackedUp).toBe(false);
    expect(emptyIdealHumanDay(day.date).footageBackedUp).toBeNull();
  });
  it("validates duplicate entry ids and nested input bounds", () => {
    const meal = {
      id: "meal",
      label: "Breakfast",
      estimated: true,
      caloriesKcal: null,
      proteinG: null,
    };
    expect(() =>
      parseIdealHumanDay({ date: "2026-11-03", meals: [meal, meal] }),
    ).toThrow("Duplicate");
    const day = emptyIdealHumanDay("2026-11-03");
    day.plan[0].tasks.push({ ...day.plan[0].tasks[0] });
    expect(() => parseIdealHumanDay(day)).toThrow("Duplicate");
    expect(() =>
      parseIdealHumanDay({
        date: "2026-11-03",
        meals: Array.from({ length: 31 }, (_, i) => ({
          ...meal,
          id: String(i),
        })),
      }),
    ).toThrow();
  });
});

describe("Ideal Human honest progress", () => {
  it("uses measured data only, not missing days as zero or failure", () => {
    const first = parseIdealHumanDay({
      date: "2026-11-03",
      weightKg: 51,
      sleepMinutes: 480,
      notes: "Good morning",
    });
    const second = parseIdealHumanDay({
      date: "2026-11-04",
      sleepMinutes: 420,
      filmingMinutes: 10,
    });
    const third = parseIdealHumanDay({
      date: "2026-11-05",
      tomorrowPlan: "Study",
    });
    const stats = idealHumanStats([first, second, third]);
    expect(stats.checkins).toBe(2);
    expect(stats.journalDays).toBe(1);
    expect(stats.avgWeightKg).toBe(51);
    expect(stats.avgSleepMinutes).toBe(450);
    expect(stats.sleepVariationMinutes).toBe(30);
    expect(stats.weekly[0].recordedDays).toBe(2);
    expect(stats.weekly[1].avgSleepMinutes).toBeNull();
    expect(stats.weekly[1].studyMinutes).toBeNull();
    expect(stats.sleepTrend).toHaveLength(2);
    expect(stats.weightTrend).toHaveLength(1);
    expect(stats.filmedDays).toBe(1);
  });
  it("deduplicates dates and uses authoritative workouts when provided", () => {
    const day = parseIdealHumanDay({ date: "2026-11-03", training: "gym" });
    expect(idealHumanStats([day, day]).gymDays).toBe(1);
    expect(idealHumanStats([day], []).gymDays).toBe(0);
    expect(
      idealHumanStats([day], [day.date, day.date, "2026-11-02"]).gymDays,
    ).toBe(1);
  });
  it("uses detailed learning totals over matching legacy aggregates", () => {
    const day = parseIdealHumanDay({
      date: "2026-11-03",
      scienceMinutes: 45,
      codingMinutes: 10,
      learningSessions: [
        {
          id: "a",
          category: "science",
          topic: "Neuroscience",
          minutes: 20,
          resource: "",
          notes: "",
          completed: true,
        },
        {
          id: "b",
          category: "cybersecurity",
          topic: "Network safety",
          minutes: 15,
          resource: "",
          notes: "",
          completed: null,
        },
      ],
    });
    expect(idealHumanStudyMinutes(day)).toBe(45);
    expect(idealHumanStats([day]).scienceMinutes).toBe(20);
    expect(idealHumanStats([day]).studyMinutes).toBe(45);
  });
  it("computes adherence over explicitly answered tasks and includes social activity", () => {
    const day = emptyIdealHumanDay("2026-11-03");
    day.plan[0].tasks[0].completed = true;
    day.plan[3].tasks[0].completed = true;
    expect(idealHumanAdherence(day)).toBe(1);
    day.plan[0].tasks[1].completed = false;
    expect(idealHumanAdherence(day)).toBeCloseTo(2 / 3);
  });
});
