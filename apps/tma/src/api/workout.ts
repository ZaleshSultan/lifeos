import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { LiftSnapshot, SetSnapshot } from "@lifeos/core";
import { telegram } from "../telegram";
import { request } from "./client";
import { queryKeys } from "./hooks";
import type { CurrentWorkout, WorkoutExercise, WorkoutSet } from "./types";

export interface WorkoutSetInput {
  reps: number;
  weightKg: number | null;
  restSeconds: number;
}

export interface WorkoutProgram {
  title: string;
  days: {
    id: string;
    title: string;
    exercises: {
      name: string;
      gifUrl?: string | null;
      sets: WorkoutSetInput[];
    }[];
  }[];
}

export interface RecordedWorkoutSet extends WorkoutSet {
  plan?: SetSnapshot;
  restSeconds: number | null;
}

export interface RecordedWorkoutExercise extends Omit<WorkoutExercise, "sets"> {
  load?: LiftSnapshot;
  sets: RecordedWorkoutSet[];
}

export interface WorkoutSession extends Omit<CurrentWorkout, "exercises"> {
  personalRevision?: number;
  sessionNote?: string;
  exercises: RecordedWorkoutExercise[];
}

export interface WorkoutHistorySession extends WorkoutSession {
  timezone?: string;
  endedAt: string;
  volumeKg: number;
}

export const workoutKeys = {
  program: ["workout", "program"] as const,
  history: ["workout", "history"] as const,
};

export const workoutApi = {
  current: () => request<WorkoutSession | null>("/api/tma/workout/current"),
  program: () => request<WorkoutProgram | null>("/api/tma/workout/program"),
  saveProgram: (program: WorkoutProgram) =>
    request<WorkoutProgram>("/api/tma/workout/program", {
      method: "PUT",
      body: JSON.stringify(program),
    }),
  history: (offset = 0) =>
    request<WorkoutHistorySession[]>(
      "/api/tma/workout/history?offset=" + offset,
    ),
  start: (programDayId?: string) =>
    request<WorkoutSession>("/api/tma/workout/start", {
      method: "POST",
      body: JSON.stringify(programDayId ? { programDayId } : {}),
    }),
  saveSet: (setId: string, values: WorkoutSetInput) =>
    request<WorkoutSession>(
      `/api/tma/workout/sets/${encodeURIComponent(setId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(values),
      },
    ),
  completeSet: (setId: string) =>
    request<WorkoutSession>(
      `/api/tma/workout/sets/${encodeURIComponent(setId)}/complete`,
      { method: "POST" },
    ),
  undoSet: (setId: string) =>
    request<WorkoutSession>(
      `/api/tma/workout/sets/${encodeURIComponent(setId)}/undo`,
      { method: "POST" },
    ),
  finish: (id: string) =>
    request<WorkoutSession>(
      `/api/tma/workout/${encodeURIComponent(id)}/complete`,
      { method: "POST" },
    ),
};

export function useWorkoutSessionQuery() {
  return useQuery({ queryKey: queryKeys.workout, queryFn: workoutApi.current });
}

export function useWorkoutProgramQuery() {
  return useQuery({
    queryKey: workoutKeys.program,
    queryFn: workoutApi.program,
  });
}

export function useWorkoutHistoryQuery(enabled = true) {
  return useInfiniteQuery({
    queryKey: workoutKeys.history,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => workoutApi.history(pageParam),
    getNextPageParam: (last, pages) =>
      last.length === 50 ? pages.length * 50 : undefined,
    select: (data) => data.pages.flat(),
    enabled,
  });
}

export function useSaveWorkoutProgram() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: workoutApi.saveProgram,
    onSuccess(program) {
      client.setQueryData(workoutKeys.program, program);
      telegram.hapticImpact("light");
    },
  });
}

type SetAction =
  | { setId: string; action: "save" | "complete"; values: WorkoutSetInput }
  | { setId: string; action: "undo" };

export function useWorkoutActions() {
  const client = useQueryClient();
  const onSession = (session: WorkoutSession) => {
    client.setQueryData(queryKeys.workout, session);
    void client.invalidateQueries({ queryKey: queryKeys.home });
    telegram.hapticImpact("light");
  };
  const start = useMutation({
    mutationFn: workoutApi.start,
    onSuccess: onSession,
  });
  const set = useMutation({
    async mutationFn(input: SetAction) {
      if (input.action === "undo") return workoutApi.undoSet(input.setId);
      const session = await workoutApi.saveSet(input.setId, input.values);
      return input.action === "complete"
        ? workoutApi.completeSet(input.setId)
        : session;
    },
    onSuccess: onSession,
    onError() {
      // Saving values and completing a set are separate requests. Reload after
      // a failure so a saved first request remains visible to the user.
      void client.invalidateQueries({ queryKey: queryKeys.workout });
    },
  });
  const finish = useMutation({
    mutationFn: workoutApi.finish,
    onSuccess() {
      client.setQueryData(queryKeys.workout, null);
      void client.invalidateQueries({ queryKey: workoutKeys.history });
      void client.invalidateQueries({ queryKey: queryKeys.home });
      telegram.hapticImpact("medium");
    },
  });
  function acceptPersonal(session: WorkoutSession) {
    if (session.mode === "completed") {
      client.setQueryData(queryKeys.workout, null);
      void client.invalidateQueries({ queryKey: workoutKeys.history });
    } else client.setQueryData(queryKeys.workout, session);
    void client.invalidateQueries({ queryKey: queryKeys.home });
  }
  return { start, set, finish, acceptPersonal };
}

export function workoutErrorMessage(error: unknown): string {
  if (!(error instanceof Error))
    return "Не удалось сохранить. Попробуй ещё раз.";
  try {
    const body = JSON.parse(error.message) as {
      error?: string;
      message?: string;
    };
    if (body.error === "workout_active_other")
      return "Открыта другая тренировка. Заверши её перед стартом Full Body.";
    if (body.error === "workout_conflict")
      return "Запись изменилась. Загрузи актуальную версию перед новой правкой.";
    if (body.error === "workout_empty")
      return "Сначала отметь хотя бы один подход.";
    if (body.error === "workout_set_limit")
      return "Достигнут предел подходов в упражнении.";
    if (body.error?.includes("not_found"))
      return "Запись не найдена. Обнови экран.";
    if (body.error?.includes("completed") || body.error?.includes("closed"))
      return "Тренировка уже завершена. Обнови экран.";
    if (
      body.error === "invalid_workout_input" &&
      body.message?.startsWith("GIF URL")
    )
      return "Проверь ссылку на GIF: http:// или https://, до 2048 символов, без данных входа.";
    if (body.error?.includes("invalid"))
      return "Проверь названия, повторы, вес и время отдыха.";
    return "Не удалось сохранить. Обнови экран и попробуй ещё раз.";
  } catch {
    return "Проверь соединение и попробуй ещё раз.";
  }
}
