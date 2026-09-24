import { Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
  useSaveWorkoutProgram,
  workoutErrorMessage,
  type WorkoutProgram,
} from "../api/workout";
import { parseSetDraft, type SetDraft } from "../lib/workout";
import {
  WorkoutSetFields,
  workoutButtonClass,
  workoutInputClass,
  workoutPanelClass,
} from "./WorkoutSetFields";

interface ExerciseDraft {
  key: string;
  name: string;
  sets: (SetDraft & { key: string })[];
}
interface DayDraft {
  id: string;
  title: string;
  exercises: ExerciseDraft[];
}

let nextKey = 0;
function key() {
  return `draft-${Date.now().toString(36)}-${++nextKey}`;
}
function blankSet(): SetDraft & { key: string } {
  return { key: key(), reps: "", weightKg: "", restSeconds: "90" };
}
function blankExercise(): ExerciseDraft {
  return { key: key(), name: "", sets: [blankSet()] };
}
function blankDay(index: number): DayDraft {
  return { id: key(), title: `День ${index}`, exercises: [blankExercise()] };
}
function programDays(program: WorkoutProgram | null): DayDraft[] {
  return (
    program?.days.map((day) => ({
      ...day,
      exercises: day.exercises.map((exercise) => ({
        key: key(),
        name: exercise.name,
        sets: exercise.sets.map((set) => ({
          key: key(),
          reps: String(set.reps),
          weightKg: set.weightKg === null ? "" : String(set.weightKg),
          restSeconds: String(set.restSeconds),
        })),
      })),
    })) ?? [blankDay(1)]
  );
}

