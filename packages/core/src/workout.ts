export interface WorkoutProgramSet {
  reps: number;
  weightKg: number | null;
  restSeconds: number;
}

export interface WorkoutProgramExercise {
  name: string;
  gifUrl?: string | null;
  sets: WorkoutProgramSet[];
}

export interface WorkoutProgramDay {
  id: string;
  title: string;
  exercises: WorkoutProgramExercise[];
}

export interface WorkoutProgram {
  title: string;
  days: WorkoutProgramDay[];
}

export class WorkoutInputError extends Error {}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkoutInputError("Expected an object");
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 120) {
    throw new WorkoutInputError(`${label} must contain 1–120 characters`);
  }
  return value.trim();
}

function list(value: unknown, maximum: number, label: string): unknown[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum) {
    throw new WorkoutInputError(`${label} must contain 1–${maximum} entries`);
  }
  return value;
}

export function parseWorkoutGifUrl(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new WorkoutInputError(
      "GIF URL must contain 1–2048 characters or be null",
    );
  }
  const gifUrl = value.trim();
  if (!gifUrl || gifUrl.length > 2048 || /[\u0000-\u001f\u007f]/.test(gifUrl)) {
    throw new WorkoutInputError(
      "GIF URL must contain 1–2048 characters or be null",
    );
  }
  let url: URL;
  try {
    url = new URL(gifUrl);
  } catch {
    throw new WorkoutInputError(
      "GIF URL must be an http(s) URL without credentials",
    );
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    !url.hostname ||
    url.username ||
    url.password
  ) {
    throw new WorkoutInputError(
      "GIF URL must be an http(s) URL without credentials",
    );
  }
  return gifUrl;
}

export function parseWorkoutSet(value: unknown): WorkoutProgramSet {
  const input = object(value);
  if (
    typeof input.reps !== "number" ||
    !Number.isInteger(input.reps) ||
    input.reps < 1 ||
    input.reps > 1000
  ) {
    throw new WorkoutInputError(
      "Repetitions must be a whole number from 1 to 1000",
    );
  }
  if (
    input.weightKg !== null &&
    (typeof input.weightKg !== "number" ||
      !Number.isFinite(input.weightKg) ||
      input.weightKg < 0 ||
      input.weightKg > 2000)
  ) {
    throw new WorkoutInputError(
      "Weight must be null or a number from 0 to 2000 kg",
    );
  }
  if (
    typeof input.restSeconds !== "number" ||
    !Number.isInteger(input.restSeconds) ||
    input.restSeconds < 0 ||
    input.restSeconds > 3600
  ) {
    throw new WorkoutInputError(
      "Rest must be a whole number from 0 to 3600 seconds",
    );
  }
  return {
    reps: input.reps,
    weightKg: input.weightKg,
    restSeconds: input.restSeconds,
  };
}

export function parseWorkoutProgram(value: unknown): WorkoutProgram {
  const input = object(value);
  const seenDays = new Set<string>();
  const days = list(input.days, 14, "Days").map((value): WorkoutProgramDay => {
    const day = object(value);
    if (
      typeof day.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(day.id) ||
      seenDays.has(day.id)
    ) {
      throw new WorkoutInputError(
        "Each day needs a unique ID using letters, numbers, underscores or hyphens",
      );
    }
    seenDays.add(day.id);
    const seenExercises = new Set<string>();
    const exercises = list(day.exercises, 30, "Exercises").map((value) => {
      const exercise = object(value);
      const name = text(exercise.name, "Exercise name");
      const key = name.toLocaleLowerCase();
      if (seenExercises.has(key)) {
        throw new WorkoutInputError(
          "Exercise names must be unique within a day; add sets to the existing exercise",
        );
      }
      seenExercises.add(key);
      return {
        name,
        ...(exercise.gifUrl === undefined
          ? {}
          : { gifUrl: parseWorkoutGifUrl(exercise.gifUrl) }),
        sets: list(exercise.sets, 20, "Sets").map(parseWorkoutSet),
      };
    });
    return { id: day.id, title: text(day.title, "Day title"), exercises };
  });
  return { title: text(input.title, "Program title"), days };
}

/** Only performed, externally loaded sets contribute to recorded training volume. */
export function workoutVolumeKg(
  sets: ReadonlyArray<{
    completed: boolean;
    targetReps: number | null;
    targetWeightKg: number | null;
  }>,
): number {
  const volume = sets.reduce(
    (total, set) =>
      total +
      (set.completed ? (set.targetReps ?? 0) * (set.targetWeightKg ?? 0) : 0),
    0,
  );
  return Math.round(volume * 100) / 100;
}
