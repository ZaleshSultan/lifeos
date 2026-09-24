import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { StudyCalculatorState } from "../../../../packages/core/src/study.js";
import { telegram } from "../telegram";
import { request } from "./client";
import type { AcademicRecord } from "./types";

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
}

export interface StudyWorkspace {
  timezone: string;
  courses: StudyWorkspaceCourse[];
  records: AcademicRecord[];
}

export const studyQueryKey = ["study"] as const;

export function useStudyQuery() {
  return useQuery({
    queryKey: studyQueryKey,
    queryFn: () => request<StudyWorkspace>("/api/tma/study"),
  });
}

export function useSaveStudyCalculatorMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      courseId,
      state,
    }: {
      courseId: string;
      state: StudyCalculatorState;
    }) =>
      request<StudyCalculatorState>(
        `/api/tma/study/courses/${encodeURIComponent(courseId)}/calculator`,
        {
          method: "PUT",
          body: JSON.stringify({ values: state.values, target: state.target }),
        },
      ),
    async onMutate() {
      await queryClient.cancelQueries({ queryKey: studyQueryKey });
    },
    async onSuccess(state, { courseId }) {
      // A refresh started during the save must not replace the saved values.
      await queryClient.cancelQueries({ queryKey: studyQueryKey });
      queryClient.setQueryData<StudyWorkspace>(studyQueryKey, (current) =>
        current
          ? {
              ...current,
              courses: current.courses.map((course) =>
                course.id === courseId
                  ? { ...course, calculator: state }
                  : course,
              ),
            }
          : current,
      );
      telegram.hapticImpact("light");
    },
  });
}
