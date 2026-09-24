import { useMemo, useState } from "react";
import { useWorkoutHistoryQuery, workoutErrorMessage } from "../api/workout";
import { exerciseProgress } from "../lib/workout";
import { formatDateTime } from "../lib/format";
import { ErrorPanel, LoadingPanel } from "./AsyncState";
import { workoutInputClass, workoutPanelClass } from "./WorkoutSetFields";

export function WorkoutHistory() {
  const query = useWorkoutHistoryQuery();
  const [exercise, setExercise] = useState("");
  const names = useMemo(
    () =>
      [
        ...new Set(
          (query.data ?? []).flatMap((session) =>
            session.exercises.map((item) => item.name),
          ),
        ),
      ].sort((a, b) => a.localeCompare(b)),
    [query.data],
  );
  if (query.isLoading) return <LoadingPanel title="Загружаем историю" />;
  if (query.isError)
    return (
      <ErrorPanel
        title="История недоступна"
        detail={workoutErrorMessage(query.error)}
        onRetry={() => void query.refetch()}
      />
    );
  const sessions = query.data ?? [];
  if (!sessions.length)
    return (
      <section className={workoutPanelClass}>
        <h2 className="font-semibold">История пока пуста</h2>
        <p className="mt-2 text-sm text-zinc-400">
          Заверши первую тренировку. Здесь появятся выполненные подходы, веса и
          прогресс по упражнениям.
        </p>
      </section>
    );
  const selected = names.includes(exercise) ? exercise : names[0];
  const points = exerciseProgress(sessions, selected ?? "");
  return (
    <div className="space-y-4">
      <section className={`${workoutPanelClass} space-y-3`}>
        <h2 className="text-lg font-semibold">Прогресс по упражнению</h2>
        <select
          aria-label="Упражнение для просмотра прогресса"
          className={workoutInputClass}
          value={selected ?? ""}
          onChange={(event) => setExercise(event.target.value)}
        >
          {names.map((name) => (
            <option value={name} key={name}>
              {name}
            </option>
          ))}
        </select>
        <p className="text-xs leading-relaxed text-zinc-400">
          Только выполненные подходы. Объём = повторы × записанный вес. Подходы
          без указанного веса не добавляют килограммы к объёму.
        </p>
        {!points.length ? (
          <p className="text-sm text-zinc-400">
            Для этого упражнения пока нет выполненных подходов.
          </p>
        ) : (
          <div className="space-y-2">
            {points.map((point) => (
              <div
                key={point.workoutId}
                className="rounded-lg bg-white/[0.03] p-3"
              >
                <div className="text-sm font-medium">
                  {formatDateTime(point.date)}
                </div>
                <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <dt className="text-zinc-400">Подходы / повт.</dt>
                    <dd className="mt-1 text-sm">
                      {point.completedSets} / {point.reps}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-zinc-400">Макс. вес</dt>
                    <dd className="mt-1 text-sm">
                      {point.maxWeightKg === null
                        ? "—"
                        : `${point.maxWeightKg} кг`}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-zinc-400">Объём</dt>
                    <dd className="mt-1 text-sm">
                      {point.volumeKg.toLocaleString("ru-RU")} кг
                    </dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Завершённые тренировки</h2>
          <p className="mt-1 text-xs text-zinc-400">
            Последние {sessions.length} из максимум 50 тренировок.
          </p>
        </div>
        {sessions.map((session) => (
          <details className={workoutPanelClass} key={session.id}>
            <summary className="min-h-11 cursor-pointer break-words">
              <span className="font-semibold">{session.title}</span>
              <span className="mt-1 block text-xs text-zinc-400">
                {formatDateTime(session.startedAt)} · {session.completedSets}/
                {session.totalSets} подходов
              </span>
            </summary>
            <div className="mt-3 space-y-3">
              <div className="text-sm text-zinc-300">
                Объём: {session.volumeKg.toLocaleString("ru-RU")} кг ·
                Завершена: {formatDateTime(session.endedAt)}
              </div>
              {session.exercises.map((item) => (
                <div key={item.id} className="border-t border-white/10 pt-3">
                  <h3 className="break-words text-sm font-semibold">
                    {item.name}
                  </h3>
                  <ul className="mt-2 space-y-1 text-sm text-zinc-400">
                    {item.sets.map((set) => (
                      <li
                        key={set.id}
                        className={
                          set.completed ? "text-zinc-200" : "text-zinc-500"
                        }
                      >
                        {set.index}. {set.targetReps ?? "—"} повт. ×{" "}
                        {set.targetWeightKg == null
                          ? "вес не указан"
                          : `${set.targetWeightKg} кг`}{" "}
                        · {set.completed ? "выполнен" : "пропущен"}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </details>
        ))}
      </section>
    </div>
  );
}
