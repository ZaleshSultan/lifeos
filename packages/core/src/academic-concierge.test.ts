import { describe, expect, it } from "vitest";
import {
  ACADEMIC_TIMEZONE,
  DEFAULT_ACADEMIC_PREFERENCES,
  academicDate,
  academicEventDaysAway,
  academicLocalDate,
  academicReminderPreview,
  academicTimestamp,
  parseAcademicEvent,
  parseAcademicEventRevision,
  parseAcademicImport,
  parseAcademicPreferences,
  parseAcademicScheduleVerification,
  parseAcademicSource,
  type AcademicEventInput,
  type AcademicSourceInput,
} from "./academic-concierge.js";

const source: AcademicSourceInput = {
  key: "synthetic-timetable",
  kind: "official_timetable",
  label: "Synthetic approved source",
  sha256: "a".repeat(64),
  sourceUrl: null,
  page: 9,
  academicYear: "2026-2027",
  groupCode: "TEST-100",
  verifiedAt: "2026-11-04T00:00:00Z",
};
const exam: AcademicEventInput = {
  key: "synthetic-exam",
  sourceKey: source.key,
  kind: "university_exam",
  title: "Synthetic systems exam",
  startsAt: "2026-11-17T10:00:00+05:00",
  endsAt: "2026-11-17T11:00:00+05:00",
  startsOn: null,
  endsOn: null,
  timezone: ACADEMIC_TIMEZONE,
  location: "C1.2.334",
  courseCode: "SYN101",
  sourceTypeCode: "exam",
  trimester: 1,
  periodType: null,
  status: "confirmed",
};
const personal: AcademicEventInput = {
  ...exam,
  key: "synthetic-personal",
  sourceKey: "synthetic-owner",
  kind: "personal_exam",
  title: "Synthetic personal examination",
  startsAt: "2026-11-17T16:00:00+05:00",
  endsAt: null,
  location: "Тестовая, 8",
  courseCode: null,
  sourceTypeCode: null,
  trimester: null,
  status: "proposed",
};
const ownerSource: AcademicSourceInput = {
  ...source,
  key: "synthetic-owner",
  kind: "owner_provided",
  page: null,
  academicYear: null,
  groupCode: null,
};

