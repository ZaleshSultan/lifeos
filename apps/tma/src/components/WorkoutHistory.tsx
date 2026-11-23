import { useState } from "react";
import {
  comparableLift,
  countedTotals,
  loadLabels,
  volumeCaption,
} from "@lifeos/core/personal-workout";
import {
  useWorkoutHistoryQuery,
  workoutErrorMessage,
  type RecordedWorkoutExercise,
  type WorkoutHistorySession,
} from "../api/workout";
import { ErrorPanel, LoadingPanel } from "./AsyncState";
import { WorkoutExerciseGif } from "./WorkoutExerciseGif";
import { deltaText } from "./PersonalSession";
import {
  workoutButtonClass,
  workoutInputClass,
  workoutPanelClass,
} from "./WorkoutSetFields";
const number = (value: number) => value.toLocaleString("ru-RU");
function date(value: string, timezone?: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));
}
function identity(ex: RecordedWorkoutExercise) {
  return ex.load ? comparableLift(ex.load) : "legacy:" + ex.name;
}
function signature(s: WorkoutHistorySession) {
  return JSON.stringify(s.exercises.map(identity).sort());
}
function label(ex: RecordedWorkoutExercise) {
  const load = ex.load;
  if (!load) return ex.name;
  return [
    ex.name,
    load.variant,
    loadLabels[load.mode],
    load.baseKg !== null ? "Основание " + number(load.baseKg) + " кг" : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
function Sets({
  ex,
  comparison = false,
}: {
  ex: RecordedWorkoutExercise;
  comparison?: boolean;
}) {
  return (
    <ul className="space-y-1 text-sm">
      {ex.sets
        .filter((s) => s.completed)
        .map((s) => {
          const previous = ex.load?.previous.find(
            (p) => p.slot === s.plan?.slot && p.warmup === s.plan?.warmup,
          );
          return (
            <li key={s.id}>
              {s.index}.{" "}
              {s.targetWeightKg == null
                ? "Без указанного веса"
                : number(s.targetWeightKg) + " кг"}{" "}
              × {s.targetReps ?? "—"}
              {s.plan?.warmup ? " · разминка" : ""}
              {comparison && previous && ex.load && (
                <span className="block text-xs text-zinc-400">
                  {deltaText(
                    (s.targetWeightKg ?? 0) - previous.weightKg,
                    (s.targetReps ?? 0) - previous.reps,
                    ex.load.mode,
                  )}
                </span>
              )}
            </li>
          );
        })}
    </ul>
  );
}
export function WorkoutHistory() {
  const query = useWorkoutHistoryQuery();
  const [selected, setSelected] = useState("");
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
        <p className="text-sm text-zinc-400">
          Заверши первую тренировку, чтобы увидеть результаты.
        </p>
      </section>
    );
  const options = new Map<string, string>();
  for (const s of sessions)
    for (const e of s.exercises)
      if (e.sets.some((x) => x.completed)) options.set(identity(e), label(e));
  const key = options.has(selected) ? selected : options.keys().next().value;
  return (
    <div className="space-y-4">
      {options.size > 0 && (
        <section className={workoutPanelClass + " space-y-3"}>
          <h2 className="text-lg font-semibold">Прогресс по упражнению</h2>
          <select
            aria-label="Упражнение для просмотра прогресса"
            className={workoutInputClass}
            value={key}
            onChange={(e) => setSelected(e.target.value)}
          >
            {Array.from(options, ([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          {sessions.map((s) => {
            const ex = s.exercises.find(
              (e) => identity(e) === key && e.sets.some((x) => x.completed),
            );
            if (!ex) return null;
            const done = ex.sets.filter((x) => x.completed);
            const weights = done.flatMap((x) =>
              x.targetWeightKg == null ? [] : [x.targetWeightKg],
            );
            const t = countedTotals([ex]);
            return (
              <details key={s.id} className="rounded-lg bg-white/5 p-2">
                <summary className="min-h-11 cursor-pointer text-sm">
                  {date(s.startedAt, s.timezone)} ·{" "}
                  {ex.sets
                    .filter((x) => x.completed)
                    .map(
                      (x) =>
                        (x.targetWeightKg ?? "—") +
                        " × " +
                        (x.targetReps ?? "—"),
                    )
                    .join(" / ")}
                </summary>
                <p className="mb-2 text-xs text-zinc-400">
                  {t.sets} подх. · {t.reps} повт. · {number(t.volumeKg)} кг
                  {weights.length
                    ? " · Макс. " + number(Math.max(...weights)) + " кг"
                    : ""}
                </p>
                <Sets ex={ex} comparison />
              </details>
            );
          })}
        </section>
      )}
      <h2 className="text-lg font-semibold">Завершённые тренировки</h2>
      {sessions.map((session, i) => {
        const total = countedTotals(session.exercises);
        const last = sessions
          .slice(i + 1)
          .find((s) => signature(s) === signature(session));
        const before = last && countedTotals(last.exercises);
        const signed = (v: number) => (v > 0 ? "+" : "") + number(v);
        return (
          <details className={workoutPanelClass} key={session.id}>
            <summary className="min-h-11 cursor-pointer">
              <strong>{session.title}</strong>
              <span className="mt-1 block text-sm text-zinc-400">
                {date(session.startedAt, session.timezone)} · {total.sets} подх.
                · {total.reps} повт. · {number(total.volumeKg)} кг
              </span>
            </summary>
            <div className="mt-3 space-y-3">
              <p className="text-xs text-zinc-400">
                Завершена {date(session.endedAt, session.timezone)}{" "}
                {session.timezone}
              </p>
              {session.personalRevision !== undefined && (
                <p className="text-xs text-zinc-400">{volumeCaption}</p>
              )}
              <p className="text-sm text-cyan-200">
                {before && last
                  ? "К тренировке " +
                    date(last.startedAt, last.timezone) +
                    ": " +
                    signed(total.sets - before.sets) +
                    " подх. · " +
                    signed(total.reps - before.reps) +
                    " повт. · " +
                    signed(total.volumeKg - before.volumeKg) +
                    " кг"
                  : "Предыдущей сопоставимой тренировки в загруженной истории нет."}
              </p>
              {session.sessionNote && (
                <p className="break-words text-sm">{session.sessionNote}</p>
              )}
              {session.exercises
                .filter((ex) => ex.sets.some((s) => s.completed))
                .map((ex) => (
                  <div
                    key={ex.id}
                    className="space-y-2 border-t border-white/10 pt-3"
                  >
                    <h3 className="font-semibold">{ex.name}</h3>
                    {ex.load && (
                      <p className="text-xs text-zinc-400">{label(ex)}</p>
                    )}
                    <WorkoutExerciseGif gifUrl={ex.gifUrl} name={ex.name} />
                    <Sets ex={ex} comparison />
                  </div>
                ))}
            </div>
          </details>
        );
      })}
      {query.hasNextPage && (
        <button
          className={workoutButtonClass + " w-full"}
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          Загрузить более ранние тренировки
        </button>
      )}
    </div>
  );
}
