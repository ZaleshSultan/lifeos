import { describe, expect, it } from "vitest";
import {
  emptyIdealHumanDay,
  hasIdealHumanObservation,
  parseIdealHumanDay,
} from "./ideal-human.js";
import {
  buildDailyBriefings,
  dailyLifeDate,
  parseDailyLifePreferences,
  DEFAULT_DAILY_LIFE_PREFERENCES,
  parseHydrationInput,
  parseTaskMutation,
  projectDailyHealth,
  documentaryPrompts,
} from "./daily-life.js";
const now = new Date("2026-11-03T06:00:00Z");
describe("daily Life facts and inputs", () => {
  it("includes actual sleep, stale markers and a bounded manual recovery note in both briefings", () => {
    const day = parseIdealHumanDay({
      date: "2026-11-03",
      recoveryNotes: "Need a slower start " + "x".repeat(500),
    });
    const health = projectDailyHealth({
      date: day.date,
      manual: day,
      metrics: { sleep_minutes: 410 },
      records: [
        {
          metricType: "sleep_minutes",
          value: 410,
          source: "health_connect",
          updatedAt: "2026-10-25T00:00:00Z",
          confidence: null,
        },
      ],
      now,
    });
    const input = {
      date: day.date,
      day,
      health,
      classes: [],
      deadlines: [],
      tasks: [],
      workouts: [],
      lmsStale: false,
    };
    const views = buildDailyBriefings(input);
    for (const view of [views.morning, views.evening]) {
      expect(view.facts).toContain(
        "Записанный сон: 410 мин · health_connect · устаревшая запись",
      );
      expect(view.warnings).toEqual(expect.arrayContaining(health.warnings));
      const recovery = view.facts.find((fact) =>
        fact.includes("Твоя запись о восстановлении:"),
      );
      expect(recovery).toContain("Need a slower start");
      expect(recovery).toContain("manual_journal");
      expect(recovery!.length).toBeLessThan(320);
      expect(recovery).not.toContain("x".repeat(500));
    }
    const privateViews = buildDailyBriefings({
      ...input,
      deliveryPrivacy: { includeHealth: false, includeFilming: true },
    });
    expect(JSON.stringify(privateViews)).not.toMatch(
      /410|health_connect|Need a slower|stale|сон|восстановлении/,
    );
  });
  it("marks missing sleep and recovery as unknown in both views instead of inventing a score", () => {
    const views = buildDailyBriefings({
      date: "2026-11-03",
      day: null,
      health: projectDailyHealth({
        date: "2026-11-03",
        manual: null,
        metrics: {},
        records: [],
        now,
      }),
      classes: [],
      deadlines: [],
      tasks: [],
      workouts: [],
      lmsStale: false,
    });
    for (const view of [views.morning, views.evening]) {
      expect(view.warnings.join(" ")).toContain(
        "Записанный сон недоступен в этом обзоре",
      );
      expect(view.warnings.join(" ")).toContain(
        "Ручная запись о восстановлении недоступна в этом обзоре",
      );
      expect(view.facts.join(" ")).not.toMatch(
        /Записанный сон|Твоя запись о восстановлении/,
      );
    }
  });
  it("distinguishes failed task/workout sources from verified empty history", () => {
    const input = {
      date: "2026-11-03",
      day: null,
      health: projectDailyHealth({
        date: "2026-11-03",
        manual: null,
        metrics: {},
        records: [],
        now,
      }),
      classes: [],
      deadlines: [],
      tasks: [],
      workouts: [],
      lmsStale: false,
    };
    const verified = buildDailyBriefings(input);
    expect(verified.evening.facts.join(" ")).toContain("завершения сегодня: 0");
    expect(verified.evening.warnings.join(" ")).toContain(
      "тренировка на эту дату не зарегистрирована",
    );
    const unavailable = buildDailyBriefings({
      ...input,
      sourceAvailability: { tasks: false, workouts: false },
    });
    expect(unavailable.evening.facts.join(" ")).not.toContain(
      "завершения сегодня: 0",
    );
    expect(unavailable.evening.warnings.join(" ")).not.toContain(
      "тренировка на эту дату не зарегистрирована",
    );
    expect(unavailable.evening.warnings.join(" ")).toMatch(
      /Источник задач недоступен/,
    );
    expect(unavailable.evening.warnings.join(" ")).toMatch(
      /Источник тренировок недоступен/,
    );
    expect(unavailable.evening.tomorrowOrder).toEqual([]);
    const privateViews = buildDailyBriefings({
      ...input,
      sourceAvailability: { tasks: false, workouts: false },
      deliveryPrivacy: { includeHealth: false, includeFilming: false },
    });
    expect(JSON.stringify(privateViews)).not.toContain("тренировок");
    expect(privateViews.evening.warnings.join(" ")).toContain(
      "Источник задач недоступен",
    );
  });
  it("omits health and filming facts at their source for notification privacy without filtering unrelated user text", () => {
    const day = parseIdealHumanDay({
      ...emptyIdealHumanDay("2026-11-03"),
      sleepMinutes: 450,
      footageCaptured: true,
      footageBackedUp: true,
      meals: [
        {
          id: "manual-meal",
          label: "Private food label",
          caloriesKcal: null,
          proteinG: null,
          estimated: true,
        },
      ],
    });
    const input = {
      date: day.date,
      day,
      health: projectDailyHealth({
        date: day.date,
        manual: day,
        metrics: {},
        records: [],
        now,
      }),
      classes: [
        {
          title: "Health cybersecurity lecture",
          startTime: "10:00",
          endTime: "11:00",
        },
      ],
      deadlines: [],
      tasks: [],
      workouts: [
        {
          title: "Private workout",
          startedAt: "2026-11-03T10:00:00Z",
          endedAt: "2026-11-03T11:00:00Z",
        },
      ],
      lmsStale: false,
    };
    const excluded = buildDailyBriefings({
      ...input,
      deliveryPrivacy: { includeHealth: false, includeFilming: false },
    });
    const included = buildDailyBriefings({
      ...input,
      deliveryPrivacy: { includeHealth: true, includeFilming: true },
    });
    const hiddenText = JSON.stringify(excluded),
      fullText = JSON.stringify(included);
    expect(hiddenText).not.toMatch(
      /Записанный сон|Завершённых тренировок|тренировка на эту дату|Приёмов пищи|отснятого материала|Резервная копия|сними короткий|Underground GYM/,
    );
    expect(hiddenText).toContain("Health cybersecurity lecture");
    for (const fact of [
      "Записанный сон",
      "Завершённых тренировок",
      "Приёмов пищи",
      "отснятого материала",
      "Резервная копия",
      "Underground GYM",
    ])
      expect(fullText).toContain(fact);
    expect(buildDailyBriefings(input)).toEqual(included);
    expect(fullText).not.toContain("Private food label");
    expect(fullText).not.toContain("Private workout");
  });
  it("keeps missing automatic measurements unknown and does not create a check-in", () => {
    const day = emptyIdealHumanDay("2026-11-03");
    const view = projectDailyHealth({
      date: day.date,
      manual: day,
      metrics: {},
      records: [],
      now,
    });
    expect(view.sleepMinutes).toBeNull();
    expect(view.weightKg).toBeNull();
    expect(view.missing).toContain("steps");
    expect(hasIdealHumanObservation(day)).toBe(false);
  });
  it("shows actual source lineage without overwriting a manual observation", () => {
    const day = { ...emptyIdealHumanDay("2026-11-03"), sleepMinutes: 450 };
    const view = projectDailyHealth({
      date: day.date,
      manual: day,
      metrics: { sleep_minutes: 420, weight_kg: 51.3 },
      records: [
        {
          metricType: "sleep_minutes",
          value: 420,
          source: "health_connect",
          updatedAt: now.toISOString(),
          confidence: 0.9,
        },
        {
          metricType: "weight_kg",
          value: 51.3,
          source: "manual",
          updatedAt: now.toISOString(),
          confidence: null,
        },
      ],
      now,
    });
    expect(view.sleepMinutes).toMatchObject({
      value: 450,
      source: "manual_journal",
    });
    expect(view.weightKg).toMatchObject({ value: 51.3, source: "manual" });
    expect(day.weightKg).toBeNull();
  });
  it("marks old source data as stale and never fabricates device permissions", () => {
    const view = projectDailyHealth({
      date: "2026-11-03",
      manual: null,
      metrics: { steps: 3200 },
      records: [
        {
          metricType: "steps",
          value: 3200,
          source: "health_connect",
          updatedAt: "2026-10-25T00:00:00Z",
          confidence: null,
        },
      ],
      now,
    });
    expect(view.steps?.stale).toBe(true);
    expect(view.devicePermissions).toBe("not_reported");
    expect(view.warnings.length).toBeGreaterThan(0);
  });
  it.each(["2026-11-31", "2026-02-29", "2026-13-01", "2026-11-03x", null])(
    "rejects invalid dates %s",
    (v) => expect(() => dailyLifeDate(v)).toThrow(),
  );
  it("validates water amounts and rejects injected ownership", () => {
    expect(
      parseHydrationInput({ amountMl: 250, requestId: "fixture-water-001" }),
    ).toEqual({ amountMl: 250, requestId: "fixture-water-001" });
    for (const amountMl of [0, -1, 1.5, 5001, "250"])
      expect(() =>
        parseHydrationInput({ amountMl, requestId: "fixture-water-001" }),
      ).toThrow();
    expect(() =>
      parseHydrationInput({
        amountMl: 250,
        requestId: "fixture-water-001",
        userId: "foreign",
      }),
    ).toThrow();
  });
  it("requires explicit notification preferences and validates local clocks", () => {
    expect(
      parseDailyLifePreferences(DEFAULT_DAILY_LIFE_PREFERENCES).morningEnabled,
    ).toBe(false);
    expect(() =>
      parseDailyLifePreferences({
        ...DEFAULT_DAILY_LIFE_PREFERENCES,
        morningTime: "24:00",
      }),
    ).toThrow();
    expect(() => parseDailyLifePreferences({ morningEnabled: true })).toThrow();
  });
  it("supports sparse task updates with a required saved revision timestamp", () => {
    expect(
      parseTaskMutation(
        { title: "  Read evidence  ", requestId: "fixture-task-001" },
        false,
      ),
    ).toMatchObject({
      patch: { title: "Read evidence", notes: "", dueAt: null },
    });
    expect(
      parseTaskMutation(
        { status: "done", expectedUpdatedAt: now.toISOString() },
        true,
      ).patch,
    ).toEqual({ status: "done" });
    expect(() => parseTaskMutation({ status: "done" }, true)).toThrow();
    expect(() =>
      parseTaskMutation(
        {
          title: "x",
          dueAt: "2026-11-31T12:00:00Z",
          requestId: "fixture-task-001",
        },
        false,
      ),
    ).toThrow();
  });
  it("separates briefing facts from suggestions and missing data", () => {
    const health = projectDailyHealth({
      date: "2026-11-03",
      manual: null,
      metrics: {},
      records: [],
      now,
    });
    const out = buildDailyBriefings({
      date: "2026-11-03",
      day: null,
      health,
      classes: [],
      deadlines: [],
      tasks: [],
      workouts: [],
      lmsStale: true,
    });
    expect(out.morning.warnings.join(" ")).toContain("AITU");
    expect(out.evening.warnings.join(" ")).toContain("не сохранён");
    expect(out.morning.facts.join(" ")).toContain("Алинур");
    expect(out.morning.facts.join(" ")).toContain("Мафия");
    expect(out.evening.tomorrowOrder).toEqual([]);
  });
  it("documentary suggestions never assert footage exists or is backed up", () => {
    const shots = documentaryPrompts(
      emptyIdealHumanDay("2026-11-03"),
      "2026-11-03",
    );
    expect(shots.some((s) => s.title.includes("Алинур"))).toBe(true);
    expect(shots.every((s) => s.reason)).toBe(true);
  });
  it("roundtrips reviewed meal metadata and actual private footage without claiming verified backups", () => {
    const input = {
      ...emptyIdealHumanDay("2026-11-03"),
      meals: [
        {
          id: "meal-1",
          label: "Measured label",
          caloriesKcal: null,
          proteinG: null,
          estimated: true,
          fatG: 12.5,
          carbsG: null,
          mealTime: "08:30",
          portion: "unknown",
          analysisSource: "manual",
          corrected: true,
        },
      ],
      footage: [
        {
          id: "clip-1",
          label: "Actual diary",
          kind: "a_roll",
          capturedAt: null,
          filename: "",
          location: "",
          notes: "",
          backupStatus: "not_backed_up",
          editingStatus: "not_started",
          storyBeat: "",
        },
      ],
      storyboard: "Draft outline",
    };
    const day = parseIdealHumanDay(input);
    expect(day.meals[0].fatG).toBe(12.5);
    expect(day.footage?.[0].capturedAt).toBeNull();
    expect(() =>
      parseIdealHumanDay({
        ...input,
        footage: [{ ...input.footage[0], backupStatus: "verified" }],
      }),
    ).toThrow();
  });
  it("storyboard planning alone does not manufacture an observation", () => {
    const day = parseIdealHumanDay({
      ...emptyIdealHumanDay("2026-11-03"),
      storyboard: "Draft only",
    });
    expect(hasIdealHumanObservation(day)).toBe(false);
  });
});