describe("academic source validation and separated personal examinations", () => {
  it("keeps university and personal examinations on the same date without a shared identity", () => {
    const parsed = parseAcademicImport({
      requestId: "synthetic-import-001",
      sources: [source, ownerSource],
      events: [exam, personal],
    });
    expect(parsed.events).toHaveLength(2);
    expect(
      parsed.events.find((e) => e.kind === "university_exam")?.startsAt,
    ).toBe("2026-11-17T05:00:00.000Z");
    const p = parsed.events.find((e) => e.kind === "personal_exam")!;
    expect(p.startsAt).toBe("2026-11-17T11:00:00.000Z");
    expect(p.endsAt).toBeNull();
    expect(p.location).toBe("Тестовая, 8");
    expect(p.status).toBe("proposed");
    expect(p.courseCode).toBeNull();
    expect(p.sourceTypeCode).toBeNull();
  });
  it.each(["exam", "examfx"] as const)(
    "preserves source type %s literally",
    (sourceTypeCode) => {
      expect(
        parseAcademicEvent({ ...exam, sourceTypeCode }).sourceTypeCode,
      ).toBe(sourceTypeCode);
    },
  );
  it("does not accept a personal exam as an institutional record", () => {
    expect(() =>
      parseAcademicEvent({ ...personal, courseCode: "SYN101" }),
    ).toThrow();
    expect(() =>
      parseAcademicEvent({ ...personal, sourceTypeCode: "exam" }),
    ).toThrow();
    expect(() =>
      parseAcademicImport({
        requestId: "synthetic",
        sources: [source],
        events: [{ ...personal, sourceKey: source.key }],
      }),
    ).toThrow();
  });
  it("imports personal events only as proposals, without notification consent", () => {
    expect(() =>
      parseAcademicImport({
        requestId: "synthetic",
        sources: [ownerSource],
        events: [{ ...personal, status: "confirmed" }],
      }),
    ).toThrow();
    expect(
      academicReminderPreview(personal, {
        ...DEFAULT_ACADEMIC_PREFERENCES,
        personalAlertsEnabled: true,
      }),
    ).toEqual([]);
  });
  it.each([
    "latitude",
    "longitude",
    "durationMinutes",
    "transportMinutes",
    "user_id",
    "notificationsEnabled",
  ])("rejects invented or authoritative field %s", (field) => {
    expect(() => parseAcademicEvent({ ...personal, [field]: 12 })).toThrow();
  });
  it("requires existing source references and unique event/source keys", () => {
    expect(() =>
      parseAcademicImport({
        requestId: "synthetic",
        sources: [source],
        events: [personal],
      }),
    ).toThrow();
    expect(() =>
      parseAcademicImport({
        requestId: "synthetic",
        sources: [source, source],
        events: [exam],
      }),
    ).toThrow();
    expect(() =>
      parseAcademicImport({
        requestId: "synthetic",
        sources: [source],
        events: [exam, exam],
      }),
    ).toThrow();
  });
  it("refuses arbitrary source links without making a network request", () => {
    for (const sourceUrl of [
      "http://astanait.edu.kz/source",
      "https://evil.invalid/source",
      "https://astanait.edu.kz@evil.invalid/source",
      "https://astanait.edu.kz/source?token=private",
      "https://astanait.edu.kz:444/source",
    ])
      expect(() => parseAcademicSource({ ...source, sourceUrl })).toThrow();
    expect(
      parseAcademicSource({
        ...source,
        sourceUrl: "https://astanait.edu.kz/academic-calendar/",
      }).sourceUrl,
    ).toContain("astanait.edu.kz");
  });
  it("bounds source digests, import sizes, labels and untrusted record shapes", () => {
    expect(() =>
      parseAcademicSource({ ...source, sha256: "not-a-digest" }),
    ).toThrow();
    expect(() =>
      parseAcademicSource({ ...source, label: "a".repeat(301) }),
    ).toThrow();
    expect(() =>
      parseAcademicImport({
        requestId: "synthetic",
        sources: [],
        events: [exam],
      }),
    ).toThrow();
    expect(() =>
      parseAcademicEvent({ ...exam, title: "a".repeat(501) }),
    ).toThrow();
  });
});

