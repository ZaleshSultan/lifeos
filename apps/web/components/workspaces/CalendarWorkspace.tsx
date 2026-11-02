"use client";
import { useState } from "react";
import type { WebTodaySummary as TodaySummary } from "@/lib/dashboard-contracts";
import { SectionPanel } from "@/components/SectionPanel";
import {
  Notice,
  buttonClass,
  inputClass,
  rowClass,
} from "@/components/WorkspaceUI";
import { webRequest, webErrorMessage } from "@/lib/web-client";
const time = (v: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Almaty",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(v));
export function CalendarWorkspace({
  initial,
  date: initialDate,
}: {
  initial: TodaySummary | null;
  date: string;
}) {
  const [date, setDate] = useState(initialDate);
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    initial ? null : "Данные календаря пока недоступны.",
  );
  async function load() {
    setBusy(true);
    setError(null);
    try {
      setData(
        await webRequest<TodaySummary>(
          `today?date=${encodeURIComponent(date)}`,
        ),
      );
    } catch (e) {
      setError(webErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-5">
      <SectionPanel title="Выбери день">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void load();
          }}
          className="flex flex-wrap items-end gap-3"
        >
          <label className="min-w-0 flex-1 basis-48 text-sm text-zinc-300">
            Дата в Asia/Almaty
            <input
              type="date"
              className={inputClass}
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <button type="submit" className={buttonClass} disabled={busy}>
            Показать день
          </button>
        </form>
      </SectionPanel>
      {error ? <Notice error>{error}</Notice> : null}
      {data ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <SectionPanel title={`Сохранённые события · ${data.plan.date}`}>
            <p className="mb-3 text-xs text-amber-100">
              Проверь свежесть календаря и AITU. Здесь показываются только
              доступные записи, без выдуманных событий.
            </p>
            <div className="space-y-3">
              {data.events.length ? (
                data.events.map((event, i) => (
                  <div key={`${event.startsAt}-${i}`} className={rowClass}>
                    <p className="break-words text-sm font-medium text-white">
                      {event.title}
                    </p>
                    <p className="mt-1 text-xs text-zinc-400">
                      {time(event.startsAt)}–{time(event.endsAt)}
                    </p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-zinc-400">
                  Событий в доступных данных нет. Это не подтверждает отсутствие
                  занятий.
                </p>
              )}
            </div>
          </SectionPanel>
          <SectionPanel title="Предложенный план">
            <p className="mb-3 text-xs text-zinc-400">
              Расчётные блоки — предложения для задач. Они не создают
              календарные события автоматически.
            </p>
            <div className="space-y-3">
              {data.plan.blocks.length ? (
                data.plan.blocks.map((block, i) => (
                  <div key={`${block.taskId}-${i}`} className={rowClass}>
                    <p className="break-words text-sm text-white">
                      {block.title}
                    </p>
                    <p className="mt-1 text-xs text-zinc-400">
                      {time(block.startsAt)}–{time(block.endsAt)} · оценка
                      планировщика
                    </p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-zinc-400">
                  Нет предложенных блоков. Добавь задачи или сохрани гибкий план
                  в Ideal Human.
                </p>
              )}
              {data.plan.warnings.map((warning, i) => (
                <p key={i} className="text-xs text-amber-200">
                  {warning}
                </p>
              ))}
            </div>
          </SectionPanel>
        </div>
      ) : null}
    </div>
  );
}
