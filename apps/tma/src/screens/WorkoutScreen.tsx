import {
  Check,
  CheckCircle2,
  Dumbbell,
  RotateCcw,
  Save,
  Timer,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  useWorkoutActions,
  useWorkoutProgramQuery,
  useWorkoutSessionQuery,
  workoutErrorMessage,
  type RecordedWorkoutSet,
  type WorkoutSetInput,
} from "../api/workout";
import { ErrorPanel, LoadingPanel } from "../components/AsyncState";
import { WorkoutHistory } from "../components/WorkoutHistory";
import { WorkoutProgramEditor } from "../components/WorkoutProgramEditor";
import {
  WorkoutSetFields,
  workoutButtonClass,
  workoutInputClass,
  workoutPanelClass,
} from "../components/WorkoutSetFields";
import { formatCountdown, formatDateTime } from "../lib/format";
import {
  parseSetDraft,
  restSecondsRemaining,
  type SetDraft,
} from "../lib/workout";

function RestTimer({ endsAt }: { endsAt?: string | null }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const timer = window.setInterval(update, 500);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, [endsAt]);
  const seconds = restSecondsRemaining(endsAt, now);
  return (
    <section
      className={`${workoutPanelClass} flex items-center justify-between gap-3`}
      aria-label="Таймер отдыха"
    >
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Timer className="h-4 w-4 text-cyan-300" />
          Отдых
        </h3>
        <p className="mt-1 text-xs text-zinc-400">
          {seconds > 0
            ? "Продолжается, даже когда Telegram свёрнут."
            : "Можно переходить к следующему подходу."}
        </p>
      </div>
      <div className="shrink-0 text-3xl font-semibold tabular-nums text-cyan-200">
        {formatCountdown(seconds)}
      </div>
    </section>
  );
}

