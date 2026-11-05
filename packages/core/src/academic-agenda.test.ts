import { describe, expect, it } from "vitest";
import { academicAgenda } from "./academic-agenda.js";
import {
  DEFAULT_ACADEMIC_PREFERENCES,
  type AcademicEvent,
  type AcademicOverview,
} from "./academic-concierge.js";

function agendaFixture(): AcademicOverview {
  return {
    timezone: "Asia/Almaty",
    sources: [],
    preferences: { ...DEFAULT_ACADEMIC_PREFERENCES },
    scheduleVerification: {
      revision: 1,
      validFrom: "2030-03-01",
      validThrough: "2030-03-10",
      sourceLabel: "Synthetic timetable",
      verifiedAt: "2030-03-01T00:00:00Z",
      current: true,
      changed: false,
    },
    lms: {
      configured: true,
      stale: false,
      lastSuccessfulSyncAt: "2030-03-04T18:00:00Z",
      state: "connected",
    },
    events: [
      {
        id: "teaching",
        key: "teaching",
        sourceKey: "calendar",
        kind: "calendar_period",
        title: "Synthetic teaching period",
        startsOn: "2030-03-01",
        endsOn: "2030-03-10",
        startsAt: null,
        endsAt: null,
        timezone: "Asia/Almaty",
        location: null,
        courseCode: null,
        sourceTypeCode: null,
        trimester: 1,
        periodType: "teaching",
        status: "confirmed",
        revision: 1,
        manuallyEdited: false,
        updatedAt: "2030-03-01T00:00:00Z",
      },
    ],
    classes: [
      {
        key: "class:a",
        title: "Synthetic class",
        startsAt: "2030-03-05T04:00:00Z",
        endsAt: "2030-03-05T05:00:00Z",
        location: "Synthetic room",
        courseCode: "SYN",
      },
    ],
    assignments: [
      {
        key: "assignment:a",
        title: "Synthetic assignment",
        courseTitle: "Synthetic course",
        dueAt: "2030-03-06T05:00:00Z",
        sourceUrl: null,
        submissionState: "not_submitted",
        verified: true,
        stale: false,
      },
    ],
    warnings: [],
    truncated: false,
  };
}
const now = "2030-03-04T19:30:00Z"; // Campus midnight has passed; owner may be in another zone.
const project = (overview = agendaFixture(), date = "2030-03-05") =>
  academicAgenda(
    overview,
    date,
    now,
    new Map([["assignment:a", Date.parse("2030-03-06T05:00:00Z")]]),
  );
describe("Academic Concierge agenda projection", () => {
  it("uses campus authority dates even when the overview reports the owner's timezone", () => {
    const f = agendaFixture();
    f.timezone = "America/New_York";
    expect(project(f)).toMatchObject({
      timezone: "Asia/Almaty",
      scheduleState: "verified",
    });
    expect(project(f).classes).toHaveLength(1);
  });
  it("fails closed without active-deadline corroboration and rejects impossible calendar dates", () => {
    expect(
      academicAgenda(agendaFixture(), "2030-03-05", now).assignments,
    ).toEqual([]);
    expect(() => project(agendaFixture(), "2030-02-30")).toThrow();
  });
  it("uses campus dates, bounded verified occurrences and fresh unsent assignments", () => {
    const a = project();
    expect(a.scheduleState).toBe("verified");
    expect(a.classes).toHaveLength(1);
    expect(a.assignments).toHaveLength(1);
    expect(project(agendaFixture(), "2030-03-04").classes).toEqual([]);
  });
  it.each(["changed", "expired", "out_of_range"])(
    "withholds classes when schedule is %s",
    (reason) => {
      const f = agendaFixture();
      if (reason === "changed") f.scheduleVerification.changed = true;
      if (reason === "expired") f.scheduleVerification.current = false;
      if (reason === "out_of_range")
        f.scheduleVerification.validThrough = "2030-03-04";
      expect(project(f)).toMatchObject({
        scheduleState: "unverified",
        classes: [],
      });
    },
  );
  it("does not convert unconfirmed teaching periods or holidays into class days", () => {
    const f = agendaFixture();
    f.events[0]!.status = "proposed";
    expect(project(f)).toMatchObject({
      scheduleState: "outside_teaching",
      classes: [],
    });
    f.events[0]!.status = "confirmed";
    f.events.push({ ...f.events[0]!, key: "holiday", kind: "holiday" });
    expect(project(f)).toMatchObject({ scheduleState: "holiday", classes: [] });
  });
  it("keeps confirmed personal and university exams distinct, including unknown ends and examfx", () => {
    const f = agendaFixture();
    const exam: AcademicEvent = {
      ...f.events[0]!,
      key: "exam",
      kind: "university_exam",
      startsAt: "2030-03-04T20:30:00Z",
      endsAt: null,
      startsOn: null,
      endsOn: null,
      sourceTypeCode: "examfx",
    };
    f.events.push(
      exam,
      { ...exam, key: "personal", kind: "personal_exam", sourceTypeCode: null },
      { ...exam, key: "cancelled", status: "cancelled" },
      { ...exam, key: "proposed", status: "proposed" },
    );
    expect(
      project(f).events.map((e) => [e.kind, e.sourceTypeCode, e.endsAt]),
    ).toEqual([
      ["university_exam", "examfx", null],
      ["personal_exam", null, null],
    ]);
  });
  it.each(["stale", "disconnected", "old", "future", "missing"])(
    "does not report an empty assignment list as authoritative when LMS is %s",
    (reason) => {
      const f = agendaFixture();
      if (reason === "stale") f.lms.stale = true;
      if (reason === "disconnected") f.lms.configured = false;
      if (reason === "old") f.lms.lastSuccessfulSyncAt = "2030-03-04T13:29:59Z";
      if (reason === "future")
        f.lms.lastSuccessfulSyncAt = "2030-03-04T19:35:01Z";
      if (reason === "missing") f.lms.lastSuccessfulSyncAt = null;
      expect(project(f)).toMatchObject({ lmsFresh: false, assignments: [] });
    },
  );
  it("excludes stale, unverified, submitted, graded, unknown, past and beyond-horizon assignments", () => {
    const f = agendaFixture();
    const a = f.assignments[0]!;
    f.assignments.push(
      ...[
        { ...a, stale: true },
        { ...a, verified: false },
        { ...a, submissionState: "submitted" as const },
        { ...a, submissionState: "graded" as const },
        { ...a, submissionState: "unknown" as const },
        { ...a, dueAt: "2030-03-04T19:29:59Z" },
        { ...a, dueAt: "2030-04-04T19:30:01Z" },
      ],
    );
    expect(project(f).assignments).toEqual([a]);
    expect(project(f).uncertainAssignments).toBe(true);
  });
  it("preserves incomplete state without mutating preferences or source records", () => {
    const f = agendaFixture();
    f.truncated = true;
    const copy = structuredClone(f);
    expect(project(f).incomplete).toBe(true);
    expect(f).toEqual(copy);
  });
});
