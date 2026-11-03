import {
  emptyIdealHumanDay,
  type IdealHumanDay,
  type WorkoutProgram,
} from "@lifeos/core";
import type {
  CurrentWorkoutSummary,
  HealthMetricDaySummary,
  HealthMetricRecord,
  LifeOSStore,
  TelegramUserRecord,
} from "@lifeos/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureSavedFacts } from "./capture-context.js";

const OWNER = "20000000-0000-4000-8000-000000000001";
const DATE = "2026-11-03";
const NOW = new Date("2026-11-03T17:00:00.000Z");
const user: TelegramUserRecord = {
  userId: OWNER,
  telegramUserId: 12345,
  displayName: "Synthetic context owner",
  username: null,
  timezone: "Asia/Almaty",
  status: "active",
  role: "user",
};

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(
    new Error("External requests are forbidden in saved context tests"),
  );
});
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

function emptyHealth(): HealthMetricDaySummary {
  return {
    date: DATE,
    metrics: {},
    sources: [],
    sourceLabel: null,
    latestSource: null,
    missingMetrics: {},
    records: [],
  };
}
function record(
  metricType: HealthMetricRecord["metricType"],
  value: number,
  updatedAt = NOW.toISOString(),
): HealthMetricRecord {
  return {
    id: "30000000-0000-4000-8000-000000000001",
    userId: OWNER,
    metricDate: DATE,
    metricType,
    value,
    unit: metricType === "steps" ? "steps" : "minutes",
    source: "xiaomi_health_connect",
    confidence: null,
    rawJson: { privatePayload: "never expose raw health data" },
    createdAt: updatedAt,
    updatedAt,
  };
}
function program(): WorkoutProgram {
  return {
    title: "Saved strength program",
    days: [
      { id: "day-a", title: "Upper body", exercises: [] },
      { id: "day-b", title: "Lower body", exercises: [] },
    ],
  };
}
function activeWorkout(): CurrentWorkoutSummary {
  return {
    id: "40000000-0000-4000-8000-000000000001",
    title: "Actual active strength session",
    mode: "strength",
    startedAt: "2026-11-03T16:45:00.000Z",
    progressPercent: 25,
    completedSets: 2,
    totalSets: 8,
    restTimerEndsAt: null,
    exercises: [],
  };
}
function fixture() {
  const ports = {
    getIdealHumanDays: vi.fn<NonNullable<LifeOSStore["getIdealHumanDays"]>>(
      async () => [],
    ),
    getHealthMetricDay: vi.fn<LifeOSStore["getHealthMetricDay"]>(async () =>
      emptyHealth(),
    ),
    getWorkoutProgram: vi.fn<LifeOSStore["getWorkoutProgram"]>(
      async () => null,
    ),
    getCurrentWorkout: vi.fn<LifeOSStore["getCurrentWorkout"]>(
      async () => null,
    ),
  };
  const mutation = vi.fn();
  const store = {
    ...ports,
    createTask: mutation,
    createLifeEntity: mutation,
    updateWorkoutSet: mutation,
    saveIdealHumanDay: mutation,
  } as unknown as LifeOSStore;
  return {
    store,
    ports,
    mutation,
    read: (date = DATE) => captureSavedFacts(store, user, date, NOW),
  };
}