describe("academic dates, calendar periods and deterministic reminder previews", () => {
  it("converts explicit offsets and local date boundaries correctly", () => {
    expect(academicLocalDate("2026-11-16T20:00:00Z", ACADEMIC_TIMEZONE)).toBe(
      "2026-11-17",
    );
    expect(academicLocalDate("2026-11-17T01:00:00Z", "America/New_York")).toBe(
      "2026-11-16",
    );
    expect(academicTimestamp("2026-11-17T16:00:00+05:00")).toBe(
      "2026-11-17T11:00:00.000Z",
    );
  });
  it("keeps institutional campus timezone while personal events retain their own explicit zone", () => {
    expect(() =>
      parseAcademicEvent({ ...exam, timezone: "Asia/Tokyo" }),
    ).toThrow();
    expect(
      parseAcademicEvent({ ...personal, timezone: "Asia/Tokyo" }).timezone,
    ).toBe("Asia/Tokyo");
  });
  it.each(["2026-02-29", "2026-11-31", "2026-13-01", "2026-00-01"])(
    "rejects impossible calendar date %s",
    (date) => expect(() => academicDate(date)).toThrow(),
  );
  it.each([
    "2026-11-17T16:00:00",
    "2026-11-17T24:00:00Z",
    "2026-11-17T16:60:00Z",
    "2026-11-17T16:00:60Z",
  ])("rejects ambiguous or invalid instant %s", (date) =>
    expect(() => academicTimestamp(date)).toThrow(),
  );
  it("preserves overlapping periods in all three trimesters rather than flattening them", () => {
    const calendarSource = {
      ...source,
      key: "synthetic-calendar",
      kind: "official_calendar" as const,
    };
    const events = [1, 2, 3].flatMap((term) =>
      ["teaching", "registration"].map((periodType) => ({
        ...exam,
        key: `term-${term}-${periodType}`,
        sourceKey: calendarSource.key,
        kind: "calendar_period" as const,
        title: `${periodType} ${term}`,
        startsAt: null,
        endsAt: null,
        startsOn: `2027-0${term}-01`,
        endsOn: `2027-0${term}-20`,
        courseCode: null,
        sourceTypeCode: null,
        trimester: term as 1 | 2 | 3,
        periodType,
      })),
    );
    const parsed = parseAcademicImport({
      requestId: "synthetic-calendar-import",
      sources: [calendarSource],
      events,
    });
    expect(parsed.events).toHaveLength(6);
    expect(new Set(parsed.events.map((e) => e.trimester))).toEqual(
      new Set([1, 2, 3]),
    );
    expect(parsed.events.every((e) => e.endsOn?.endsWith("20"))).toBe(true);
  });
  it("keeps missing end time unknown and rejects reversed intervals", () => {
    expect(parseAcademicEvent(personal).endsAt).toBeNull();
    expect(() =>
      parseAcademicEvent({ ...exam, endsAt: "2026-11-17T09:00:00+05:00" }),
    ).toThrow();
  });
  it("creates no preview with all notification defaults OFF", () => {
    expect(
      academicReminderPreview(
        parseAcademicEvent(exam),
        parseAcademicPreferences(DEFAULT_ACADEMIC_PREFERENCES),
      ),
    ).toEqual([]);
    for (const key of [
      "classAlertsEnabled",
      "assignmentAlertsEnabled",
      "examAlertsEnabled",
      "personalAlertsEnabled",
      "staleWarningEnabled",
    ] as const)
      expect(DEFAULT_ACADEMIC_PREFERENCES[key]).toBe(false);
  });
  it("uses exact approved offsets and no LLM scheduling", () => {
    const prefs = {
      ...DEFAULT_ACADEMIC_PREFERENCES,
      personalAlertsEnabled: true,
    };
    expect(
      academicReminderPreview(
        parseAcademicEvent({ ...personal, status: "confirmed" }),
        prefs,
      ),
    ).toEqual([
      "2026-11-16T11:00:00.000Z",
      "2026-11-17T09:00:00.000Z",
      "2026-11-17T10:30:00.000Z",
    ]);
    expect(academicEventDaysAway(exam, "2026-11-16T20:00:00Z")).toBe(0);
  });
  it("requires explicit bounded preferences and revisions", () => {
    for (const patch of [
      { classAlertsEnabled: "true" },
      { quietStart: "25:00" },
      { examOffsetsMinutes: [120, 120] },
      { classOffsetMinutes: 0 },
      { personalOffsetsMinutes: [10081] },
      { revision: -1 },
      { ownerId: "other" },
    ])
      expect(() =>
        parseAcademicPreferences({ ...DEFAULT_ACADEMIC_PREFERENCES, ...patch }),
      ).toThrow();
  });
  it("requires independent explicit confirmation and a bounded schedule-verification period", () => {
    expect(() =>
      parseAcademicEventRevision({
        expectedRevision: 1,
        patch: { status: "confirmed" },
        confirmed: false,
      }),
    ).toThrow();
    expect(() =>
      parseAcademicEventRevision({
        expectedRevision: 1,
        patch: { sourceKey: "fake" },
        confirmed: true,
      }),
    ).toThrow();
    expect(() =>
      parseAcademicScheduleVerification({
        expectedRevision: 0,
        validFrom: "2026-11-01",
        validThrough: "2027-11-01",
        sourceLabel: "Synthetic",
        confirmed: true,
      }),
    ).toThrow();
    expect(
      parseAcademicScheduleVerification({
        expectedRevision: 0,
        validFrom: "2026-11-01",
        validThrough: "2026-11-20",
        sourceLabel: "Synthetic reviewed timetable",
        confirmed: true,
      }).validThrough,
    ).toBe("2026-11-20");
  });
});
