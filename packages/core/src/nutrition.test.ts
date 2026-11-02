import { describe, expect, it } from "vitest";
import { mergeReviewedMeals } from "./nutrition.js";
import type { IdealHumanMeal } from "./ideal-human.js";

const meal = (id: string, caloriesKcal: number): IdealHumanMeal => ({
  id,
  label: "Recorded meal",
  caloriesKcal,
  proteinG: null,
  estimated: true,
});

describe("explicitly reviewed meal retries", () => {
  it("keeps corrections after a committed response was lost without duplicating draft items", () => {
    const recorded = meal("photo-stable-id", 500);
    const corrected = { ...recorded, caloriesKcal: 650, corrected: true };
    const result = mergeReviewedMeals([recorded], [corrected]);
    expect(result).toEqual([corrected]);
    expect(mergeReviewedMeals(result, [corrected])).toEqual(result);
    expect(recorded.caloriesKcal).toBe(500);
  });
  it("preserves unrelated concurrent entries and appends new reviewed IDs exactly once", () => {
    const original = meal("manual-existing", 100);
    const concurrent = meal("concurrent-entry", 200);
    const reviewed = meal("photo-new", 300);
    expect(
      mergeReviewedMeals([original, concurrent], [reviewed, reviewed]),
    ).toEqual([original, concurrent, reviewed]);
  });
});
