import { describe, expect, it } from "vitest";
import {
  countedTotals,
  comparableLift,
  fullBodyTemplate,
  parsePersonalTemplate,
  parseDraftCommand,
} from "./personal-workout.js";

const planned = () =>
  fullBodyTemplate().map((load) => ({
    load,
    sets: load.sets.map((s) => ({
      targetReps: s.reps,
      targetWeightKg: s.weightKg,
      completed: false,
    })),
  }));
describe("personal Full Body", () => {
  it("creates only a plan and verifies the six performed subtotals", () => {
    const exercises = planned();
    expect(countedTotals(exercises)).toEqual({ sets: 0, reps: 0, volumeKg: 0 });
    for (const ex of exercises) for (const set of ex.sets) set.completed = true;
    expect(exercises.map((e) => countedTotals([e]).volumeKg)).toEqual([
      1750, 360, 432, 1300, 3240, 288,
    ]);
    expect(countedTotals(exercises)).toEqual({
      sets: 16,
      reps: 204,
      volumeKg: 7370,
    });
  });
  it("counts a pair once and ignores all unconfirmed changes", () => {
    const exercises = planned();
    exercises[2].sets[0].completed = true;
    exercises[2].sets[1].targetWeightKg = 10;
    expect(countedTotals(exercises)).toEqual({
      sets: 1,
      reps: 12,
      volumeKg: 216,
    });
    expect(
      countedTotals([
        { sets: [{ targetReps: 12, targetWeightKg: 18, completed: true }] },
      ]).volumeKg,
    ).toBe(216);
  });
  it("preserves unknown vs zero, fractional steps, slot identity and equipment variants", () => {
    const exercises = fullBodyTemplate();
    const ex = exercises[0];
    expect(comparableLift(ex)).not.toBe(comparableLift({ ...ex, baseKg: 0 }));
    expect(comparableLift(ex)).not.toBe(
      comparableLift({ ...ex, variant: "Зал 2" }),
    );
    ex.step = 0.25;
    ex.sets[0].warmup = true;
    expect(parsePersonalTemplate({ revision: 1, exercises })).toEqual({
      revision: 1,
      exercises,
    });
    ex.sets[1].slot = ex.sets[0].slot;
    expect(() => parsePersonalTemplate({ revision: 1, exercises })).toThrow();
    expect(() =>
      parseDraftCommand({ kind: "set", revision: 0, reps: 1.5 }),
    ).toThrow();
  });
});
