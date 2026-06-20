import {
  Check,
  CheckCircle2,
  Clock3,
  Dumbbell,
  Pause,
  Play,
  RotateCcw,
  TimerReset,
  Trophy,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  useCompleteSetMutation,
  useCompleteWorkoutMutation,
  useStartWorkoutMutation,
  useUndoSetMutation,
  useWorkoutQuery,
} from "../api/hooks";
import type { WorkoutExercise, WorkoutSet } from "../api/types";
import { ErrorPanel, LoadingPanel } from "../components/AsyncState";
import { ProgressRing } from "../components/ProgressRing";
import { formatCountdown, formatDateTime } from "../lib/format";
import { cx } from "../lib/styles";

function secondsUntil(endsAt: string): number {
  return Math.max(
    0,
    Math.ceil((new Date(endsAt).getTime() - Date.now()) / 1000),
  );
}

function useRestTimer(endsAt?: string | null, stopped = false) {
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!endsAt || stopped) {
      setRemainingSeconds(null);
      setRunning(false);
      return;
    }

    const nextRemaining = secondsUntil(endsAt);
    setRemainingSeconds(nextRemaining);
    setRunning(nextRemaining > 0);
  }, [endsAt, stopped]);

  useEffect(() => {
    if (!running || remainingSeconds === null || remainingSeconds <= 0) {
      return;
    }

    const timer = window.setInterval(() => {
      setRemainingSeconds((current) => {
        if (current === null || current <= 1) {
          setRunning(false);
          return 0;
        }

        return current - 1;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [remainingSeconds, running]);

  return {
    remainingSeconds,
    running,
    pause() {
      setRunning(false);
    },
    reset() {
      if (!endsAt || stopped) {
        setRemainingSeconds(null);
        setRunning(false);
        return;
      }

      const nextRemaining = secondsUntil(endsAt);
      setRemainingSeconds(nextRemaining);
      setRunning(nextRemaining > 0);
    },
    resume() {
      if ((remainingSeconds ?? 0) > 0) {
        setRunning(true);
      }
    },
  };
}

function TimerButton({
  children,
  disabled,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 text-xs font-semibold text-zinc-200 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function targetText(set: WorkoutSet): string {
  return [
    set.targetReps ? `${set.targetReps} reps` : null,
    set.targetWeightKg ? `${set.targetWeightKg} kg` : null,
  ]
    .filter(Boolean)
    .join(" / ");
}

function SetButton({
  set,
  onComplete,
  onUndo,
  busy,
}: {
  set: WorkoutSet;
  onComplete: () => void;
  onUndo: () => void;
  busy: boolean;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-3 border-t border-white/[0.06] py-3 first:border-t-0">
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          <span
            className={cx(
              "grid h-10 w-10 shrink-0 place-items-center rounded-lg border text-sm font-semibold tabular-nums",
              set.completed
                ? "border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300"
                : "border-white/[0.08] bg-white/[0.04] text-zinc-300",
            )}
          >
            {set.index}
          </span>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white">
              Set {set.index}
            </div>
            <div className="mt-0.5 truncate text-xs text-zinc-500">
              {targetText(set) || "Open target"}
            </div>
          </div>
        </div>
      </div>
      <button
        className={cx(
          "inline-flex min-h-12 min-w-24 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-60",
          set.completed
            ? "border border-emerald-400/25 bg-emerald-400/[0.08] text-emerald-300"
            : "bg-cyan-300 text-graphite-950 shadow-[0_10px_30px_rgba(34,211,238,0.18)]",
        )}
        disabled={busy}
        onClick={set.completed ? onUndo : onComplete}
        type="button"
      >
        {set.completed ? (
          <>
            <RotateCcw className="h-4 w-4" />
            Undo
          </>
        ) : (
          <>
            <Check className="h-4 w-4" />
            Done
          </>
        )}
      </button>
    </div>
  );
}

function ExerciseCard({
  exercise,
  pendingSetId,
  onComplete,
  onUndo,
}: {
  exercise: WorkoutExercise;
  pendingSetId: string | null;
  onComplete: (setId: string) => void;
  onUndo: (setId: string) => void;
}) {
  const completed = exercise.sets.filter((set) => set.completed).length;
  const total = exercise.sets.length;
  const percent = total ? Math.round((completed / total) * 100) : 0;

  return (
    <section className="rounded-xl border border-white/[0.08] bg-white/[0.03] shadow-panel">
      <div className="border-b border-white/[0.06] px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="break-words text-base font-semibold text-white">
              {exercise.name}
            </h3>
            {exercise.note ? (
              <p className="mt-1 text-sm text-zinc-500">{exercise.note}</p>
            ) : null}
          </div>
          <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-xs font-medium text-zinc-400">
            {completed}/{total}
          </span>
        </div>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className="h-full rounded-full bg-emerald-400 transition-all"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
      <div className="px-4">
        {exercise.sets.map((set) => (
          <SetButton
            busy={pendingSetId === set.id}
            key={set.id}
            onComplete={() => onComplete(set.id)}
            onUndo={() => onUndo(set.id)}
            set={set}
          />
        ))}
      </div>
    </section>
  );
}

export function WorkoutScreen() {
  const query = useWorkoutQuery();
  const completeSet = useCompleteSetMutation();
  const undoSet = useUndoSetMutation();
  const completeWorkout = useCompleteWorkoutMutation();
  const startWorkout = useStartWorkoutMutation();
  const workout = query.data;
  const completed = workout?.mode === "completed";
  const restTimer = useRestTimer(workout?.restTimerEndsAt, completed);
  const pendingSetId = useMemo(() => {
    return completeSet.variables ?? undoSet.variables ?? null;
  }, [completeSet.variables, undoSet.variables]);

  if (query.isLoading) {
    return <LoadingPanel title="Loading workout" />;
  }

  if (query.isError) {
    return (
      <ErrorPanel
        detail={query.error.message}
        onRetry={() => void query.refetch()}
        title="Workout unavailable"
      />
    );
  }

  if (!workout) {
    return (
      <section className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 text-sm text-zinc-400 shadow-panel">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-cyan-400/20 bg-cyan-400/[0.08] text-cyan-300">
            <Dumbbell className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-white">
              No active workout
            </h2>
            <p className="mt-1 leading-relaxed">
              Start a session here or send /workout in Telegram when you are
              ready to train.
            </p>
          </div>
        </div>
        <button
          className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-cyan-300 px-4 text-sm font-semibold text-graphite-950 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-60"
          disabled={startWorkout.isPending}
          onClick={() => startWorkout.mutate()}
          type="button"
        >
          <Dumbbell className="h-4 w-4" />
          Start workout
        </button>
        {startWorkout.isError ? (
          <p className="mt-3 text-sm text-rose-300">
            {startWorkout.error.message}
          </p>
        ) : null}
      </section>
    );
  }

  const restSeconds = restTimer.remainingSeconds;
  const restActive = restSeconds !== null && restSeconds > 0;

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 shadow-panel">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-zinc-500">
              <Dumbbell className="h-4 w-4 text-cyan-400" />
              {formatDateTime(workout.startedAt)}
            </div>
            <h2 className="mt-3 break-words text-[26px] font-semibold leading-tight tracking-tight text-white">
              {workout.title}
            </h2>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-xs font-medium capitalize text-zinc-300">
                {workout.mode}
              </span>
              <span className="rounded-full border border-cyan-400/20 bg-cyan-400/[0.08] px-2.5 py-1 text-xs font-medium text-cyan-300">
                {workout.completedSets}/{workout.totalSets} sets
              </span>
            </div>
          </div>
          <ProgressRing
            label="done"
            tone={completed ? "mint" : "cyan"}
            value={workout.progressPercent}
          />
        </div>
        <div className="mt-5 h-2.5 overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className="h-full rounded-full bg-cyan-300 transition-all"
            style={{ width: `${workout.progressPercent}%` }}
          />
        </div>
      </section>

      <section
        className={cx(
          "grid grid-cols-[1fr_auto] items-center gap-3 rounded-xl border p-4 shadow-panel",
          restActive
            ? "border-amber-400/20 bg-amber-400/[0.08]"
            : "border-emerald-400/20 bg-emerald-400/[0.08]",
        )}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            {restActive ? (
              <Clock3 className="h-4 w-4 text-amber-300" />
            ) : (
              <TimerReset className="h-4 w-4 text-emerald-300" />
            )}
            Rest timer
          </div>
          <p className="mt-1 text-sm text-zinc-500">
            {restActive
              ? "Breathe, reset, next set soon."
              : "Ready for the next set."}
          </p>
        </div>
        <div className="text-right">
          <div
            className={cx(
              "rounded-lg px-3 py-2 text-2xl font-semibold tabular-nums",
              restActive ? "text-amber-200" : "text-emerald-200",
            )}
          >
            {restSeconds === null ? "0:00" : formatCountdown(restSeconds)}
          </div>
          <div className="mt-2 flex justify-end gap-2">
            {restTimer.running ? (
              <TimerButton onClick={restTimer.pause} disabled={!restActive}>
                <Pause className="h-3.5 w-3.5" />
                Pause
              </TimerButton>
            ) : (
              <TimerButton onClick={restTimer.resume} disabled={!restActive}>
                <Play className="h-3.5 w-3.5" />
                Resume
              </TimerButton>
            )}
            <TimerButton
              disabled={restSeconds === null}
              onClick={restTimer.reset}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </TimerButton>
          </div>
        </div>
      </section>

      {workout.exercises.length === 0 ? (
        <section className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 text-sm text-zinc-400 shadow-panel">
          <div className="flex items-center gap-3">
            <Dumbbell className="h-5 w-5 text-cyan-400" />
            <span>No exercises returned for this workout.</span>
          </div>
          <button
            className="mt-4 inline-flex min-h-12 w-full items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] px-4 text-sm font-semibold text-white active:scale-[0.99]"
            onClick={() => void query.refetch()}
            type="button"
          >
            Refresh Workout
          </button>
        </section>
      ) : (
        workout.exercises.map((exercise) => (
          <ExerciseCard
            exercise={exercise}
            key={exercise.id}
            onComplete={(setId) => completeSet.mutate(setId)}
            onUndo={(setId) => undoSet.mutate(setId)}
            pendingSetId={pendingSetId}
          />
        ))
      )}

      {completeWorkout.isError ? (
        <ErrorPanel
          detail={completeWorkout.error.message}
          title="Workout completion failed"
        />
      ) : null}

      <button
        className={cx(
          "inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition active:scale-[0.99] disabled:pointer-events-none disabled:opacity-60",
          completed
            ? "border border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300"
            : "bg-emerald-300 text-graphite-950 shadow-[0_12px_40px_rgba(74,222,128,0.18)]",
        )}
        disabled={completeWorkout.isPending || completed}
        onClick={() => completeWorkout.mutate(workout.id)}
        type="button"
      >
        {completed ? (
          <>
            <Trophy className="h-5 w-5" />
            Workout Complete
          </>
        ) : (
          <>
            <CheckCircle2 className="h-5 w-5" />
            Complete Workout
          </>
        )}
      </button>
    </div>
  );
}
