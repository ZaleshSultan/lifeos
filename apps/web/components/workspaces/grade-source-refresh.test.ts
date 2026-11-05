import { afterEach, describe, expect, it, vi } from "vitest";
import type { StudyWorkspace } from "../../../tma/src/api/study-types";
import { defaultScholarshipConfig } from "../../../../packages/core/src/scholarship.js";
import type { GradeEventFeed } from "../../../../packages/core/src/academic-intelligence.js";
import { createStudyDraft } from "../../../tma/src/components/study/model";
import { courseGradeTarget } from "../../../tma/src/components/study/grade-target-model";
import {
  gradeCalculatorBaseForEdit,
  startOwnedGradeSourceRefresh,
} from "./grade-source-refresh";

function fixture() {
  const study: StudyWorkspace = {
    timezone: "Asia/Almaty",
    courses: [
      {
        id: "owned",
        title: "Synthetic",
        code: "DEMO",
        startsOn: null,
        endsOn: null,
        schedules: [],
        externalCourseKey: "moodle:42",
        calculator: {
          definition: {
            version: 1,
            sourceName: "Synthetic source",
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
        scholarship: {
          ...defaultScholarshipConfig(),
          bindings: {
            a: {
              mode: "aggregate",
              ruleConfirmed: true,
              entries: [{ recordId: "grade", weight: 100 }],
            },
          },
        },
      },
    ],
    records: [
      {
        id: "grade",
        userId: "synthetic-owner",
        sourceEventId: null,
        title: "Synthetic grade",
        courseTitle: "Synthetic",
        recordType: "assignment",
        valueText: null,
        score: 15,
        maxScore: 30,
        percentage: 50,
        occursAt: null,
        dueAt: null,
        updatedAt: "2026-11-06T09:00:00Z",
        createdAt: "2026-11-06T09:00:00Z",
        rawJson: { moodle_course_id: "42", moodle_item_id: "101" },
      },
    ],
  };
  const feed: GradeEventFeed = {
    events: [],
    eligibleDeadlines: [],
    preferences: {
      revision: 0,
      academicRevision: 0,
      courseReviews: {},
      gradeAlertsEnabled: false,
      assignmentAlertsEnabled: false,
      quizAlertsEnabled: false,
      assignmentOffsetsMinutes: [],
      quizOffsetsMinutes: [],
      quietStart: "23:00",
      quietEnd: "08:00",
    },
    lms: {
      configured: true,
      stale: false,
      lastSuccessfulSyncAt: "2026-11-06T09:00:00Z",
      state: "ready",
    },
    truncated: false,
  };
  return { study, feed };
}
afterEach(() => vi.useRealTimers());
describe("owned grade source refresh", () => {
  it("refreshes corrections every 60 seconds while preserving a dirty hypothesis and its old save base", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-11-06T10:00:00Z");
    const initial = fixture();
    let study = initial.study;
    const draft = createStudyDraft(study.courses[0].calculator!);
    draft.inputs.a = "75";
    const before = structuredClone(draft);
    const bases = { owned: study.courses[0].calculator };
    const corrected = structuredClone(study);
    corrected.records[0].score = 21;
    corrected.courses[0].calculator!.values.a = 60;
    const load = vi.fn().mockResolvedValue(corrected);
    const refresh = startOwnedGradeSourceRefresh({
      loadStudy: load,
      loadFeed: async () => initial.feed,
      onStudy: (next) => {
        study = next;
      },
      onFeed: () => {},
      onFailure: vi.fn(),
      onSuccess: vi.fn(),
      canRefresh: () => true,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(
      courseGradeTarget(
        study.courses[0],
        study.records,
        undefined,
        new Date().toISOString(),
        initial.feed.lms,
      ).plan?.earnedFinalPoints,
    ).toBe(21);
    expect(draft).toEqual(before);
    expect(gradeCalculatorBaseForEdit(bases, study.courses[0], draft)).toBe(
      bases,
    );
    expect(bases.owned?.values.a).toBe(100);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(2);
    refresh.dispose();
  });
  it("reports partial failures so the retained source is downgraded instead of claiming fresh combined evidence", async () => {
    vi.useFakeTimers();
    const data = fixture();
    let feed = data.feed;
    const refresh = startOwnedGradeSourceRefresh({
      loadStudy: async () => {
        throw new Error("offline");
      },
      loadFeed: async () => data.feed,
      onStudy: vi.fn(),
      onFeed: (next) => {
        feed = next;
      },
      onFailure: () => {
        feed = { ...feed, lms: { ...feed.lms, stale: true } };
      },
      onSuccess: vi.fn(),
      canRefresh: () => true,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(feed.lms.stale).toBe(true);
    refresh.dispose();
  });
  it("bounds an in-flight read to 15 seconds and prevents overlapping reads", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const failure = vi.fn();
    const load = vi.fn((value: AbortSignal) => {
      signal = value;
      return new Promise<StudyWorkspace>(() => {});
    });
    const refresh = startOwnedGradeSourceRefresh({
      loadStudy: load,
      loadFeed: () => new Promise(() => {}),
      onStudy: vi.fn(),
      onFeed: vi.fn(),
      onFailure: failure,
      onSuccess: vi.fn(),
      canRefresh: () => true,
    });
    await refresh.refresh();
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(signal?.aborted).toBe(true);
    expect(failure).toHaveBeenCalledTimes(1);
    refresh.dispose();
  });
  it("aborts on cleanup and ignores responses arriving after the workspace is gone", async () => {
    vi.useFakeTimers();
    const data = fixture();
    let signal: AbortSignal | undefined;
    let resolveStudy!: (value: StudyWorkspace) => void;
    let resolveFeed!: (value: GradeEventFeed) => void;
    const apply = vi.fn();
    const refresh = startOwnedGradeSourceRefresh({
      loadStudy: (value) => {
        signal = value;
        return new Promise((resolve) => {
          resolveStudy = resolve;
        });
      },
      loadFeed: () =>
        new Promise((resolve) => {
          resolveFeed = resolve;
        }),
      onStudy: apply,
      onFeed: apply,
      onFailure: vi.fn(),
      onSuccess: vi.fn(),
      canRefresh: () => true,
    });
    refresh.dispose();
    expect(signal?.aborted).toBe(true);
    resolveStudy(data.study);
    resolveFeed(data.feed);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(apply).not.toHaveBeenCalled();
  });
});
