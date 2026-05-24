import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { telegram } from "../telegram";
import { api } from "./client";

export const queryKeys = {
  home: ["home"] as const,
  workout: ["workout", "current"] as const,
  health: ["health"] as const,
  focus: ["focus"] as const,
  sources: ["sources"] as const,
  academic: ["academic"] as const,
  mode: ["mode"] as const,
  activeCourse: ["course", "active"] as const,
};

export function useHomeQuery() {
  return useQuery({
    queryKey: queryKeys.home,
    queryFn: api.getHome,
  });
}

export function useWorkoutQuery() {
  return useQuery({
    queryKey: queryKeys.workout,
    queryFn: api.getCurrentWorkout,
  });
}

export function useHealthQuery() {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: api.getHealth,
  });
}

export function useFocusQuery() {
  return useQuery({
    queryKey: queryKeys.focus,
    queryFn: api.getFocus,
  });
}

export function useSourcesQuery() {
  return useQuery({
    queryKey: queryKeys.sources,
    queryFn: api.getSources,
  });
}

export function useAcademicQuery() {
  return useQuery({
    queryKey: queryKeys.academic,
    queryFn: api.getAcademic,
  });
}

export function useModeQuery() {
  return useQuery({
    queryKey: queryKeys.mode,
    queryFn: api.getMode,
  });
}

export function useActiveCourseQuery() {
  return useQuery({
    queryKey: queryKeys.activeCourse,
    queryFn: api.getActiveCourse,
  });
}

export function useSaveModeMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.saveMode,
    onSuccess(data) {
      telegram.hapticImpact("medium");
      queryClient.setQueryData(queryKeys.mode, data);
      void queryClient.invalidateQueries({ queryKey: queryKeys.home });
      void queryClient.invalidateQueries({ queryKey: queryKeys.focus });
      void queryClient.invalidateQueries({ queryKey: queryKeys.workout });
    },
  });
}

export function useClearModeMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.clearMode,
    onSuccess(data) {
      telegram.hapticImpact("light");
      queryClient.setQueryData(queryKeys.mode, data);
      void queryClient.invalidateQueries({ queryKey: queryKeys.home });
      void queryClient.invalidateQueries({ queryKey: queryKeys.focus });
      void queryClient.invalidateQueries({ queryKey: queryKeys.workout });
    },
  });
}

export function useUpdateActiveCourseProgressMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.updateActiveCourseProgress,
    onSuccess(data) {
      telegram.hapticImpact("light");
      queryClient.setQueryData(queryKeys.activeCourse, data);
      void queryClient.invalidateQueries({ queryKey: queryKeys.focus });
      void queryClient.invalidateQueries({ queryKey: queryKeys.home });
    },
  });
}

export function useCreateReminderMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.createReminder,
    onSuccess(data) {
      telegram.hapticImpact("light");
      queryClient.setQueryData(queryKeys.sources, data);
      void queryClient.invalidateQueries({ queryKey: queryKeys.home });
    },
  });
}

export function useStartWorkoutMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.startWorkout,
    onSuccess(data) {
      telegram.hapticImpact("medium");
      queryClient.setQueryData(queryKeys.workout, data);
      void queryClient.invalidateQueries({ queryKey: queryKeys.home });
    },
  });
}

export function useCompleteSetMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.completeSet,
    onSuccess(data) {
      telegram.hapticImpact("light");
      queryClient.setQueryData(queryKeys.workout, data);
      void queryClient.invalidateQueries({ queryKey: queryKeys.home });
    },
  });
}

export function useUndoSetMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.undoSet,
    onSuccess(data) {
      telegram.hapticImpact("light");
      queryClient.setQueryData(queryKeys.workout, data);
      void queryClient.invalidateQueries({ queryKey: queryKeys.home });
    },
  });
}

export function useCompleteWorkoutMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.completeWorkout,
    onSuccess() {
      telegram.hapticImpact("medium");
      queryClient.setQueryData(queryKeys.workout, null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.home });
    },
  });
}
