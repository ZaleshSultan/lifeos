import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ACADEMIC_PREFERENCES,
  type AcademicEvent,
  type AcademicSource,
} from "../../../../../packages/core/src/academic-concierge.js";
import type {
  AcademicSnapshot,
  AcademicTransport,
} from "../../api/study-concierge";
import { AcademicConcierge } from "./AcademicConcierge";
import { AcademicEventSummary } from "./AcademicEventReview";
import {
  AcademicPreferencesForm,
  AcademicScheduleVerificationForm,
} from "./AcademicPreferencesForm";
import { AcademicRoomMap } from "./AcademicRoomMap";

const source: AcademicSource = {
  key: "invented-source",
  revision: 1,
  kind: "official_timetable",
  label: "Synthetic timetable <script>do not execute</script>",
  sha256: "a".repeat(64),
  sourceUrl: null,
  page: 2,
  academicYear: "2030-2031",
  groupCode: "DEMO-7",
  verifiedAt: "2026-10-01T00:00:00Z",
};
const event: AcademicEvent = {
  id: "11111111-1111-4111-8111-111111111111",
  key: "invented-event",
  sourceKey: source.key,
  kind: "university_exam",
  title: "Synthetic Systems",
  startsAt: "2030-11-12T04:00:00Z",
  endsAt: "2030-11-12T05:00:00Z",
  startsOn: null,
  endsOn: null,
  timezone: "Asia/Almaty",
  location: "C1.3.323K",
  courseCode: "DEMO",
  sourceTypeCode: "examfx",
  trimester: null,
  periodType: null,
  status: "confirmed",
  revision: 1,
  manuallyEdited: false,
  updatedAt: "2026-10-01T00:00:00Z",
};
const overview: AcademicSnapshot = {
  timezone: "Asia/Tokyo",
  deliveryEnabled: false,
  sources: [source],
  events: [event],
  preferences: { ...DEFAULT_ACADEMIC_PREFERENCES },
  scheduleVerification: {
    revision: 0,
    validFrom: null,
    validThrough: null,
    sourceLabel: null,
    verifiedAt: null,
    current: false,
    changed: false,
  },
  lms: {
    configured: false,
    stale: true,
    lastSuccessfulSyncAt: null,
    state: "not_configured",
  },
  classes: [
    {
      key: "invented-class",
      title: "Synthetic campus class",
      startsAt: "2030-11-12T04:00:00Z",
      endsAt: "2030-11-12T05:00:00Z",
      location: "C1.3.323K",
      courseCode: "DEMO",
    },
  ],
  assignments: [],
  warnings: ["lms_stale_or_reconnect_required"],
  truncated: false,
};
const transport = Object.fromEntries(
  [
    "overview",
    "preview",
    "importSelected",
    "preferences",
    "revise",
    "decide",
    "verifySchedule",
  ].map((name) => [name, vi.fn()]),
) as unknown as AcademicTransport;

