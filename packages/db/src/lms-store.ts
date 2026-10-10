import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  classifyStudyWork,
  type StudyWorkItem,
  type StudyWorkKind,
  type StudySubmissionStatus,
} from "@lifeos/core";
import type { Database, Json } from "./types.js";

type Client = SupabaseClient<Database>;
export type LmsConnectionState =
  | "not_configured"
  | "legacy_configuration"
  | "connected"
  | "session_expired"
  | "reauthentication_required"
  | "syncing"
  | "error";
export interface LmsConnection {
  configured: boolean;
  state: LmsConnectionState;
  lastSyncSuccessAt: string | null;
  lastSyncAttemptAt: string | null;
  lastErrorCategory: string | null;
  sessionExpiresAt: string | null;
  syncRequestedAt: string | null;
  unsupportedFeatures: string[];
}
export interface LmsWork {
  timezone: string;
  lastSyncSuccessAt: string | null;
  lastSyncAttemptAt: string | null;
  stale: boolean;
  truncated: boolean;
  warnings: string[];
  unsupportedFeatures: string[];
  items: StudyWorkItem[];
}
export interface ManualStudyWork {
  title: string;
  courseTitle: string | null;
  kind: Exclude<StudyWorkKind, "unknown">;
  dueAt: string | null;
  submissionStatus: Exclude<StudySubmissionStatus, "graded">;
}
export interface LmsSessionStore {
  getLmsConnection(userId: string): Promise<LmsConnection>;
  saveLmsSession(input: {
    userId: string;
    encryptedCookie: string;
    expiresAt: string;
  }): Promise<LmsConnection>;
  deleteLmsSession(userId: string): Promise<LmsConnection>;
  requestLmsSync(userId: string): Promise<void>;
  getLmsWork(userId: string, timezone: string): Promise<LmsWork>;
  addManualStudyWork(userId: string, work: ManualStudyWork): Promise<void>;
}
export class LmsStoreError extends Error {
  constructor(
    public readonly code:
      | "lms_sync_in_progress"
      | "lms_session_required"
      | "lms_unavailable",
  ) {
    super(code);
  }
}
const metadataColumns =
  "auth_mode,is_active,is_token_valid,session_state,session_expires_at,last_sync_success_at,last_sync_attempt_at,last_error_category,sync_requested_at,unsupported_features" as const;
