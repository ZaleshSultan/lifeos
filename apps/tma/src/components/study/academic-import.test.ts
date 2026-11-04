import { describe, expect, it } from "vitest";
import {
  academicFilePreview,
  academicInputTimestamp,
  academicOffsetsInput,
  localAcademicInput,
} from "./academic-import";
import { academicCountdown } from "./academic-ui";
import type {
  AcademicEventInput,
  AcademicSourceInput,
} from "../../../../../packages/core/src/academic-concierge.js";

const options = {
  format: "csv" as const,
  filename: "invented-study.csv",
  kind: "university_exam" as const,
  timezone: "Asia/Almaty",
  sourceTypeCode: "exam" as const,
  referenceAt: "2026-10-01T00:00:00Z",
};
const csv =
  'date,start_local,end_local,course,room,source_type_code,timezone\n2030-11-12,09:00,10:00,"Invented, Systems",C1.3.323K,exam,Asia/Almaty\n2030-11-15,14:00,15:00,Synthetic Networks,C1.1.227P,examfx,Asia/Almaty';
const source: AcademicSourceInput = {
  key: "source-fixture",
  kind: "owner_provided",
  label: "Invented source",
  sha256: "a".repeat(64),
  sourceUrl: null,
  page: null,
  academicYear: null,
  groupCode: null,
  verifiedAt: options.referenceAt,
};
const event: AcademicEventInput = {
  key: "event-fixture",
  sourceKey: source.key,
  kind: "personal_exam",
  title: "Synthetic personal test",
  startsAt: "2030-11-12T11:00:00Z",
  endsAt: null,
  startsOn: null,
  endsOn: null,
  timezone: "Asia/Almaty",
  location: "Invented street, 5",
  courseCode: null,
  sourceTypeCode: null,
  trimester: null,
  periodType: null,
  status: "proposed",
};