describe("capture saved context uses recorded facts without inference", () => {
  it("keeps manual journal sleep authoritative over a conflicting imported measurement", async () => {
    const f = fixture();
    const day = { ...emptyIdealHumanDay(DATE), sleepMinutes: 450 };
    const health = {
      ...emptyHealth(),
      metrics: { sleep_minutes: 410 },
      records: [record("sleep_minutes", 410)],
    };
    f.ports.getIdealHumanDays.mockResolvedValue([day]);
    f.ports.getHealthMetricDay.mockResolvedValue(health);
    const before = structuredClone({ day, health });
    const result = await f.read();
    expect(result.facts).toContain("Sleep: 450 minutes (manual_journal).");
    expect(result.facts.join(" ")).not.toContain("410");
    expect(result.warnings.join(" ")).not.toMatch(/stale/i);
    expect({ day, health }).toEqual(before);
    expect(f.mutation).not.toHaveBeenCalled();
  });

  it("keeps absent health values and an unsaved journal unknown rather than inventing zeroes or template commitments", async () => {
    const f = fixture();
    const result = await f.read();
    expect(result.facts).toContain(
      "No saved Ideal Human day is available for this date; template activities are not treated as commitments.",
    );
    expect(result.facts).toContain(
      "Missing recorded health fields: sleepMinutes, weightKg, steps, workoutMinutes. No values inferred.",
    );
    expect(
      result.facts.some((fact) =>
        /^(Sleep|Steps|Workout activity|Saved journal items|Active workout):/.test(
          fact,
        ),
      ),
    ).toBe(false);
    expect(result.warnings).toEqual([]);
    expect(f.mutation).not.toHaveBeenCalled();
  });

  it("preserves explicitly recorded zero steps and workout minutes", async () => {
    const f = fixture();
    f.ports.getHealthMetricDay.mockResolvedValue({
      ...emptyHealth(),
      metrics: { steps: 0, workout_minutes: 0 },
      records: [record("steps", 0), record("workout_minutes", 0)],
    });
    const result = await f.read();
    expect(result.facts).toContain("Steps: 0 steps (xiaomi_health_connect).");
    expect(result.facts).toContain(
      "Workout activity: 0 minutes (xiaomi_health_connect).",
    );
    expect(result.facts).toContain(
      "Missing recorded health fields: sleepMinutes, weightKg. No values inferred.",
    );
  });

  it("labels stale imported values and omits raw health payloads and record identities", async () => {
    const f = fixture();
    f.ports.getHealthMetricDay.mockResolvedValue({
      ...emptyHealth(),
      metrics: { sleep_minutes: 415, steps: 3200 },
      records: [
        record("sleep_minutes", 415, "2026-10-25T00:00:00Z"),
        record("steps", 3200, "2026-10-25T00:00:00Z"),
      ],
    });
    const result = await f.read();
    expect(result.facts).toContain(
      "Sleep: 415 minutes (xiaomi_health_connect, stale).",
    );
    expect(result.facts).toContain(
      "Steps: 3200 steps (xiaomi_health_connect, stale).",
    );
    expect(result.warnings).toContain(
      "Recorded source measurements are stale; manual entries remain authoritative.",
    );
    for (const privateValue of [
      OWNER,
      "30000000-0000-4000-8000-000000000001",
      "privatePayload",
      "never expose raw health data",
    ])
      expect(JSON.stringify(result)).not.toContain(privateValue);
  });

  it("treats an aggregate without matching source metadata as stale recorded data", async () => {
    const f = fixture();
    f.ports.getHealthMetricDay.mockResolvedValue({
      ...emptyHealth(),
      metrics: { workout_minutes: 30 },
    });
    const result = await f.read();
    expect(result.facts).toContain(
      "Workout activity: 30 minutes (recorded_health, stale).",
    );
    expect(result.warnings.join(" ")).toMatch(/stale/);
    expect(result.facts.join(" ")).not.toMatch(
      /Health Connect|permission granted|completed workout/i,
    );
  });

  it("uses only the requested saved date and makes no health assumptions for a future date", async () => {
    const f = fixture();
    f.ports.getIdealHumanDays.mockResolvedValue([
      {
        ...emptyIdealHumanDay(DATE),
        workoutNotes: "Another date's private note",
        sleepMinutes: 440,
      },
    ]);
    const result = await f.read("2026-11-04");
    expect(result.facts.join(" ")).not.toContain("Another date's private note");
    expect(result.facts.join(" ")).not.toContain("440");
    expect(result.facts).toContain(
      "No saved Ideal Human day is available for this date; template activities are not treated as commitments.",
    );
    expect(result.warnings).toContain(
      "Future date: no health measurement is inferred.",
    );
    expect(f.ports.getHealthMetricDay).toHaveBeenCalledExactlyOnceWith(
      OWNER,
      "2026-11-04",
    );
  });

  it("distinguishes plan items not marked complete from finished tasks and mixed learning observations", async () => {
    const f = fixture();
    const day: IdealHumanDay = {
      ...emptyIdealHumanDay(DATE),
      plan: [
        {
          id: "plan-1",
          title: "Saved plan",
          notes: "",
          kind: "flexible",
          time: null,
          tasks: [
            {
              id: "unknown",
              title: "Unknown completion task",
              completed: null,
            },
            {
              id: "unfinished",
              title: "Explicit unfinished task",
              completed: false,
            },
            { id: "finished", title: "Finished task", completed: true },
          ],
        },
      ],
      learningSessions: [
        {
          id: "learning-1",
          category: "programming",
          topic: "Observed learning",
          minutes: 20,
          resource: "",
          notes: "",
          completed: true,
        },
        {
          id: "learning-2",
          category: "science",
          topic: "Unconfirmed study",
          minutes: null,
          resource: "",
          notes: "",
          completed: null,
        },
      ],
    };
    f.ports.getIdealHumanDays.mockResolvedValue([day]);
    const before = structuredClone(day);
    const result = await f.read();
    const plan = result.facts.find((fact) => fact.startsWith("Saved journal"));
    expect(plan).toContain("not marked complete");
    expect(plan).toContain("Unknown completion task");
    expect(plan).toContain("Explicit unfinished task");
    expect(plan).not.toContain("Finished task");
    expect(result.facts).toContain(
      "Saved learning entries: 2; completion is recorded per entry.",
    );
    expect(result.facts.join(" ")).not.toMatch(
      /2 (completed|finished) learning|all.*completed/i,
    );
    expect(day).toEqual(before);
  });

  it("does not turn a storyboard or workout note into filmed footage or a completed workout", async () => {
    const f = fixture();
    const day = {
      ...emptyIdealHumanDay(DATE),
      storyboard: "A documentary idea for later",
      workoutNotes: "A note about possible recovery",
      training: null,
    };
    f.ports.getIdealHumanDays.mockResolvedValue([day]);
    const result = await f.read();
    expect(result.facts).toContain(
      "Recorded workout note: A note about possible recovery",
    );
    expect(result.facts.join(" ")).not.toMatch(
      /Footage recorded as captured|Active workout:|Workout activity:|filming.*complet|workout.*complet/i,
    );
    expect(day.footageCaptured).toBeNull();
    expect(day.training).toBeNull();
    expect(f.mutation).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "reports only an explicit footageCaptured=%s observation",
    async (footageCaptured) => {
      const f = fixture();
      f.ports.getIdealHumanDays.mockResolvedValue([
        { ...emptyIdealHumanDay(DATE), footageCaptured },
      ]);
      const result = await f.read();
      expect(result.facts).toContain(
        "Footage recorded as captured: " + (footageCaptured ? "yes" : "no"),
      );
      expect(result.facts.join(" ")).not.toMatch(
        /film.*complete|documentary.*done|backed up/i,
      );
    },
  );

  it("keeps a workout program unscheduled and an active session's set progress partial", async () => {
    const f = fixture();
    const savedProgram = program(),
      workout = activeWorkout();
    const before = structuredClone({ savedProgram, workout });
    f.ports.getWorkoutProgram.mockResolvedValue(savedProgram);
    f.ports.getCurrentWorkout.mockResolvedValue(workout);
    const result = await f.read();
    expect(result.facts).toContain(
      "Saved workout program: Saved strength program. Available sessions: Upper body; Lower body. No session time or completion assumed.",
    );
    expect(result.facts).toContain(
      "Active workout: Actual active strength session; 2/8 sets recorded. It has not been marked complete by capture.",
    );
    expect(result.facts.join(" ")).not.toContain("16:45");
    expect({ savedProgram, workout }).toEqual(before);
    expect(f.mutation).not.toHaveBeenCalled();
  });
});

describe("capture saved context owner scope and unavailable reads", () => {
  it("forwards the authenticated owner to every read port and performs no mutation", async () => {
    const f = fixture();
    await f.read();
    expect(f.ports.getIdealHumanDays).toHaveBeenCalledExactlyOnceWith(OWNER);
    expect(f.ports.getHealthMetricDay).toHaveBeenCalledExactlyOnceWith(
      OWNER,
      DATE,
    );
    expect(f.ports.getWorkoutProgram).toHaveBeenCalledExactlyOnceWith(OWNER);
    expect(f.ports.getCurrentWorkout).toHaveBeenCalledExactlyOnceWith({
      userId: OWNER,
    });
    expect(f.mutation).not.toHaveBeenCalled();
  });

  it.each(["rejected", "synchronous"])(
    "settles %s port failures independently and returns only safe warnings",
    async (failure) => {
      const f = fixture();
      const diagnostic = new Error(
        "private provider/database error and credential-like diagnostic",
      );
      if (failure === "rejected") {
        f.ports.getIdealHumanDays.mockRejectedValue(diagnostic);
        f.ports.getHealthMetricDay.mockRejectedValue(diagnostic);
        f.ports.getWorkoutProgram.mockRejectedValue(diagnostic);
        f.ports.getCurrentWorkout.mockRejectedValue(diagnostic);
      } else {
        const fail = () => {
          throw diagnostic;
        };
        f.ports.getIdealHumanDays.mockImplementation(fail);
        f.ports.getHealthMetricDay.mockImplementation(fail);
        f.ports.getWorkoutProgram.mockImplementation(fail);
        f.ports.getCurrentWorkout.mockImplementation(fail);
      }
      const result = await f.read();
      expect(result.warnings).toEqual([
        "Saved Ideal Human activity is unavailable.",
        "Recorded health is unavailable; no health assumptions were made.",
        "Saved workout program is unavailable.",
        "Active workout status is unavailable.",
      ]);
      expect(result.facts).toContain(
        "No saved Ideal Human day is available for this date; template activities are not treated as commitments.",
      );
      expect(
        result.facts.some((fact) =>
          /^(Sleep|Steps|Workout activity|Active workout):/.test(fact),
        ),
      ).toBe(false);
      expect(JSON.stringify(result)).not.toMatch(
        /credential-like|provider\/database|private provider/,
      );
      for (const port of Object.values(f.ports))
        expect(port).toHaveBeenCalledTimes(1);
      expect(f.mutation).not.toHaveBeenCalled();
    },
  );

  it("retains available health and program facts when independent reads fail", async () => {
    const f = fixture();
    f.ports.getIdealHumanDays.mockRejectedValue(
      new Error("private journal diagnostic"),
    );
    f.ports.getCurrentWorkout.mockRejectedValue(
      new Error("private workout diagnostic"),
    );
    f.ports.getHealthMetricDay.mockResolvedValue({
      ...emptyHealth(),
      metrics: { steps: 1230 },
      records: [record("steps", 1230)],
    });
    f.ports.getWorkoutProgram.mockResolvedValue(program());
    const result = await f.read();
    expect(result.facts).toContain(
      "Steps: 1230 steps (xiaomi_health_connect).",
    );
    expect(
      result.facts.some((fact) => fact.startsWith("Saved workout program:")),
    ).toBe(true);
    expect(result.warnings).toEqual([
      "Saved Ideal Human activity is unavailable.",
      "Active workout status is unavailable.",
    ]);
    expect(JSON.stringify(result)).not.toMatch(
      /private journal|private workout/,
    );
  });

  it("retains an actual manual sleep observation when the automatic health reader fails", async () => {
    const f = fixture();
    f.ports.getIdealHumanDays.mockResolvedValue([
      { ...emptyIdealHumanDay(DATE), sleepMinutes: 470 },
    ]);
    f.ports.getHealthMetricDay.mockRejectedValue(
      new Error("private automatic health diagnostic"),
    );
    const result = await f.read();
    expect(result.facts).toContain("Sleep: 470 minutes (manual_journal).");
    expect(result.warnings).toContain(
      "Recorded health is unavailable; no health assumptions were made.",
    );
    expect(result.facts.some((fact) => fact.startsWith("Steps:"))).toBe(false);
    expect(JSON.stringify(result)).not.toContain("private automatic health");
  });

  it("supports a store without the optional journal reader without inventing a template day", async () => {
    const f = fixture();
    const store = { ...f.store, getIdealHumanDays: undefined } as LifeOSStore;
    const result = await captureSavedFacts(store, user, DATE, NOW);
    expect(result.facts).toContain(
      "No saved Ideal Human day is available for this date; template activities are not treated as commitments.",
    );
    expect(result.warnings).toEqual([]);
    expect(f.ports.getIdealHumanDays).not.toHaveBeenCalled();
  });
});
