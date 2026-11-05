import { describe, expect, it } from "vitest";
import {
  calculateCourseGradeTarget,
  gradeTargetBindingsKey,
  gradeTargetContextKey,
  gradeTargetDefinitionKey,
  type CourseGradeTargetInput,
  type GradePolicyReview,
} from "./grade-target.js";

function input(): CourseGradeTargetInput {
  return {
    courseId: "owned-course",
    externalCourseKey: "moodle:42",
    now: "2026-11-06T10:00:00Z",
    calculator: {
      definition: {
        version: 1,
        sourceName: "Reviewed syllabus p2",
        attestationThreshold: 25,
        fields: [
          { id: "a", label: "ATT1", period: "att1", weightPercent: 100 },
          { id: "b", label: "ATT2", period: "att2", weightPercent: 100 },
          { id: "exam", label: "Exam", period: "exam", weightPercent: 100 },
        ],
      },
      values: { a: 100, b: 100, exam: 100 },
      target: 70,
    },
    records: [
      {
        id: "record-a",
        courseTitle: "Different title",
        title: "Assessment",
        score: 15,
        maxScore: 30,
        updatedAt: "2026-11-06T09:00:00Z",
        rawJson: { moodle_course_id: 42, moodle_item_id: "101" },
      },
    ],
    bindings: {
      a: {
        mode: "aggregate",
        ruleConfirmed: true,
        entries: [{ recordId: "record-a", weight: 100 }],
      },
    },
  };
}
function review(value: CourseGradeTargetInput): GradePolicyReview {
  return {
    version: 1,
    externalCourseKey: value.externalCourseKey!,
    contextKey: gradeTargetContextKey({
      externalCourseKey: value.externalCourseKey,
      startsOn: value.courseStartsOn ?? null,
      endsOn: value.courseEndsOn ?? null,
    }),
    definitionKey: gradeTargetDefinitionKey(value.calculator!.definition),
    bindingsKey: gradeTargetBindingsKey(value.bindings),
    reviewedAt: "2026-11-06T09:30:00Z",
    sourceRef: "Current syllabus p2",
    supportedPolicy: "linear-30-30-40",
  };
}
describe("deterministic course grade target", () => {
  it("normalizes raw 15/30, keeps pending work unknown and ignores saved scenario values", () => {
    const value = input();
    const before = structuredClone(value);
    const result = calculateCourseGradeTarget(value);
    expect(result.actualState?.values).toEqual({ a: 50, b: null, exam: null });
    expect(result.completedWeight).toBe(30);
    expect(result.assessedAverage).toBe(50);
    expect(result.plan).toMatchObject({
      earnedFinalPoints: 15,
      remainingFinalWeight: 70,
      minimumFinal: 15,
      maximumFinal: 85,
      requiredAverage: 78.6,
      targetPossible: true,
    });
    expect(result.scenarios.map((row) => row.final)).toEqual([64, 74.5, 85]);
    expect(result.status).toBe("conditional");
    expect(value).toEqual(before);
  });
  it("only confirms the exact reviewed course, definition and mapping", () => {
    const value = input();
    value.review = review(value);
    expect(calculateCourseGradeTarget(value).status).toBe("confirmed");
    for (const field of [
      "definitionKey",
      "bindingsKey",
      "externalCourseKey",
      "contextKey",
      "supportedPolicy",
      "sourceRef",
    ] as const) {
      const changed = structuredClone(value);
      Object.assign(changed.review!, {
        [field]: field === "sourceRef" ? "" : "changed",
      });
      expect(calculateCourseGradeTarget(changed).status).toBe("conditional");
    }
  });
  it("canonical review keys ignore field and entry order but include policy changes", () => {
    const value = input();
    const definition = structuredClone(value.calculator!.definition);
    definition.fields.reverse();
    expect(gradeTargetDefinitionKey(definition)).toBe(
      gradeTargetDefinitionKey(value.calculator!.definition),
    );
    definition.attestationThreshold = 50;
    expect(gradeTargetDefinitionKey(definition)).not.toBe(
      gradeTargetDefinitionKey(value.calculator!.definition),
    );
    const bindings = structuredClone(value.bindings);
    bindings.a.entries[0].weight = 99;
    expect(gradeTargetBindingsKey(bindings)).not.toBe(
      gradeTargetBindingsKey(value.bindings),
    );
  });
  it("invalidates review on enrollment context changes, expiry and future review time", () => {
    const value = input();
    value.review = review(value);
    expect(
      calculateCourseGradeTarget({ ...value, courseStartsOn: "2026-09-01" })
        .status,
    ).toBe("conditional");
    expect(
      calculateCourseGradeTarget({ ...value, courseEndsOn: "2026-12-01" })
        .status,
    ).toBe("conditional");
    value.review.reviewedAt = "2026-08-01T00:00:00Z";
    expect(calculateCourseGradeTarget(value).status).toBe("conditional");
    value.review.reviewedAt = "2026-11-07T00:00:00Z";
    expect(calculateCourseGradeTarget(value).status).toBe("conditional");
  });
  it.each([
    "missing-course",
    "other-course",
    "missing-item",
    "title-identity",
    "hidden-last-known",
    "mock",
    "null-score",
    "null-max",
    "zero-max",
    "bonus",
    "negative",
    "nan",
    "old",
    "future",
    "bad-time",
    "duplicate-id",
    "duplicate-item",
    "reused-binding",
    "partial-weighted",
    "bad-weight",
    "unconfirmed",
    "weighted-exam",
  ])("does not invent an observed grade for %s", (defect) => {
    const value = input();
    value.review = review(value);
    const row = value.records[0];
    if (defect === "missing-course") value.externalCourseKey = null;
    if (defect === "other-course")
      row.rawJson = { moodle_course_id: 43, moodle_item_id: "101" };
    if (defect === "missing-item") row.rawJson = { moodle_course_id: 42 };
    if (defect === "title-identity")
      row.rawJson = { moodle_course_id: 42, moodle_item_id: "title-123abc" };
    if (defect === "hidden-last-known")
      row.rawJson = {
        ...(row.rawJson as object),
        _grade_visibility_unknown: true,
        _last_known_score: 15,
      };
    if (defect === "mock")
      row.rawJson = { ...(row.rawJson as object), _is_mocked: true };
    if (defect === "null-score") row.score = null;
    if (defect === "null-max") row.maxScore = null;
    if (defect === "zero-max") row.maxScore = 0;
    if (defect === "bonus") row.score = 31;
    if (defect === "negative") row.score = -1;
    if (defect === "nan") row.score = NaN;
    if (defect === "old") row.updatedAt = "2026-11-01T00:00:00Z";
    if (defect === "future") row.updatedAt = "2026-11-07T00:00:00Z";
    if (defect === "bad-time") row.updatedAt = "invalid";
    if (defect === "duplicate-id") value.records.push(structuredClone(row));
    if (defect === "duplicate-item")
      value.records.push({ ...row, id: "another" });
    if (defect === "reused-binding")
      value.bindings.b = structuredClone(value.bindings.a);
    if (defect === "partial-weighted")
      value.bindings.a = {
        mode: "weighted",
        ruleConfirmed: true,
        entries: [
          { recordId: "record-a", weight: 50 },
          { recordId: "missing", weight: 50 },
        ],
      };
    if (defect === "bad-weight") value.bindings.a.entries[0].weight = 50;
    if (defect === "unconfirmed") value.bindings.a.ruleConfirmed = false;
    if (defect === "weighted-exam") {
      value.calculator!.definition.fields[0].period = "exam";
      value.calculator!.definition.fields[2].period = "att1";
      value.bindings.a.mode = "weighted";
    }
    expect(calculateCourseGradeTarget(value).actualState?.values.a).toBeNull();
  });
  it("counts an observed zero without converting pending grades to zero", () => {
    const value = input();
    value.records[0].score = 0;
    const result = calculateCourseGradeTarget(value);
    expect(result.completedWeight).toBe(30);
    expect(result.assessedAverage).toBe(0);
    expect(result.actualState?.values.b).toBeNull();
    expect(result.plan?.maximumFinal).toBe(70);
  });
  it("supports explicitly reviewed weighted components without double counting", () => {
    const value = input();
    value.records.push({
      ...value.records[0],
      id: "second",
      score: 30,
      rawJson: { moodle_course_id: 42, moodle_item_id: "102" },
    });
    value.bindings.a = {
      mode: "weighted",
      ruleConfirmed: true,
      entries: [
        { recordId: "record-a", weight: 25 },
        { recordId: "second", weight: 75 },
      ],
    };
    expect(calculateCourseGradeTarget(value).actualState?.values.a).toBe(87.5);
  });
  it("handles unattainable targets and closed complete courses via the same engine", () => {
    const value = input();
    value.records[0].score = 0;
    value.calculator!.target = 80;
    expect(calculateCourseGradeTarget(value).plan?.targetPossible).toBe(false);
    for (const [id, item] of [
      ["b", "102"],
      ["exam", "103"],
    ]) {
      value.records.push({
        ...value.records[0],
        id,
        score: 30,
        rawJson: { moodle_course_id: 42, moodle_item_id: item },
      });
      value.bindings[id] = {
        mode: "aggregate",
        ruleConfirmed: true,
        entries: [{ recordId: id, weight: 100 }],
      };
    }
    const result = calculateCourseGradeTarget(value);
    expect(result.plan).toMatchObject({
      requiredAverage: null,
      minimumFinal: 70,
      maximumFinal: 70,
      targetPossible: false,
    });
  });
  it.each([
    null,
    {
      ...input().calculator!,
      definition: { ...input().calculator!.definition, fields: [] },
    },
  ])("does not guess missing or invalid weights", (calculator) => {
    expect(
      calculateCourseGradeTarget({ ...input(), calculator }).plan,
    ).toBeNull();
  });
  it("blocks explicitly unsupported policies and invalid clocks", () => {
    expect(
      calculateCourseGradeTarget({
        ...input(),
        unsupportedRules: ["drop-lowest"],
      }),
    ).toMatchObject({ status: "unsupported", plan: null });
    expect(
      calculateCourseGradeTarget({ ...input(), now: "invalid" }).plan,
    ).toBeNull();
  });
});
