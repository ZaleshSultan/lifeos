import { describe, expect, it } from "vitest";
import {
  emptyIdealHumanDay, idealHumanDate, idealHumanDayNumber,
  idealHumanStats, parseIdealHumanDay,
} from "./ideal-human.js";

describe("Ideal Human date and privacy-safe input", () => {
  it("uses November 3 through December 2, inclusive", () => {
    expect(idealHumanDayNumber("2026-11-03")).toBe(1);
    expect(idealHumanDayNumber("2026-12-02")).toBe(30);
    expect(idealHumanDate(30)).toBe("2026-12-02");
    expect(idealHumanDayNumber("2026-11-02")).toBeNull();
    expect(idealHumanDayNumber("2026-12-03")).toBeNull();
    expect(idealHumanDayNumber("2026-11-31")).toBeNull();
  });
  it("does not confuse zero with missing and never fabricates measurements", () => {
    const value = parseIdealHumanDay({date:"2026-11-03", scienceMinutes:0, sleepMinutes:null});
    expect(value.scienceMinutes).toBe(0);
    expect(value.sleepMinutes).toBeNull();
    expect(idealHumanStats([value]).avgWeightKg).toBeNull();
    expect(emptyIdealHumanDay("2026-11-03").training).toBeNull();
  });
  it("rejects invalid values and extra fields", () => {
    expect(() => parseIdealHumanDay({date:"2026-11-03", weightKg:"52"})).toThrow();
    expect(() => parseIdealHumanDay({date:"2026-11-03", notes:"x".repeat(2001)})).toThrow();
    expect(() => parseIdealHumanDay({date:"2026-11-03", userId:"other"})).toThrow();
    expect(() => parseIdealHumanDay({date:"2026-11-03", energy:7})).toThrow();
  });
});
