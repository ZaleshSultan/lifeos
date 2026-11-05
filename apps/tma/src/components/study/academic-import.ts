import {
  academicDate,
  academicTimestamp,
  academicTimezone,
  parseAcademicImport,
  type AcademicEventInput,
  type AcademicSourceInput,
} from "../../../../../packages/core/src/academic-concierge.js";
import type { AcademicImportBundle } from "../../api/study-concierge";

export const MAX_ACADEMIC_IMPORT_BYTES = 256 * 1024;
export type AcademicImportFormat = "json" | "csv" | "ics";
export interface AcademicImportOptions {
  format: AcademicImportFormat;
  filename: string;
  kind: "university_exam" | "personal_exam";
  timezone: string;
  sourceTypeCode: "exam" | "examfx";
  referenceAt: string;
}

export function localAcademicInput(
  timestamp: string | null,
  timezone: string,
): string {
  if (!timestamp) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const get = (key: string) => parts.find((p) => p.type === key)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** Wall-clock input is interpreted in its explicit source zone, never browser timezone. */
export function academicInputTimestamp(
  value: string,
  timezone: string,
): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw new Error("academic_import_time");
  academicDate(value.slice(0, 10));
  const zone = academicTimezone(timezone);
  const wanted = Date.parse(value + ":00Z");
  if (
    !Number.isFinite(wanted) ||
    Number(value.slice(11, 13)) > 23 ||
    Number(value.slice(14)) > 59
  )
    throw new Error("academic_import_time");
  let instant = wanted;
  for (let i = 0; i < 3; i++) {
    const displayed = localAcademicInput(new Date(instant).toISOString(), zone);
    const difference = Date.parse(displayed + ":00Z") - wanted;
    if (!difference) return academicTimestamp(new Date(instant).toISOString());
    instant -= difference;
  }
  throw new Error("academic_import_time");
}

export function academicOffsetsInput(value: string): number[] {
  const parts = value.split(/[,;\s]+/).filter(Boolean);
  if (
    !parts.length ||
    parts.length > 6 ||
    parts.some((x) => !/^\d{1,5}$/.test(x))
  )
    throw new Error("academic_offsets");
  const numbers = parts.map(Number);
  if (
    new Set(numbers).size !== numbers.length ||
    numbers.some((x) => x < 1 || x > 10080)
  )
    throw new Error("academic_offsets");
  return numbers.sort((a, b) => b - a);
}

function csvTable(text: string): string[][] {
  const rows: string[][] = [];
  let cells: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        if (!quoted && cell) throw new Error("academic_csv");
        quoted = !quoted;
      }
    } else if (!quoted && (ch === "," || ch === "\n" || ch === "\r")) {
      cells.push(cell.trim());
      cell = "";
      if (ch !== ",") {
        if (cells.some(Boolean)) rows.push(cells);
        cells = [];
        if (ch === "\r" && text[i + 1] === "\n") i++;
      }
    } else cell += ch;
  }
  if (quoted) throw new Error("academic_csv");
  cells.push(cell.trim());
  if (cells.some(Boolean)) rows.push(cells);
  if (
    rows.length < 2 ||
    rows.length > 501 ||
    new Set(rows[0]).size !== rows[0].length ||
    rows.slice(1).some((row) => row.length !== rows[0].length)
  )
    throw new Error("academic_csv");
  return rows;
}

async function digest(text: string): Promise<string> {
  const value = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(value)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
function unescapeIcs(value: string) {
  return value.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
}
function icsInstant(key: string, value: string, zone: string) {
  if (/^\d{8}T\d{6}Z$/.test(value))
    return academicTimestamp(
      value.replace(
        /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
        "$1-$2-$3T$4:$5:$6Z",
      ),
    );
  if (!/^\d{8}T\d{6}$/.test(value) || value.slice(-2) !== "00")
    throw new Error("academic_ics_time");
  const tzid = /(?:^|;)TZID=([^;]+)/.exec(key)?.[1] ?? zone;
  return academicInputTimestamp(
    value.replace(
      /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})\d{2}$/,
      "$1-$2-$3T$4:$5",
    ),
    tzid,
  );
}