describe("Daily Life strict mutation boundaries", () => {
  it.each([
    "2026-11-03T24:00:00Z",
    "2026-11-03T12:61:00Z",
    "2026-11-31T12:00:00Z",
    "2026-11-03T12:00:00",
    "tomorrow",
  ])("rejects invalid or ambiguous task timestamp %s", (dueAt) => {
    expect(() =>
      parseTaskMutation(
        { title: "x", requestId: "task-request-1", dueAt },
        false,
      ),
    ).toThrow();
  });
  it("rejects invalid saved revisions, null status and empty edits", () => {
    expect(() =>
      parseDailyLifePreferences({
        ...DEFAULT_DAILY_LIFE_PREFERENCES,
        revision: 2147483648,
      }),
    ).toThrow();
    expect(() =>
      parseTaskMutation(
        { status: null, expectedUpdatedAt: now.toISOString() },
        true,
      ),
    ).toThrow();
    expect(() =>
      parseTaskMutation({ expectedUpdatedAt: now.toISOString() }, true),
    ).toThrow();
    expect(() =>
      parseTaskMutation({ status: "done", expectedUpdatedAt: "2026" }, true),
    ).toThrow();
  });
  it("shows the confirmed Day1 plan without manufacturing an evening journal", () => {
    const health = projectDailyHealth({
      date: "2026-11-03",
      manual: null,
      metrics: {},
      records: [],
      now,
    });
    const out = buildDailyBriefings({
      date: "2026-11-03",
      day: null,
      health,
      classes: [],
      deadlines: [],
      tasks: [],
      workouts: [],
      lmsStale: true,
    });
    expect(out.morning.facts.join(" ")).toContain("Порядок из твоего плана");
    expect(out.evening.warnings.join(" ")).toContain(
      "Дневник дня пока не сохранён",
    );
  });
});
