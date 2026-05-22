import { AlertCircle, CheckCircle2, Target } from "lucide-react";
import { useFocusQuery } from "../api/hooks";
import { ErrorPanel, LoadingPanel } from "../components/AsyncState";
import { MetricTile } from "../components/MetricTile";
import { ProgressRing } from "../components/ProgressRing";

export function FocusScreen() {
  const query = useFocusQuery();

  if (query.isLoading) {
    return <LoadingPanel title="Loading focus" />;
  }

  if (query.isError) {
    return (
      <ErrorPanel
        detail={query.error.message}
        onRetry={() => void query.refetch()}
        title="Focus unavailable"
      />
    );
  }

  if (!query.data) {
    return (
      <ErrorPanel
        onRetry={() => void query.refetch()}
        title="Focus returned no data"
      />
    );
  }

  const focus = query.data;
  const calm = focus.band === "high";

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 shadow-panel">
        <div className="flex items-center gap-4">
          <ProgressRing
            label="score"
            tone={calm ? "mint" : "amber"}
            value={focus.score}
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-zinc-500">{focus.lifeModeLabel}</p>
            <h2 className="mt-1 text-[26px] font-semibold capitalize leading-tight tracking-tight text-white">
              {focus.band}
            </h2>
            {focus.nextBestAction ? (
              <p className="mt-2 break-words text-sm text-zinc-300">
                {focus.nextBestAction}
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-2">
        <MetricTile label="Score" value={focus.score} />
        <MetricTile
          label="Open"
          tone="amber"
          value={focus.openTaskCount ?? "n/a"}
        />
      </section>

      <section className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 shadow-panel">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          {calm ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-400" />
          ) : (
            <AlertCircle className="h-5 w-5 text-amber-400" />
          )}
          Signals
        </div>
        {focus.reasons.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {focus.reasons.map((reason) => (
              <span
                className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-sm text-zinc-300"
                key={reason}
              >
                {reason}
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-zinc-500">
            No drag signals returned.
          </p>
        )}
      </section>

      <section className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 shadow-panel">
        <Target className="h-5 w-5 text-cyan-400" />
        <div className="mt-3 text-sm text-zinc-500">Mode</div>
        <div className="mt-1 text-xl font-semibold">{focus.lifeModeLabel}</div>
      </section>

      {focus.topItems?.length ? (
        <section className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 shadow-panel">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Target className="h-5 w-5 text-cyan-400" />
            Queue
          </div>
          <div className="mt-3 space-y-2">
            {focus.topItems.map((item) => (
              <div
                className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-lg bg-white/[0.03] px-3 py-2"
                key={item.id}
              >
                <div className="min-w-0 truncate text-sm text-zinc-200">
                  {item.title}
                </div>
                <div className="text-xs font-semibold tabular-nums text-cyan-300">
                  {item.modeScore}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
