import { describe, expect, it } from "vitest";
import { defaultScholarshipConfig } from "../../../packages/core/src/scholarship.js";
import { builtinStudyCalculatorState } from "../../../packages/core/src/study-syllabi.js";
import { bridgeResourceAllowed } from "./bridge-policy";
import { studyMutationBodyError } from "./study-bridge-policy";

const course = "study/courses/00000000-0000-4000-8000-000000000001";
const scholarship = course + "/scholarship";
const syllabus = course + "/syllabus";

describe("web scholarship and syllabus editing", () => {
  it("allows only a PUT on a bounded course resource", () => {
    for (const route of [scholarship, syllabus]) {
      expect(bridgeResourceAllowed(route, "PUT")).toBe(true);
      for (const method of ["GET", "POST", "PATCH", "DELETE"])
        expect(bridgeResourceAllowed(route, method)).toBe(false);
      expect(bridgeResourceAllowed(route + "/more", "PUT")).toBe(false);
      expect(
        bridgeResourceAllowed(
          route.replace("courses/", "courses/group/"),
          "PUT",
        ),
      ).toBe(false);
      expect(
        bridgeResourceAllowed(route.replace("00000000", "no-id"), "PUT"),
      ).toBe(false);
    }
    expect(bridgeResourceAllowed(course + "/calculator", "PUT")).toBe(false);
  });
  it("requires both a valid current scholarship configuration and its expected version", () => {
    const config = defaultScholarshipConfig();
    expect(
      studyMutationBodyError(scholarship, { config, expectedConfig: null }),
    ).toBeNull();
    expect(
      studyMutationBodyError(scholarship, {
        config: { ...config, target: 0 },
        expectedConfig: config,
      }),
    ).toBeNull();
    for (const body of [
      { config },
      { config, expectedConfig: {} },
      { config: { ...config, target: 101 }, expectedConfig: null },
      { config, expectedConfig: null, userId: "another" },
      null,
      [],
    ]) {
      expect(studyMutationBodyError(scholarship, body)).toBe(
        "invalid_scholarship_plan",
      );
    }
  });
  it("accepts a first or concurrent-class syllabus edit with the same definition and score constraints as the owner's calculator", () => {
    const state = builtinStudyCalculatorState("OS52-EN")!;
    const body = { definition: state.definition, expectedState: state };
    expect(
      studyMutationBodyError(syllabus, { ...body, expectedState: null }),
    ).toBeNull();
    expect(
      studyMutationBodyError(syllabus, {
        ...body,
        target: 0,
        values: { assignment_1: 0, assignment_5: null },
      }),
    ).toBeNull();
    for (const invalid of [
      { definition: state.definition },
      { ...body, target: 101 },
      { ...body, values: { outside: 75 } },
      { ...body, values: { assignment_1: 101 } },
      { ...body, expectedState: { ...state, target: null } },
      { ...body, expectedState: { ...state, values: { outside: 10 } } },
      { ...body, definition: { ...state.definition, fields: [] } },
      { ...body, definition: { ...state.definition, other: true } },
      {
        ...body,
        definition: {
          ...state.definition,
          fields: state.definition.fields.map((field) => ({
            ...field,
            other: true,
          })),
        },
      },
      { ...body, owner: "other" },
    ])
      expect(studyMutationBodyError(syllabus, invalid)).toBe(
        "invalid_study_calculator",
      );
  });
});
