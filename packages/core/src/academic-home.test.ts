import { describe, expect, it } from "vitest";
import type { GradeEventFeed } from "./academic-intelligence.js";
import type { AcademicOverview } from "./academic-concierge.js";
import { buildAcademicHome } from "./academic-home.js";

const now = "2030-03-05T10:00:00Z";
function feed(): GradeEventFeed {
  return {
    lms: {
      configured: true,
      stale: false,
      lastSuccessfulSyncAt: now,
      state: "connected",
    },
    events: [
      {
        id: "synthetic-event",
        courseId: "synthetic-course",
        courseTitle: "Synthetic course",
        itemTitle: "Synthetic work",
        kind: "corrected",
        observedAt: now,
        oldScore: 0,
        oldMaxScore: 30,
        newScore: 24,
        newMaxScore: 30,
        moodleCourseId: "100",
        moodleItemId: "200",
        sourceUrl: null,
      },
    ],
    eligibleDeadlines: [
      {
        key: "synthetic-assignment",
        courseId: "synthetic-course",
        courseTitle: "Synthetic course",
        title: "Synthetic assignment",
        kind: "assignment",
        dueAt: "2030-03-06T10:00:00Z",
        sourceUrl: null,
        lastSuccessfulSyncAt: now,
      },
    ],
    truncated: false,
  } as GradeEventFeed;
}
const project = (value = feed()) =>
  buildAcademicHome({ feed: value, concierge: null, risks: [], now });
describe("read-only academic Home briefing", () => {
  it("shows durable history processing as pending rather than an authoritative empty update list", () => {
    const f = feed();
    f.historyPending = true;
    const result = project(f);
    expect(result.historyPending).toBe(true);
    expect(result.grades).toEqual([]);
    expect(result.deadlines).toHaveLength(1);
    expect(result.warnings.join(" ")).toContain(
      "История оценок ещё обновляется",
    );
  });
  it("references corrections including real zero without creating a second notification", () => {
    const f = feed(),
      before = structuredClone(f);
    expect(project(f).grades[0]).toMatchObject({
      courseId: "synthetic-course",
      tab: "grades",
      detail: "Исправлена оценка: 24/30 (было 0/30)",
    });
    expect(f).toEqual(before);
  });
  it.each(["stale", "missing", "future", "old"])(
    "withholds academic assertions when successful sync is %s",
    (reason) => {
      const f = feed();
      if (reason === "stale") f.lms.stale = true;
      if (reason === "missing") f.lms.lastSuccessfulSyncAt = null;
      if (reason === "future")
        f.lms.lastSuccessfulSyncAt = "2030-03-05T10:06:00Z";
      if (reason === "old") f.lms.lastSuccessfulSyncAt = "2030-03-05T03:59:59Z";
      const view = project(f);
      expect(view).toMatchObject({
        fresh: false,
        grades: [],
        deadlines: [],
        risks: [],
      });
      expect(view.warnings.join(" ")).toContain("не означает");
    },
  );
  it("does not infer unknown maximums or replay older/future/duplicate grade rows", () => {
    const f = feed();
    f.events[0]!.newMaxScore = null;
    f.events.push(
      { ...f.events[0]! },
      { ...f.events[0]!, id: "old", observedAt: "2030-03-04T09:59:59Z" },
      { ...f.events[0]!, id: "future", observedAt: "2030-03-05T10:06:00Z" },
    );
    expect(project(f).grades).toHaveLength(1);
    expect(project(f).grades[0]!.detail).toContain("максимум неизвестен");
  });
  it("bounds selection and keeps only future deadlines in its explicit horizon", () => {
    const f = feed();
    const a = f.eligibleDeadlines[0]!;
    f.eligibleDeadlines.push(
      { ...a, key: "past", dueAt: "2030-03-05T09:59:59Z" },
      { ...a, key: "later", dueAt: "2030-03-12T10:00:01Z" },
    );
    f.truncated = true;
    expect(project(f).deadlines.map((r) => r.key)).toEqual([a.key]);
    expect(project(f).warnings.join(" ")).toContain("Выборка ограничена");
  });
  it("only flags confirmed target plans and preserves confirmed personal/university exam distinctions", () => {
    const exam = {
      key: "exam",
      title: "Synthetic exam",
      status: "confirmed",
      kind: "university_exam",
      startsAt: "2030-03-06T09:00:00Z",
      endsAt: null,
      sourceTypeCode: "examfx",
    };
    const concierge = {
      events: [
        exam,
        { ...exam, key: "personal", kind: "personal_exam" },
        { ...exam, key: "proposed", status: "proposed" },
      ],
      truncated: false,
    } as unknown as AcademicOverview;
    const risk = {
      courseId: "course",
      title: "Synthetic course",
      target: 70,
      maximumFinal: 65,
      requiredRemainingAverage: 120,
      confirmed: true,
    };
    const view = buildAcademicHome({
      feed: feed(),
      concierge,
      risks: [risk, { ...risk, courseId: "conditional", confirmed: false }],
      now,
    });
    expect(view.risks.map((r) => r.courseId)).toEqual(["course"]);
    expect(view.exams).toHaveLength(2);
    expect(view.exams[0]!.detail).toContain("examfx");
    expect(view.exams[1]!.detail).toContain("Личный экзамен");
    expect(view.exams[0]!.detail).toContain("длительность неизвестна");
  });
});