describe("shared academic review", () => {
  it("keeps campus clocks independent from a travelling profile and hides mutation controls before hydration", () => {
    const html = renderToStaticMarkup(
      createElement(AcademicConcierge, {
        transport,
        initial: overview,
        errorMessage: () => "Unavailable",
      }),
    );
    const section =
      html.match(/Следующее подтверждённое занятие.*?<\/section>/s)?.[0] ?? "";
    expect(section).toContain("09:00");
    expect(section).toContain("Asia/Almaty");
    expect(section).not.toContain("13:00");
    expect(html).toContain("Личное время и тихие часы: Asia/Tokyo");
    expect(html).toContain(
      "Автоматическая учебная доставка выключена на сервере",
    );
    expect(html).toContain("Данные LMS устарели");
    expect(html).not.toContain("lms_stale_or_reconnect_required");
    expect(html).not.toContain(event.id);
    expect(html).not.toContain("<script>do not execute</script>");
    expect(html).toContain("&lt;script&gt;");
    const buttons = [...html.matchAll(/<button\b[^>]*>/g)].map((x) => x[0]);
    expect(buttons.length).toBeGreaterThan(6);
    expect(buttons.every((button) => button.includes("disabled"))).toBe(true);
    expect(transport.overview).not.toHaveBeenCalled();
    expect(transport.decide).not.toHaveBeenCalled();
  });

  it("shows personal provenance and unknown duration without a campus map or invented location", () => {
    const personal = {
      ...event,
      kind: "personal_exam" as const,
      sourceTypeCode: null,
      courseCode: null,
      endsAt: null,
      location: "Invented test street, 9",
      status: "proposed" as const,
    };
    const html = renderToStaticMarkup(
      createElement(AcademicEventSummary, {
        event: personal,
        source: { ...source, kind: "owner_provided" },
        now: "2030-11-01T00:00:00Z",
      }),
    );
    expect(html).toContain("Личный экзамен");
    expect(html).toContain("Ожидает проверки");
    expect(html).toContain("Invented test street, 9");
    expect(html).toContain("Окончание и длительность неизвестны");
    expect(html).toContain("не относится к AITU");
    expect(html).not.toContain("aitumap");
    expect(html).not.toContain("<img");
  });

  it("preserves inclusive calendar ranges and institutional code without guessed exam meaning", () => {
    const calendar = {
      ...event,
      kind: "calendar_period" as const,
      title: "Synthetic summer term",
      startsAt: null,
      endsAt: null,
      startsOn: "2031-07-01",
      endsOn: "2031-08-05",
      sourceTypeCode: null,
    };
    const html = renderToStaticMarkup(
      createElement(AcademicEventSummary, {
        event: calendar,
        source: { ...source, kind: "official_calendar" },
        now: null,
      }),
    );
    expect(html).toContain("Последний день включён");
    expect(html).toContain("2031");
    const exam = renderToStaticMarkup(
      createElement(AcademicEventSummary, {
        event,
        source,
        now: null,
        map: false,
      }),
    );
    expect(exam).toContain("examfx");
    expect(exam).not.toContain("Пересдача");
  });

  it("starts every alert and source-verification checkbox unchecked", () => {
    const preferences = renderToStaticMarkup(
      createElement(AcademicPreferencesForm, {
        initial: { ...DEFAULT_ACADEMIC_PREFERENCES },
        timezone: "Asia/Almaty",
        busy: false,
        onSave: vi.fn(),
        onDirtyChange: vi.fn(),
      }),
    );
    const checkboxes = [
      ...preferences.matchAll(/<input\b[^>]*type="checkbox"[^>]*>/g),
    ];
    expect(checkboxes).toHaveLength(6);
    expect(checkboxes.every((x) => !x[0].includes("checked"))).toBe(true);
    expect(preferences).toContain('value="10"');
    expect(preferences).toContain('value="1440, 120, 30"');
    const verification = renderToStaticMarkup(
      createElement(AcademicScheduleVerificationForm, {
        verification: overview.scheduleVerification,
        busy: false,
        onSave: vi.fn(),
        onDirtyChange: vi.fn(),
      }),
    );
    expect(
      verification.match(/<input\b[^>]*type="checkbox"[^>]*>/)?.[0],
    ).not.toContain("checked");
    expect(
      verification.match(/<button\b[^>]*type="submit"[^>]*>/)?.[0],
    ).toContain("disabled");
  });

  it("uses only a generic link when exact map geometry is unknown", () => {
    const html = renderToStaticMarkup(
      createElement(AcademicRoomMap, { location: "C1.2.221K" }),
    );
    expect(html).toContain("Точное место на карте не подтверждено");
    expect(html).toContain('href="https://yuujiso.github.io/aitumap/"');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("?room=");
    const known = renderToStaticMarkup(
      createElement(AcademicRoomMap, { location: "C1.3.319" }),
    );
    expect(known).toContain("C1.3.319P.png");
    expect(known).toContain("Проверенное обозначение на карте");
  });
});
