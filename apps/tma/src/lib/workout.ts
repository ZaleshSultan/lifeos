import type { WorkoutHistorySession, WorkoutSetInput } from "../api/workout";

export interface SetDraft {
  reps: string;
  weightKg: string;
  restSeconds: string;
}

export function parseSetDraft(draft: SetDraft): WorkoutSetInput {
  const reps = Number(draft.reps);
  const weightKg =
    draft.weightKg.trim() === ""
      ? null
      : Number(draft.weightKg.replace(",", "."));
  const restSeconds = Number(draft.restSeconds);
  if (
    !draft.reps.trim() ||
    !Number.isInteger(reps) ||
    reps < 1 ||
    reps > 1000
  ) {
    throw new Error("Повторы: целое число от 1 до 1000.");
  }
  if (
    weightKg !== null &&
    (!Number.isFinite(weightKg) || weightKg < 0 || weightKg > 2000)
  ) {
    throw new Error("Вес: от 0 до 2000 кг. Пустое поле — вес не указан.");
  }
  if (
    !draft.restSeconds.trim() ||
    !Number.isInteger(restSeconds) ||
    restSeconds < 0 ||
    restSeconds > 3600
  ) {
    throw new Error("Отдых: целое число от 0 до 3600 секунд.");
  }
  return { reps, weightKg, restSeconds };
}

export function restSecondsRemaining(
  deadline: string | number | null | undefined,
  now: number,
): number {
  if (deadline === null || deadline === undefined) return 0;
  const end = typeof deadline === "number" ? deadline : Date.parse(deadline);
  return Number.isFinite(end) ? Math.max(0, Math.ceil((end - now) / 1000)) : 0;
}

export interface ExerciseProgressPoint {
  workoutId: string;
  date: string;
  completedSets: number;
  reps: number;
  volumeKg: number;
  maxWeightKg: number | null;
}

export function exerciseProgress(
  sessions: WorkoutHistorySession[],
  name: string,
): ExerciseProgressPoint[] {
  const key = name.trim().toLocaleLowerCase();
  return sessions
    .flatMap((session) => {
      const sets = session.exercises
        .filter((exercise) => exercise.name.trim().toLocaleLowerCase() === key)
        .flatMap((exercise) => exercise.sets)
        .filter((set) => set.completed);
      if (!sets.length) return [];
      const weights = sets
        .map((set) => set.targetWeightKg)
        .filter((weight): weight is number => weight != null);
      return [
        {
          workoutId: session.id,
          date: session.startedAt,
          completedSets: sets.length,
          reps: sets.reduce((sum, set) => sum + (set.targetReps ?? 0), 0),
          volumeKg: sets.reduce(
            (sum, set) =>
              sum + (set.targetReps ?? 0) * (set.targetWeightKg ?? 0),
            0,
          ),
          maxWeightKg: weights.length ? Math.max(...weights) : null,
        },
      ];
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}