const errorCategories = new Set([
  "encryption_unavailable",
  "decryption_failed",
  "session_expired",
  "reauthentication_required",
  "connection_failed",
  "unsupported_auth_flow",
  "partial_sync",
  "unsupported_page",
  "sync_failed",
]);
// Only machine-readable codes cross the boundary; no raw Moodle/network output.
function safeCodes(codes: unknown): string[] {
  return Array.isArray(codes)
    ? codes
        .filter(
          (c): c is string =>
            typeof c === "string" && /^[a-z][a-z0-9_:.-]{0,95}$/.test(c),
        )
        .slice(0, 40)
    : [];
}
export async function getLmsConnection(
  client: Client,
  userId: string,
  now = new Date(),
): Promise<LmsConnection> {
  const { data, error } = await client
    .from("user_lms_settings")
    .select(metadataColumns)
    .eq("user_id", userId)
    .eq("platform_type", "aitu_moodle")
    .maybeSingle();
  if (error) throw new LmsStoreError("lms_unavailable");
  const expired =
    data?.auth_mode === "session" &&
    data.session_expires_at !== null &&
    Date.parse(data.session_expires_at) <= now.getTime();
  return {
    configured: Boolean(
      data?.auth_mode === "session" &&
      data.is_active &&
      data.is_token_valid &&
      !expired &&
      data.session_expires_at &&
      ["connected", "syncing", "error"].includes(data.session_state),
    ),
    state: !data
      ? "not_configured"
      : data.auth_mode === "password"
        ? "legacy_configuration"
        : expired
          ? "session_expired"
          : data.session_state,
    lastSyncSuccessAt: data?.last_sync_success_at ?? null,
    lastSyncAttemptAt: data?.last_sync_attempt_at ?? null,
    lastErrorCategory: expired
      ? "session_expired"
      : data?.last_error_category &&
          errorCategories.has(data.last_error_category)
        ? data.last_error_category
        : null,
    sessionExpiresAt: data?.session_expires_at ?? null,
    syncRequestedAt: data?.sync_requested_at ?? null,
    unsupportedFeatures: safeCodes(data?.unsupported_features),
  };
}
async function withLease<T>(
  client: Client,
  userId: string,
  run: (owner: string) => Promise<T>,
): Promise<T> {
  const owner = randomUUID();
  const args = {
    p_user_id: userId,
    p_platform_type: "aitu_moodle",
    p_owner: owner,
  };
  const { data, error } = await client.rpc("claim_lms_sync_lease", {
    ...args,
    p_ttl_seconds: 30,
  });
  if (error) throw new LmsStoreError("lms_unavailable");
  if (!data) throw new LmsStoreError("lms_sync_in_progress");
  try {
    return await run(owner);
  } finally {
    await client.rpc("release_lms_sync_lease", args);
  }
}
export async function saveLmsSession(
  client: Client,
  input: { userId: string; encryptedCookie: string; expiresAt: string },
): Promise<LmsConnection> {
  if (
    !/^enc:v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/.test(
      input.encryptedCookie,
    )
  )
    throw new LmsStoreError("lms_unavailable");
  return withLease(client, input.userId, async (owner) => {
    const { data, error } = await client.rpc("save_lms_session", {
      p_user_id: input.userId,
      p_owner: owner,
      p_encrypted_cookie: input.encryptedCookie,
      p_expires_at: input.expiresAt,
    });
    if (error) throw new LmsStoreError("lms_unavailable");
    if (!data) throw new LmsStoreError("lms_sync_in_progress");
    return getLmsConnection(client, input.userId);
  });
}
export async function deleteLmsSession(
  client: Client,
  userId: string,
): Promise<LmsConnection> {
  return withLease(client, userId, async (owner) => {
    const { data, error } = await client.rpc("delete_lms_session", {
      p_user_id: userId,
      p_owner: owner,
    });
    if (error) throw new LmsStoreError("lms_unavailable");
    if (!data) throw new LmsStoreError("lms_sync_in_progress");
    return getLmsConnection(client, userId);
  });
}
export async function requestLmsSync(
  client: Client,
  userId: string,
): Promise<void> {
  const now = new Date().toISOString();
  const { data, error } = await client
    .from("user_lms_settings")
    .update({ sync_requested_at: now })
    .eq("user_id", userId)
    .eq("platform_type", "aitu_moodle")
    .eq("auth_mode", "session")
    .eq("is_active", true)
    .eq("is_token_valid", true)
    .gt("session_expires_at", now)
    .select("id");
  if (error) throw new LmsStoreError("lms_unavailable");
  if (!data?.length) throw new LmsStoreError("lms_session_required");
}
function object(v: Json): Record<string, Json | undefined> {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}
function iso(v: unknown): string | null {
  return typeof v === "string" && Number.isFinite(Date.parse(v))
    ? new Date(v).toISOString()
    : null;
}
function number(v: unknown): number | null {
  if (typeof v === "string" && !v.trim()) return null;
  return (typeof v === "number" || typeof v === "string") &&
    v !== "" &&
    Number.isFinite(Number(v))
    ? Number(v)
    : null;
}

