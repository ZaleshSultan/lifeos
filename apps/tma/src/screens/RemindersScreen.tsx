import { Bell, CircleAlert, RefreshCw, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import {
  useCancelReminderMutation,
  useCreateReminderMutation,
  useRemindersQuery,
} from "../api/hooks";
import type { ReminderRecord } from "../api/types";
import { ErrorPanel, LoadingPanel } from "../components/AsyncState";
import { formatDateTime } from "../lib/format";
import { cx } from "../lib/styles";

function defaultReminderDateTime(): string {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function statusClass(status: ReminderRecord["status"]): string {
  if (status === "pending" || status === "sent") {
    return "border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300";
  }
  if (status === "failed") {
    return "border-rose-400/20 bg-rose-400/[0.08] text-rose-300";
  }
  return "border-white/[0.08] bg-white/[0.04] text-zinc-300";
}

function metadataSource(reminder: ReminderRecord): string {
  const source =
    typeof reminder.metadataJson?.source === "string"
      ? reminder.metadataJson.source
      : "";
  const label =
    typeof reminder.metadataJson?.source_label === "string"
      ? reminder.metadataJson.source_label
      : "";

  if (label) return label;
  if (source === "google_tasks") return "Google Tasks";
  if (source === "google_calendar") return "Google Calendar";
  if (source === "moodle_ics" || source === "personal_ics") return "ICS";
  return "Manual";
}

function ReminderRow({
  cancelPending,
  onCancel,
  reminder,
}: {
  cancelPending: boolean;
  onCancel: () => void;
  reminder: ReminderRecord;
}) {
  return (
    <div className="border-t border-white/[0.06] py-3 first:border-t-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="break-words text-sm font-semibold text-white">
            {reminder.message}
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            {formatDateTime(reminder.remindAt)}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-xs text-zinc-400">
              {metadataSource(reminder)}
            </span>
            <span
              className={cx(
                "rounded-full border px-2 py-0.5 text-xs",
                statusClass(reminder.status),
              )}
            >
              {reminder.status}
            </span>
          </div>
        </div>
        {reminder.status === "pending" ? (
          <button
            aria-label={`Cancel ${reminder.message}`}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-rose-400/20 bg-rose-400/[0.08] text-rose-300 disabled:opacity-50"
            disabled={cancelPending}
            onClick={onCancel}
            type="button"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function RemindersScreen() {
  const query = useRemindersQuery();
  const createReminder = useCreateReminderMutation();
  const cancelReminder = useCancelReminderMutation();
  const [message, setMessage] = useState("");
  const [reminderAt, setReminderAt] = useState(defaultReminderDateTime);

  if (query.isLoading) return <LoadingPanel title="Loading reminders" />;
  if (query.isError) {
    return (
      <ErrorPanel
        detail={query.error.message}
        onRetry={() => void query.refetch()}
        title="Reminders unavailable"
      />
    );
  }

  const reminders = query.data?.reminders ?? [];
  const createDisabled =
    createReminder.isPending || !message.trim() || !reminderAt;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (createDisabled) return;
    createReminder.mutate(
      {
        message: message.trim(),
        remindAt: new Date(reminderAt).toISOString(),
      },
      {
        onSuccess() {
          setMessage("");
          setReminderAt(defaultReminderDateTime());
        },
      },
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 shadow-panel">
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-lg border border-amber-400/20 bg-amber-400/[0.08] text-amber-300">
            <Bell className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-zinc-500">Schedule</div>
            <h2 className="mt-1 text-[26px] font-semibold text-white">
              Reminders
            </h2>
          </div>
          <button
            aria-label="Refresh reminders"
            className="grid h-11 w-11 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.03] text-zinc-300"
            onClick={() => void query.refetch()}
            type="button"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 shadow-panel">
        <form className="space-y-3" onSubmit={onSubmit}>
          <input
            className="min-h-12 w-full rounded-lg border border-white/[0.08] bg-black/20 px-3 text-sm font-semibold text-white"
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Reminder message"
            value={message}
          />
          <input
            className="min-h-12 w-full rounded-lg border border-white/[0.08] bg-black/20 px-3 text-sm font-semibold text-white"
            onChange={(event) => setReminderAt(event.target.value)}
            type="datetime-local"
            value={reminderAt}
          />
          <button
            className="min-h-12 w-full rounded-lg bg-amber-300 px-4 text-sm font-semibold text-graphite-950 disabled:opacity-60"
            disabled={createDisabled}
            type="submit"
          >
            Add reminder
          </button>
        </form>
        {createReminder.isError ? (
          <div className="mt-3 flex gap-2 text-sm text-rose-300">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{createReminder.error.message}</span>
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 shadow-panel">
        <div className="mb-2 text-sm font-semibold text-white">
          Next 10 reminders
        </div>
        {reminders.length ? (
          reminders.map((reminder) => (
            <ReminderRow
              cancelPending={cancelReminder.isPending}
              key={reminder.id}
              onCancel={() => cancelReminder.mutate(reminder.id)}
              reminder={reminder}
            />
          ))
        ) : (
          <p className="py-3 text-sm text-zinc-500">
            No upcoming reminders. Add one here or use /remind in Telegram.
          </p>
        )}
        {cancelReminder.isError ? (
          <p className="mt-2 text-sm text-rose-300">
            {cancelReminder.error.message}
          </p>
        ) : null}
      </section>
    </div>
  );
}
