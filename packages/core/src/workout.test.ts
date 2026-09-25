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

  it("keeps legacy exercises unchanged and accepts an optional GIF URL or null", () => {
    expect(parseWorkoutProgram(program)).toEqual(program);
    const exercise = program.days[0].exercises[0];
    const withGif = {
      ...program,
      days: [
        {
          ...program.days[0],
          exercises: [
            { ...exercise, gifUrl: " https://example.com/squat.gif " },
          ],
        },
      ],
    };
    expect(parseWorkoutProgram(withGif).days[0].exercises[0].gifUrl).toBe(
      "https://example.com/squat.gif",
    );
    const withoutGif = {
      ...withGif,
      days: [
        { ...withGif.days[0], exercises: [{ ...exercise, gifUrl: null }] },
      ],
    };
    expect(
      parseWorkoutProgram(withoutGif).days[0].exercises[0].gifUrl,
    ).toBeNull();
  });

  it.each([
    "",
    "./squat.gif",
    "javascript:alert(1)",
    "data:image/gif;base64,AA==",
    "https://exam\nple.com/squat.gif",
    "https://user:secret@example.com/squat.gif",
    `https://example.com/${"x".repeat(2049)}`,
    123,
  ])("rejects invalid GIF URL %j", (gifUrl) => {
    expect(() =>
      parseWorkoutProgram({
        ...program,
        days: [
          {
            ...program.days[0],
            exercises: [{ ...program.days[0].exercises[0], gifUrl }],
          },
        ],
      }),
    ).toThrow();
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
