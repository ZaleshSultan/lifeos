import { describe, expect, it } from "vitest";
import { parseDurationToMinutes, parseScore, parseTags } from "./parsers.js";

describe("parsers", () => {
  it("parses explicit 1-10 scores", () => {
    expect(parseScore("mood 8/10").value).toBe(8);
    expect(parseScore("energy: 10").value).toBe(10);
  });

  it("rejects missing scores", () => {
    expect(() => parseScore("nothing useful here")).toThrow("Could not parse");
  });

  it("parses duration phrases and clock durations", () => {
    expect(parseDurationToMinutes("1h 30m").minutes).toBe(90);
    expect(parseDurationToMinutes("00:45").minutes).toBe(45);
  });

  it("normalizes tags", () => {
    expect(parseTags("#Sleep recovery, sleep")).toEqual(["sleep", "recovery"]);
  });
});