/** Local parsing creates only preview data. It never authorizes imports or alerts. */
export async function academicFilePreview(
  text: string,
  options: AcademicImportOptions,
): Promise<AcademicImportBundle> {
  if (
    !text.trim() ||
    new TextEncoder().encode(text).length > MAX_ACADEMIC_IMPORT_BYTES
  )
    throw new Error("academic_import_size");
  if (options.format === "json") {
    const input: unknown = JSON.parse(text);
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).some((k) => !["sources", "events"].includes(k))
    )
      throw new Error("academic_import_schema");
    const parsed = parseAcademicImport({
      ...(input as AcademicImportBundle),
      requestId: "preview-only",
    });
    return { sources: parsed.sources, events: parsed.events };
  }
  const sha256 = await digest(text);
  const source: AcademicSourceInput = {
    key: "file:" + sha256.slice(0, 32),
    kind:
      options.kind === "personal_exam"
        ? "owner_provided"
        : "official_timetable",
    label:
      options.filename.trim().slice(0, 300) ||
      "Предоставленный файл расписания",
    sha256,
    sourceUrl: null,
    page: null,
    academicYear: null,
    groupCode: null,
    verifiedAt: academicTimestamp(options.referenceAt),
  };
  const timezone = academicTimezone(options.timezone);
  const events: AcademicEventInput[] = [];
  const add = async (
    item: Pick<
      AcademicEventInput,
      | "title"
      | "startsAt"
      | "endsAt"
      | "location"
      | "courseCode"
      | "sourceTypeCode"
    >,
  ) => {
    const fingerprint = await digest(
      JSON.stringify([
        options.kind,
        item.title.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim(),
        item.startsAt,
        item.location,
        item.sourceTypeCode,
      ]),
    );
    events.push({
      ...item,
      key: "event:" + fingerprint.slice(0, 40),
      sourceKey: source.key,
      kind: options.kind,
      timezone,
      startsOn: null,
      endsOn: null,
      trimester: null,
      periodType: null,
      status: "proposed",
    });
  };
  if (options.format === "csv") {
    const [header, ...rows] = csvTable(text.replace(/^\uFEFF/, ""));
    if (!["date", "start_local", "course"].every((key) => header.includes(key)))
      throw new Error("academic_csv_columns");
    for (const row of rows) {
      const values = Object.fromEntries(header.map((key, i) => [key, row[i]]));
      const zone = values.timezone || timezone;
      if (zone !== timezone) throw new Error("academic_import_mixed_timezone");
      const code = values.source_type_code || options.sourceTypeCode;
      if (!["exam", "examfx"].includes(code))
        throw new Error("academic_import_type");
      await add({
        title: values.course,
        startsAt: academicInputTimestamp(
          values.date + "T" + values.start_local,
          zone,
        ),
        endsAt: values.end_local
          ? academicInputTimestamp(values.date + "T" + values.end_local, zone)
          : null,
        location: values.room || values.location || null,
        courseCode:
          options.kind === "personal_exam" ? null : values.course_code || null,
        sourceTypeCode:
          options.kind === "personal_exam" ? null : (code as "exam" | "examfx"),
      });
    }
  } else {
    const unfolded = text.replace(/\r?\n[ \t]/g, "");
    if (
      !unfolded.includes("BEGIN:VCALENDAR") ||
      /(?:^|\n)(?:RRULE|RDATE|RECURRENCE-ID|EXDATE)[;:]/.test(unfolded)
    )
      throw new Error("academic_ics_recurrence");
    const pieces = unfolded.split("BEGIN:VEVENT").slice(1);
    if (!pieces.length || pieces.length > 500)
      throw new Error("academic_ics_events");
    for (const piece of pieces) {
      const body = piece.split("END:VEVENT", 1)[0];
      const fields = body
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => {
          const colon = line.indexOf(":");
          if (colon < 1) throw new Error("academic_ics_field");
          return [line.slice(0, colon), line.slice(colon + 1)] as const;
        });
      const get = (name: string) => {
        const matches = fields.filter(([key]) => key.split(";")[0] === name);
        if (matches.length > 1) throw new Error("academic_ics_duplicate_field");
        return matches[0];
      };
      const start = get("DTSTART");
      if (!start) throw new Error("academic_ics_time");
      const end = get("DTEND");
      const title = unescapeIcs(get("SUMMARY")?.[1] ?? "");
      const code =
        /\((examfx|exam)\)\s*$/.exec(title)?.[1] ?? options.sourceTypeCode;
      await add({
        title: title.replace(/\s*\((?:examfx|exam)\)\s*$/, ""),
        startsAt: icsInstant(...start, timezone),
        endsAt: end ? icsInstant(...end, timezone) : null,
        location: get("LOCATION") ? unescapeIcs(get("LOCATION")![1]) : null,
        courseCode: null,
        sourceTypeCode:
          options.kind === "personal_exam" ? null : (code as "exam" | "examfx"),
      });
    }
  }
  const parsed = parseAcademicImport({
    requestId: "preview-only",
    sources: [source],
    events,
  });
  return { sources: parsed.sources, events: parsed.events };
}
