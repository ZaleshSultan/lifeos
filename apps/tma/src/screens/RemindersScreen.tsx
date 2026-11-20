import { CircleAlert, Plus, RefreshCw, X } from "lucide-react";
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
  return "Вручную";
}

const statuses: Record<ReminderRecord["status"], string> = {
  pending: "Запланировано",
  processing: "Отправляется",
  sent: "Отправлено",
  cancelled: "Отменено",
  failed: "Ошибка",
};

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
              {statuses[reminder.status]}
            </span>
          </div>
        </div>
        {reminder.status === "pending" ? (
          <button
            aria-label={`Отменить напоминание «${reminder.message}»`}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-rose-400/20 bg-rose-400/[0.08] text-rose-300 disabled:opacity-50"
            disabled={cancelPending}
            onClick={onCancel}
            type="button"
          >
            <X aria-hidden="true" className="h-4 w-4" />
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
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState("");
  const [reminderAt, setReminderAt] = useState(defaultReminderDateTime);

  if (query.isLoading) return <LoadingPanel title="Загружаем напоминания…" />;
  if (query.isError) {
    return (
      <ErrorPanel
        detail={query.error.message}
        onRetry={() => void query.refetch()}
        title="Не удалось загрузить напоминания"
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
          setEditing(false);
          setMessage("");
          setReminderAt(defaultReminderDateTime());
        },
      },
    );
  }

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-[27px] font-bold leading-tight">Напоминания</h1>
        <button
          aria-label="Обновить напоминания"
          className="grid min-h-11 min-w-11 place-items-center rounded-xl border border-white/10 text-zinc-300"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
          type="button"
        >
          <RefreshCw size={17} aria-hidden="true" />
        </button>
      </header>

      <button
        type="button"
        aria-expanded={editing}
        aria-controls="reminder-form"
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#a9c1ff] px-4 text-sm font-bold text-[#111725]"
        onClick={() => setEditing((open) => !open)}
      >
        {editing ? (
          <X size={18} aria-hidden="true" />
        ) : (
          <Plus size={18} aria-hidden="true" />
        )}
        {editing ? "Свернуть форму" : "Новое напоминание"}
      </button>
      <section
        id="reminder-form"
        hidden={!editing}
        className="rounded-[18px] border border-white/[0.08] bg-[#151517] p-4"
      >
        <form className="space-y-3" onSubmit={onSubmit}>
          <label className="block space-y-1">
            <span className="text-sm text-zinc-400">О чём напомнить</span>
            <input
              className="min-h-12 w-full rounded-lg border border-white/[0.08] bg-black/20 px-3 text-sm font-semibold text-white"
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Например, вернуть книгу"
              value={message}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm text-zinc-400">Дата и время</span>
            <input
              className="min-h-12 w-full rounded-lg border border-white/[0.08] bg-black/20 px-3 text-sm font-semibold text-white"
              onChange={(event) => setReminderAt(event.target.value)}
              type="datetime-local"
              value={reminderAt}
            />
          </label>
          <button
            className="min-h-12 w-full rounded-lg bg-[#a9c1ff] px-4 text-sm font-semibold text-graphite-950 disabled:opacity-60"
            disabled={createDisabled}
            type="submit"
          >
            {createReminder.isPending ? "Сохраняем…" : "Сохранить"}
          </button>
        </form>
        {createReminder.isError ? (
          <div role="alert" className="mt-3 flex gap-2 text-sm text-rose-300">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{createReminder.error.message}</span>
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 shadow-panel">
        <h2 className="mb-1 text-lg font-semibold text-white">Список</h2>
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
          <p className="py-3 text-sm text-zinc-500">Напоминаний пока нет.</p>
        )}
        {cancelReminder.isError ? (
          <p role="alert" className="mt-2 text-sm text-rose-300">
            {cancelReminder.error.message}
          </p>
        ) : null}
      </section>
    </div>
  );
}