function RecordedSet({
  set,
  exerciseName,
  busy,
  onSave,
  onComplete,
  onUndo,
  onDirtyChange,
}: {
  set: RecordedWorkoutSet;
  exerciseName: string;
  busy: boolean;
  onSave: (values: WorkoutSetInput) => Promise<unknown>;
  onComplete: (values: WorkoutSetInput) => Promise<unknown>;
  onUndo: () => void;
  onDirtyChange: (id: string, dirty: boolean) => void;
}) {
  const draftFromSet = (): SetDraft => ({
    reps: set.targetReps == null ? "" : String(set.targetReps),
    weightKg: set.targetWeightKg == null ? "" : String(set.targetWeightKg),
    restSeconds: String(set.restSeconds ?? 90),
  });
  const [draft, setDraft] = useState(draftFromSet);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    onDirtyChange(set.id, dirty);
    return () => onDirtyChange(set.id, false);
  }, [dirty, set.id, onDirtyChange]);
  useEffect(() => {
    setDraft(draftFromSet());
    setDirty(false);
  }, [set.targetReps, set.targetWeightKg, set.restSeconds, set.completed]);
  async function submit(action: (input: WorkoutSetInput) => Promise<unknown>) {
    let values: WorkoutSetInput;
    try {
      values = parseSetDraft(draft);
      setError(null);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Проверь значения подхода.",
      );
      return;
    }
    try {
      await action(values);
      setDirty(false);
    } catch (failure) {
      setError(workoutErrorMessage(failure));
    }
  }
  return (
    <div className="space-y-3 border-t border-white/10 py-4 first:border-t-0">
      <div className="flex items-center justify-between gap-2 text-sm font-medium">
        <span>Подход {set.index}</span>
        <span className={set.completed ? "text-emerald-200" : "text-zinc-400"}>
          {dirty ? "Есть изменения" : set.completed ? "Выполнен" : "Ожидает"}
        </span>
      </div>
      <WorkoutSetFields
        value={draft}
        disabled={busy}
        labelPrefix={`${exerciseName}, подход ${set.index}`}
        onChange={(value) => {
          setDraft(value);
          setDirty(true);
        }}
      />
      {error ? (
        <p role="alert" className="text-sm text-rose-200">
          {error}
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          className={workoutButtonClass}
          disabled={busy}
          onClick={() => void submit(onSave)}
        >
          <Save className="h-4 w-4" />
          Записать
        </button>
        <button
          type="button"
          className={`${workoutButtonClass} ${set.completed ? "border-emerald-300/30 text-emerald-200" : "bg-cyan-300 text-graphite-950"}`}
          disabled={busy}
          onClick={set.completed ? onUndo : () => void submit(onComplete)}
        >
          {set.completed ? (
            <RotateCcw className="h-4 w-4" />
          ) : (
            <Check className="h-4 w-4" />
          )}
          {set.completed ? "Отменить" : "Готово"}
        </button>
      </div>
    </div>
  );
}

export function WorkoutScreen() {
  const [tab, setTab] = useState<"session" | "program" | "history">("session");
  const [dayId, setDayId] = useState("");
  const [finishConfirm, setFinishConfirm] = useState(false);
  const [unsavedSets, setUnsavedSets] = useState<string[]>([]);
  const onDirtyChange = useCallback((id: string, dirty: boolean) => {
    setUnsavedSets((ids) =>
      dirty
        ? ids.includes(id)
          ? ids
          : [...ids, id]
        : ids.includes(id)
          ? ids.filter((item) => item !== id)
          : ids,
    );
  }, []);
  const query = useWorkoutSessionQuery();
  const program = useWorkoutProgramQuery();
  const actions = useWorkoutActions();
  const workout = query.data;
  const selectedDayId = program.data?.days.some((day) => day.id === dayId)
    ? dayId
    : program.data?.days[0]?.id;
  const busy = actions.set.isPending || actions.finish.isPending;

  return (
    <div className="space-y-4">
      <div
        className="grid grid-cols-3 gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1"
        aria-label="Разделы тренировок"
      >
        {(
          [
            ["session", "Тренировка"],
            ["program", "Программа"],
            ["history", "История"],
          ] as const
        ).map(([id, title]) => (
          <button
            type="button"
            key={id}
            aria-pressed={tab === id}
            className={`${workoutButtonClass} min-w-0 border-0 px-1 text-xs ${tab === id ? "bg-cyan-300/10 text-cyan-200" : "text-zinc-400"}`}
            onClick={() => setTab(id)}
          >
            {title}
          </button>
        ))}
      </div>

      {tab === "history" ? (
        <WorkoutHistory />
      ) : tab === "program" ? (
        program.isLoading ? (
          <LoadingPanel title="Загружаем программу" />
        ) : program.isError ? (
          <ErrorPanel
            title="Программа недоступна"
            detail={workoutErrorMessage(program.error)}
            onRetry={() => void program.refetch()}
          />
        ) : (
          <WorkoutProgramEditor
            program={program.data ?? null}
            hasActiveWorkout={Boolean(workout)}
          />
        )
      ) : query.isLoading ? (
        <LoadingPanel title="Загружаем тренировку" />
      ) : query.isError ? (
        <ErrorPanel
          title="Тренировка недоступна"
          detail={workoutErrorMessage(query.error)}
          onRetry={() => void query.refetch()}
        />
      ) : !workout ? (
        <section className={`${workoutPanelClass} space-y-4`}>
          <div>
            <Dumbbell className="mb-3 h-6 w-6 text-cyan-300" />
            <h2 className="text-xl font-semibold">Начать тренировку</h2>
            <p className="mt-2 text-sm text-zinc-400">
              Выбери день своей программы. Фактические повторы, вес и отдых
              можно менять во время тренировки.
            </p>
          </div>
          {program.isLoading ? (
            <LoadingPanel title="Загружаем программу" />
          ) : program.isError ? (
            <ErrorPanel
              title="Не удалось загрузить программу"
              detail={workoutErrorMessage(program.error)}
              onRetry={() => void program.refetch()}
            />
          ) : program.data ? (
            <>
              <label className="block space-y-2 text-sm text-zinc-300">
                <span>{program.data.title}</span>
                <select
                  className={workoutInputClass}
                  value={selectedDayId ?? ""}
                  onChange={(event) => setDayId(event.target.value)}
                >
                  {program.data.days.map((day) => (
                    <option key={day.id} value={day.id}>
                      {day.title}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className={`${workoutButtonClass} w-full bg-cyan-300 text-graphite-950`}
                disabled={actions.start.isPending || !selectedDayId}
                onClick={() => actions.start.mutate(selectedDayId)}
              >
                {actions.start.isPending
                  ? "Начинаем…"
                  : "Начать выбранный день"}
              </button>
            </>
          ) : (
            <button
              type="button"
              className={`${workoutButtonClass} w-full bg-cyan-300 text-graphite-950`}
              onClick={() => setTab("program")}
            >
              Создать свою программу
            </button>
          )}
          <button
            type="button"
            className={`${workoutButtonClass} w-full`}
            disabled={actions.start.isPending}
            onClick={() => actions.start.mutate(undefined)}
          >
            Начать стандартный план LifeOS
          </button>
          {actions.start.isError ? (
            <p role="alert" className="text-sm text-rose-200">
              {workoutErrorMessage(actions.start.error)}
            </p>
          ) : null}
          {actions.finish.isSuccess ? (
            <p role="status" className="text-sm text-emerald-200">
              Тренировка сохранена в истории.
            </p>
          ) : null}
        </section>
      ) : (
        <>
          <section className={workoutPanelClass}>
            <p className="text-xs text-zinc-400">
              {formatDateTime(workout.startedAt)}
            </p>
            <h2 className="mt-2 break-words text-2xl font-semibold">
              {workout.title}
            </h2>
            <p className="mt-3 text-sm text-cyan-200">
              {workout.completedSets} / {workout.totalSets} подходов выполнено
            </p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full bg-cyan-300"
                style={{ width: `${workout.progressPercent}%` }}
              />
            </div>
            <p className="mt-3 text-xs text-zinc-400">
              Впиши фактические значения. «Готово» сохранит их и отметит подход
              выполненным.
            </p>
          </section>
          <RestTimer endsAt={workout.restTimerEndsAt} />
          {actions.set.isError ? (
            <p
              role="alert"
              className={`${workoutPanelClass} text-sm text-rose-200`}
            >
              {workoutErrorMessage(actions.set.error)}
            </p>
          ) : null}
          {workout.exercises.map((exercise) => (
            <section className={workoutPanelClass} key={exercise.id}>
              <h3 className="mb-1 break-words text-lg font-semibold">
                {exercise.name}
              </h3>
              {exercise.sets.map((set) => (
                <RecordedSet
                  key={set.id}
                  set={set}
                  exerciseName={exercise.name}
                  busy={busy}
                  onDirtyChange={onDirtyChange}
                  onSave={(values) =>
                    actions.set.mutateAsync({
                      setId: set.id,
                      action: "save",
                      values,
                    })
                  }
                  onComplete={(values) =>
                    actions.set.mutateAsync({
                      setId: set.id,
                      action: "complete",
                      values,
                    })
                  }
                  onUndo={() =>
                    actions.set.mutate({ setId: set.id, action: "undo" })
                  }
                />
              ))}
            </section>
          ))}
          {actions.finish.isError ? (
            <p role="alert" className="text-sm text-rose-200">
              {workoutErrorMessage(actions.finish.error)}
            </p>
          ) : null}
          {unsavedSets.length > 0 ? (
            <p role="status" className="text-sm text-amber-200">
              Перед завершением сохрани изменённые подходы кнопкой «Записать»
              или «Готово».
            </p>
          ) : null}
          {finishConfirm ? (
            <section className={`${workoutPanelClass} space-y-3`}>
              <p className="text-sm text-zinc-300">
                Осталось невыполненных подходов:{" "}
                {workout.totalSets - workout.completedSets}. Завершить
                тренировку с текущими результатами?
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className={workoutButtonClass}
                  disabled={busy}
                  onClick={() => setFinishConfirm(false)}
                >
                  Продолжить
                </button>
                <button
                  type="button"
                  className={`${workoutButtonClass} border-emerald-300/30 text-emerald-200`}
                  disabled={busy || unsavedSets.length > 0}
                  onClick={() => {
                    actions.finish.mutate(workout.id);
                    setFinishConfirm(false);
                  }}
                >
                  Завершить
                </button>
              </div>
            </section>
          ) : (
            <button
              type="button"
              className={`${workoutButtonClass} min-h-14 w-full bg-emerald-300 text-graphite-950`}
              disabled={busy || unsavedSets.length > 0}
              onClick={() =>
                workout.completedSets < workout.totalSets
                  ? setFinishConfirm(true)
                  : actions.finish.mutate(workout.id)
              }
            >
              <CheckCircle2 className="h-5 w-5" />
              {actions.finish.isPending ? "Сохраняем…" : "Завершить тренировку"}
            </button>
          )}
        </>
      )}
    </div>
  );
}
