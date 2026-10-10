import { useState } from "react";
import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  MessageCircle,
  RefreshCw,
} from "lucide-react";
import {
  planningErrorMessage,
  useTodayQuery,
  type TodaySummary,
} from "../api/planning";
import { formatMinutes } from "../lib/format";
import { ErrorPanel, LoadingPanel } from "./AsyncState";

interface TodayPanelProps {
  date: string;
  onOpenAi: (date: string) => void;
}

export function shiftPlanDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function formatPlanTime(value: string, timezone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatPlanDeadline(value: string, timezone: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (!Number.isFinite(new Date(value).getTime())) return "invalid deadline";
  return new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function TodayDetails({ summary }: { summary: TodaySummary }) {
  const { plan, productivity } = summary;
  const time = (value: string) => formatPlanTime(value, plan.timezone);
  const timeline = [
    ...summary.events.map((event) => ({ ...event, kind: "event" as const })),
    ...plan.blocks.map((block) => ({ ...block, kind: "task" as const })),
  ].sort((left, right) => left.startsAt.localeCompare(right.startsAt));

  return (
    <div className="space-y-4">
      <p className="break-words text-xs text-zinc-400">
        {plan.timezone} · {plan.mode.replaceAll("_", " ")} · planning window{" "}
        {time(plan.window.startsAt)}–{time(plan.window.endsAt)}
      </p>
      <p className="text-xs leading-relaxed text-zinc-400">
        Planning hours use an assumed 09:00–21:00 day. Calendar events and
        elapsed time are excluded from free time.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-3">
          <div className="text-xs text-zinc-400">Free around events</div>
          <div className="mt-1 text-lg font-semibold tabular-nums text-white">
            {formatMinutes(plan.availableMinutes)}
          </div>
        </div>
        <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-3">
          <div className="text-xs text-zinc-400">Tasks planned</div>
          <div className="mt-1 text-lg font-semibold tabular-nums text-white">
            {plan.blocks.length}
          </div>
        </div>
      </div>

      {plan.conflicts.length > 0 ? (
        <p
          role="status"
          className="rounded-lg border border-amber-300/25 bg-amber-300/[0.08] p-3 text-sm text-amber-100"
        >
          {plan.conflicts.length} calendar{" "}
          {plan.conflicts.length === 1 ? "conflict needs" : "conflicts need"}{" "}
          attention. Task blocks avoid calendar events.
        </p>
      ) : null}
      {plan.warnings.length > 0 ? (
        <ul className="space-y-1 text-sm text-amber-200">
          {plan.warnings.map((warning, index) => (
            <li key={index}>{warning}</li>
          ))}
        </ul>
      ) : null}

      <div>
        <h3 className="mb-2 text-sm font-semibold text-white">
          Schedule &amp; proposed task blocks
        </h3>
        <p className="mb-3 text-xs leading-relaxed text-zinc-400">
          Task blocks are planning suggestions. They have not been saved to your
          calendar.
        </p>
        {timeline.length > 0 ? (
          <ol className="space-y-2">
            {timeline.map((item, index) => (
              <li
                key={`${item.kind}-${index}`}
                className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-3"
              >
                <p className="text-xs tabular-nums text-cyan-200">
                  {time(item.startsAt)}–{time(item.endsAt)} ·{" "}
                  {item.kind === "event" ? "Calendar" : "Task proposal"}
                </p>
                <p className="mt-1 break-words text-sm font-medium text-white">
                  {item.title}
                </p>
                {item.kind === "task" && item.estimated ? (
                  <p className="mt-1 text-xs text-amber-200">
                    Duration estimated
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-zinc-400">
            No calendar events or planned tasks for this date.
          </p>
        )}
        {plan.freeSlots.length > 0 ? (
          <details className="mt-3 text-sm text-zinc-300">
            <summary className="min-h-11 cursor-pointer py-3">
              Available calendar windows ({plan.freeSlots.length})
            </summary>
            <ul className="space-y-1 pb-2 text-xs tabular-nums text-zinc-400">
              {plan.freeSlots.map((slot, index) => (
                <li key={index}>
                  {time(slot.startsAt)}–{time(slot.endsAt)}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-white">
          Task priorities
        </h3>
        {plan.rankedTasks.length > 0 ? (
          <ol className="space-y-2">
            {plan.rankedTasks.map((task, index) => (
              <li
                key={task.id}
                className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-3"
              >
                <p className="break-words text-sm font-medium text-white">
                  {index + 1}. {task.title}
                </p>
                <p className="mt-1 text-xs text-zinc-400">
                  {task.domain ? `${task.domain} · ` : ""}
                  {task.dueAt
                    ? `Due ${formatPlanDeadline(task.dueAt, plan.timezone)}`
                    : "No deadline"}
                  {task.estimatedMinutes != null
                    ? ` · ${formatMinutes(task.estimatedMinutes)}`
                    : ""}
                </p>
                <ul className="mt-2 space-y-1 text-xs leading-relaxed text-zinc-300">
                  {task.reasons.map((reason, reasonIndex) => (
                    <li key={reasonIndex}>{reason}</li>
                  ))}
                </ul>
                {plan.unscheduledTaskIds.includes(task.id) ? (
                  <p className="mt-2 text-xs text-amber-200">
                    Outside this day's plan
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-zinc-400">
            No open tasks available to plan.
          </p>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-white">Reminders</h3>
        {summary.reminders.length > 0 ? (
          <ul className="space-y-2">
            {summary.reminders.map((reminder, index) => (
              <li key={index} className="flex items-start gap-3 text-sm">
                <span className="shrink-0 tabular-nums text-amber-200">
                  {time(reminder.remindAt)}
                </span>
                <span className="min-w-0 break-words text-zinc-200">
                  {reminder.title}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-zinc-400">No reminders for this date.</p>
        )}
      </div>

      <div className="border-t border-white/[0.08] pt-4">
        <h3 className="text-sm font-semibold text-white">Last 7 days</h3>
        <p className="mt-1 text-xs text-zinc-400">
          {productivity.startDate}–{productivity.endDate} ·{" "}
          {productivity.timezone}
        </p>
        <p className="mt-2 text-sm text-zinc-200">
          {productivity.totalCompleted} tasks completed ·{" "}
          {productivity.totalCreated} created
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs tabular-nums text-zinc-300">
            <caption className="sr-only">
              Actual daily task activity for the last seven days
            </caption>
            <thead>
              <tr>
                <th scope="col" className="pb-2 font-medium text-zinc-400">
                  Date
                </th>
                <th
                  scope="col"
                  className="pb-2 text-right font-medium text-zinc-400"
                >
                  Created
                </th>
                <th
                  scope="col"
                  className="pb-2 text-right font-medium text-zinc-400"
                >
                  Completed
                </th>
              </tr>
            </thead>
            <tbody>
              {productivity.daily.map((day) => (
                <tr key={day.date}>
                  <th scope="row" className="py-1 font-normal">
                    {day.date}
                  </th>
                  <td className="py-1 text-right">{day.created}</td>
                  <td className="py-1 text-right">{day.completed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {productivity.truncated ? (
          <p className="mt-2 text-xs text-amber-200">
            Activity is partial because the data limit was reached.
          </p>
        ) : null}
        {productivity.warnings.map((warning, index) => (
          <p key={index} className="mt-2 text-xs text-amber-200">
            {warning}
          </p>
        ))}
      </div>
    </div>
  );
}

export function TodayPanel({ date, onOpenAi }: TodayPanelProps) {
  const [selectedDate, setSelectedDate] = useState(date);
  const query = useTodayQuery(selectedDate);

  return (
    <section
      aria-labelledby="today-heading"
      className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 shadow-panel"
    >
      <div className="flex items-center justify-between gap-2">
        <h2
          id="today-heading"
          className="flex items-center gap-2 text-base font-semibold text-white"
        >
          <CalendarClock className="h-5 w-5 text-cyan-400" />
          Today
        </h2>
        <button
          aria-label="Refresh daily plan"
          type="button"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
          className="grid min-h-11 min-w-11 place-items-center rounded-lg text-zinc-300 hover:bg-white/[0.06] active:scale-[0.98] disabled:opacity-50"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>
      <div className="mb-4 flex items-center gap-1">
        <button
          aria-label="Previous day"
          type="button"
          onClick={() => setSelectedDate(shiftPlanDate(selectedDate, -1))}
          className="grid min-h-11 min-w-11 place-items-center rounded-lg text-zinc-300 hover:bg-white/[0.06] active:scale-[0.98]"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <input
          aria-label="Planning date"
          type="date"
          value={selectedDate}
          onChange={(event) => {
            if (event.target.value) setSelectedDate(event.target.value);
          }}
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-graphite-900 px-2 text-sm text-white"
        />
        <button
          aria-label="Next day"
          type="button"
          onClick={() => setSelectedDate(shiftPlanDate(selectedDate, 1))}
          className="grid min-h-11 min-w-11 place-items-center rounded-lg text-zinc-300 hover:bg-white/[0.06] active:scale-[0.98]"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
        {selectedDate !== date ? (
          <button
            type="button"
            onClick={() => setSelectedDate(date)}
            className="min-h-11 rounded-lg px-2 text-xs font-medium text-cyan-200 hover:bg-white/[0.06] active:scale-[0.98]"
          >
            Today
          </button>
        ) : null}
      </div>
      {query.isLoading ? (
        <LoadingPanel title="Loading daily plan" />
      ) : query.isError ? (
        <ErrorPanel
          title="Daily plan unavailable"
          detail={planningErrorMessage(query.error)}
          onRetry={() => void query.refetch()}
        />
      ) : query.data ? (
        <TodayDetails summary={query.data} />
      ) : (
        <ErrorPanel
          title="Daily plan returned no data"
          onRetry={() => void query.refetch()}
        />
      )}
      <button
        type="button"
        onClick={() => onOpenAi(selectedDate)}
        className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-cyan-400/25 bg-cyan-400/10 px-3 text-sm font-medium text-cyan-200 hover:bg-cyan-400/15 active:scale-[0.98]"
      >
        <MessageCircle className="h-4 w-4" />
        Ask LifeOS AI
      </button>
      {query.data && !query.data.ai.available ? (
        <p className="mt-2 text-xs leading-relaxed text-zinc-400">
          {query.data.ai.enabled
            ? "AI assistance is unavailable. The plan above uses deterministic rules."
            : "AI assistance is disabled. The plan above uses deterministic rules."}
        </p>
      ) : null}
    </section>
  );
}
