import { describe, expect, it } from "vitest";
import { calculateCourseGradeTarget } from "../packages/core/src/grade-target";
import {
  v6BrowserFixture,
  V6_FOREIGN_COURSE_ID,
} from "./v6-browser-fixtures.mjs";
const now = "2031-04-07T08:00:00.000Z";
const target = (
  fixture: ReturnType<typeof v6BrowserFixture>,
  index: number,
) => {
  const course = fixture.workspace.courses[index];
  return calculateCourseGradeTarget({
    courseId: course.id,
    externalCourseKey: course.externalCourseKey,
    courseStartsOn: course.startsOn,
    courseEndsOn: course.endsOn,
    calculator: course.calculator,
    records: fixture.workspace.records,
    bindings: course.scholarship.bindings,
    review: fixture.feed.preferences.courseReviews[course.id],
    lms: fixture.feed.lms,
    now,
  });
};
describe("synthetic V6 acceptance contracts", () => {
  it("derives observed 50 from raw 15/30 while preserving a separate manual 100 scenario", () => {
    const fixture = v6BrowserFixture("A", { now });
    expect(target(fixture, 0)).toMatchObject({
      status: "conditional",
      assessedAverage: 50,
      actualState: { values: { att1: 50, att2: null, exam: null } },
      plan: { earnedFinalPoints: 15, maximumFinal: 85 },
    });
    expect(fixture.workspace.courses[0].calculator.values.att1).toBe(100);
    expect(fixture.workspace.records[0].courseTitle).not.toBe(
      fixture.workspace.courses[0].title,
    );
    expect(target(fixture, 1)).toMatchObject({
      status: "confirmed",
      assessedAverage: 80,
    });
  });
  it("requires the exact owner, context, definition, bindings and explicit review", () => {
    const fixture = v6BrowserFixture("A", { now }),
      course = fixture.workspace.courses[0];
    const body = {
      expectedRevision: 0,
      ...fixture.reviewFor(course),
      sourceRef: "Invented review p2",
      confirmed: true,
      currentEnrollmentConfirmed: true,
      supportedRulesConfirmed: true,
    };
    expect(
      fixture.response(
        `study/grade-policy/${V6_FOREIGN_COURSE_ID}`,
        "PUT",
        body,
      )?.status,
    ).toBe(404);
    expect(
      fixture.response(`study/grade-policy/${course.id}`, "PUT", {
        ...body,
        bindingsKey: "wrong",
      })?.status,
    ).toBe(400);
    expect(
      fixture.response(`study/grade-policy/${course.id}`, "PUT", body)?.status,
    ).toBe(200);
    expect(target(fixture, 0).status).toBe("confirmed");
    fixture.setStale();
    expect(target(fixture, 0).status).toBe("conditional");
    expect(fixture.writes.policy).toBe(1);
  });
  it("reading keeps categories off and preference mutations enforce both original revisions", () => {
    const fixture = v6BrowserFixture("A", { now });
    fixture.response("study/grade-events");
    expect(fixture.feed.preferences.gradeAlertsEnabled).toBe(false);
    expect(fixture.writes.preferences).toBe(0);
    const {
      revision: _revision,
      academicRevision: _academicRevision,
      courseReviews: _reviews,
      ...preferences
    } = fixture.feed.preferences;
    const body = {
      expectedRevision: 0,
      expectedAcademicRevision: 0,
      preferences: { ...preferences, gradeAlertsEnabled: true },
      confirmed: true,
    };
    expect(
      fixture.response("study/academic-preferences", "PUT", {
        ...body,
        confirmed: false,
      })?.status,
    ).toBe(400);
    fixture.remotePreferenceChange();
    expect(
      fixture.response("study/academic-preferences", "PUT", body)?.status,
    ).toBe(409);
    expect(fixture.writes.preferences).toBe(0);
    expect(
      fixture.telegramSends + fixture.providerCalls + fixture.deliveryJobs,
    ).toBe(0);
  });
  it("isolates two owners and records actual requested day reads without live operations", () => {
    const a = v6BrowserFixture("A", { now }),
      b = v6BrowserFixture("B", { now });
    expect(
      a.workspace.courses
        .map((row) => row.id)
        .some((id) => b.workspace.courses.some((row) => row.id === id)),
    ).toBe(false);
    expect(
      b.response(
        `study/courses/${a.workspace.courses[0].id}/calculator`,
        "PUT",
        { values: {}, target: 70 },
      )?.status,
    ).toBe(404);
    a.response("today?date=2031-04-08");
    expect(a.requests.at(-1)).toMatchObject({
      path: "today",
      method: "GET",
      date: "2031-04-08",
    });
    expect(a.feed.deliveryEnabled).toBe(false);
  });
});
