import type { SupabaseClient } from "@supabase/supabase-js";
import {
  validateStudyCalculatorDefinition,
  validateStudyCalculatorValues,
  type StudyCalculatorState,
} from "../../core/src/study.js";
import type { Database, Json } from "./types.js";

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
  schedules: StudySchedule[];
  calculator: StudyCalculatorState | null;
}

export class StudyWorkspaceError extends Error {
  constructor(
    public readonly code:
      | "study_course_not_found"
      | "study_calculator_not_configured"
      | "invalid_study_calculator"
      | "study_calculator_conflict",
  ) {
    super(code);
  }
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
    state.target > 100
  )
    return null;
  return {
    definition: state.definition,
    values: state.values,
    target: state.target,
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
      .select("id,code,title,starts_on,ends_on,external_course_key,metadata")
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
      ...courses.map((course) => ({
        id: course.id,
        code: course.code,
        title: course.title,
        startsOn: course.starts_on,
        endsOn: course.ends_on,
        externalCourseKey: course.external_course_key,
        calculator: calculatorFromMetadata(course.metadata),
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
      })),
    );
  }
  return result.sort((left, right) => left.title.localeCompare(right.title));
}

export async function saveStudyCalculator(
  client: Client,
  userId: string,
  courseId: string,
  input: unknown,
): Promise<StudyCalculatorState> {
  const { data: course, error } = await client
    .from("study_courses")
    .select("metadata,updated_at")
    .eq("user_id", userId)
    .eq("id", courseId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw new Error("Failed to load study calculator");
  if (!course) throw new StudyWorkspaceError("study_course_not_found");
  const current = calculatorFromMetadata(course.metadata);
  if (!current)
    throw new StudyWorkspaceError("study_calculator_not_configured");
  const body = object(input);
  if (
    !validateStudyCalculatorValues(body.values, current.definition) ||
    typeof body.target !== "number" ||
    !Number.isFinite(body.target) ||
    body.target < 0 ||
    body.target > 100
  ) {
    throw new StudyWorkspaceError("invalid_study_calculator");
  }
  const state: StudyCalculatorState = {
    definition: current.definition,
    values: body.values,
    target: body.target,
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
