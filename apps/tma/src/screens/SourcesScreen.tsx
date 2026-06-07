import {
  CalendarClock,
  CheckCircle2,
  Clock3,
  PlugZap,
  RefreshCw,
  Send,
} from "lucide-react";
import { useSourcesQuery } from "../api/hooks";
import type {
  SourceRecord,
  SourceEventRecord,
  SyncRunRecord,
} from "../api/types";
import { ErrorPanel, LoadingPanel } from "../components/AsyncState";
import { formatDateTime } from "../lib/format";
import { cx } from "../lib/styles";

const SOURCE_CATALOG: Array<{
  sourceKey: string;
  displayName: string;
  sourceType: string;
  note: string;
  implemented: boolean;
}> = [
  {
    sourceKey: "obsidian_mirror",
    displayName: "Obsidian Mirror",
    sourceType: "obsidian",
    note: "Worker status is shown when a source heartbeat is available.",
    implemented: true,
  },
  {
    sourceKey: "google_calendar",
    displayName: "Google Calendar",
    sourceType: "google",
    note: "Read-only local OAuth worker.",
    implemented: true,
  },
  {
    sourceKey: "google_tasks",
    displayName: "Google Tasks",
    sourceType: "google",
    note: "Read-only local OAuth worker.",
    implemented: true,
  },
  {
    sourceKey: "health_connect",
    displayName: "Health Connect",
    sourceType: "android",
    note: "Health ingest status is shown from backend sync rows.",
    implemented: true,
  },
  {
    sourceKey: "reminder_worker",
    displayName: "Reminder Worker",
    sourceType: "worker",
    note: "Worker status is shown when a source heartbeat is available.",
    implemented: true,
  },
  {
    sourceKey: "moodle_ics",
    displayName: "Moodle ICS",
    sourceType: "ics",
    note: "Placeholder until MOODLE_ICS_URL is configured.",
    implemented: true,
  },
  {
    sourceKey: "personal_ics",
    displayName: "Personal ICS",
    sourceType: "ics",
    note: "Placeholder until PERSONAL_ICS_URL is configured.",
    implemented: true,
  },
  {
    sourceKey: "university_platform",
    displayName: "University Platform",
    sourceType: "university",
    note: "Server-side connector planned.",
    implemented: false,
  },
  {
    sourceKey: "manual",
    displayName: "Manual",
    sourceType: "manual",
    note: "Telegram and TMA inputs.",
    implemented: true,
  },
];

function statusClass(status: string): string {
  if (
    status === "connected" ||
    status === "active" ||
    status === "success" ||
    status === "scheduled" ||
    status === "pending"
  ) {
    return "border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300";
  }

  if (status === "error" || status === "failed") {
    return "border-rose-400/20 bg-rose-400/[0.08] text-rose-300";
  }

  return "border-white/[0.08] bg-white/[0.04] text-zinc-300";
}

function eventTime(event: SourceEventRecord): string | null {
  return event.startsAt ?? event.dueAt;
}

function sourceRows(sources: SourceRecord[]) {
  const byKey = new Map(sources.map((source) => [source.sourceKey, source]));

  return SOURCE_CATALOG.map((catalog) => ({
    ...catalog,
    source: byKey.get(catalog.sourceKey),
  }));
}