export function WorkoutProgramEditor({
  program,
  hasActiveWorkout,
}: {
  program: WorkoutProgram | null;
  hasActiveWorkout: boolean;
}) {
  const [title, setTitle] = useState(program?.title ?? "Моя программа");
  const [days, setDays] = useState(() => programDays(program));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const save = useSaveWorkoutProgram();
  useEffect(() => {
    // A background query refresh must not overwrite an unfinished form.
    if (dirty) return;
    setTitle(program?.title ?? "Моя программа");
    setDays(programDays(program));
  }, [program]);
  const current = days.find((day) => day.id === selectedId) ?? days[0];
  const changeDay = (update: (day: DayDraft) => DayDraft) => {
    setDirty(true);
    setDays((items) =>
      items.map((day) => (day.id === current.id ? update(day) : day)),
    );
  };
  const changeExercise = (
    exerciseKey: string,
    update: (exercise: ExerciseDraft) => ExerciseDraft,
  ) =>
    changeDay((day) => ({
      ...day,
      exercises: day.exercises.map((exercise) =>
        exercise.key === exerciseKey ? update(exercise) : exercise,
      ),
    }));
  async function submit() {
    setValidation(null);
    try {
      if (!title.trim()) throw new Error("Укажи название программы.");
      const input: WorkoutProgram = {
        title: title.trim(),
        days: days.map((day) => {
          if (!day.title.trim())
            throw new Error("У каждого дня должно быть название.");
          if (!day.exercises.length)
            throw new Error(`Добавь упражнение в «${day.title}».`);
          const names = day.exercises.map((exercise) =>
            exercise.name.trim().toLocaleLowerCase(),
          );
          if (new Set(names).size !== names.length)
            throw new Error(
              `В «${day.title}» повторяется название упражнения. Добавь подходы к существующему упражнению.`,
            );
          return {
            id: day.id,
            title: day.title.trim(),
            exercises: day.exercises.map((exercise) => {
              if (!exercise.name.trim())
                throw new Error(`Укажи название упражнения в «${day.title}».`);
              return {
                name: exercise.name.trim(),
                sets: exercise.sets.map(parseSetDraft),
              };
            }),
          };
        }),
      };
      await save.mutateAsync(input);
      setDirty(false);
    } catch (error) {
      if (!save.isPending)
        setValidation(
          error instanceof Error && !error.message.startsWith("{")
            ? error.message
            : "Не удалось сохранить программу.",
        );
    }
  }
  return (
    <fieldset disabled={save.isPending} className="min-w-0 space-y-4">
      <section className={`${workoutPanelClass} space-y-4`}>
        <div>
          <h2 className="text-lg font-semibold">Своя программа</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Создай дни A/B или назови их по-своему. Перед тренировкой выберешь
            нужный день.
          </p>
          {hasActiveWorkout ? (
            <p className="mt-2 text-sm text-amber-200">
              Изменения программы применятся к следующей тренировке.
            </p>
          ) : null}
        </div>
        <label className="block space-y-1 text-sm text-zinc-400">
          <span>Название программы</span>
          <input
            className={workoutInputClass}
            maxLength={120}
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              setDirty(true);
            }}
          />
        </label>
        <div className="flex flex-wrap gap-2" aria-label="Дни программы">
          {days.map((day) => (
            <button
              type="button"
              key={day.id}
              aria-pressed={day.id === current.id}
              className={`${workoutButtonClass} max-w-full break-words ${day.id === current.id ? "border-cyan-300/40 text-cyan-200" : ""}`}
              onClick={() => setSelectedId(day.id)}
            >
              {day.title || "Без названия"}
            </button>
          ))}
          <button
            type="button"
            className={workoutButtonClass}
            disabled={days.length >= 14}
            onClick={() => {
              const next = blankDay(days.length + 1);
              setDays((items) => [...items, next]);
              setSelectedId(next.id);
              setDirty(true);
            }}
          >
            <Plus className="h-4 w-4" />
            День
          </button>
        </div>
        <div className="flex items-end gap-2">
          <label className="min-w-0 flex-1 space-y-1 text-sm text-zinc-400">
            <span>Название дня</span>
            <input
              className={workoutInputClass}
              maxLength={120}
              value={current.title}
              onChange={(event) =>
                changeDay((day) => ({ ...day, title: event.target.value }))
              }
            />
          </label>
          <button
            type="button"
            aria-label="Удалить день"
            disabled={days.length === 1}
            className={`${workoutButtonClass} min-w-11 text-rose-300`}
            onClick={() => {
              if (!window.confirm(`Удалить «${current.title}» из программы?`))
                return;
              setDays((items) => items.filter((day) => day.id !== current.id));
              setSelectedId(null);
              setDirty(true);
            }}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </section>
      {current.exercises.map((exercise, exerciseIndex) => (
        <section
          className={`${workoutPanelClass} space-y-3`}
          key={exercise.key}
        >
          <div className="flex items-end gap-2">
            <label className="min-w-0 flex-1 space-y-1 text-sm text-zinc-400">
              <span>Упражнение {exerciseIndex + 1}</span>
              <input
                className={workoutInputClass}
                maxLength={120}
                placeholder="Название упражнения"
                value={exercise.name}
                onChange={(event) =>
                  changeExercise(exercise.key, (item) => ({
                    ...item,
                    name: event.target.value,
                  }))
                }
              />
            </label>
            <button
              type="button"
              aria-label={`Удалить упражнение ${exerciseIndex + 1}`}
              className={`${workoutButtonClass} min-w-11 text-rose-300`}
              onClick={() =>
                changeDay((day) => ({
                  ...day,
                  exercises: day.exercises.filter(
                    (item) => item.key !== exercise.key,
                  ),
                }))
              }
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          {exercise.sets.map((set, setIndex) => (
            <div
              key={set.key}
              className="space-y-2 border-t border-white/10 pt-3"
            >
              <div className="flex items-center justify-between gap-2 text-sm text-zinc-300">
                <span>Подход {setIndex + 1}</span>
                <button
                  type="button"
                  disabled={exercise.sets.length === 1}
                  aria-label={`Удалить подход ${setIndex + 1} упражнения ${exerciseIndex + 1}`}
                  className={`${workoutButtonClass} min-w-11`}
                  onClick={() =>
                    changeExercise(exercise.key, (item) => ({
                      ...item,
                      sets: item.sets.filter((value) => value.key !== set.key),
                    }))
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <WorkoutSetFields
                value={set}
                labelPrefix={`Упражнение ${exerciseIndex + 1}, подход ${setIndex + 1}`}
                onChange={(value) =>
                  changeExercise(exercise.key, (item) => ({
                    ...item,
                    sets: item.sets.map((old) =>
                      old.key === set.key ? { ...value, key: old.key } : old,
                    ),
                  }))
                }
              />
            </div>
          ))}
          <button
            type="button"
            disabled={exercise.sets.length >= 20}
            className={`${workoutButtonClass} w-full`}
            onClick={() =>
              changeExercise(exercise.key, (item) => ({
                ...item,
                sets: [
                  ...item.sets,
                  { ...item.sets[item.sets.length - 1], key: key() },
                ],
              }))
            }
          >
            <Plus className="h-4 w-4" />
            Подход
          </button>
        </section>
      ))}
      <button
        type="button"
        disabled={current.exercises.length >= 30}
        className={`${workoutButtonClass} w-full`}
        onClick={() =>
          changeDay((day) => ({
            ...day,
            exercises: [...day.exercises, blankExercise()],
          }))
        }
      >
        <Plus className="h-4 w-4" />
        Добавить упражнение
      </button>
      {validation || save.isError ? (
        <p role="alert" className="text-sm text-rose-200">
          {validation ?? workoutErrorMessage(save.error)}
        </p>
      ) : null}
      {save.isSuccess && !dirty ? (
        <p role="status" className="text-sm text-emerald-200">
          Программа сохранена.
        </p>
      ) : null}
      {dirty ? (
        <p className="text-sm text-amber-200">Есть несохранённые изменения.</p>
      ) : null}
      <button
        type="button"
        disabled={save.isPending}
        className={`${workoutButtonClass} w-full border-cyan-300/30 bg-cyan-300 text-graphite-950`}
        onClick={() => void submit()}
      >
        <Save className="h-4 w-4" />
        {save.isPending ? "Сохраняем…" : "Сохранить программу"}
      </button>
    </fieldset>
  );
}
