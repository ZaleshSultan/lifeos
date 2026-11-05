"use client";
import {
  useDraftState,
  useDraftRetention,
} from "../../../tma/src/lib/retained-draft";
import { useRef, useState } from "react";
import type { WorkoutProgram } from "../../../../packages/core/src/workout.js";
import { parseWorkoutSet } from "../../../../packages/core/src/workout.js";
import type {
  WebWorkout,
  WebWorkoutHistory,
  WebWorkoutSet,
} from "@/lib/dashboard-contracts";
import { SectionPanel } from "@/components/SectionPanel";
import {
  Notice,
  buttonClass,
  inputClass,
  rowClass,
  useUnsavedGuard,
} from "@/components/WorkspaceUI";
import { webRequest, webErrorMessage } from "@/lib/web-client";

function SetEditor({
  set,
  busy,
  onAction,
}: {
  set: WebWorkoutSet;
  busy: boolean;
  onAction: (
    action: "save" | "complete" | "undo",
    values?: { reps: number; weightKg: number | null; restSeconds: number },
  ) => Promise<void>;
}) {
  const [reps, setReps] = useDraftState(
    `workout:set:${set.id}`,
    "reps",
    String(set.targetReps ?? ""),
  );
  const [weight, setWeight] = useDraftState(
    `workout:set:${set.id}`,
    "weight",
    set.targetWeightKg === null || set.targetWeightKg === undefined
      ? ""
      : String(set.targetWeightKg),
  );
  const [rest, setRest] = useDraftState(
    `workout:set:${set.id}`,
    "rest",
    String(set.restSeconds ?? 90),
  );
  const [dirty, setDirty] = useDraftState(
    `workout:set:${set.id}`,
    "dirty",
    false,
  );
  const retained = useDraftRetention(`workout:set:${set.id}`, dirty);
  useUnsavedGuard(dirty || busy, retained && !busy);
  const [error, setError] = useState<string | null>(null);
  async function action(next: "save" | "complete" | "undo") {
    try {
      setError(null);
      if (next === "undo") {
        await onAction(next);
        return;
      }
      const values = parseWorkoutSet({
        reps: reps.trim() ? Number(reps) : NaN,
        weightKg: weight.trim() ? Number(weight) : null,
        restSeconds: rest.trim() ? Number(rest) : NaN,
      });
      await onAction(next, values);
      setDirty(false);
    } catch {
      setError(
        "Повторы: 1–1000; вес: 0–2000 кг или пусто; отдых: 0–3600 секунд.",
      );
    }
  }
  return (
    <div className={rowClass}>
      <p className="text-sm font-medium text-white">
        Подход {set.index} · {set.completed ? "выполнен" : "ожидает"}
      </p>
      <fieldset
        disabled={busy || set.completed}
        className="mt-3 grid min-w-0 grid-cols-3 gap-2"
      >
        <label className="min-w-0 text-xs text-zinc-300">
          Повторы
          <input
            type="number"
            className={inputClass}
            min={1}
            max={1000}
            value={reps}
            onChange={(e) => {
              setReps(e.target.value);
              setDirty(true);
            }}
          />
        </label>
        <label className="min-w-0 text-xs text-zinc-300">
          Вес, кг
          <input
            type="number"
            step="0.1"
            className={inputClass}
            min={0}
            max={2000}
            value={weight}
            onChange={(e) => {
              setWeight(e.target.value);
              setDirty(true);
            }}
          />
        </label>
        <label className="min-w-0 text-xs text-zinc-300">
          Отдых, сек
          <input
            type="number"
            className={inputClass}
            min={0}
            max={3600}
            value={rest}
            onChange={(e) => {
              setRest(e.target.value);
              setDirty(true);
            }}
          />
        </label>
      </fieldset>
      <div className="mt-3 flex flex-wrap gap-2">
        {set.completed ? (
          <button
            type="button"
            className={buttonClass}
            disabled={busy}
            onClick={() => void action("undo")}
          >
            Отменить отметку
          </button>
        ) : (
          <>
            <button
              type="button"
              className={buttonClass}
              disabled={busy}
              onClick={() => void action("save")}
            >
              Сохранить значения
            </button>
            <button
              type="button"
              className={`${buttonClass} border-emerald-300/30 text-emerald-100`}
              disabled={busy}
              onClick={() => void action("complete")}
            >
              Подход выполнен
            </button>
          </>
        )}
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-rose-200">
          {error}
        </p>
      ) : null}
    </div>
  );
}
export function WorkoutWorkspace({
  initial,
  history: initialHistory,
  program,
}: {
  initial: WebWorkout | null;
  history: WebWorkoutHistory[] | null;
  program: WorkoutProgram | null;
}) {
  const [current, setCurrent] = useState(initial);
  const [history, setHistory] = useState(initialHistory);
  const [day, setDay] = useState(program?.days[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef(false);
  async function load() {
    const [next, past] = await Promise.all([
      webRequest<WebWorkout | null>("workout/current"),
      webRequest<WebWorkoutHistory[]>("workout/history"),
    ]);
    setCurrent(next);
    setHistory(past);
  }
  async function run(operation: () => Promise<void>) {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    setError(null);
    try {
      await operation();
    } catch (e) {
      setError(webErrorMessage(e));
      try {
        await load();
      } catch {
        /* Keep the last owned snapshot and show the original error. */
      }
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="space-y-5">
      {error ? <Notice error>{error}</Notice> : null}
      <SectionPanel
        title={current?.title ?? "Тренировка"}
        action={
          <button
            type="button"
            disabled={busy}
            className={buttonClass}
            onClick={() => void run(load)}
          >
            Обновить
          </button>
        }
      >
        {current ? (
          <>
            <p className="text-sm text-zinc-300">
              Подходов выполнено {current.completedSets}/{current.totalSets}.
              Начало:{" "}
              {new Intl.DateTimeFormat("ru-RU", {
                timeZone: "Asia/Almaty",
                timeStyle: "short",
                dateStyle: "medium",
              }).format(new Date(current.startedAt))}
              .
            </p>
            {current.restTimerEndsAt ? (
              <p className="mt-2 text-sm text-cyan-200">
                Отдых до{" "}
                {new Intl.DateTimeFormat("ru-RU", {
                  timeZone: "Asia/Almaty",
                  timeStyle: "medium",
                }).format(new Date(current.restTimerEndsAt))}
                .
              </p>
            ) : null}
            <div className="mt-4 space-y-4">
              {current.exercises.map((exercise) => (
                <section key={exercise.id}>
                  <h3 className="mb-3 break-words text-base font-semibold text-white">
                    {exercise.name}
                  </h3>
                  <div className="grid gap-3 lg:grid-cols-2">
                    {exercise.sets.map((set) => (
                      <SetEditor
                        key={`${set.id}-${set.completed}-${set.targetReps}-${set.targetWeightKg}`}
                        set={set}
                        busy={busy}
                        onAction={(action, values) =>
                          run(async () => {
                            if (action === "undo") {
                              setCurrent(
                                await webRequest<WebWorkout>(
                                  `workout/sets/${set.id}/undo`,
                                  { method: "POST", body: "{}" },
                                ),
                              );
                              return;
                            }
                            const saved = await webRequest<WebWorkout>(
                              `workout/sets/${set.id}`,
                              { method: "PATCH", body: JSON.stringify(values) },
                            );
                            setCurrent(
                              action === "complete"
                                ? await webRequest<WebWorkout>(
                                    `workout/sets/${set.id}/complete`,
                                    { method: "POST", body: "{}" },
                                  )
                                : saved,
                            );
                          })
                        }
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
            <button
              type="button"
              className={`${buttonClass} mt-5 w-full`}
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    "Завершить текущую тренировку и сохранить её в историю?",
                  )
                )
                  void run(async () => {
                    await webRequest(`workout/${current.id}/complete`, {
                      method: "POST",
                      body: "{}",
                    });
                    await load();
                  });
              }}
            >
              Завершить тренировку
            </button>
          </>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-zinc-300">
              Активной тренировки нет. Новая сессия начнётся только после
              нажатия кнопки.
            </p>
            {program ? (
              <label className="block text-sm text-zinc-300">
                {program.title}
                <select
                  className={inputClass}
                  value={day}
                  disabled={busy}
                  onChange={(e) => setDay(e.target.value)}
                >
                  {program.days.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="text-xs text-zinc-400">
                Сохранённая программа не найдена. Будет использован существующий
                план LifeOS. Выбирай комфортные веса и оставляй запас сил.
              </p>
            )}
            <button
              type="button"
              className={buttonClass}
              disabled={busy}
              onClick={() =>
                void run(async () =>
                  setCurrent(
                    await webRequest<WebWorkout>("workout/start", {
                      method: "POST",
                      body: JSON.stringify(day ? { programDayId: day } : {}),
                    }),
                  ),
                )
              }
            >
              Начать тренировку
            </button>
          </div>
        )}
      </SectionPanel>
      <SectionPanel title="История тренировок">
        <div className="space-y-3">
          {history === null ? (
            <Notice>История пока недоступна. Обнови экран.</Notice>
          ) : history.length ? (
            history.map((workout) => (
              <details key={workout.id} className={rowClass}>
                <summary className="min-h-11 cursor-pointer text-sm font-semibold text-white">
                  {workout.title} ·{" "}
                  {new Intl.DateTimeFormat("ru-RU", {
                    timeZone: "Asia/Almaty",
                    dateStyle: "medium",
                  }).format(new Date(workout.endedAt))}
                </summary>
                <p className="mt-2 text-xs text-zinc-300">
                  {workout.completedSets} подходов ·{" "}
                  {Math.max(
                    0,
                    Math.round(
                      (Date.parse(workout.endedAt) -
                        Date.parse(workout.startedAt)) /
                        60000,
                    ),
                  )}{" "}
                  мин · объём {workout.volumeKg} кг
                </p>
                {workout.exercises.map((exercise) => (
                  <p
                    key={exercise.id}
                    className="mt-2 break-words text-xs text-zinc-400"
                  >
                    {exercise.name}:{" "}
                    {exercise.sets
                      .filter((set) => set.completed)
                      .map(
                        (set) =>
                          `${set.targetReps ?? "?"} × ${set.targetWeightKg === null || set.targetWeightKg === undefined ? "вес не указан" : `${set.targetWeightKg} кг`}`,
                      )
                      .join("; ") || "нет отмеченных подходов"}
                  </p>
                ))}
              </details>
            ))
          ) : (
            <p className="text-sm text-zinc-400">
              Завершённых тренировок пока нет.
            </p>
          )}
        </div>
        <p className="mt-3 text-xs text-zinc-400">
          Используется существующая история LifeOS; последние доступные сессии,
          без повторного учёта в Ideal Human.
        </p>
      </SectionPanel>
    </div>
  );
}
