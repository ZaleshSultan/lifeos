import { describe, expect, it } from "vitest";
import {
  buildDailyPlan,
  summarizeProductivity,
  validatePlanSuggestions,
  type DailyPlanInput,
} from "./planner.js";

const base: DailyPlanInput = {
  date: "2026-10-10",
  timezone: "Asia/Almaty",
  now: "2026-10-10T04:30:00Z",
  mode: "trimester",
  tasks: [],
  events: [],
  dayStartHour: 8,
  dayEndHour: 18,
};

describe("buildDailyPlan", () => {
  it("uses local hours and excludes past time with an explicit clock", () => {
    const plan = buildDailyPlan(base);
    expect(plan.window).toEqual({
      startsAt: "2026-10-10T04:30:00.000Z",
      endsAt: "2026-10-10T13:00:00.000Z",
    });
    expect(plan.availableMinutes).toBe(510);
    expect(buildDailyPlan(base)).toEqual(plan);
  });

  it("does not expose time outside working hours on future or finished days", () => {
    const future = buildDailyPlan({ ...base, now: "2026-10-09T01:00:00Z" });
    expect(future.window.startsAt).toBe("2026-10-10T03:00:00.000Z");
    expect(future.availableMinutes).toBe(600);
    const finished = buildDailyPlan({
      ...base,
      now: "2026-10-11T01:00:00Z",
      tasks: [{ id: "a", title: "A" }],
    });
    expect(finished.window.startsAt).toBe(finished.window.endsAt);
    expect(finished.freeSlots).toEqual([]);
    expect(finished.availableMinutes).toBe(0);
    expect(finished.blocks).toEqual([]);
    expect(finished.unscheduledTaskIds).toEqual(["a"]);
  });

  it("unions overlapping events, includes events crossing midnight, and identifies conflicts", () => {
    const plan = buildDailyPlan({
      ...base,
      events: [
        {
          id: "overnight",
          title: "Overnight",
          startsAt: "2026-10-09T16:00:00Z",
          endsAt: "2026-10-10T05:00:00Z",
        },
        {
          id: "a",
          title: "A",
          startsAt: "2026-10-10T06:00:00Z",
          endsAt: "2026-10-10T08:00:00Z",
        },
        {
          id: "b",
          title: "B",
          startsAt: "2026-10-10T07:00:00Z",
          endsAt: "2026-10-10T09:00:00Z",
        },
        {
          id: "c",
          title: "C",
          startsAt: "2026-10-10T09:00:00Z",
          endsAt: "2026-10-10T10:00:00Z",
        },
        {
          id: "tomorrow",
          title: "Tomorrow",
          startsAt: "2026-10-11T06:00:00Z",
          endsAt: "2026-10-11T08:00:00Z",
        },
      ],
    });
    expect(plan.conflicts).toEqual([{ eventIds: ["a", "b"] }]);
    expect(plan.freeSlots).toEqual([
      {
        startsAt: "2026-10-10T05:00:00.000Z",
        endsAt: "2026-10-10T06:00:00.000Z",
      },
      {
        startsAt: "2026-10-10T10:00:00.000Z",
        endsAt: "2026-10-10T13:00:00.000Z",
      },
    ]);
    expect(plan.availableMinutes).toBe(240);
  });

  it("reports conflicts elsewhere in the same day, including outside work hours", () => {
    const plan = buildDailyPlan({
      ...base,
      events: [
        {
          id: "a",
          title: "A",
          startsAt: "2026-10-09T20:00:00Z",
          endsAt: "2026-10-09T22:00:00Z",
        },
        {
          id: "b",
          title: "B",
          startsAt: "2026-10-09T21:00:00Z",
          endsAt: "2026-10-09T23:00:00Z",
        },
      ],
    });
    expect(plan.conflicts).toEqual([{ eventIds: ["a", "b"] }]);
    expect(plan.availableMinutes).toBe(510);
  });

  it("uses mode priorities and explicit custom weight overrides", () => {
    const tasks = [
      { id: "study", title: "Review", domain: "study" },
      { id: "health", title: "Appointment", domain: "health" },
    ];
    const exam = buildDailyPlan({ ...base, mode: "exam_war", tasks });
    const recovery = buildDailyPlan({ ...base, mode: "recovery", tasks });
    expect(exam.rankedTasks[0].id).toBe("study");
    expect(recovery.rankedTasks[0].id).toBe("health");
    expect(exam.rankedTasks[0].reasons).toContain("Mode exam_war: study +100.");
    const custom = buildDailyPlan({
      ...base,
      mode: "exam_war",
      priorityWeights: { health: 500 },
      tasks,
    });
    expect(custom.rankedTasks[0].id).toBe("health");
  });

  it("prioritizes deadlines and leaves impossible or overdue tasks unscheduled", () => {
    const plan = buildDailyPlan({
      ...base,
      tasks: [
        { id: "normal", title: "Ordinary", estimatedMinutes: 60 },
        {
          id: "urgent",
          title: "Soon",
          estimatedMinutes: 30,
          dueAt: "2026-10-10T05:00:00Z",
        },
        {
          id: "late",
          title: "Overdue",
          estimatedMinutes: 15,
          dueAt: "2026-10-10T04:00:00Z",
        },
        {
          id: "impossible",
          title: "Too large",
          estimatedMinutes: 90,
          dueAt: "2026-10-10T05:00:00Z",
        },
      ],
    });
    expect(plan.rankedTasks[0].id).toBe("late");
    expect(plan.blocks.find((block) => block.taskId === "urgent")?.endsAt).toBe(
      "2026-10-10T05:00:00.000Z",
    );
    expect(plan.unscheduledTaskIds).toEqual(
      expect.arrayContaining(["late", "impossible"]),
    );
    expect(plan.blocks.map((block) => block.taskId)).not.toContain("late");
    expect(validatePlanSuggestions(plan, plan.blocks).valid).toBe(true);
  });

  it("does not split tasks across calendar events or shorten known durations", () => {
    const plan = buildDailyPlan({
      ...base,
      dayEndHour: 12,
      tasks: [
        { id: "large", title: "Large", estimatedMinutes: 120 },
        { id: "small", title: "Small", estimatedMinutes: 30 },
      ],
      events: [
        {
          id: "meeting",
          title: "Meeting",
          startsAt: "2026-10-10T05:00:00Z",
          endsAt: "2026-10-10T06:00:00Z",
        },
      ],
    });
    expect(plan.blocks).toEqual([
      {
        taskId: "small",
        title: "Small",
        startsAt: "2026-10-10T04:30:00.000Z",
        endsAt: "2026-10-10T05:00:00.000Z",
        estimated: false,
      },
    ]);
    expect(plan.unscheduledTaskIds).toEqual(["large"]);
  });

  it("labels unknown duration estimates and rejects invalid recorded durations or deadlines", () => {
    const plan = buildDailyPlan({
      ...base,
      tasks: [
        { id: "unknown", title: "Unknown" },
        { id: "recorded", title: "Recorded", estimatedMinutes: 45 },
        { id: "bad-duration", title: "Bad duration", estimatedMinutes: -3 },
        {
          id: "bad-deadline",
          title: "Bad deadline",
          dueAt: "2026-02-30T09:00:00Z",
        },
      ],
    });
    expect(
      plan.blocks.find((block) => block.taskId === "unknown")?.estimated,
    ).toBe(true);
    expect(
      plan.blocks.find((block) => block.taskId === "recorded")?.estimated,
    ).toBe(false);
    expect(plan.warnings.join(" ")).toContain(
      "provisional 30-minute estimates",
    );
    expect(plan.unscheduledTaskIds).toEqual(
      expect.arrayContaining(["bad-duration", "bad-deadline"]),
    );
  });

  it("interprets date-only deadlines at the end of the user's local date", () => {
    const plan = buildDailyPlan({
      ...base,
      tasks: [
        {
          id: "today",
          title: "Due today",
          dueAt: "2026-10-10",
          estimatedMinutes: 60,
        },
      ],
    });
    expect(plan.blocks).toHaveLength(1);
    expect(validatePlanSuggestions(plan, plan.blocks).valid).toBe(true);
    const nextDay = buildDailyPlan({
      ...base,
      date: "2026-10-11",
      now: "2026-10-11T03:00:00Z",
      tasks: [{ id: "yesterday", title: "Due yesterday", dueAt: "2026-10-10" }],
    });
    expect(nextDay.blocks).toEqual([]);
  });

  it.each([
    ["2026-03-08", 23 * 60],
    ["2026-11-01", 25 * 60],
  ])("honors the actual DST day length on %s", (date, minutes) => {
    const plan = buildDailyPlan({
      ...base,
      date,
      timezone: "America/New_York",
      now: "2026-01-01T00:00:00Z",
      dayStartHour: 0,
      dayEndHour: 24,
    });
    expect(plan.availableMinutes).toBe(minutes);
  });

  it("resolves nonexistent spring hours and both occurrences of autumn hours", () => {
    const gap = buildDailyPlan({
      ...base,
      date: "2026-03-08",
      timezone: "America/New_York",
      now: "2026-01-01T00:00:00Z",
      dayStartHour: 2,
      dayEndHour: 4,
    });
    expect(gap.window.startsAt).toBe("2026-03-08T07:00:00.000Z");
    expect(gap.availableMinutes).toBe(60);
    const fold = buildDailyPlan({
      ...base,
      date: "2026-11-01",
      timezone: "America/New_York",
      now: "2026-01-01T00:00:00Z",
      dayStartHour: 1,
      dayEndHour: 2,
    });
    expect(fold.window.startsAt).toBe("2026-11-01T05:00:00.000Z");
    expect(fold.availableMinutes).toBe(120);
  });

  it("supports non-hour timezone offsets and non-hour DST transitions", () => {
    const kathmandu = buildDailyPlan({
      ...base,
      timezone: "Asia/Kathmandu",
      now: "2026-10-09T00:00:00Z",
    });
    expect(kathmandu.window.startsAt).toBe("2026-10-10T02:15:00.000Z");
    const lordHowe = buildDailyPlan({
      ...base,
      timezone: "Australia/Lord_Howe",
      date: "2026-10-04",
      now: "2026-01-01T00:00:00Z",
      dayStartHour: 0,
      dayEndHour: 24,
    });
    expect(lordHowe.availableMinutes).toBe(23.5 * 60);
  });

  it("rejects invalid dates, timezone-free timestamps, duplicate IDs and invalid calendar intervals", () => {
    expect(() => buildDailyPlan({ ...base, date: "2026-02-30" })).toThrow();
    expect(() =>
      buildDailyPlan({ ...base, now: "2026-10-10T04:30:00" }),
    ).toThrow();
    expect(() =>
      buildDailyPlan({ ...base, timezone: "bad/timezone" }),
    ).toThrow();
    expect(() =>
      buildDailyPlan({ ...base, dayStartHour: 18, dayEndHour: 8 }),
    ).toThrow();
    expect(() =>
      buildDailyPlan({
        ...base,
        tasks: [
          { id: "a", title: "A" },
          { id: "a", title: "B" },
        ],
      }),
    ).toThrow();
    expect(() =>
      buildDailyPlan({
        ...base,
        events: [
          {
            id: "a",
            title: "A",
            startsAt: "2026-10-10T05:00:00Z",
            endsAt: "2026-10-10T04:00:00Z",
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      buildDailyPlan({ ...base, priorityWeights: { study: NaN } }),
    ).toThrow();
    expect(() =>
      buildDailyPlan({
        ...base,
        date: "2011-12-30",
        timezone: "Pacific/Apia",
        now: "2011-01-01T00:00:00Z",
      }),
    ).toThrow();
  });

  it("does not mutate caller-owned tasks, events or priority weights", () => {
    const input = {
      ...base,
      tasks: [{ id: "a", title: "A", estimatedMinutes: 30 }],
      priorityWeights: { study: 40 },
    };
    const original = structuredClone(input);
    buildDailyPlan(input);
    expect(input).toEqual(original);
  });
});

describe("validatePlanSuggestions", () => {
  const plan = () =>
    buildDailyPlan({
      ...base,
      tasks: [
        { id: "a", title: "Actual A", estimatedMinutes: 30 },
        {
          id: "b",
          title: "Actual B",
          estimatedMinutes: 30,
          dueAt: "2026-10-10T06:00:00Z",
        },
      ],
      events: [
        {
          id: "meeting",
          title: "Meeting",
          startsAt: "2026-10-10T07:00:00Z",
          endsAt: "2026-10-10T08:00:00Z",
        },
      ],
    });

  it("accepts valid alternate ordering and derives titles from actual tasks", () => {
    const result = validatePlanSuggestions(plan(), [
      {
        taskId: "a",
        startsAt: "2026-10-10T05:00:00Z",
        endsAt: "2026-10-10T05:30:00Z",
      },
      {
        taskId: "b",
        startsAt: "2026-10-10T04:30:00Z",
        endsAt: "2026-10-10T05:00:00Z",
      },
    ]);
    expect(result.valid).toBe(true);
    expect(result.blocks.map((block) => block.title)).toEqual([
      "Actual B",
      "Actual A",
    ]);
    expect(validatePlanSuggestions(plan(), []).valid).toBe(true);
  });

  it.each([null, {}, "bad", [null], [{}], [["a"]]])(
    "rejects malformed runtime responses: %j",
    (suggestions) => {
      expect(validatePlanSuggestions(plan(), suggestions).valid).toBe(false);
    },
  );

  it.each([
    [
      "unknown",
      [
        {
          taskId: "unknown",
          startsAt: "2026-10-10T05:00:00Z",
          endsAt: "2026-10-10T05:30:00Z",
        },
      ],
    ],
    [
      "duplicate",
      [
        {
          taskId: "a",
          startsAt: "2026-10-10T05:00:00Z",
          endsAt: "2026-10-10T05:30:00Z",
        },
        {
          taskId: "a",
          startsAt: "2026-10-10T05:30:00Z",
          endsAt: "2026-10-10T06:00:00Z",
        },
      ],
    ],
    [
      "overlap",
      [
        {
          taskId: "a",
          startsAt: "2026-10-10T05:00:00Z",
          endsAt: "2026-10-10T05:30:00Z",
        },
        {
          taskId: "b",
          startsAt: "2026-10-10T05:15:00Z",
          endsAt: "2026-10-10T05:45:00Z",
        },
      ],
    ],
    [
      "calendar",
      [
        {
          taskId: "a",
          startsAt: "2026-10-10T07:00:00Z",
          endsAt: "2026-10-10T07:30:00Z",
        },
      ],
    ],
    [
      "past",
      [
        {
          taskId: "a",
          startsAt: "2026-10-10T04:00:00Z",
          endsAt: "2026-10-10T04:30:00Z",
        },
      ],
    ],
    [
      "after window",
      [
        {
          taskId: "a",
          startsAt: "2026-10-10T13:00:00Z",
          endsAt: "2026-10-10T13:30:00Z",
        },
      ],
    ],
    [
      "duration",
      [
        {
          taskId: "a",
          startsAt: "2026-10-10T05:00:00Z",
          endsAt: "2026-10-10T05:15:00Z",
        },
      ],
    ],
    [
      "deadline",
      [
        {
          taskId: "b",
          startsAt: "2026-10-10T06:00:00Z",
          endsAt: "2026-10-10T06:30:00Z",
        },
      ],
    ],
    [
      "invalid date",
      [{ taskId: "a", startsAt: "invalid", endsAt: "2026-10-10T05:30:00Z" }],
    ],
    [
      "timezone missing",
      [
        {
          taskId: "a",
          startsAt: "2026-10-10T05:00:00",
          endsAt: "2026-10-10T05:30:00",
        },
      ],
    ],
    [
      "inverted interval",
      [
        {
          taskId: "a",
          startsAt: "2026-10-10T05:30:00Z",
          endsAt: "2026-10-10T05:00:00Z",
        },
      ],
    ],
  ])(
    "rejects %s suggestions without returning partial blocks",
    (_name, suggestions) => {
      const result = validatePlanSuggestions(plan(), suggestions);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.blocks).toEqual([]);
    },
  );
});

describe("summarizeProductivity", () => {
  it("counts actual creation and completion dates in the user's timezone", () => {
    const summary = summarizeProductivity({
      startDate: "2026-10-09",
      endDate: "2026-10-10",
      timezone: "Asia/Almaty",
      tasks: [
        {
          createdAt: "2026-10-08T20:00:00Z",
          completedAt: "2026-10-09T20:00:00Z",
        },
        { createdAt: "2026-10-09T08:00:00Z", completedAt: null },
        {
          createdAt: "2026-10-01T08:00:00Z",
          completedAt: "2026-10-09T10:00:00Z",
        },
        {
          createdAt: "2026-10-10T08:00:00Z",
          completedAt: "2026-10-12T08:00:00Z",
        },
      ],
    });
    expect(summary.daily).toEqual([
      { date: "2026-10-09", created: 2, completed: 1 },
      { date: "2026-10-10", created: 1, completed: 1 },
    ]);
    expect(summary.totalCreated).toBe(3);
    expect(summary.totalCompleted).toBe(2);
    expect(summary.completionRate).toBe(1 / 3);
  });

  it("does not invent completions or ratios when history is empty or incomplete", () => {
    const empty = summarizeProductivity({
      startDate: "2026-10-01",
      endDate: "2026-10-07",
      timezone: "UTC",
      tasks: [],
    });
    expect(empty.daily).toHaveLength(7);
    expect(empty.totalCompleted).toBe(0);
    expect(empty.completionRate).toBeNull();
    expect(empty.warnings).toHaveLength(1);
    const partial = summarizeProductivity({
      startDate: "2026-10-01",
      endDate: "2026-10-07",
      timezone: "UTC",
      truncated: true,
      tasks: [
        {
          createdAt: "2026-10-01T00:00:00Z",
          completedAt: "2026-10-02T00:00:00Z",
        },
      ],
    });
    expect(partial.totalCompleted).toBe(1);
    expect(partial.completionRate).toBeNull();
    expect(partial.truncated).toBe(true);
    expect(partial.warnings.join(" ")).toContain("incomplete");
  });

  it("excludes unknown and impossible timestamps while retaining known completions", () => {
    const summary = summarizeProductivity({
      startDate: "2026-10-01",
      endDate: "2026-10-07",
      timezone: "UTC",
      tasks: [
        { createdAt: "invalid", completedAt: "2026-10-02T00:00:00Z" },
        {
          createdAt: "2026-10-02T00:00:00Z",
          completedAt: "2026-10-01T00:00:00Z",
        },
        { createdAt: "2026-10-02T00:00:00Z", completedAt: "invalid" },
      ],
    });
    expect(summary.totalCreated).toBe(2);
    expect(summary.totalCompleted).toBe(1);
    expect(summary.completionRate).toBeNull();
    expect(summary.warnings.join(" ")).toContain("3 task record(s)");
  });

  it("validates date ranges and timezone", () => {
    expect(() =>
      summarizeProductivity({
        startDate: "2026-02-30",
        endDate: "2026-03-01",
        timezone: "UTC",
        tasks: [],
      }),
    ).toThrow();
    expect(() =>
      summarizeProductivity({
        startDate: "2026-10-10",
        endDate: "2026-10-01",
        timezone: "UTC",
        tasks: [],
      }),
    ).toThrow();
    expect(() =>
      summarizeProductivity({
        startDate: "2020-01-01",
        endDate: "2026-10-01",
        timezone: "UTC",
        tasks: [],
      }),
    ).toThrow();
    expect(() =>
      summarizeProductivity({
        startDate: "2026-10-01",
        endDate: "2026-10-07",
        timezone: "invalid",
        tasks: [],
      }),
    ).toThrow();
  });
});
