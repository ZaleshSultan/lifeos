import { type ScholarshipConfig } from "../../../../packages/core/src/scholarship.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  studyCalculatorStatesMatch,
  type StudyCalculatorState,
} from "../../../../packages/core/src/study.js";
import { telegram } from "../telegram";
import { request } from "./client";

export type {
  StudyWeekday,
  StudySchedule,
  StudyWorkspaceCourse,
  StudyWorkspace,
} from "./study-types";
import type { StudyWorkspace } from "./study-types";

export const studyQueryKey = ["study"] as const;

export interface ConfigureStudyCalculatorInput {
  courseId: string;
  definition: StudyCalculatorState["definition"];
  target?: number;
  values?: StudyCalculatorState["values"];
  expectedState?: StudyCalculatorState | null;
}

export function useStudyQuery() {
  return useQuery({
    queryKey: studyQueryKey,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    queryFn: () => request<StudyWorkspace>("/api/tma/study"),
  });
}

export interface SaveStudyCalculatorInput {
  courseId: string;
  state: StudyCalculatorState;
  expectedState?: StudyCalculatorState | null;
}
export function useSaveStudyCalculatorMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      courseId,
      state,
      expectedState,
    }: SaveStudyCalculatorInput) =>
      request<StudyCalculatorState>(
        `/api/tma/study/courses/${encodeURIComponent(courseId)}/calculator`,
        {
          method: "PUT",
          body: JSON.stringify({
            values: state.values,
            target: state.target,
            ...(expectedState === undefined ? {} : { expectedState }),
          }),
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

export function useConfigureStudyCalculatorMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      courseId,
      definition,
      target,
      values,
      expectedState,
    }: ConfigureStudyCalculatorInput) =>
      request<StudyCalculatorState>(
        `/api/tma/study/courses/${encodeURIComponent(courseId)}/syllabus`,
        {
          method: "PUT",
          body: JSON.stringify({ definition, target, values, expectedState }),
        },
      ),
    async onMutate() {
      await queryClient.cancelQueries({ queryKey: studyQueryKey });
    },
    async onSuccess(state, { courseId, expectedState }) {
      await queryClient.cancelQueries({ queryKey: studyQueryKey });
      let newerState = false;
      queryClient.setQueryData<StudyWorkspace>(studyQueryKey, (current) =>
        current
          ? {
              ...current,
              courses: current.courses.map((course) => {
                if (course.id !== courseId) return course;
                // An automatic response may arrive after a newer refresh or
                // custom edit. Preserve that state until the next server read.
                if (
                  expectedState !== undefined &&
                  !studyCalculatorStatesMatch(
                    course.calculator,
                    expectedState,
                  ) &&
                  !studyCalculatorStatesMatch(course.calculator, state)
                ) {
                  newerState = true;
                  return course;
                }
                return { ...course, calculator: state };
              }),
            }
          : current,
      );
      if (newerState)
        await queryClient.invalidateQueries({ queryKey: studyQueryKey });
      if (expectedState === undefined) telegram.hapticImpact("light");
    },
  });
}

export function useSaveScholarshipPlanMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      courseId,
      config,
      expectedConfig,
    }: {
      courseId: string;
      config: ScholarshipConfig;
      expectedConfig: ScholarshipConfig | null;
    }) =>
      request<ScholarshipConfig>(
        `/api/tma/study/courses/${encodeURIComponent(courseId)}/scholarship`,
        {
          method: "PUT",
          body: JSON.stringify({ config, expectedConfig }),
        },
      ),
    async onMutate() {
      await client.cancelQueries({ queryKey: studyQueryKey });
    },
    async onSuccess(config, { courseId }) {
      await client.cancelQueries({ queryKey: studyQueryKey });
      client.setQueryData<StudyWorkspace>(studyQueryKey, (current) =>
        current
          ? {
              ...current,
              courses: current.courses.map((course) =>
                course.id === courseId
                  ? { ...course, scholarship: config }
                  : course,
              ),
            }
          : current,
      );
      telegram.hapticImpact("light");
    },
  });
}
