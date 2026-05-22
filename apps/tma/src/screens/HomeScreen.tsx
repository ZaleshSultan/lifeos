import { Activity, Dumbbell, HeartPulse, RefreshCw } from "lucide-react";
import { useHomeQuery } from "../api/hooks";
import { recoveryModeLabels } from "../api/types";
import { ErrorPanel, LoadingPanel } from "../components/AsyncState";
import { MetricTile } from "../components/MetricTile";
import { ProgressRing } from "../components/ProgressRing";
import { formatDateTime } from "../lib/format";

interface HomeScreenProps {
  onOpenWorkout: () => void;
}

export function HomeScreen({ onOpenWorkout }: HomeScreenProps) {
  const query = useHomeQuery();

  if (query.isLoading) {
    return <LoadingPanel title="Loading home" />;
  }

  if (query.isError) {
    return (
      <ErrorPanel
        detail={query.error.message}
        onRetry={() => void query.refetch()}
        title="Home unavailable"
      />
    );
  }

  if (!query.data) {
    return (
      <ErrorPanel
        onRetry={() => void query.refetch()}
        title="Home returned no data"
      />
    );
  }

  const home = query.data;

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 shadow-panel">
        <div className="flex items-center gap-4">
          <ProgressRing label="focus" value={home.focusScore ?? 0} />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-zinc-500">{home.localDate}</p>
            <h2 className="mt-1 truncate text-[26px] font-semibold leading-tight tracking-tight text-white">
              {home.displayName ? `Hi, ${home.displayName}` : "LifeOS ready"}
            </h2>
            <div className="mt-3 inline-flex rounded-full border border-cyan-400/20 bg-cyan-400/[0.08] px-2.5 py-1 text-xs font-medium text-cyan-300">
              {home.modeLabel}
            </div>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-3 gap-2">
        <MetricTile
          label="Health"
          tone="mint"
          value={
            home.healthCompletenessScore === null ||
            home.healthCompletenessScore === undefined
              ? "n/a"
              : `${Math.round(home.healthCompletenessScore)}%`
          }
        />
        <MetricTile label="Focus" value={home.focusScore ?? "n/a"} />
        <MetricTile
          label="Sync"
          tone={home.pendingSyncCount ? "amber" : "mint"}
          value={home.pendingSyncCount ?? 0}
        />
      </section>

      {home.activeWorkout ? (
        <section className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 shadow-panel">
          <div className="flex items-start gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300">
              <Dumbbell className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-lg font-semibold tracking-tight text-white">
                {home.activeWorkout.title}
              </div>
              <p className="mt-1 text-sm text-zinc-500">
                {formatDateTime(home.activeWorkout.startedAt)}
              </p>
            </div>
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="h-full rounded-full bg-emerald-400"
              style={{ width: `${home.activeWorkout.progressPercent}%` }}
            />
          </div>
          <button
            className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-emerald-300 px-4 text-sm font-semibold text-graphite-950 active:scale-[0.99]"
            onClick={onOpenWorkout}
            type="button"
          >
            <Dumbbell className="h-4 w-4" />
            Open Workout
          </button>
        </section>
      ) : (
        <section className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 shadow-panel">
          <div className="flex items-center gap-3 text-zinc-400">
            <Activity className="h-5 w-5 text-cyan-400" />
            <span className="text-sm">No active workout</span>
          </div>
        </section>
      )}

      <button
        className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] text-sm font-semibold text-zinc-200 active:scale-[0.99]"
        onClick={() => void query.refetch()}
        type="button"
      >
        <RefreshCw className="h-4 w-4" />
        Refresh
      </button>

      <section className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3 shadow-panel">
          <HeartPulse className="h-5 w-5 text-emerald-400" />
          <div className="mt-2 text-sm text-zinc-500">Health mode</div>
          <div className="text-base font-semibold">
            {recoveryModeLabels[home.recoveryMode]}
          </div>
        </div>
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3 shadow-panel">
          <Activity className="h-5 w-5 text-cyan-400" />
          <div className="mt-2 text-sm text-zinc-500">Focus score</div>
          <div className="text-base font-semibold">
            {home.focusScore ?? "n/a"}
          </div>
        </div>
      </section>
    </div>
  );
}
