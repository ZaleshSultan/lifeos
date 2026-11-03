"use client";
import { useEffect, useRef, useState } from "react";
import { SectionPanel } from "@/components/SectionPanel";
import {
  Notice,
  buttonClass,
  inputClass,
  rowClass,
  useWebResource,
  useUnsavedGuard,
} from "@/components/WorkspaceUI";
import { webErrorMessage, webRequest } from "@/lib/web-client";
export type {
  TaskWorkspaceItem as WebTask,
  TaskWorkspace as WebTasks,
} from "../../../../packages/core/src/daily-life.js";
import type {
  TaskWorkspaceItem as WebTask,
  TaskWorkspace as WebTasks,
} from "../../../../packages/core/src/daily-life.js";
function TaskEdit({
  task,
  busy,
  onSave,
}: {
  task: WebTask;
  busy: boolean;
  onSave: (patch: {
    title: string;
    notes: string;
    dueAt: string | null;
    expectedUpdatedAt: string;
  }) => Promise<void>;
}) {
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes);
  const [due, setDue] = useState(
    task.dueAt
      ? new Date(Date.parse(task.dueAt) + 5 * 3600000)
          .toISOString()
          .slice(0, 16)
      : "",
  );
  const [base, setBase] = useState(task.updatedAt);
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard(dirty);
  useEffect(() => {
    if (dirty) return;
    setTitle(task.title);
    setNotes(task.notes);
    setDue(
      task.dueAt
        ? new Date(Date.parse(task.dueAt) + 5 * 3600000)
            .toISOString()
            .slice(0, 16)
        : "",
    );
    setBase(task.updatedAt);
  }, [task, dirty]);
  return (
    <details className="mt-3">
      <summary className="min-h-11 cursor-pointer text-sm text-cyan-200">
        Изменить задачу
      </summary>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void onSave({
            title: title.trim(),
            notes,
            dueAt: due ? `${due}:00+05:00` : null,
            expectedUpdatedAt: base,
          })
            .then(() => setDirty(false))
            .catch(() => {});
        }}
      >
        <fieldset disabled={busy} className="min-w-0 space-y-3">
          <label className="block text-sm text-zinc-300">
            Новое название
            <input
              required
              maxLength={240}
              className={inputClass}
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                setDirty(true);
              }}
            />
          </label>
          <label className="block text-sm text-zinc-300">
            Заметки задачи
            <textarea
              className={inputClass}
              maxLength={2000}
              value={notes}
              onChange={(event) => {
                setNotes(event.target.value);
                setDirty(true);
              }}
            />
          </label>
          <label className="block text-sm text-zinc-300">
            Дедлайн задачи (Asia/Almaty)
            <input
              className={inputClass}
              type="datetime-local"
              value={due}
              onChange={(event) => {
                setDue(event.target.value);
                setDirty(true);
              }}
            />
          </label>
          <button
            type="submit"
            className={buttonClass}
            disabled={!dirty || !title.trim() || busy}
          >
            Сохранить задачу
          </button>
          <button
            type="button"
            className={buttonClass}
            disabled={busy || !dirty}
            onClick={() => setDirty(false)}
          >
            Отменить правки задачи
          </button>
        </fieldset>
      </form>
    </details>
  );
}
export function PlannerWorkspace({ initial }: { initial: WebTasks | null }) {
  const resource = useWebResource<WebTasks>("tasks", initial);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const inflight = useRef(false);
  const createId = useRef<string | null>(null);
  useUnsavedGuard(Boolean(title || notes || due));
  async function create() {
    if (inflight.current || !title.trim()) return;
    inflight.current = true;
    setBusy(true);
    resource.setError(null);
    createId.current ??= crypto.randomUUID();
    try {
      await webRequest("tasks", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          notes,
          dueAt: due ? `${due}:00+05:00` : null,
          requestId: createId.current,
        }),
      });
      setTitle("");
      setNotes("");
      setDue("");
      createId.current = null;
      await resource.reload();
    } catch (e) {
      resource.setError(webErrorMessage(e));
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  }
  async function status(task: WebTask, next: WebTask["status"]) {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    resource.setError(null);
    try {
      await webRequest(`tasks/${encodeURIComponent(task.id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: next,
          expectedUpdatedAt: task.updatedAt,
        }),
      });
      await resource.reload();
    } catch (e) {
      await resource.reload();
      resource.setError(webErrorMessage(e));
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
      <SectionPanel title="Новая задача">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <fieldset disabled={busy} className="min-w-0 space-y-3">
            <label className="block text-sm text-zinc-300">
              Название
              <input
                className={inputClass}
                required
                maxLength={240}
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  createId.current = null;
                }}
              />
            </label>
            <label className="block text-sm text-zinc-300">
              Заметки
              <textarea
                className={inputClass}
                maxLength={2000}
                value={notes}
                onChange={(e) => {
                  setNotes(e.target.value);
                  createId.current = null;
                }}
              />
            </label>
            <label className="block text-sm text-zinc-300">
              Дедлайн, если известен (Asia/Almaty)
              <input
                type="datetime-local"
                className={inputClass}
                value={due}
                onChange={(e) => {
                  setDue(e.target.value);
                  createId.current = null;
                }}
              />
            </label>
            <button
              className={`${buttonClass} w-full`}
              type="submit"
              disabled={!title.trim() || busy}
            >
              Добавить задачу
            </button>
          </fieldset>
        </form>
      </SectionPanel>
      <SectionPanel
        title="Мои задачи"
        action={
          <button
            type="button"
            className={buttonClass}
            disabled={resource.busy || busy}
            onClick={() => void resource.reload()}
          >
            Обновить
          </button>
        }
      >
        {resource.error ? <Notice error>{resource.error}</Notice> : null}
        {resource.data?.truncated ? (
          <Notice>
            Показана часть задач. Остальные записи остаются в LifeOS.
          </Notice>
        ) : null}
        <div className="mt-3 space-y-3">
          {resource.data?.tasks.length ? (
            resource.data.tasks.map((task) => (
              <article key={task.id} className={rowClass}>
                <h3 className="break-words text-sm font-semibold text-white">
                  {task.title}
                </h3>
                {task.notes ? (
                  <p className="mt-1 whitespace-pre-wrap break-words text-xs text-zinc-400">
                    {task.notes}
                  </p>
                ) : null}
                <p className="mt-2 text-xs text-zinc-400">
                  {task.dueAt
                    ? new Intl.DateTimeFormat("ru-RU", {
                        timeZone: "Asia/Almaty",
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(task.dueAt))
                    : "Без назначенного времени"}
                </p>
                <TaskEdit
                  key={task.id}
                  task={task}
                  busy={busy}
                  onSave={async (patch) => {
                    if (inflight.current) return;
                    inflight.current = true;
                    setBusy(true);
                    try {
                      await webRequest(`tasks/${encodeURIComponent(task.id)}`, {
                        method: "PATCH",
                        body: JSON.stringify(patch),
                      });
                      await resource.reload();
                    } catch (error) {
                      resource.setError(webErrorMessage(error));
                      throw error;
                    } finally {
                      inflight.current = false;
                      setBusy(false);
                    }
                  }}
                />
                <label className="mt-3 block text-xs text-zinc-300">
                  Статус задачи
                  <select
                    className={inputClass}
                    aria-label="Статус задачи"
                    value={task.status}
                    disabled={busy}
                    onChange={(e) =>
                      void status(task, e.target.value as WebTask["status"])
                    }
                  >
                    <option value="inbox">Входящая</option>
                    <option value="next">Следующая</option>
                    <option value="scheduled">Запланирована</option>
                    <option value="waiting">В ожидании</option>
                    <option value="done">Выполнена</option>
                    <option value="cancelled">Отменена</option>
                  </select>
                </label>
              </article>
            ))
          ) : resource.data ? (
            <p className="text-sm text-zinc-400">
              Пока нет задач. Добавь первый реальный приоритет.
            </p>
          ) : null}
        </div>
      </SectionPanel>
    </div>
  );
}
