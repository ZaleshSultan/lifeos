import {
  Activity,
  CalendarClock,
  Dumbbell,
  GraduationCap,
  HeartPulse,
  NotebookText,
  PlugZap,
  RefreshCw,
} from "lucide-react";
import {
  useAcademicQuery,
  useGenerateMonthlyReviewMutation,
  useHomeQuery,
  useMonthlyReviewQuery,
  useStartGoogleOAuthMutation,
} from "../api/hooks";
import { recoveryModeLabels, type TmaSessionStatus } from "../api/types";
import { ErrorPanel, LoadingPanel } from "../components/AsyncState";
import { IntegrationStatusCard } from "../components/IntegrationStatusCard";
import { MetricTile } from "../components/MetricTile";
import { ProgressRing } from "../components/ProgressRing";
import { formatDateTime } from "../lib/format";
import { integrationCardsForSession } from "../lib/session-status";

interface HomeScreenProps {
  onOpenWorkout: () => void;
  session: TmaSessionStatus;
}

export function HomeScreen({ onOpenWorkout, session }: HomeScreenProps) {
  const query = useHomeQuery();
  const academicQuery = useAcademicQuery();
  const monthlyReviewQuery = useMonthlyReviewQuery();
  const generateMonthlyReview = useGenerateMonthlyReviewMutation();
  const startGoogleOAuth = useStartGoogleOAuthMutation();

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
  const academic = academicQuery.data;
  const nextAcademicEvent = academic?.nextAcademicEvent;
  const activeCourse = academic?.activeCourse;
  const latestReview = monthlyReviewQuery.data?.latest;
  const reviewStats = latestReview?.statsJson;
  const financeStats =
    typeof reviewStats?.finance === "object" && reviewStats.finance !== null
      ? (reviewStats.finance as Record<string, unknown>)
      : {};
  const healthStats =
    typeof reviewStats?.health === "object" && reviewStats.health !== null
      ? (reviewStats.health as Record<string, unknown>)
      : {};
  const integrationCards = integrationCardsForSession(session);

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

      <section className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          <PlugZap className="h-5 w-5 text-cyan-400" />
          Integrations
        </div>
        {integrationCards.map((card) => (
          <IntegrationStatusCard
            actionBusy={
              card.action === "connect_google" && startGoogleOAuth.isPending
            }
            actionLabel={
              card.action === "connect_google" ? "Connect Google" : undefined
            }
            description={card.description}
            key={card.title}
            onAction={
              card.action === "connect_google"
                ? () => startGoogleOAuth.mutate()
                : undefined
            }
            status={card.status}
            title={card.title}
          />
        ))}
      </section>

      <section className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 shadow-panel">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
          <NotebookText className="h-5 w-5 text-amber-300" />
          Monthly Review
        </div>
        {monthlyReviewQuery.isLoading ? (
          <p className="text-sm text-zinc-500">Loading monthly review.</p>
        ) : monthlyReviewQuery.isError ? (
          <p className="text-sm text-rose-300">
            Monthly review unavailable: {monthlyReviewQuery.error.message}
          </p>
        ) : latestReview ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2">
                <div className="text-xs text-zinc-500">Month</div>
                <div className="mt-1 text-sm font-semibold text-white">
                  {latestReview.periodMonth}
                </div>
              </div>
              <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2">
                <div className="text-xs text-zinc-500">Status</div>
                <div className="mt-1 text-sm font-semibold text-white">
                  {latestReview.status}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/[0.08] px-3 py-2">
                <div className="text-xs text-emerald-300">Net</div>
                <div className="mt-1 text-sm font-semibold text-white">
                  {typeof financeStats.netCashflow === "number"
                    ? `${financeStats.netCashflow.toLocaleString("ru-RU")} KZT`
                    : "n/a"}
                </div>
              </div>
              <div className="rounded-lg border border-cyan-400/20 bg-cyan-400/[0.08] px-3 py-2">
                <div className="text-xs text-cyan-300">Avg steps</div>
                <div className="mt-1 text-sm font-semibold text-white">
                  {typeof healthStats.avgSteps === "number"
                    ? Math.round(healthStats.avgSteps)
                    : "n/a"}
                </div>
              </div>
            </div>
            <p className="break-words text-xs text-zinc-500">
              {latestReview.obsidianPath ?? "Obsidian path pending"}
            </p>
            {latestReview.generatedAt ? (
              <p className="text-xs text-zinc-600">
                {formatDateTime(latestReview.generatedAt)}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-zinc-500">No monthly review generated.</p>
        )}
        <button
          className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-amber-300/30 bg-amber-300/10 px-4 text-sm font-semibold text-amber-100 disabled:opacity-60"
          disabled={generateMonthlyReview.isPending}
          onClick={() => generateMonthlyReview.mutate()}
          type="button"
        >
          <NotebookText className="h-4 w-4" />
          Generate previous month
        </button>
      </section>

      <section className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 shadow-panel">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
          <GraduationCap className="h-5 w-5 text-cyan-400" />
          Academic
        </div>
        {academicQuery.isLoading ? (
          <p className="text-sm text-zinc-500">Loading academic data.</p>
        ) : academicQuery.isError ? (
          <p className="text-sm text-rose-300">
            Academic unavailable: {academicQuery.error.message}
          </p>
        ) : academic ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2">
              <div className="text-xs text-zinc-500">Current mode</div>
              <div className="mt-1 text-sm font-semibold text-white">
                {academic.currentMode.label}
              </div>
            </div>
            {nextAcademicEvent ? (
              <div className="rounded-lg border border-cyan-400/20 bg-cyan-400/[0.08] px-3 py-2">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase text-cyan-300">
                  <CalendarClock className="h-3.5 w-3.5" />
                  Next event
                </div>
                <div className="mt-1 text-sm font-semibold text-white">
                  {nextAcademicEvent.title ?? nextAcademicEvent.eventType}
                </div>
                <div className="mt-0.5 text-xs text-zinc-400">
                  {nextAcademicEvent.startsAt
                    ? formatDateTime(nextAcademicEvent.startsAt)
                    : nextAcademicEvent.dueAt
                      ? formatDateTime(nextAcademicEvent.dueAt)
                      : "Time pending"}
                </div>
              </div>
            ) : (
              <p className="text-sm text-zinc-500">
                No upcoming academic events.
              </p>
            )}
            {activeCourse ? (
              <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/[0.08] px-3 py-2">
                <div className="text-xs text-emerald-300">Active course</div>
                <div className="mt-1 text-sm font-semibold text-white">
                  {activeCourse.title}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-zinc-500">Academic data is empty.</p>
        )}
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
