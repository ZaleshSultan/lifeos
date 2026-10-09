import type { SupabaseClient } from "@supabase/supabase-js";
import {
  validateStudyCalculatorDefinition,
  type StudyCalculatorDefinition,
} from "../../core/src/study.js";
import type { Database, Json } from "./types.js";
import { StudyWorkspaceError } from "./study-errors.js";
import {
  persistStudyPdf,
  readStudyPdfContent,
  validateStudyPdf,
  type StudyDocumentInput,
  type StudyPdfUploadOptions,
} from "./study-document-storage.js";

type Client = SupabaseClient<Database>;
export interface StudyDocument {
  id: string;
  fileName: string;
  sha256: string;
  version: number;
  extractionStatus: string;
  sourcePages: number[];
  uploadedAt: string;
  available: boolean;
  notes: string[];
}
export interface StudyScheme {
  id: string;
  version: number;
  definition: StudyCalculatorDefinition;
  documentId: string | null;
  isActive: boolean;
  verification: string;
  createdAt: string;
}
export interface StudyAssignment {
  id: string;
  studyCourseId: string;
  courseTitle: string;
  courseCode: string;
  title: string;
  assessmentType: string | null;
  source: string;
  externalId: string | null;
  maxScore: number | null;
  actualScore: number | null;
  dueAt: string | null;
  status: string;
  notes: string | null;
  updatedAt: string;
  editable: boolean;
  sourceId: string | null;
  componentId: string | null;
  schemeId: string | null;
  sourceUrl: string | null;
  override: {
    earned: number;
    max: number;
    note: string | null;
    updatedAt: string;
  } | null;
  effectiveScore: number | null;
  effectiveMax: number | null;
}
export interface StudyDeadline {
  id: string;
  title: string;
  courseTitle: string | null;
  dueAt: string;
  status: string;
  source: string;
  externalId: string | null;
  sourceUrl: string | null;
  assessmentId: string | null;
}
export interface StudySource {
  id: string;
  title: string;
  status: string;
  lastSyncedAt: string | null;
  lastError: string | null;
}
export interface StudySupplement {
  assignments: StudyAssignment[];
  deadlines: StudyDeadline[];
  sources: StudySource[];
  sync: { updatedAt: string | null; status: string; message: string };
}
export function studyObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function sourceUrl(raw: unknown): string | null {
  const item = studyObject(raw);
  const value = item.source_url ?? item.sourceUrl ?? item.url ?? item.link;
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
// Keyset pagination avoids Supabase's default 1000-row response truncation.
async function ownedRows<
  K extends
    | "study_courses"
    | "source_events"
    | "life_entities"
    | "tasks"
    | "external_sources"
    | "assessment_grade_overrides"
    | "assessment_component_mappings",
>(
  client: Client,
  table: K,
  userId: string,
): Promise<Database["public"]["Tables"][K]["Row"][]> {
  const rows: Database["public"]["Tables"][K]["Row"][] = [];
  let after: string | undefined;
  while (true) {
    let query = client
      .from(table)
      .select("*")
      .filter("user_id", "eq", userId)
      .order("id")
      .limit(100);
    if (after) query = query.gt("id", after);
    const { data, error } = await query;
    if (error) throw new Error(`Failed to load study ${table}`);
    if (!data?.length) break;
    const batch = data as unknown as Database["public"]["Tables"][K]["Row"][];
    rows.push(...batch);
    after = batch[batch.length - 1].id;
  }
  return rows;
}
export async function assertStudyCourse(
  client: Client,
  userId: string,
  courseId: string,
) {
  const { data, error } = await client
    .from("study_courses")
    .select("id,metadata,updated_at,code")
    .eq("user_id", userId)
    .eq("id", courseId)
    .maybeSingle();
  if (error) throw new Error("Failed to load study course");
  if (!data) throw new StudyWorkspaceError("study_course_not_found");
  return data;
}
export async function listCourseSchemes(
  client: Client,
  userId: string,
  courseId: string,
): Promise<StudyScheme[]> {
  const { data, error } = await client
    .from("grading_schemes")
    .select("*")
    .eq("user_id", userId)
    .eq("study_course_id", courseId)
    .order("version", { ascending: false });
  if (error) throw new Error("Failed to load study schemes");
  return (data ?? [])
    .filter((row) => validateStudyCalculatorDefinition(row.definition))
    .map((row) => ({
      id: row.id,
      version: row.version,
      definition: row.definition as unknown as StudyCalculatorDefinition,
      documentId: row.document_id,
      isActive: row.is_active,
      verification: row.verification,
      createdAt: row.created_at,
    }));
}
export async function listCourseDocuments(
  client: Client,
  userId: string,
  courseId: string,
): Promise<StudyDocument[]> {
  const { data, error } = await client
    .from("syllabus_documents")
    .select(
      "id,file_name,sha256,version,extraction_status,source_pages,notes,uploaded_at,has_content",
    )
    .eq("user_id", userId)
    .eq("study_course_id", courseId)
    .order("version", { ascending: false });
  if (error) throw new Error("Failed to load study documents");
  // PDF bytes are never returned in the workspace envelope.
  return (data ?? []).map((row) => ({
    id: row.id,
    fileName: row.file_name,
    sha256: row.sha256,
    version: row.version,
    extractionStatus: row.extraction_status,
    sourcePages: Array.isArray(row.source_pages)
      ? row.source_pages.filter((x): x is number => typeof x === "number")
      : [],
    notes: Array.isArray(row.notes)
      ? row.notes.filter((x): x is string => typeof x === "string")
      : [],
    uploadedAt: row.uploaded_at,
    available: row.has_content,
  }));
}
export async function loadStudySupplement(
  client: Client,
  userId: string,
): Promise<StudySupplement> {
  const courses = await ownedRows(client, "study_courses", userId);
  const courseMap = new Map(courses.map((row) => [row.id, row]));
  const [overrides, mappings, events, entities, tasks, sources] =
    await Promise.all([
      ownedRows(client, "assessment_grade_overrides", userId),
      ownedRows(client, "assessment_component_mappings", userId),
      ownedRows(client, "source_events", userId),
      ownedRows(client, "life_entities", userId),
      ownedRows(client, "tasks", userId),
      ownedRows(client, "external_sources", userId),
    ]);
  const rows: Database["public"]["Tables"]["assessment_items"]["Row"][] = [];
  const ids = [...courseMap.keys()];
  for (let offset = 0; offset < ids.length; offset += 100) {
    let after: string | undefined;
    while (true) {
      let query = client
        .from("assessment_items")
        .select("*")
        .in("study_course_id", ids.slice(offset, offset + 100))
        .order("id")
        .limit(100);
      if (after) query = query.gt("id", after);
      const { data, error: assessmentError } = await query;
      if (assessmentError) throw new Error("Failed to load study assignments");
      if (!data?.length) break;
      rows.push(...data);
      after = data[data.length - 1].id;
    }
  }
  const overrideMap = new Map(overrides.map((row) => [row.assessment_id, row]));
  const mappingMap = new Map(mappings.map((row) => [row.assessment_id, row]));
  const assignments: StudyAssignment[] = rows.map((row) => {
    const override = overrideMap.get(row.id);
    const course = courseMap.get(row.study_course_id)!;
    return {
      id: row.id,
      studyCourseId: row.study_course_id,
      courseTitle: course.title,
      courseCode: course.code,
      title: row.title,
      assessmentType: row.assessment_type,
      source: row.source,
      externalId: row.external_id,
      maxScore: row.max_score,
      actualScore: row.actual_score,
      dueAt: row.due_at ?? row.syllabus_due_at,
      status: row.status,
      notes: row.notes,
      updatedAt: row.updated_at,
      editable: row.source === "manual",
      sourceId: null,
      componentId: mappingMap.get(row.id)?.component_id ?? null,
      schemeId: mappingMap.get(row.id)?.scheme_id ?? null,
      sourceUrl: sourceUrl(row.raw_json),
      override: override
        ? {
            earned: override.earned,
            max: override.max_score,
            note: override.note,
            updatedAt: override.updated_at,
          }
        : null,
      effectiveScore: override?.earned ?? row.actual_score,
      effectiveMax: override?.max_score ?? row.max_score,
    };
  });
  const deadlines: StudyDeadline[] = [];
  const stableIds = new Set<string>();
  const linkedIds = new Set<string>();
  const assessmentByExternalId = new Map(
    assignments
      .filter((item) => item.externalId)
      .map((item) => [item.externalId!, item]),
  );
  const studyEvents = events.filter(
    (event) =>
      /university|moodle|academic|study/i.test(event.source_key) ||
      ["academic_event", "academic_record"].includes(event.event_type),
  );
  for (const event of studyEvents) {
    if (
      event.event_type !== "task" ||
      !event.due_at ||
      ["cancelled", "deleted"].includes(event.status)
    )
      continue;
    const raw = studyObject(event.raw_json);
    const relatedExternal =
      typeof raw.related_grade_external_id === "string"
        ? raw.related_grade_external_id
        : event.external_id;
    const related = relatedExternal
      ? assessmentByExternalId.get(relatedExternal)
      : undefined;
    if (related) {
      related.dueAt = event.due_at;
      related.sourceUrl = event.source_url ?? related.sourceUrl;
      related.sourceId = event.id;
      continue;
    }
    const moodleId = String(raw.moodle_course_id ?? "");
    const course = courses.find(
      (row) => moodleId && row.external_course_key === `moodle:${moodleId}`,
    );
    assignments.push({
      id: `source:${event.id}`,
      studyCourseId: course?.id ?? "",
      courseTitle:
        course?.title ??
        (typeof raw.course_title === "string"
          ? raw.course_title
          : "Курс Moodle"),
      courseCode: course?.code ?? "",
      title: event.title ?? "Задание",
      assessmentType: "assignment",
      source: event.source_key,
      externalId: event.external_id,
      maxScore: null,
      actualScore: null,
      dueAt: event.due_at,
      status: event.status === "completed" ? "graded" : "pending",
      notes: null,
      updatedAt: event.last_synced_at ?? event.updated_at,
      editable: false,
      sourceId: event.id,
      componentId: null,
      schemeId: null,
      sourceUrl: event.source_url,
      override: null,
      effectiveScore: null,
      effectiveMax: null,
    });
  }
  function add(row: StudyDeadline, key: string) {
    if (stableIds.has(key)) return;
    stableIds.add(key);
    deadlines.push(row);
  }
  for (const item of assignments)
    if (item.dueAt) {
      add(
        {
          id: `assessment:${item.id}`,
          title: item.title,
          courseTitle: item.courseTitle,
          dueAt: item.dueAt,
          status: item.status,
          source: item.source,
          externalId: item.externalId,
          sourceUrl: item.sourceUrl,
          assessmentId: item.id,
        },
        item.externalId
          ? `${item.source}:${item.externalId}`
          : `assessment:${item.id}`,
      );
      linkedIds.add(item.id);
    }
  for (const event of studyEvents)
    if (event.due_at && !["cancelled", "deleted"].includes(event.status)) {
      if (event.normalized_entity_id) linkedIds.add(event.normalized_entity_id);
      if (assignments.some((item) => item.sourceId === event.id)) continue;
      const raw = studyObject(event.raw_json);
      const relatedExternal =
        typeof raw.related_grade_external_id === "string"
          ? raw.related_grade_external_id
          : event.external_id;
      const related = relatedExternal
        ? assessmentByExternalId.get(relatedExternal)
        : undefined;
      const assessmentId =
        related?.id ??
        (typeof raw.assessment_id === "string" ? raw.assessment_id : null);
      if (assessmentId && linkedIds.has(assessmentId)) continue;
      add(
        {
          id: `source:${event.id}`,
          title: event.title ?? "Учебный дедлайн",
          courseTitle:
            typeof raw.course_title === "string" ? raw.course_title : null,
          dueAt: event.due_at,
          status: event.status,
          source: event.source_key,
          externalId: event.external_id,
          sourceUrl: event.source_url,
          assessmentId,
        },
        event.external_id
          ? `${event.provider ?? event.source_key}:${event.external_id}`
          : `source:${event.id}`,
      );
    }
  for (const entity of entities)
    if (
      entity.due_at &&
      (["study", "academic"].includes(entity.domain) ||
        entity.entity_type === "deadline") &&
      !linkedIds.has(entity.id) &&
      !["deleted", "cancelled"].includes(entity.status)
    ) {
      if (entity.linked_id && linkedIds.has(entity.linked_id)) continue;
      if (entity.linked_id) linkedIds.add(entity.linked_id);
      const metadata = studyObject(entity.metadata);
      const externalId =
        typeof metadata.external_id === "string" ? metadata.external_id : null;
      add(
        {
          id: `entity:${entity.id}`,
          title: entity.title,
          courseTitle: null,
          dueAt: entity.due_at,
          status: entity.status,
          source: entity.source,
          externalId,
          sourceUrl: sourceUrl(entity.metadata),
          assessmentId: null,
        },
        externalId ? `${entity.source}:${externalId}` : `entity:${entity.id}`,
      );
    }
  for (const task of tasks)
    if (
      task.due_at &&
      !linkedIds.has(task.id) &&
      !["cancelled"].includes(task.status)
    ) {
      const metadata = studyObject(task.metadata);
      if (
        !["study", "academic"].includes(String(metadata.domain ?? "")) &&
        !metadata.study_course_id
      )
        continue;
      add(
        {
          id: `task:${task.id}`,
          title: task.title,
          courseTitle:
            typeof metadata.study_course_id === "string"
              ? (courseMap.get(metadata.study_course_id)?.title ?? null)
              : null,
          dueAt: task.due_at,
          status: task.status,
          source: task.source ?? "manual",
          externalId: null,
          sourceUrl: sourceUrl(metadata),
          assessmentId: null,
        },
        `task:${task.id}`,
      );
    }
  const studySources = sources.filter((row) =>
    /moodle|university|academic|study|lms/i.test(
      `${row.source_type} ${row.source_key}`,
    ),
  );
  const last =
    [...studySources]
      .map((row) => row.last_sync_at)
      .filter((x): x is string => !!x)
      .sort()
      .at(-1) ?? null;
  const status = studySources.some((row) => row.status === "error")
    ? "error"
    : last
      ? "connected"
      : "not_synced";
  return {
    assignments,
    deadlines: deadlines.sort((a, b) => a.dueAt.localeCompare(b.dueAt)),
    sources: studySources.map((row) => ({
      id: row.id,
      title: row.display_name,
      status: row.status,
      lastSyncedAt: row.last_sync_at,
      lastError: null,
    })),
    sync: {
      updatedAt: last,
      status,
      message: last
        ? "Актуальность сроков зависит от последней синхронизации источников"
        : "Нет подтверждённой синхронизации: отсутствие работ не означает отсутствие дедлайнов",
    },
  };
}

export async function getOwnedAssessment(
  client: Client,
  userId: string,
  id: string,
) {
  const courses = await ownedRows(client, "study_courses", userId);
  for (let offset = 0; offset < courses.length; offset += 100) {
    const { data, error } = await client
      .from("assessment_items")
      .select("*")
      .eq("id", id)
      .in(
        "study_course_id",
        courses.slice(offset, offset + 100).map((course) => course.id),
      )
      .maybeSingle();
    if (error) throw new Error("Failed to load study assignment");
    if (data) return data;
  }
  throw new StudyWorkspaceError("study_assignment_not_found");
}
export async function saveStudyOverride(
  client: Client,
  userId: string,
  id: string,
  input: unknown,
): Promise<void> {
  const assessment = await getOwnedAssessment(client, userId, id);
  if (input === null || studyObject(input).earned === null) {
    const { error } = await client
      .from("assessment_grade_overrides")
      .delete()
      .eq("user_id", userId)
      .eq("assessment_id", id);
    if (error) throw new Error("Failed to clear study grade override");
    return;
  }
  const body = studyObject(input);
  if (
    typeof body.earned !== "number" ||
    typeof body.max !== "number" ||
    !Number.isFinite(body.earned) ||
    !Number.isFinite(body.max) ||
    body.max <= 0 ||
    body.earned < 0 ||
    body.earned > body.max ||
    (body.note !== undefined &&
      (typeof body.note !== "string" || body.note.length > 2000))
  )
    throw new StudyWorkspaceError("invalid_study_assignment");
  const { error } = await client.from("assessment_grade_overrides").upsert(
    {
      user_id: userId,
      study_course_id: assessment.study_course_id,
      assessment_id: id,
      earned: body.earned,
      max_score: body.max,
      note: typeof body.note === "string" ? body.note : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,assessment_id" },
  );
  if (error) throw new Error("Failed to save study grade override");
}
export async function saveStudyMapping(
  client: Client,
  userId: string,
  id: string,
  input: unknown,
): Promise<void> {
  const assessment = await getOwnedAssessment(client, userId, id);
  const body = studyObject(input);
  if (body.componentId === null) {
    const { error } = await client
      .from("assessment_component_mappings")
      .delete()
      .eq("user_id", userId)
      .eq("assessment_id", id);
    if (error) throw new Error("Failed to clear study mapping");
    return;
  }
  const schemes = await listCourseSchemes(
    client,
    userId,
    assessment.study_course_id,
  );
  const active = schemes.find((row) => row.isActive);
  const definition = active?.definition;
  if (
    !validateStudyCalculatorDefinition(definition) ||
    typeof body.componentId !== "string" ||
    !definition.fields.some((field) => field.id === body.componentId)
  )
    throw new StudyWorkspaceError("invalid_study_component");
  const { error } = await client.from("assessment_component_mappings").upsert(
    {
      user_id: userId,
      study_course_id: assessment.study_course_id,
      assessment_id: id,
      component_id: body.componentId,
      scheme_id: active!.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,assessment_id" },
  );
  if (error?.code === "23505")
    throw new StudyWorkspaceError("study_component_already_mapped");
  if (error) throw new Error("Failed to save study component mapping");
}
export async function createStudyDocument(
  client: Client,
  userId: string,
  courseId: string,
  input: StudyDocumentInput,
  options: StudyPdfUploadOptions = {},
): Promise<StudyDocument> {
  await assertStudyCourse(client, userId, courseId);
  const { data: existing, error: loadError } = await client
    .from("syllabus_documents")
    .select("id,has_content")
    .eq("user_id", userId)
    .eq("study_course_id", courseId)
    .eq("sha256", input.sha256)
    .maybeSingle();
  if (loadError) throw new Error("Failed to load study document");
  const bytes = input.bytes ?? Buffer.from(input.pdfBase64, "base64");
  validateStudyPdf(bytes, input.sha256);
  if (existing?.has_content) {
    // Verify but preserve the four legacy uploads and existing Storage documents.
    await downloadStudyDocument(client, userId, existing.id);
  } else await persistStudyPdf(client, userId, courseId, input, options);
  return (await listCourseDocuments(client, userId, courseId)).find(
    (row) => row.sha256 === input.sha256,
  )!;
}
export async function downloadStudyDocument(
  client: Client,
  userId: string,
  id: string,
): Promise<{ fileName: string; bytes: Uint8Array }> {
  const { data, error } = await client
    .from("syllabus_documents")
    .select(
      "file_name,pdf_base64,study_course_id,sha256,storage_bucket,storage_object_path,content_bytes,storage_verified_at",
    )
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("Failed to load study PDF");
  if (!data) throw new StudyWorkspaceError("study_document_not_found");
  await assertStudyCourse(client, userId, data.study_course_id);
  return {
    fileName: data.file_name,
    bytes: await readStudyPdfContent(client, userId, data),
  };
}
export async function createStudyScheme(
  client: Client,
  userId: string,
  courseId: string,
  input: unknown,
): Promise<StudyScheme> {
  await assertStudyCourse(client, userId, courseId);
  const body = studyObject(input);
  if (!validateStudyCalculatorDefinition(body.definition))
    throw new StudyWorkspaceError("invalid_study_calculator");
  if (body.documentId !== undefined && body.documentId !== null) {
    const { data, error } = await client
      .from("syllabus_documents")
      .select("id")
      .eq("user_id", userId)
      .eq("study_course_id", courseId)
      .eq("id", String(body.documentId))
      .maybeSingle();
    if (error || !data)
      throw new StudyWorkspaceError("study_document_not_found");
  }
  const schemes = await listCourseSchemes(client, userId, courseId);
  if (body.activate === true && body.confirmed !== true)
    throw new StudyWorkspaceError("study_scheme_needs_review");
  const definition =
    body.confirmed === true
      ? confirmedDefinition(body.definition)
      : body.definition;
  const { data, error } = await client
    .from("grading_schemes")
    .insert({
      user_id: userId,
      study_course_id: courseId,
      definition: definition as unknown as Json,
      document_id: typeof body.documentId === "string" ? body.documentId : null,
      version: (schemes[0]?.version ?? 0) + 1,
      verification: body.confirmed === true ? "user_confirmed" : "needs_review",
    })
    .select("id")
    .single();
  if (error?.code === "23505")
    throw new StudyWorkspaceError("study_calculator_conflict");
  if (error) throw new Error("Failed to save study scheme");
  if (body.activate === true) {
    if (body.confirmed !== true)
      throw new StudyWorkspaceError("study_scheme_needs_review");
    await activateStudyScheme(client, userId, courseId, data.id, true);
  }
  return (await listCourseSchemes(client, userId, courseId)).find(
    (row) => row.id === data.id,
  )!;
}
function confirmedDefinition(
  definition: StudyCalculatorDefinition,
): StudyCalculatorDefinition {
  return {
    ...definition,
    verification: "verified",
    fields: definition.fields.map((field) => ({
      ...field,
      verification: "verified",
    })),
    ...(definition.requirements
      ? {
          requirements: definition.requirements.map((requirement) => ({
            ...requirement,
            verification: "verified",
          })),
        }
      : {}),
  };
}
export async function activateStudyScheme(
  client: Client,
  userId: string,
  courseId: string,
  schemeId: string,
  confirmed: boolean,
): Promise<StudyScheme> {
  await assertStudyCourse(client, userId, courseId);
  if (!confirmed) throw new StudyWorkspaceError("study_scheme_needs_review");
  const schemes = await listCourseSchemes(client, userId, courseId);
  const scheme = schemes.find((row) => row.id === schemeId);
  if (!scheme) throw new StudyWorkspaceError("study_scheme_not_found");
  if (scheme.verification === "needs_review") {
    const acceptedDefinition = confirmedDefinition(scheme.definition);
    const { error } = await client
      .from("grading_schemes")
      .update({
        verification: "user_confirmed",
        definition: JSON.parse(JSON.stringify(acceptedDefinition)) as Json,
      })
      .eq("user_id", userId)
      .eq("study_course_id", courseId)
      .eq("id", schemeId);
    if (error) throw new Error("Failed to confirm study scheme");
  }
  const { error } = await client.rpc("activate_study_grading_scheme", {
    p_user_id: userId,
    p_course_id: courseId,
    p_scheme_id: schemeId,
  });
  if (error) throw new Error("Failed to activate study scheme");
  return (await listCourseSchemes(client, userId, courseId)).find(
    (row) => row.id === schemeId,
  )!;
}
