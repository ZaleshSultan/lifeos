import type { ScholarshipConfig } from "../../../../packages/core/src/scholarship.js";
import type { StudyCalculatorState } from "../../../../packages/core/src/study.js";
import type { AcademicRecord } from "./types";

/** Shared DTOs only: no Telegram, Vite environment or HTTP dependencies. */
export type StudyWeekday =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export interface StudySchedule {
  id: string;
  dayOfWeek: StudyWeekday;
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
  scholarship?: ScholarshipConfig | null;
}

export interface StudyWorkspace {
  timezone: string;
  courses: StudyWorkspaceCourse[];
  records: AcademicRecord[];
}
