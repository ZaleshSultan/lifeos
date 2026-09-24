import { describe, expect, it } from "vitest";
import type { WorkoutHistorySession } from "../api/workout";
import {
  exerciseProgress,
  parseSetDraft,
  restSecondsRemaining,
} from "./workout";

describe("workout recording", () => {
  it("keeps no recorded weight distinct from zero and accepts a decimal comma", () => {
    expect(
      parseSetDraft({ reps: "8", weightKg: "", restSeconds: "0" }),
    ).toEqual({ reps: 8, weightKg: null, restSeconds: 0 });
    expect(
      parseSetDraft({ reps: "8", weightKg: "0", restSeconds: "90" }).weightKg,
    ).toBe(0);
    expect(
      parseSetDraft({ reps: "8", weightKg: "12,5", restSeconds: "90" })
        .weightKg,
    ).toBe(12.5);
  });

  it("rejects blanks, fractions in reps and negative rest", () => {
    for (const update of [
      { reps: "" },
      { reps: "1.5" },
      { restSeconds: "-1" },
      { weightKg: "Infinity" },
    ]) {
      expect(() =>
        parseSetDraft({
          reps: "8",
          weightKg: "20",
          restSeconds: "90",
          ...update,
        }),
      ).toThrow();
    }
  });
});

describe("rest timer", () => {
  it("expires according to wall time after Telegram resumes", () => {
    const start = Date.parse("2026-09-24T10:00:00Z");
    const deadline = "2026-09-24T10:01:30Z";
    expect(restSecondsRemaining(deadline, start)).toBe(90);
    expect(restSecondsRemaining(deadline, start + 60_000)).toBe(30);
    expect(restSecondsRemaining(deadline, start + 180_000)).toBe(0);
    expect(restSecondsRemaining(null, start)).toBe(0);
    expect(restSecondsRemaining("invalid", start)).toBe(0);
  });
});

describe("exercise history", () => {
  it("counts performed sets only, preserves unknown weights and orders by time", () => {
    const session = (
      id: string,
      date: string,
      weights: (number | null)[],
    ): WorkoutHistorySession => ({
      id,
      title: "День A",
      startedAt: date,
      endedAt: date,
      mode: "completed",
      volumeKg: 0,
      progressPercent: 100,
      completedSets: 2,
      totalSets: 3,
      exercises: [
        {
          id: "row",
          name: "Тяга",
          sets: weights.map((weight, index) => ({
            id: `${id}-${index}`,
            index: index + 1,
            targetReps: 8,
            targetWeightKg: weight,
            completed: index < 2,
            completedAt: date,
            restSeconds: 90,
          })),
        },
      ],
    });
    const points = exerciseProgress(
      [
        session("old", "2026-09-20T10:00:00Z", [null, null, 500]),
        session("new", "2026-09-24T10:00:00Z", [10, 12.5, 500]),
      ],
      " тяга ",
    );
    expect(points).toMatchObject([
      {
        workoutId: "new",
        completedSets: 2,
        reps: 16,
        maxWeightKg: 12.5,
        volumeKg: 180,
      },
      {
        workoutId: "old",
        completedSets: 2,
        reps: 16,
        maxWeightKg: null,
        volumeKg: 0,
      },
    ]);
    expect(exerciseProgress([], "Тяга")).toEqual([]);
  });
});
