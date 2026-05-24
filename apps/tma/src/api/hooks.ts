import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { telegram } from "../telegram";
import { api } from "./client";

export const queryKeys = {
  home: ["home"] as const,
  workout: ["workout", "current"] as const,
  health: ["health"] as const,
  focus: ["focus"] as const,
  mode: ["mode"] as const,
  discreteMathCourse: ["course", "discrete-math-summer-term"] as const,
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

export function useModeQuery() {
  return useQuery({
    queryKey: queryKeys.mode,
    queryFn: api.getMode,
  });
}

export function useDiscreteMathCourseQuery() {
  return useQuery({
    queryKey: queryKeys.discreteMathCourse,
    queryFn: api.getDiscreteMathCourse,
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

export function useUpdateDiscreteMathCourseProgressMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.updateDiscreteMathCourseProgress,
    onSuccess(data) {
      telegram.hapticImpact("light");
      queryClient.setQueryData(queryKeys.discreteMathCourse, data);
      void queryClient.invalidateQueries({ queryKey: queryKeys.focus });
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
    onSuccess(data) {
      telegram.hapticImpact("medium");
      queryClient.setQueryData(queryKeys.workout, data);
      void queryClient.invalidateQueries({ queryKey: queryKeys.home });
    },
  });
}
