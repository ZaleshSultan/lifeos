import { Footprints, HeartPulse, Moon, Zap } from "lucide-react";
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
              {health.lifeModeLabel}
            </h2>
            <p className="mt-2 text-sm text-zinc-500">
              {health.recommendation}
            </p>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-2">
        <MetricTile
          label="Sleep"
          tone="cyan"
          value={formatMinutes(health.sleepMinutes)}
        />
        <MetricTile
          label="HRV"
          tone="mint"
          value={health.hrvMs ? `${health.hrvMs} ms` : "n/a"}
        />
        <MetricTile
          label="RHR"
          tone="rose"
          value={health.restingHeartRate ? `${health.restingHeartRate}` : "n/a"}
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
          <div className="mt-3 text-sm text-zinc-500">Energy</div>
          <div className="mt-1 text-xl font-semibold">
            {health.activeEnergyKcal
              ? `${health.activeEnergyKcal} kcal`
              : "n/a"}
          </div>
        </div>
      </section>
    </div>
  );
}
