import type { SupabaseClient } from "@supabase/supabase-js";
import {
  validateStudyCalculatorDefinition,
  validateStudyCalculatorValues,
  validateStudyCalculatorMaxima,
  type StudyCalculatorState,
} from "../../core/src/study.js";
import {
  listCourseDocuments,
  listCourseSchemes,
  createStudyScheme,
  type StudyDocument,
  type StudyScheme,
} from "./study-records.js";
import type { Database, Json } from "./types.js";
import { StudyWorkspaceError } from "./study-errors.js";
export { StudyWorkspaceError } from "./study-errors.js";

type Client = SupabaseClient<Database>;

export interface StudySchedule {
  id: string;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  room: string | null;
  sessionType: string | null;
  instructorName: string | null;
}

export interface StudyWorkspaceCourse {
  id: string;
  code: string;
  title: string;
  startsOn: string | null;
  endsOn: string | null;
  externalCourseKey: string | null;
  term: string | null;
  instructorName: string | null;
  updatedAt: string;
  documents: StudyDocument[];
  gradingSchemes: StudyScheme[];
  actualValues: Record<
    string,
    { earned: number; max: number; kind: "actual"; source: string }
  >;
  schedules: StudySchedule[];
  calculator: StudyCalculatorState | null;
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function calculatorFromMetadata(metadata: Json): StudyCalculatorState | null {
  const state = object(object(metadata).study_calculator_v1);
  if (
    !validateStudyCalculatorDefinition(state.definition) ||
    !validateStudyCalculatorValues(state.values, state.definition) ||
    typeof state.target !== "number" ||
    !Number.isFinite(state.target) ||
    state.target < 0 ||
    state.target > 100 ||
    (state.attendancePercent !== undefined &&
      state.attendancePercent !== null &&
      (typeof state.attendancePercent !== "number" ||
        !Number.isFinite(state.attendancePercent) ||
        state.attendancePercent < 0 ||
        state.attendancePercent > 100)) ||
    (state.maxima !== undefined &&
      !validateStudyCalculatorMaxima(state.maxima, state.definition))
  )
    return null;
  return {
    definition: state.definition,
    values: scenarioValues(state.values),
    target: state.target,
    ...(state.maxima !== undefined
      ? { maxima: state.maxima as Record<string, number> }
      : {}),
    ...(state.attendancePercent !== undefined
      ? { attendancePercent: state.attendancePercent as number | null }
      : {}),
  };
}

function scenarioValues(
  values: StudyCalculatorState["values"],
): StudyCalculatorState["values"] {
  return Object.fromEntries(
    Object.entries(values).map(([id, value]) => [
      id,
      value !== null && typeof value === "object"
        ? {
            ...value,
            kind:
              value.kind === "actual"
                ? ("actual" as const)
                : ("assumed" as const),
            source:
              value.kind === "actual" ? "manual_confirmed" : "manual_scenario",
          }
        : value,
    ]),
  );
}

async function courseCalculator(
  client: Client,
  userId: string,
  courseId: string,
  metadata: Json,
  schemes?: StudyScheme[],
): Promise<StudyCalculatorState | null> {
  const legacy = calculatorFromMetadata(metadata);
  const active = (
    schemes ?? (await listCourseSchemes(client, userId, courseId))
  ).find((row) => row.isActive);
  if (!active) return legacy;
  const ids = new Set(active.definition.fields.map((field) => field.id));
  const values = Object.fromEntries(
    Object.entries(legacy?.values ?? {}).filter(([id]) => ids.has(id)),
  );
  return {
    definition: active.definition,
    values,
    target: legacy?.target ?? 70,
    ...(legacy?.maxima
      ? {
          maxima: Object.fromEntries(
            Object.entries(legacy.maxima).filter(([id]) => ids.has(id)),
          ),
        }
      : {}),
    ...(legacy?.attendancePercent !== undefined
      ? { attendancePercent: legacy.attendancePercent }
      : {}),
  };
}

export async function loadStudyWorkspaceCourses(
  client: Client,
  userId: string,
): Promise<StudyWorkspaceCourse[]> {
  const result: StudyWorkspaceCourse[] = [];
  let afterId: string | undefined;
  while (true) {
    let query = client
      .from("study_courses")
      .select(
        "id,code,title,term,instructor_name,updated_at,starts_on,ends_on,external_course_key,metadata",
      )
      .eq("user_id", userId)
      .eq("status", "active")
      .order("id", { ascending: true })
      .limit(100);
    if (afterId) query = query.gt("id", afterId);
    const { data: courses, error } = await query;
    if (error) throw new Error("Failed to load study courses");
    if (!courses.length) break;
    afterId = courses[courses.length - 1].id;
    const ids = courses.map((course) => course.id);
    const schedules: Database["public"]["Tables"]["course_schedules"]["Row"][] =
      [];
    let afterScheduleId: string | undefined;
    while (true) {
      // Only IDs from the caller's owned courses may enter this child query.
      let scheduleQuery = client
        .from("course_schedules")
        .select("*")
        .in("study_course_id", ids)
        .order("id", { ascending: true })
        .limit(100);
      if (afterScheduleId)
        scheduleQuery = scheduleQuery.gt("id", afterScheduleId);
      const { data, error: scheduleError } = await scheduleQuery;
      if (scheduleError) throw new Error("Failed to load study schedule");
      if (!data.length) break;
      schedules.push(...data);
      afterScheduleId = data[data.length - 1].id;
    }
    result.push(
      ...(await Promise.all(
        courses.map(async (course) => {
          const [gradingSchemes, documents] = await Promise.all([
            listCourseSchemes(client, userId, course.id),
            listCourseDocuments(client, userId, course.id),
          ]);
          return {
            id: course.id,
            code: course.code,
            title: course.title,
            startsOn: course.starts_on,
            endsOn: course.ends_on,
            externalCourseKey: course.external_course_key,
            term: course.term,
            instructorName: course.instructor_name,
            updatedAt: course.updated_at,
            gradingSchemes,
            documents,
            actualValues: {},
            calculator: await courseCalculator(
              client,
              userId,
              course.id,
              course.metadata,
              gradingSchemes,
            ),
            schedules: schedules
              .filter((slot) => slot.study_course_id === course.id)
              .map((slot) => ({
                id: slot.id,
                dayOfWeek: slot.day_of_week,
                startTime: slot.start_time,
                endTime: slot.end_time,
                room: slot.room,
                sessionType: slot.session_type,
                instructorName: slot.instructor_name,
              })),
          };
        }),
      )),
    );
  }
  return result.sort((left, right) => left.title.localeCompare(right.title));
}

export async function configureStudyCalculator(
  client: Client,
  userId: string,
  courseId: string,
  input: unknown,
): Promise<StudyCalculatorState> {
  const { data: course, error } = await client
    .from("study_courses")
    .select("metadata,updated_at,code")
    .eq("user_id", userId)
    .eq("id", courseId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw new Error("Failed to load study calculator");
  if (!course) throw new StudyWorkspaceError("study_course_not_found");

  const body = object(input);
  if (!validateStudyCalculatorDefinition(body.definition))
    throw new StudyWorkspaceError("invalid_study_calculator");

  const current = await courseCalculator(
    client,
    userId,
    courseId,
    course.metadata,
  );
  const nextIds = new Set(body.definition.fields.map((field) => field.id));
  const values = Object.fromEntries(
    Object.entries(current?.values ?? {}).filter(([id]) => nextIds.has(id)),
  );
  const requestedTarget = body.target;
  const target =
    typeof requestedTarget === "number" &&
    Number.isFinite(requestedTarget) &&
    requestedTarget >= 0 &&
    requestedTarget <= 100
      ? requestedTarget
      : (current?.target ?? 70);

  if (body.confirmed !== true)
    throw new StudyWorkspaceError("study_scheme_needs_review");
  await createStudyScheme(client, userId, courseId, {
    definition: body.definition,
    confirmed: true,
    activate: true,
  });
  return saveStudyCalculator(client, userId, courseId, { values, target });
}

export async function saveStudyCalculator(
  client: Client,
  userId: string,
  courseId: string,
  input: unknown,
): Promise<StudyCalculatorState> {
  const { data: course, error } = await client
    .from("study_courses")
    .select("metadata,updated_at,code")
    .eq("user_id", userId)
    .eq("id", courseId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw new Error("Failed to load study calculator");
  if (!course) throw new StudyWorkspaceError("study_course_not_found");
  const current = await courseCalculator(
    client,
    userId,
    courseId,
    course.metadata,
  );
  if (!current)
    throw new StudyWorkspaceError("study_calculator_not_configured");
  const body = object(input);
  if (
    !validateStudyCalculatorValues(body.values, current.definition) ||
    typeof body.target !== "number" ||
    !Number.isFinite(body.target) ||
    body.target < 0 ||
    body.target > 100 ||
    (body.attendancePercent !== undefined &&
      body.attendancePercent !== null &&
      (typeof body.attendancePercent !== "number" ||
        !Number.isFinite(body.attendancePercent) ||
        body.attendancePercent < 0 ||
        body.attendancePercent > 100)) ||
    (body.maxima !== undefined &&
      !validateStudyCalculatorMaxima(body.maxima, current.definition))
  ) {
    throw new StudyWorkspaceError("invalid_study_calculator");
  }
  const state: StudyCalculatorState = {
    definition: current.definition,
    values: scenarioValues(body.values),
    target: body.target,
    ...((body.maxima ?? current.maxima) !== undefined
      ? {
          maxima:
            (body.maxima as Record<string, number> | undefined) ??
            current.maxima,
        }
      : {}),
    ...((body.attendancePercent ?? current.attendancePercent) !== undefined
      ? {
          attendancePercent:
            body.attendancePercent === null
              ? null
              : ((body.attendancePercent as number | undefined) ??
                current.attendancePercent),
        }
      : {}),
  };
  const metadata = {
    ...object(course.metadata),
    study_calculator_v1: state,
  } as unknown as Json;
  const { data: saved, error: saveError } = await client
    .from("study_courses")
    .update({ metadata })
    .eq("user_id", userId)
    .eq("id", courseId)
    .eq("updated_at", course.updated_at)
    .select("id")
    .maybeSingle();
  if (saveError) throw new Error("Failed to save study calculator");
  if (!saved) throw new StudyWorkspaceError("study_calculator_conflict");
  return state;
}
