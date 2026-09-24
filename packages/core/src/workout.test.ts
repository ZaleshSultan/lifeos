import { describe, expect, it } from "vitest";
import {
  parseWorkoutProgram,
  parseWorkoutSet,
  workoutVolumeKg,
} from "./workout.js";

const set = { reps: 8, weightKg: 42.5, restSeconds: 120 };
const program = {
  title: "Моя программа",
  days: [
    {
      id: "day-a",
      title: "Ноги",
      exercises: [{ name: "Приседания", sets: [set] }],
    },
  ],
};

describe("workout programs", () => {
  it("keeps custom days, fractional weights, bodyweight and no rest", () => {
    expect(parseWorkoutProgram(program)).toEqual(program);
    expect(
      parseWorkoutSet({ reps: 1, weightKg: null, restSeconds: 0 }),
    ).toEqual({ reps: 1, weightKg: null, restSeconds: 0 });
    expect(
      parseWorkoutSet({ reps: 1, weightKg: 0, restSeconds: 0 }).weightKg,
    ).toBe(0);
  });

  it.each([
    { ...set, reps: 1.5 },
    { ...set, reps: 0 },
    { ...set, reps: "8" },
    { ...set, weightKg: -2 },
    { ...set, weightKg: NaN },
    { ...set, weightKg: Infinity },
    { ...set, restSeconds: -1 },
    { ...set, restSeconds: 3601 },
  ])("rejects invalid set %j", (value) => {
    expect(() => parseWorkoutSet(value)).toThrow();
  });

  it("rejects duplicate days or exercises before they can merge in persisted sessions", () => {
    expect(() =>
      parseWorkoutProgram({
        ...program,
        days: [program.days[0], program.days[0]],
      }),
    ).toThrow();
    expect(() =>
      parseWorkoutProgram({
        ...program,
        days: [
          {
            ...program.days[0],
            exercises: [
              program.days[0].exercises[0],
              { name: " приседания ", sets: [set] },
            ],
          },
        ],
      }),
    ).toThrow();
  });

  it("bounds nested arrays and removes unsupported fields", () => {
    expect(() => parseWorkoutProgram({ ...program, days: [] })).toThrow();
    expect(() =>
      parseWorkoutProgram({
        ...program,
        days: Array.from({ length: 15 }, (_, i) => ({
          ...program.days[0],
          id: `day-${i}`,
        })),
      }),
    ).toThrow();
    expect(() =>
      parseWorkoutProgram({
        ...program,
        days: [
          {
            ...program.days[0],
            exercises: [{ name: "Squat", sets: Array(21).fill(set) }],
          },
        ],
      }),
    ).toThrow();
    expect(parseWorkoutProgram({ ...program, userId: "other-user" })).toEqual(
      program,
    );
  });

  it("counts only completed weighted sets in progress volume", () => {
    expect(
      workoutVolumeKg([
        { completed: true, targetReps: 8, targetWeightKg: 42.5 },
        { completed: false, targetReps: 100, targetWeightKg: 100 },
        { completed: true, targetReps: 10, targetWeightKg: null },
      ]),
    ).toBe(340);
  });
});