/** Deterministic bounded pages include arbitrarily old unfinished records. */
export async function loadLmsTaskEvents(
  client: Client,
  userId: string,
  activeOnly = false,
) {
  const rows: Database["public"]["Tables"]["source_events"]["Row"][] = [];
  let after: string | undefined;
  const pageSize = 100;
  for (let page = 0; page < 20; page++) {
    let q = client
      .from("source_events")
      .select("*")
      .eq("user_id", userId)
      .eq("event_type", "task")
      .in(
        "source_key",
        activeOnly
          ? ["university_platform"]
          : ["university_platform", "manual_study"],
      )
      .in("status", activeOnly ? ["active"] : ["active", "completed"])
      .order("id")
      .limit(pageSize);
    if (after) q = q.gt("id", after);
    const { data, error } = await q;
    if (error) throw new LmsStoreError("lms_unavailable");
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return { rows, truncated: false };
    after = data[data.length - 1].id;
  }
  return { rows, truncated: true };
}
export async function loadLinkedAssignmentGrades(
  client: Client,
  userId: string,
  externalIds: string[],
) {
  const result = new Map<
    string,
    { score: number | null; maxScore: number | null; percentage: number | null }
  >();
  const unique = [...new Set(externalIds)];
  for (let i = 0; i < unique.length; i += 100) {
    const { data: events, error } = await client
      .from("source_events")
      .select("id,external_id")
      .eq("user_id", userId)
      .eq("source_key", "university_platform")
      .in("external_id", unique.slice(i, i + 100))
      .limit(100);
    if (error) throw new LmsStoreError("lms_unavailable");
    if (!events?.length) continue;
    const ids = new Map(events.map((e) => [e.id, e.external_id]));
    const { data: grades, error: gradeError } = await client
      .from("academic_records")
      .select("source_event_id,score,max_score,percentage")
      .eq("user_id", userId)
      .in(
        "source_event_id",
        events.map((e) => e.id),
      )
      .limit(100);
    if (gradeError) throw new LmsStoreError("lms_unavailable");
    for (const grade of grades ?? []) {
      const id = grade.source_event_id && ids.get(grade.source_event_id);
      if (!id) continue;
      const score = number(grade.score),
        maxScore = number(grade.max_score);
      const percentage =
        number(grade.percentage) ??
        (score !== null && maxScore !== null && maxScore > 0
          ? Math.round((score / maxScore) * 1000) / 10
          : null);
      result.set(id, { score, maxScore, percentage });
    }
  }
  return result;
}

async function loadAcademicWork(client: Client, userId: string) {
  type Grade = Database["public"]["Tables"]["academic_records"]["Row"];
  const grades: Grade[] = [];
  let after: string | undefined;
  let truncated = false;
  for (let page = 0; page < 20; page++) {
    let q = client
      .from("academic_records")
      .select("*")
      .eq("user_id", userId)
      .order("id")
      .limit(100);
    if (after) q = q.gt("id", after);
    const { data, error } = await q;
    if (error) throw new LmsStoreError("lms_unavailable");
    grades.push(...(data ?? []));
    if (!data || data.length < 100) break;
    after = data[data.length - 1].id;
    if (page === 19) truncated = true;
  }
  const ids = [
    ...new Set(
      grades.flatMap((g) => (g.source_event_id ? [g.source_event_id] : [])),
    ),
  ];
  const externalIds = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await client
      .from("source_events")
      .select("id,external_id")
      .eq("user_id", userId)
      .eq("source_key", "university_platform")
      .eq("status", "active")
      .in("id", ids.slice(i, i + 100))
      .limit(100);
    if (error) throw new LmsStoreError("lms_unavailable");
    for (const row of data ?? [])
      if (row.external_id) externalIds.set(row.id, row.external_id);
  }
  return { grades, externalIds, truncated };
}

