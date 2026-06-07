import {
  Activity,
  Footprints,
  HeartPulse,
  Moon,
  Watch,
  Zap,
} from "lucide-react";
import { useHealthQuery } from "../api/hooks";
import { ErrorPanel, LoadingPanel } from "../components/AsyncState";
import { MetricTile } from "../components/MetricTile";
import { ProgressRing } from "../components/ProgressRing";
import { formatMinutes } from "../lib/format";

export function HealthScreen() {
  const query = useHealthQuery();

  if (query.isLoading) {
    return <LoadingPanel title="Loading health" />;
  }

  if (query.isError) {
    return (
      <ErrorPanel
        detail={query.error.message}
        onRetry={() => void query.refetch()}
        title="Health unavailable"
      />
    );
  }

  if (!query.data) {
    return (
      <ErrorPanel
        onRetry={() => void query.refetch()}
        title="Health returned no data"
      />
    );
  }

  const health = query.data;
  const missing = Object.entries(health.missingMetrics ?? {})
    .filter(([, isMissing]) => isMissing)
    .map(([name]) => name.replaceAll("_", " "));
  const trends = health.trends ?? [];

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 shadow-panel">
        <div className="flex items-center gap-4">
          <ProgressRing
            label="data"
            tone="mint"
            value={health.dataCompletenessScore}
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-zinc-500">{health.date}</p>
            <h2 className="mt-1 text-[26px] font-semibold leading-tight tracking-tight text-white">
              Health
            </h2>
            <p className="mt-2 text-sm text-zinc-500">
              {health.hasMetrics
                ? (health.sourceLabel ?? "Health metrics")
                : "No Xiaomi Watch data yet. Connect Mi Fitness -> Health Connect or use /health_log."}
            </p>
          </div>
        </div>
      </section>

      {!health.hasMetrics ? (
        <section className="rounded-xl border border-amber-400/20 bg-amber-400/[0.08] p-4 text-sm text-amber-100 shadow-panel">
          No Xiaomi Watch data yet. Connect Mi Fitness -&gt; Health Connect or
          use /health_log.
        </section>
      ) : null}

      <section className="grid grid-cols-2 gap-2">
        <MetricTile
          label="Sleep"
          tone="cyan"
          value={formatMinutes(health.sleepMinutes)}
        />
        <MetricTile
          label="Resting HR"
          tone="mint"
          value={
            health.restingHeartRate ? `${health.restingHeartRate} bpm` : "n/a"
          }
        />
        <MetricTile
          label="Active kcal"
          tone="rose"
          value={
            health.activeEnergyKcal ? `${health.activeEnergyKcal} kcal` : "n/a"
          }
        />
        <MetricTile
          label="Steps"
          tone="amber"
          value={health.steps ? health.steps.toLocaleString() : "n/a"}
        />
      </section>

      <section className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 shadow-panel">
          <Moon className="h-5 w-5 text-cyan-400" />
          <div className="mt-3 text-sm text-zinc-500">Sleep</div>
          <div className="mt-1 text-xl font-semibold">
            {formatMinutes(health.sleepMinutes)}
          </div>
        </div>
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 shadow-panel">
          <HeartPulse className="h-5 w-5 text-rose-400" />
          <div className="mt-3 text-sm text-zinc-500">Resting HR</div>
          <div className="mt-1 text-xl font-semibold">
            {health.restingHeartRate ?? "n/a"}
          </div>
        </div>
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 shadow-panel">
          <Footprints className="h-5 w-5 text-amber-400" />
          <div className="mt-3 text-sm text-zinc-500">Steps</div>
          <div className="mt-1 text-xl font-semibold">
            {health.steps?.toLocaleString() ?? "n/a"}
          </div>
        </div>
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 shadow-panel">
          <Zap className="h-5 w-5 text-emerald-400" />
          <div className="mt-3 text-sm text-zinc-500">Workout</div>
          <div className="mt-1 text-xl font-semibold">
            {formatMinutes(health.workoutMinutes)}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 shadow-panel">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
          <Activity className="h-5 w-5 text-emerald-400" />
          7-day trends
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-lg bg-white/[0.04] p-3">
            <div className="text-zinc-500">Avg steps</div>
            <div className="mt-1 font-semibold text-white">
              {health.weekly?.avgSteps?.toLocaleString() ?? "n/a"}
            </div>
          </div>
          <div className="rounded-lg bg-white/[0.04] p-3">
            <div className="text-zinc-500">Avg sleep</div>
            <div className="mt-1 font-semibold text-white">
              {formatMinutes(health.weekly?.avgSleepMinutes)}
            </div>
          </div>
          <div className="rounded-lg bg-white/[0.04] p-3">
            <div className="text-zinc-500">Avg RHR</div>
            <div className="mt-1 font-semibold text-white">
              {health.weekly?.avgRestingHeartRate
                ? `${health.weekly.avgRestingHeartRate} bpm`
                : "n/a"}
            </div>
          </div>
          <div className="rounded-lg bg-white/[0.04] p-3">
            <div className="text-zinc-500">Workout total</div>
            <div className="mt-1 font-semibold text-white">
              {formatMinutes(health.weekly?.totalWorkoutMinutes)}
            </div>
          </div>
        </div>
        {trends.length ? (
          <div className="mt-3 space-y-1">
            {trends.map((day) => (
              <div
                className="grid grid-cols-[1fr_auto] rounded-lg bg-white/[0.02] px-3 py-2 text-xs"
                key={day.date}
              >
                <span className="text-zinc-500">{day.date}</span>
                <span className="text-zinc-300">
                  {day.steps?.toLocaleString() ?? "n/a"} steps -{" "}
                  {formatMinutes(day.sleepMinutes)}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 shadow-panel">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
          <Watch className="h-5 w-5 text-cyan-400" />
          Sources
        </div>
        <div className="space-y-2">
          {(health.sources ?? []).map((source) => (
            <div
              className="flex items-center justify-between gap-3 rounded-lg bg-white/[0.03] px-3 py-2 text-sm"
              key={source.source}
            >
              <span className="text-zinc-200">{source.label}</span>
              <span className="text-xs text-zinc-500">
                {source.latestMetricAt
                  ? source.latestMetricAt.slice(0, 10)
                  : "never"}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-3 text-xs text-zinc-500">
          Missing: {missing.length ? missing.join(", ") : "none"}
        </div>
      </section>
    </div>
  );
}
