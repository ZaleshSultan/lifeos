import { describe, expect, it } from "vitest";
import { validateStudyCalculatorDefinition } from "./study.js";
import {
  builtinStudyCalculatorState,
  builtinStudySyllabusCourseCodes,
} from "./study-syllabi.js";

describe("built-in study syllabi", () => {
  it("contains valid calculator definitions for all five current courses", () => {
    expect(builtinStudySyllabusCourseCodes()).toHaveLength(5);
    for (const code of builtinStudySyllabusCourseCodes()) {
      const state = builtinStudyCalculatorState(code);
      expect(state).not.toBeNull();
      expect(validateStudyCalculatorDefinition(state!.definition)).toBe(true);
      expect(state!.target).toBe(70);
    }
  });

  it("does not invent a syllabus for an unknown course", () => {
    expect(builtinStudyCalculatorState("UNKNOWN-101")).toBeNull();
  });
});
