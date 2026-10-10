import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "./types.js";

type Row<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
export interface PlanningSnapshotRange {
  startsAt: string;
  endsAt: string;
  historyStartsAt: string;
  historyEndsAt: string;
}
export interface PlanningSnapshot {
  tasks: Array<
    Pick<
      Row<"tasks">,
      "id" | "title" | "priority" | "due_at" | "scheduled_for"
    > & { domain: string; estimatedMinutes: number | null }
  >;
  events: Array<
    Pick<
      Row<"source_events">,
      "id" | "title" | "event_type" | "starts_at" | "ends_at" | "due_at"
    >
  >;
  reminders: Array<Pick<Row<"reminders">, "message" | "remind_at">>;
  projects: Array<Pick<Row<"projects">, "name" | "due_on">>;
  courses: Array<
    Pick<Row<"study_courses">, "id" | "title" | "starts_on" | "ends_on">
  >;
  schedules: Array<
    Pick<
      Row<"course_schedules">,
      "id" | "study_course_id" | "day_of_week" | "start_time" | "end_time"
    >
  >;
  assessments: Array<
    Pick<
      Row<"assessment_items">,
      "id" | "study_course_id" | "title" | "due_at" | "syllabus_due_at"
    >
  >;
  history: Array<{ createdAt: string; completedAt: string | null }>;
  truncated: boolean;
  historyTruncated: boolean;
}

function metadata(value: Json): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

/** Read-only, bounded projection. Child tables are restricted to owned course IDs. */
export async function loadPlanningSnapshot(
  client: SupabaseClient<Database>,
  userId: string,
  range: PlanningSnapshotRange,
): Promise<PlanningSnapshot> {
  const [tasks, events, reminders, projects, courses, created, completed] =
    await Promise.all([
      client
        .from("tasks")
        .select("id,title,priority,due_at,scheduled_for,metadata")
        .eq("user_id", userId)
        .in("status", ["inbox", "next", "scheduled"])
        .order("due_at", { ascending: true, nullsFirst: false })
        .order("id")
        .limit(201),
      client
        .from("source_events")
        .select("id,title,event_type,starts_at,ends_at,due_at")
        .eq("user_id", userId)
        .not("status", "in", "(cancelled,deleted,done,completed)")
        .or(
          `and(starts_at.lt.${range.endsAt},ends_at.gt.${range.startsAt}),and(starts_at.lt.${range.endsAt},ends_at.is.null),and(starts_at.gte.${range.startsAt},starts_at.lt.${range.endsAt}),due_at.lt.${range.endsAt}`,
        )
        .order("starts_at", { ascending: true })
        .order("id")
        .limit(501),
      client
        .from("reminders")
        .select("message,remind_at")
        .eq("user_id", userId)
        .eq("status", "pending")
        .gte("remind_at", range.startsAt)
        .lt("remind_at", range.endsAt)
        .order("remind_at")
        .limit(201),
      client
        .from("projects")
        .select("name,due_on")
        .eq("user_id", userId)
        .eq("status", "active")
        .is("archived_at", null)
        .order("id")
        .limit(101),
      client
        .from("study_courses")
        .select("id,title,starts_on,ends_on")
        .eq("user_id", userId)
        .eq("status", "active")
        .order("id")
        .limit(101),
      client
        .from("tasks")
        .select("id,created_at,completed_at")
        .eq("user_id", userId)
        .gte("created_at", range.historyStartsAt)
        .lt("created_at", range.historyEndsAt)
        .order("id")
        .limit(1000),
      client
        .from("tasks")
        .select("id,created_at,completed_at")
        .eq("user_id", userId)
        .eq("status", "done")
        .gte("completed_at", range.historyStartsAt)
        .lt("completed_at", range.historyEndsAt)
        .order("id")
        .limit(1000),
    ]);
  if (
    [tasks, events, reminders, projects, courses, created, completed].some(
      (r) => r.error,
    )
  ) {
    throw new Error("Planning data unavailable");
  }
  const ownedCourses = courses.data!.slice(0, 100);
  const ids = ownedCourses.map((c) => c.id);
  const [schedules, assessments] = ids.length
    ? await Promise.all([
        client
          .from("course_schedules")
          .select("id,study_course_id,day_of_week,start_time,end_time")
          .in("study_course_id", ids)
          .order("id")
          .limit(1000),
        client
          .from("assessment_items")
          .select("id,study_course_id,title,due_at,syllabus_due_at")
          .in("study_course_id", ids)
          .eq("status", "pending")
          .order("due_at", { ascending: true, nullsFirst: false })
          .order("id")
          .limit(501),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
      ];
  if (schedules.error || assessments.error)
    throw new Error("Planning data unavailable");
  const history = new Map(
    (created.data ?? []).map((t) => [
      t.id,
      { createdAt: t.created_at, completedAt: t.completed_at },
    ]),
  );
  for (const t of completed.data ?? [])
    history.set(t.id, { createdAt: t.created_at, completedAt: t.completed_at });
  return {
    tasks: tasks.data!.slice(0, 200).map((t) => {
      const m = metadata(t.metadata);
      const minutes = m.estimatedMinutes ?? m.estimated_minutes;
      return {
        id: t.id,
        title: t.title,
        priority: t.priority,
        due_at: t.due_at,
        scheduled_for: t.scheduled_for,
        domain:
          typeof m.domain === "string" ? m.domain.slice(0, 80) : "personal",
        estimatedMinutes:
          typeof minutes === "number" &&
          Number.isInteger(minutes) &&
          minutes > 0 &&
          minutes <= 480
            ? minutes
            : null,
      };
    }),
    events: events.data!.slice(0, 500),
    reminders: reminders.data!.slice(0, 200),
    projects: projects.data!.slice(0, 100),
    courses: ownedCourses,
    schedules: (schedules.data ?? []).slice(0, 999),
    assessments: (assessments.data ?? []).slice(0, 500),
    history: [...history.values()],
    truncated:
      tasks.data!.length > 200 ||
      events.data!.length > 500 ||
      reminders.data!.length > 200 ||
      projects.data!.length > 100 ||
      courses.data!.length > 100 ||
      (schedules.data?.length ?? 0) >= 1000 ||
      (assessments.data?.length ?? 0) > 500,
    historyTruncated:
      created.data!.length >= 1000 || completed.data!.length >= 1000,
  };
}
