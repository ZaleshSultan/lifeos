"use client";
import { useRef, useState } from "react";
import type { RemindersResponse } from "../../../tma/src/api/types";
import { SectionPanel } from "@/components/SectionPanel";
import {
  Notice,
  buttonClass,
  inputClass,
  rowClass,
  useWebResource,
} from "@/components/WorkspaceUI";
import { webErrorMessage, webRequest } from "@/lib/web-client";
export function NotificationsWorkspace({
  initial,
}: {
  initial: RemindersResponse | null;
}) {
  const resource = useWebResource<RemindersResponse>("reminders", initial);
  const [message, setMessage] = useState("");
  const [time, setTime] = useState("");
  const [busy, setBusy] = useState(false);
  const inflight = useRef(false);
  const [receipt, setReceipt] = useState<string | null>(null);
  async function create() {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    resource.setError(null);
    try {
      await webRequest("reminders", {
        method: "POST",
        body: JSON.stringify({ message, remindAt: `${time}:00+05:00` }),
      });
      setMessage("");
      setTime("");
      setReceipt("Напоминание создано. Проверь его в списке ниже.");
      await resource.reload();
    } catch (e) {
      resource.setError(webErrorMessage(e));
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  }
  async function cancel(id: string) {
    if (inflight.current || !window.confirm("Отменить это напоминание?"))
      return;
    inflight.current = true;
    setBusy(true);
    try {
      await webRequest(`reminders/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      await resource.reload();
    } catch (e) {
      resource.setError(webErrorMessage(e));
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <SectionPanel title="Новое напоминание">
        <p className="mb-4 text-sm text-zinc-300">
          Сообщение придёт в связанный Telegram после явного создания. Время
          указывается в Asia/Almaty (UTC+05:00).
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <fieldset disabled={busy} className="min-w-0 space-y-3">
            <label className="block text-sm text-zinc-300">
              Текст
              <input
                className={inputClass}
                required
                maxLength={500}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Например: вечерняя рефлексия"
              />
            </label>
            <label className="block text-sm text-zinc-300">
              Когда
              <input
                className={inputClass}
                required
                type="datetime-local"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </label>
            <button
              type="submit"
              className={`${buttonClass} w-full`}
              disabled={!message.trim() || !time || busy}
            >
              Создать напоминание
            </button>
          </fieldset>
        </form>
        {receipt ? (
          <p role="status" className="mt-3 text-sm text-emerald-200">
            {receipt}
          </p>
        ) : null}
      </SectionPanel>
      <SectionPanel
        title="Предстоящие уведомления"
        action={
          <button
            type="button"
            className={buttonClass}
            disabled={busy || resource.busy}
            onClick={() => void resource.reload()}
          >
            Обновить
          </button>
        }
      >
        {resource.error ? <Notice error>{resource.error}</Notice> : null}
        <div className="mt-3 space-y-3">
          {resource.data?.reminders.length ? (
            resource.data.reminders.map((reminder) => (
              <article key={reminder.id} className={rowClass}>
                <p className="break-words text-sm text-white">
                  {reminder.message}
                </p>
                <p className="mt-1 text-xs text-zinc-400">
                  {new Intl.DateTimeFormat("ru-RU", {
                    timeZone: "Asia/Almaty",
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(reminder.remindAt))}{" "}
                  · {reminder.status}
                </p>
                <button
                  type="button"
                  className={`${buttonClass} mt-3`}
                  disabled={busy}
                  onClick={() => void cancel(reminder.id)}
                >
                  Отменить
                </button>
              </article>
            ))
          ) : resource.data ? (
            <p className="text-sm text-zinc-400">
              Нет предстоящих напоминаний. Уведомления сами не включаются.
            </p>
          ) : null}
        </div>
      </SectionPanel>
    </div>
  );
}
