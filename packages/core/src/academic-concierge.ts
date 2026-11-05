/** Academic source records are data, never notification consent or model authority. */
export const ACADEMIC_TIMEZONE = "Asia/Almaty";
export type AcademicSourceKind =
  | "official_timetable"
  | "official_calendar"
  | "owner_provided";
export type AcademicEventKind =
  | "university_exam"
  | "personal_exam"
  | "calendar_period"
  | "holiday";
export type AcademicEventStatus = "proposed" | "confirmed" | "cancelled";
export interface AcademicSourceInput {
  key: string;
  kind: AcademicSourceKind;
  label: string;
  sha256: string;
  sourceUrl: string | null;
  page: number | null;
  academicYear: string | null;
  groupCode: string | null;
  verifiedAt: string;
}
export interface AcademicSource extends AcademicSourceInput {
  revision: number;
}
export interface AcademicEventInput {
  key: string;
  sourceKey: string;
  kind: AcademicEventKind;
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  startsOn: string | null;
  /** Inclusive calendar date, unlike the exclusive DTEND of all-day ICS events. */
  endsOn: string | null;
  timezone: string;
  location: string | null;
  courseCode: string | null;
  sourceTypeCode: "exam" | "examfx" | null;
  trimester: 1 | 2 | 3 | null;
  periodType: string | null;
  status: AcademicEventStatus;
}
export interface AcademicEvent extends AcademicEventInput {
  id: string;
  revision: number;
  manuallyEdited: boolean;
  updatedAt: string;
}
export interface AcademicPreferences {
  revision: number;
  classAlertsEnabled: boolean;
  assignmentAlertsEnabled: boolean;
  examAlertsEnabled: boolean;
  personalAlertsEnabled: boolean;
  staleWarningEnabled: boolean;
  includeOnlineClasses: boolean;
  classOffsetMinutes: number;
  assignmentOffsetsMinutes: number[];
  examOffsetsMinutes: number[];
  personalOffsetsMinutes: number[];
  quietStart: string;
  quietEnd: string;
}
export const DEFAULT_ACADEMIC_PREFERENCES: AcademicPreferences = {
  revision: 0,
  classAlertsEnabled: false,
  assignmentAlertsEnabled: false,
  examAlertsEnabled: false,
  personalAlertsEnabled: false,
  staleWarningEnabled: false,
  includeOnlineClasses: false,
  classOffsetMinutes: 10,
  assignmentOffsetsMinutes: [1440, 180, 30],
  examOffsetsMinutes: [1440, 120],
  personalOffsetsMinutes: [1440, 120, 30],
  quietStart: "22:00",
  quietEnd: "07:00",
};
export interface AcademicScheduleVerification {
  revision: number;
  validFrom: string | null;
  validThrough: string | null;
  sourceLabel: string | null;
  verifiedAt: string | null;
  current: boolean;
  changed: boolean;
}
export interface AcademicOverview {
  timezone: string;
  sources: AcademicSource[];
  events: AcademicEvent[];
  preferences: AcademicPreferences;
  scheduleVerification: AcademicScheduleVerification;
  lms: {
    configured: boolean;
    stale: boolean;
    lastSuccessfulSyncAt: string | null;
    state: string;
  };
  classes: Array<{
    key: string;
    title: string;
    startsAt: string;
    endsAt: string;
    location: string | null;
    courseCode: string;
  }>;
  assignments: Array<{
    key: string;
    title: string;
    courseTitle: string | null;
    dueAt: string;
    sourceUrl: string | null;
    submissionState: "not_submitted" | "submitted" | "graded" | "unknown";
    verified: boolean;
    stale: boolean;
  }>;
  warnings: string[];
  truncated: boolean;
}
export interface AcademicImportInput {
  requestId: string;
  sources: AcademicSourceInput[];
  events: AcademicEventInput[];
}
export interface AcademicImportResult {
  created: number;
  unchanged: number;
  conflicts: string[];
  overview: AcademicOverview;
}
export interface AcademicEventRevisionInput {
  expectedRevision: number;
  patch: Partial<
    Pick<
      AcademicEventInput,
      "title" | "startsAt" | "endsAt" | "location" | "status"
    >
  >;
  confirmed: true;
}
export interface AcademicScheduleVerificationInput {
  expectedRevision: number;
  validFrom: string;
  validThrough: string;
  sourceLabel: string;
  confirmed: true;
}
export class AcademicInputError extends Error {
  readonly code = "academic_invalid_input";
  constructor() {
    super("Review the academic input and try again.");
    this.name = "AcademicInputError";
  }
}
function invalid(): never {
  throw new AcademicInputError();
}
export function academicObject(
  input: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) invalid();
  const v = input as Record<string, unknown>;
  if (Object.keys(v).some((key) => !keys.includes(key))) invalid();
  return v;
}
export function academicText(value: unknown, max = 500): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)
  )
    invalid();
  return value.trim();
}
function nullableText(value: unknown, max = 500): string | null {
  return value === null ? null : academicText(value, max);
}
export function academicKey(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9:_.-]{0,159}$/.test(value)
  )
    invalid();
  return value;
}
export function academicRevision(value: unknown): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    (value as number) > 2147483646
  )
    invalid();
  return value as number;
}
export function academicDate(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^(?:20\d{2}|2100)-\d{2}-\d{2}$/.test(value)
  )
    invalid();
  const date = new Date(value + "T00:00:00Z");
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  )
    invalid();
  return value;
}
export function academicTimestamp(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 40 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    )
  )
    invalid();
  academicDate(value.slice(0, 10));
  if (
    Number(value.slice(11, 13)) > 23 ||
    Number(value.slice(14, 16)) > 59 ||
    Number(value.slice(17, 19)) > 59
  )
    invalid();
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) invalid();
  return date.toISOString();
}
export function academicTimezone(value: unknown): string {
  const zone = academicText(value, 80);
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone }).format(0);
  } catch {
    invalid();
  }
  return zone;
}
export function academicLocalDate(instant: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: academicTimezone(timezone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(academicTimestamp(instant)));
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function offsets(input: unknown): number[] {
  if (
    !Array.isArray(input) ||
    input.length < 1 ||
    input.length > 6 ||
    new Set(input).size !== input.length ||
    input.some((x) => !Number.isSafeInteger(x) || x < 1 || x > 10080)
  )
    invalid();
  return [...input].sort((a, b) => b - a);
}
export function parseAcademicPreferences(input: unknown): AcademicPreferences {
  const v = academicObject(input, Object.keys(DEFAULT_ACADEMIC_PREFERENCES));
  const out = {
    ...DEFAULT_ACADEMIC_PREFERENCES,
    revision: academicRevision(v.revision),
  };
  for (const key of [
    "classAlertsEnabled",
    "assignmentAlertsEnabled",
    "examAlertsEnabled",
    "personalAlertsEnabled",
    "staleWarningEnabled",
    "includeOnlineClasses",
  ] as const) {
    if (typeof v[key] !== "boolean") invalid();
    out[key] = v[key];
  }
  for (const key of ["quietStart", "quietEnd"] as const) {
    if (
      typeof v[key] !== "string" ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v[key])
    )
      invalid();
    out[key] = v[key];
  }
  if (
    !Number.isSafeInteger(v.classOffsetMinutes) ||
    (v.classOffsetMinutes as number) < 1 ||
    (v.classOffsetMinutes as number) > 120
  )
    invalid();
  out.classOffsetMinutes = v.classOffsetMinutes as number;
  out.assignmentOffsetsMinutes = offsets(v.assignmentOffsetsMinutes);
  out.examOffsetsMinutes = offsets(v.examOffsetsMinutes);
  out.personalOffsetsMinutes = offsets(v.personalOffsetsMinutes);
  return out;
}
export function parseAcademicSource(input: unknown): AcademicSourceInput {
  const v = academicObject(input, [
    "key",
    "kind",
    "label",
    "sha256",
    "sourceUrl",
    "page",
    "academicYear",
    "groupCode",
    "verifiedAt",
  ]);
  if (
    !["official_timetable", "official_calendar", "owner_provided"].includes(
      String(v.kind),
    ) ||
    typeof v.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(v.sha256)
  )
    invalid();
  let sourceUrl: string | null = null;
  if (v.sourceUrl !== null) {
    const raw = academicText(v.sourceUrl, 1000);
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      invalid();
    }
    if (
      url.protocol !== "https:" ||
      !["astanait.edu.kz", "www.astanait.edu.kz"].includes(url.hostname) ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      invalid();
    sourceUrl = url.href;
  }
  if (
    v.page !== null &&
    (!Number.isSafeInteger(v.page) ||
      (v.page as number) < 1 ||
      (v.page as number) > 10000)
  )
    invalid();
  const academicYear = nullableText(v.academicYear, 9);
  if (academicYear !== null && !/^20\d{2}-20\d{2}$/.test(academicYear))
    invalid();
  return {
    key: academicKey(v.key),
    kind: v.kind as AcademicSourceKind,
    label: academicText(v.label, 300),
    sha256: v.sha256,
    sourceUrl,
    page: v.page as number | null,
    academicYear,
    groupCode: nullableText(v.groupCode, 40),
    verifiedAt: academicTimestamp(v.verifiedAt),
  };
}
export function parseAcademicEvent(input: unknown): AcademicEventInput {
  const v = academicObject(input, [
    "key",
    "sourceKey",
    "kind",
    "title",
    "startsAt",
    "endsAt",
    "startsOn",
    "endsOn",
    "timezone",
    "location",
    "courseCode",
    "sourceTypeCode",
    "trimester",
    "periodType",
    "status",
  ]);
  if (
    ![
      "university_exam",
      "personal_exam",
      "calendar_period",
      "holiday",
    ].includes(String(v.kind)) ||
    !["proposed", "confirmed", "cancelled"].includes(String(v.status))
  )
    invalid();
  const startsAt = v.startsAt === null ? null : academicTimestamp(v.startsAt),
    endsAt = v.endsAt === null ? null : academicTimestamp(v.endsAt);
  const startsOn = v.startsOn === null ? null : academicDate(v.startsOn),
    endsOn = v.endsOn === null ? null : academicDate(v.endsOn);
  const timed = v.kind === "university_exam" || v.kind === "personal_exam";
  if (
    timed
      ? startsAt === null ||
        startsOn !== null ||
        endsOn !== null ||
        (endsAt !== null && endsAt <= startsAt)
      : startsAt !== null ||
        endsAt !== null ||
        startsOn === null ||
        endsOn === null ||
        endsOn < startsOn
  )
    invalid();
  const courseCode = nullableText(v.courseCode, 100);
  if (v.kind !== "personal_exam" && v.timezone !== ACADEMIC_TIMEZONE) invalid();
  if (
    v.sourceTypeCode !== null &&
    v.sourceTypeCode !== "exam" &&
    v.sourceTypeCode !== "examfx"
  )
    invalid();
  if (
    v.kind === "personal_exam" &&
    (courseCode !== null || v.sourceTypeCode !== null)
  )
    invalid();
  if (v.kind === "university_exam" && v.sourceTypeCode === null) invalid();
  if (v.trimester !== null && ![1, 2, 3].includes(v.trimester as number))
    invalid();
  return {
    key: academicKey(v.key),
    sourceKey: academicKey(v.sourceKey),
    kind: v.kind as AcademicEventKind,
    title: academicText(v.title),
    startsAt,
    endsAt,
    startsOn,
    endsOn,
    timezone: academicTimezone(v.timezone),
    location: nullableText(v.location),
    courseCode,
    sourceTypeCode: v.sourceTypeCode as "exam" | "examfx" | null,
    trimester: v.trimester as 1 | 2 | 3 | null,
    periodType: nullableText(v.periodType, 100),
    status: v.status as AcademicEventStatus,
  };
}
export function parseAcademicImport(input: unknown): AcademicImportInput {
  const v = academicObject(input, ["requestId", "sources", "events"]);
  if (
    !Array.isArray(v.sources) ||
    v.sources.length < 1 ||
    v.sources.length > 100 ||
    !Array.isArray(v.events) ||
    v.events.length < 1 ||
    v.events.length > 500
  )
    invalid();
  const sources = v.sources
    .map(parseAcademicSource)
    .sort((a, b) => a.key.localeCompare(b.key));
  const events = v.events
    .map(parseAcademicEvent)
    .sort((a, b) => a.key.localeCompare(b.key));
  if (
    new Set(sources.map((s) => s.key)).size !== sources.length ||
    new Set(events.map((e) => e.key)).size !== events.length
  )
    invalid();
  for (const event of events) {
    const source = sources.find((s) => s.key === event.sourceKey);
    if (
      !source ||
      (event.kind === "personal_exam"
        ? source.kind !== "owner_provided" || event.status !== "proposed"
        : event.kind === "university_exam"
          ? source.kind !== "official_timetable"
          : source.kind !== "official_calendar")
    )
      invalid();
  }
  return { requestId: academicKey(v.requestId), sources, events };
}
export function parseAcademicEventRevision(
  input: unknown,
): AcademicEventRevisionInput {
  const v = academicObject(input, ["expectedRevision", "patch", "confirmed"]);
  if (v.confirmed !== true) invalid();
  const patch = academicObject(v.patch, [
    "title",
    "startsAt",
    "endsAt",
    "location",
    "status",
  ]);
  if (!Object.keys(patch).length) invalid();
  const out: AcademicEventRevisionInput["patch"] = {};
  if ("title" in patch) out.title = academicText(patch.title);
  if ("location" in patch) out.location = nullableText(patch.location);
  for (const key of ["startsAt", "endsAt"] as const)
    if (key in patch)
      out[key] = patch[key] === null ? null : academicTimestamp(patch[key]);
  if ("status" in patch) {
    if (!["proposed", "confirmed", "cancelled"].includes(String(patch.status)))
      invalid();
    out.status = patch.status as AcademicEventStatus;
  }
  return {
    expectedRevision: academicRevision(v.expectedRevision),
    patch: out,
    confirmed: true,
  };
}
export function parseAcademicScheduleVerification(
  input: unknown,
): AcademicScheduleVerificationInput {
  const v = academicObject(input, [
    "expectedRevision",
    "validFrom",
    "validThrough",
    "sourceLabel",
    "confirmed",
  ]);
  if (v.confirmed !== true) invalid();
  const validFrom = academicDate(v.validFrom),
    validThrough = academicDate(v.validThrough);
  if (
    validThrough < validFrom ||
    Date.parse(validThrough) - Date.parse(validFrom) > 180 * 86400000
  )
    invalid();
  return {
    expectedRevision: academicRevision(v.expectedRevision),
    validFrom,
    validThrough,
    sourceLabel: academicText(v.sourceLabel, 300),
    confirmed: true,
  };
}
/** Read-only preview; actual delivery rechecks all consent/source facts transactionally. */
export function academicReminderPreview(
  event: AcademicEventInput,
  preferences: AcademicPreferences,
): string[] {
  if (event.status !== "confirmed" || !event.startsAt) return [];
  const enabled =
    event.kind === "university_exam"
      ? preferences.examAlertsEnabled
      : event.kind === "personal_exam"
        ? preferences.personalAlertsEnabled
        : false;
  if (!enabled) return [];
  const values =
    event.kind === "university_exam"
      ? preferences.examOffsetsMinutes
      : preferences.personalOffsetsMinutes;
  return values.map((minutes) =>
    new Date(Date.parse(event.startsAt!) - minutes * 60000).toISOString(),
  );
}
export function academicEventDaysAway(
  event: AcademicEventInput,
  now: string,
): number | null {
  const day =
    event.startsOn ??
    (event.startsAt ? academicLocalDate(event.startsAt, event.timezone) : null);
  return day === null
    ? null
    : Math.round(
        (Date.parse(day) - Date.parse(academicLocalDate(now, event.timezone))) /
          86400000,
      );
}
