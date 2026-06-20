import { describe, expect, it } from "vitest";
import { scoreFocus } from "./focus.js";

describe("scoreFocus", () => {
  it("scores high when energy, mood, sleep, and stress are favorable", () => {
    expect(
      scoreFocus({
        sleepHours: 8,
        energyScore: 9,
        moodScore: 8,
        stressScore: 2,
      }).band,
    ).toBe("high");
  });

  it("penalizes recovery mode and poor sleep", () => {
    const result = scoreFocus({
      sleepHours: 3.5,
      energyScore: 5,
      moodScore: 5,
      stressScore: 8,
    });

    expect(result.band).toBe("low");
    expect(result.reasons).toContain("recovery-mode");
    expect(result.reasons).toContain("low-sleep");
  });

  it("accounts for task load without going below zero", () => {
    expect(
      scoreFocus({
        openTaskCount: 100,
        stressScore: 10,
        healthMode: "recovery",
      }).score,
    ).toBeGreaterThanOrEqual(0);
  });
});
