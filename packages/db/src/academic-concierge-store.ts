import type { SupabaseClient } from "@supabase/supabase-js";
import {
  academicDate,
  academicKey,
  academicObject,
  academicRevision,
  academicText,
  academicTimestamp,
  academicTimezone,
  parseAcademicEvent,
  parseAcademicEventRevision,
  parseAcademicImport,
  parseAcademicPreferences,
  parseAcademicScheduleVerification,
  parseAcademicSource,
  type AcademicEventRevisionInput,
  type AcademicImportInput,
  type AcademicImportResult,
  type AcademicOverview,
  type AcademicPreferences,
  type AcademicScheduleVerificationInput,
} from "../../core/src/academic-concierge.js";

export class AcademicStoreError extends Error {
  constructor(
    readonly code:
      | "academic_invalid_input"
      | "academic_conflict"
      | "academic_not_found"
      | "academic_unavailable",
  ) {
    super(code);
    this.name = "AcademicStoreError";
  }
}
/** Structural client contract permits the existing generated schema to migrate separately. */
type AcademicClient = Pick<SupabaseClient, "rpc">;
function id(v: unknown): string {
  if (
    typeof v !== "string" ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v)
  )
    throw new AcademicStoreError("academic_invalid_input");
  return v;
}
function bool(v: unknown): boolean {
  if (typeof v !== "boolean") throw new Error();
  return v;
}
const nullableTime = (v: unknown) => (v === null ? null : academicTimestamp(v));
const nullableDate = (v: unknown) => (v === null ? null : academicDate(v));
const nullableText = (v: unknown) => (v === null ? null : academicText(v));
export function parseAcademicOverview(input: unknown): AcademicOverview {
  try {
    const v = academicObject(input, [
      "timezone",
      "sources",
      "events",
      "preferences",
      "scheduleVerification",
      "lms",
      "classes",
      "assignments",
      "warnings",
      "truncated",
    ]);
    if (
      !Array.isArray(v.sources) ||
      v.sources.length > 100 ||
      !Array.isArray(v.events) ||
      v.events.length > 500 ||
      !Array.isArray(v.classes) ||
      v.classes.length > 100 ||
      !Array.isArray(v.assignments) ||
      v.assignments.length > 100 ||
      !Array.isArray(v.warnings) ||
      v.warnings.length > 20
    )
      throw new Error();
    const verification = academicObject(v.scheduleVerification, [
      "revision",
      "validFrom",
      "validThrough",
      "sourceLabel",
      "verifiedAt",
      "current",
      "changed",
    ]);
    const lms = academicObject(v.lms, [
      "configured",
      "stale",
      "lastSuccessfulSyncAt",
      "state",
    ]);
    return {
      timezone: academicTimezone(v.timezone),
      preferences: parseAcademicPreferences(v.preferences),
      sources: v.sources.map((value) => {
        const { revision, ...source } = value as Record<string, unknown>;
        const parsed = parseAcademicSource(source);
        const r = academicRevision(revision);
        if (!r) throw new Error();
        return { ...parsed, revision: r };
      }),
      events: v.events.map((value) => {
        const {
          id: recordId,
          revision,
          manuallyEdited,
          updatedAt,
          ...event
        } = value as Record<string, unknown>;
        const parsed = parseAcademicEvent(event),
          r = academicRevision(revision);
        if (!r) throw new Error();
        return {
          ...parsed,
          id: id(recordId),
          revision: r,
          manuallyEdited: bool(manuallyEdited),
          updatedAt: academicTimestamp(updatedAt),
        };
      }),
      scheduleVerification: {
        revision: academicRevision(verification.revision),
        validFrom: nullableDate(verification.validFrom),
        validThrough: nullableDate(verification.validThrough),
        sourceLabel: nullableText(verification.sourceLabel),
        verifiedAt: nullableTime(verification.verifiedAt),
        current: bool(verification.current),
        changed: bool(verification.changed),
      },
      lms: {
        configured: bool(lms.configured),
        stale: bool(lms.stale),
        lastSuccessfulSyncAt: nullableTime(lms.lastSuccessfulSyncAt),
        state: academicText(lms.state, 80),
      },
      classes: v.classes.map((value) => {
        const c = academicObject(value, [
          "key",
          "title",
          "startsAt",
          "endsAt",
          "location",
          "courseCode",
        ]);
        return {
          key: academicKey(c.key),
          title: academicText(c.title),
          startsAt: academicTimestamp(c.startsAt),
          endsAt: academicTimestamp(c.endsAt),
          location: nullableText(c.location),
          courseCode: academicText(c.courseCode, 100),
        };
      }),
      assignments: v.assignments.map((value) => {
        const a = academicObject(value, [
          "key",
          "title",
          "courseTitle",
          "dueAt",
          "sourceUrl",
          "submissionState",
          "verified",
          "stale",
        ]);
        if (
          !["not_submitted", "submitted", "graded", "unknown"].includes(
            String(a.submissionState),
          )
        )
          throw new Error();
        let sourceUrl: string | null = null;
        if (a.sourceUrl !== null) {
          const raw = academicText(a.sourceUrl, 1000);
          if (
            !/^https:\/\/lms\.astanait\.edu\.kz\/mod\/assign\/view\.php\?id=[1-9]\d*$/.test(
              raw,
            )
          )
            throw new Error();
          sourceUrl = raw;
        }
        return {
          key: academicKey(a.key),
          title: academicText(a.title),
          courseTitle: nullableText(a.courseTitle),
          dueAt: academicTimestamp(a.dueAt),
          sourceUrl,
          submissionState:
            a.submissionState as AcademicOverview["assignments"][number]["submissionState"],
          verified: bool(a.verified),
          stale: bool(a.stale),
        };
      }),
      warnings: v.warnings.map((w) => {
        if (typeof w !== "string" || !/^[a-z_]{1,80}$/.test(w))
          throw new Error();
        return w;
      }),
      truncated: bool(v.truncated),
    };
  } catch {
    throw new AcademicStoreError("academic_unavailable");
  }
}
async function service(
  client: AcademicClient,
  userId: string,
  operation: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  id(userId);
  const { data, error } = await client.rpc("academic_service", {
    p_user_id: userId,
    p_operation: operation,
    p_args: args,
  });
  if (error) {
    const message = error.message;
    if (message === "academic_conflict")
      throw new AcademicStoreError("academic_conflict");
    if (message === "academic_not_found")
      throw new AcademicStoreError("academic_not_found");
    if (
      [
        "academic_invalid_input",
        "academic_invalid_timezone",
        "academic_schedule_empty",
        "academic_course_not_found",
        "academic_import_history_full",
        "academic_history_full",
      ].includes(message)
    )
      throw new AcademicStoreError("academic_invalid_input");
    throw new AcademicStoreError("academic_unavailable");
  }
  return data;
}
export async function getAcademicOverview(
  client: AcademicClient,
  userId: string,
): Promise<AcademicOverview> {
  return parseAcademicOverview(await service(client, userId, "overview", {}));
}
export async function saveAcademicPreferences(
  client: AcademicClient,
  userId: string,
  input: { expectedRevision: number; preferences: AcademicPreferences },
): Promise<AcademicOverview> {
  const expectedRevision = academicRevision(input.expectedRevision),
    parsed = parseAcademicPreferences(input.preferences);
  if (parsed.revision !== expectedRevision)
    throw new AcademicStoreError("academic_conflict");
  const { revision: _, ...preferences } = parsed;
  return parseAcademicOverview(
    await service(client, userId, "save_preferences", {
      expectedRevision,
      preferences,
    }),
  );
}
export async function importAcademicRecords(
  client: AcademicClient,
  userId: string,
  input: AcademicImportInput,
): Promise<AcademicImportResult> {
  const parsed = parseAcademicImport(input);
  const raw = academicObject(
    await service(
      client,
      userId,
      "import",
      parsed as unknown as Record<string, unknown>,
    ),
    ["created", "unchanged", "conflicts", "overview"],
  );
  if (
    !Number.isSafeInteger(raw.created) ||
    (raw.created as number) < 0 ||
    !Number.isSafeInteger(raw.unchanged) ||
    (raw.unchanged as number) < 0 ||
    !Array.isArray(raw.conflicts) ||
    raw.conflicts.some((x) => typeof x !== "string" || x.length > 180)
  )
    throw new AcademicStoreError("academic_unavailable");
  return {
    created: raw.created as number,
    unchanged: raw.unchanged as number,
    conflicts: raw.conflicts as string[],
    overview: parseAcademicOverview(raw.overview),
  };
}
export async function reviseAcademicEvent(
  client: AcademicClient,
  userId: string,
  eventId: string,
  input: AcademicEventRevisionInput,
): Promise<AcademicOverview> {
  const parsed = parseAcademicEventRevision(input);
  return parseAcademicOverview(
    await service(client, userId, "revise_event", {
      id: id(eventId),
      ...parsed,
    }),
  );
}
export async function verifyAcademicSchedule(
  client: AcademicClient,
  userId: string,
  input: AcademicScheduleVerificationInput,
): Promise<AcademicOverview> {
  const parsed = parseAcademicScheduleVerification(input);
  return parseAcademicOverview(
    await service(
      client,
      userId,
      "verify_schedule",
      parsed as unknown as Record<string, unknown>,
    ),
  );
}