function SourceRow({
  displayName,
  implemented,
  note,
  source,
  sourceKey,
  sourceType,
}: {
  displayName: string;
  implemented: boolean;
  note: string;
  source?: SourceRecord;
  sourceKey: string;
  sourceType: string;
}) {
  const status =
    source?.status ??
    (sourceKey === "google_calendar" || sourceKey === "google_tasks"
      ? "disconnected"
      : "disabled");

  return (
    <div className="grid grid-cols-[auto_1fr] gap-3 border-t border-white/[0.06] py-3 first:border-t-0">
      <div className="grid h-10 w-10 place-items-center rounded-lg border border-cyan-400/20 bg-cyan-400/[0.08] text-cyan-300">
        <PlugZap className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <div className="truncate text-sm font-semibold text-white">
            {displayName}
          </div>
          {!implemented ? (
            <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[11px] font-medium text-zinc-400">
              coming soon
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 truncate text-xs text-zinc-500">
          {source?.sourceType ?? sourceType}
        </div>
        <p className="mt-2 text-xs leading-relaxed text-zinc-500">{note}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <span
            className={cx(
              "rounded-full border px-2.5 py-1 text-xs font-medium",
              statusClass(status),
            )}
          >
            {status}
          </span>
          <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-xs font-medium text-zinc-400">
            {source?.lastSyncAt ? formatDateTime(source.lastSyncAt) : "never"}
          </span>
        </div>
      </div>
    </div>
  );
}

function EventRow({ event }: { event: SourceEventRecord }) {
  const time = eventTime(event);

  return (
    <div className="border-t border-white/[0.06] py-3 first:border-t-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="break-words text-sm font-semibold text-white">
            {event.title ?? event.eventType}
          </div>
          <div className="mt-1 flex flex-wrap gap-2">
            <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-xs text-zinc-400">
              {event.sourceKey}
            </span>
            <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-xs text-zinc-400">
              {event.eventType}
            </span>
          </div>
        </div>
        {time ? (
          <span className="shrink-0 text-xs font-medium text-zinc-500">
            {formatDateTime(time)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function SyncRunRow({ run }: { run: SyncRunRecord }) {
  return (
    <div className="grid grid-cols-[1fr_auto] gap-3 rounded-lg bg-white/[0.03] px-3 py-2">
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-zinc-100">
          {run.sourceKey}
        </div>
        <div className="mt-0.5 text-xs text-zinc-500">
          {formatDateTime(run.startedAt)}
        </div>
      </div>
      <span
        className={cx(
          "self-center rounded-full border px-2.5 py-1 text-xs font-medium",
          statusClass(run.status),
        )}
      >
        {run.status}
      </span>
    </div>
  );
}

export function SourcesScreen() {
  const query = useSourcesQuery();

  if (query.isLoading) {
    return <LoadingPanel title="Loading sources" />;
  }

  if (query.isError) {
    return (
      <ErrorPanel
        detail={query.error.message}
        onRetry={() => void query.refetch()}
        title="Sources unavailable"
      />
    );
  }

  if (!query.data) {
    return (
      <ErrorPanel
        onRetry={() => void query.refetch()}
        title="Sources returned no data"
      />
    );
  }

  const summary = query.data;

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 shadow-panel">
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-cyan-400/20 bg-cyan-400/[0.08] text-cyan-300">
            <PlugZap className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-zinc-500">
              Integrations
            </div>
            <h2 className="mt-1 text-[26px] font-semibold leading-tight tracking-tight text-white">
              Sources
            </h2>
          </div>
          <button
            aria-label="Refresh"
            className="grid h-11 w-11 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.03] text-zinc-300 active:scale-[0.98]"
            onClick={() => void query.refetch()}
            type="button"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 shadow-panel">
        <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-white">
          <CheckCircle2 className="h-5 w-5 text-emerald-400" />
          Integrations
        </div>
        {sourceRows(summary.sources).map((source) => (
          <SourceRow
            displayName={source.displayName}
            implemented={source.implemented}
            key={source.sourceKey}
            note={source.note}
            source={source.source}
            sourceKey={source.sourceKey}
            sourceType={source.sourceType}
          />
        ))}
      </section>

      <section className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 shadow-panel">
        <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-white">
          <CalendarClock className="h-5 w-5 text-cyan-400" />
          Schedule
        </div>
        {summary.sourceEvents.length ? (
          summary.sourceEvents.map((event) => (
            <EventRow event={event} key={event.id} />
          ))
        ) : (
          <p className="mt-3 text-sm text-zinc-500">No upcoming events.</p>
        )}
      </section>

      <section className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 shadow-panel">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
          <Send className="h-5 w-5 text-cyan-400" />
          Sync Runs
        </div>
        {summary.syncRuns.length ? (
          <div className="space-y-2">
            {summary.syncRuns.map((run) => (
              <SyncRunRow key={run.id} run={run} />
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <Clock3 className="h-4 w-4" />
            No sync runs recorded.
          </div>
        )}
      </section>
    </div>
  );
}
