import { describe, expect, it } from "vitest";
import { resolveHealthMode } from "./health.js";

describe("resolveHealthMode", () => {
  it("enters recovery for severe strain", () => {
    expect(resolveHealthMode({ sleepHours: 3.5, stressScore: 5 })).toBe(
      "recovery",
    );
    expect(resolveHealthMode({ symptomSeverities: [8] })).toBe("recovery");
  });

  it("uses maintenance for moderate health debt", () => {
    expect(resolveHealthMode({ sleepHours: 5.5, energyScore: 5 })).toBe(
      "maintenance",
    );
    expect(resolveHealthMode({ stressScore: 7 })).toBe("maintenance");
  });

  it("uses growth for strong health signals", () => {
    expect(
      resolveHealthMode({
        sleepHours: 8,
        energyScore: 8,
        moodScore: 8,
        stressScore: 3,
      }),
    ).toBe("growth");
  });

  it("falls back to baseline for mixed signals", () => {
    expect(
      resolveHealthMode({
        sleepHours: 6.5,
        energyScore: 6,
        moodScore: 6,
        stressScore: 5,
      }),
    ).toBe("baseline");
  });
});