export async function getLmsWork(
  client: Client,
  userId: string,
  timezone: string,
  now = new Date(),
): Promise<LmsWork> {
  const [connection, { rows, truncated }, academic] = await Promise.all([
    getLmsConnection(client, userId, now),
    loadLmsTaskEvents(client, userId),
    loadAcademicWork(client, userId),
  ]);
  const gradesByExternalId = new Map(
    academic.grades.flatMap((g) =>
      g.source_event_id && academic.externalIds.get(g.source_event_id)
        ? [[academic.externalIds.get(g.source_event_id)!, g] as const]
        : [],
    ),
  );
  const consumedGrades = new Set<string>();
  const warnings = new Set<string>();
  const items = rows.map((event): StudyWorkItem => {
    const raw = object(event.raw_json);
    for (const w of safeCodes(raw.parser_warnings)) warnings.add(w);
    const status = raw.submission_status;
    const submissionStatus: StudySubmissionStatus =
      status === "overdue"
        ? "not_submitted"
        : status === "not_submitted" ||
            status === "submitted" ||
            status === "graded"
          ? status
          : "unknown";
    const kind: StudyWorkKind = [
      "assignment",
      "quiz",
      "exam",
      "midterm",
    ].includes(String(raw.assessment_type))
      ? (raw.assessment_type as StudyWorkKind)
      : raw.module_type === "quiz"
        ? "quiz"
        : event.external_id?.startsWith("assignment:")
          ? "assignment"
          : "unknown";
    const relatedGrade =
      typeof raw.related_grade_external_id === "string"
        ? gradesByExternalId.get(raw.related_grade_external_id)
        : undefined;
    if (relatedGrade) consumedGrades.add(relatedGrade.id);
    const score = number(raw.score) ?? number(relatedGrade?.score);
    return classifyStudyWork(
      {
        title: event.title || "Задание",
        courseTitle:
          typeof raw.course_title === "string" ? raw.course_title : null,
        kind,
        submissionStatus,
        dueAt: iso(event.due_at),
        startsAt: iso(raw.opens_at),
        endsAt: iso(raw.closes_at),
        score,
        maxScore: number(raw.max_score) ?? number(relatedGrade?.max_score),
        percentage: number(raw.percentage) ?? number(relatedGrade?.percentage),
        source: event.source_key === "manual_study" ? "manual" : "moodle",
      },
      now.toISOString(),
    );
  });
  for (const grade of academic.grades) {
    if (consumedGrades.has(grade.id)) continue;
    if (
      grade.source_event_id &&
      !academic.externalIds.has(grade.source_event_id)
    )
      continue;
    const kind: StudyWorkKind =
      grade.record_type === "final" || grade.record_type === "exam"
        ? "exam"
        : grade.record_type === "midterm"
          ? "midterm"
          : grade.record_type === "quiz"
            ? "quiz"
            : grade.record_type === "assignment"
              ? "assignment"
              : "unknown";
    const score = number(grade.score);
    items.push(
      classifyStudyWork(
        {
          title: grade.title,
          courseTitle: grade.course_title,
          kind,
          submissionStatus: score === null ? "unknown" : "graded",
          dueAt: iso(grade.due_at),
          startsAt: null,
          endsAt: null,
          score,
          maxScore: number(grade.max_score),
          percentage: number(grade.percentage),
          source: grade.source_event_id ? "moodle" : "unknown",
        },
        now.toISOString(),
      ),
    );
  }
  items.sort(
    (a, b) =>
      (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999") ||
      a.title.localeCompare(b.title),
  );
  return {
    timezone,
    lastSyncSuccessAt: connection.lastSyncSuccessAt,
    lastSyncAttemptAt: connection.lastSyncAttemptAt,
    stale:
      !connection.lastSyncSuccessAt ||
      now.getTime() - Date.parse(connection.lastSyncSuccessAt) > 6 * 3600000 ||
      !connection.configured ||
      connection.lastErrorCategory !== null,
    truncated: truncated || academic.truncated,
    warnings: [...warnings].slice(0, 40),
    unsupportedFeatures: connection.unsupportedFeatures,
    items,
  };
}
export async function addManualStudyWork(
  client: Client,
  userId: string,
  work: ManualStudyWork,
): Promise<void> {
  const { error } = await client.from("source_events").insert({
    user_id: userId,
    source_key: "manual_study",
    external_id: `manual:${randomUUID()}`,
    event_type: "task",
    title: work.title,
    due_at: work.dueAt,
    status: "active",
    raw_json: {
      course_title: work.courseTitle,
      assessment_type: work.kind,
      submission_status: work.submissionStatus,
    },
  });
  if (error) throw new LmsStoreError("lms_unavailable");
}