describe("academic local preview and clocks", () => {
  it("preserves quoted CSV titles, exact institutional codes and UTC instants without approving or scheduling", async () => {
    const preview = await academicFilePreview(csv, options);
    expect(preview.events).toHaveLength(2);
    const primary = preview.events.find((x) => x.sourceTypeCode === "exam")!;
    expect(primary.title).toBe("Invented, Systems");
    expect(primary.startsAt).toBe("2030-11-12T04:00:00.000Z");
    expect(primary.endsAt).toBe("2030-11-12T05:00:00.000Z");
    expect(preview.events.every((x) => x.status === "proposed")).toBe(true);
    expect(
      preview.events.find((x) => x.sourceTypeCode === "examfx")?.title,
    ).toBe("Synthetic Networks");
    expect(JSON.stringify(preview)).not.toContain("remindersEnabled");
  });

  it("gives the same natural key to a CSV and UTC ICS event and never uses their notification alarms", async () => {
    const first = await academicFilePreview(
      csv.split("\n").slice(0, 2).join("\n"),
      options,
    );
    const ics =
      "BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:arbitrary-file-id\nDTSTART:20301112T040000Z\nDTEND:20301112T050000Z\nSUMMARY:Invented\\, Systems (exam)\nLOCATION:C1.3.323K\nBEGIN:VALARM\nTRIGGER:-PT10M\nACTION:DISPLAY\nDESCRIPTION:Untrusted alarm\nEND:VALARM\nEND:VEVENT\nEND:VCALENDAR";
    const second = await academicFilePreview(ics, {
      ...options,
      format: "ics",
    });
    expect(second.events[0].key).toBe(first.events[0].key);
    expect(second.events[0].status).toBe("proposed");
    expect(Object.keys(second.events[0])).not.toContain("TRIGGER");
  });

  it("keeps a personal event separate, retains the original location and leaves its end unknown", async () => {
    const value = await academicFilePreview(
      "date,start_local,course,room\n2030-11-12,16:00,Synthetic personal test,Invented address",
      { ...options, kind: "personal_exam" },
    );
    expect(value.sources[0].kind).toBe("owner_provided");
    expect(value.events[0]).toMatchObject({
      kind: "personal_exam",
      sourceTypeCode: null,
      courseCode: null,
      endsAt: null,
      location: "Invented address",
      status: "proposed",
    });
  });

  it("validates normalized JSON and rejects embedded notification authority", async () => {
    const text = JSON.stringify({ sources: [source], events: [event] });
    expect(
      (await academicFilePreview(text, { ...options, format: "json" }))
        .events[0],
    ).toEqual({ ...event, startsAt: "2030-11-12T11:00:00.000Z" });
    await expect(
      academicFilePreview(
        JSON.stringify({
          sources: [source],
          events: [event],
          paidCallsAuthorized: true,
        }),
        { ...options, format: "json" },
      ),
    ).rejects.toThrow();
    await expect(
      academicFilePreview(
        JSON.stringify({
          sources: [source],
          events: [{ ...event, userId: "foreign-owner" }],
        }),
        { ...options, format: "json" },
      ),
    ).rejects.toThrow();
  });

  it("rejects malformed, duplicate, oversized, recurring and timezone-inconsistent inputs", async () => {
    await expect(
      academicFilePreview(csv + "\n" + csv.split("\n")[1], options),
    ).rejects.toThrow();
    await expect(
      academicFilePreview(
        'date,start_local,course\n2030-11-12,09:00,"unterminated',
        options,
      ),
    ).rejects.toThrow();
    await expect(
      academicFilePreview("x".repeat(256 * 1024 + 1), options),
    ).rejects.toThrow();
    await expect(
      academicFilePreview(csv.replaceAll("Asia/Almaty", "Asia/Tokyo"), options),
    ).rejects.toThrow();
    await expect(
      academicFilePreview(
        "BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART:20301112T040000Z\nSUMMARY:Synthetic\nRRULE:FREQ=DAILY\nEND:VEVENT\nEND:VCALENDAR",
        { ...options, format: "ics" },
      ),
    ).rejects.toThrow();
  });

  it("round-trips source-local time and rejects nonexistent dates and DST wall clocks", () => {
    expect(academicInputTimestamp("2030-11-12T00:30", "Asia/Almaty")).toBe(
      "2030-11-11T19:30:00.000Z",
    );
    expect(localAcademicInput("2030-11-11T19:30:00Z", "Asia/Almaty")).toBe(
      "2030-11-12T00:30",
    );
    expect(() =>
      academicInputTimestamp("2030-02-30T09:00", "Asia/Almaty"),
    ).toThrow();
    expect(() =>
      academicInputTimestamp("2027-03-14T02:30", "America/New_York"),
    ).toThrow();
    expect(() =>
      academicInputTimestamp("2030-11-12T25:00", "Asia/Almaty"),
    ).toThrow();
  });

  it("uses event-local days for countdowns and never invents a passed exam result", () => {
    expect(
      academicCountdown(
        { ...event, startsAt: "2030-11-13T04:00:00Z" },
        "2030-11-11T20:30:00Z",
      ),
    ).toBe("Завтра");
    expect(academicCountdown(event, "2030-11-12T12:00:00Z")).toBe(
      "Время начала прошло",
    );
    expect(
      academicCountdown(
        { ...event, endsAt: "2030-11-12T12:00:00Z" },
        "2030-11-12T13:00:00Z",
      ),
    ).toContain("результат неизвестен");
  });

  it("keeps reminder offsets bounded, distinct and separate from file input", () => {
    expect(academicOffsetsInput("30; 1440, 120")).toEqual([1440, 120, 30]);
    for (const text of [
      "",
      "0",
      "-1",
      "10,10",
      "1e2",
      "10081",
      "1,2,3,4,5,6,7",
    ])
      expect(() => academicOffsetsInput(text)).toThrow();
  });
});
