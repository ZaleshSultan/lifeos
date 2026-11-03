"use client";
import { useState } from "react";
import type { AssistantMemoryCategory } from "../../../../../packages/core/src/assistant.js";
import {
  captureMemoryCommand,
  type CaptureActionPayload,
  type CaptureMemoryView,
} from "../../../../../packages/core/src/universal-capture.js";
import { captureButtonClass, captureInputClass } from "./ActionEditor";
import { captureDateTime } from "./model";

type MemoryAction = Extract<
  CaptureActionPayload,
  {
    kind:
      | "memory.remember"
      | "memory.update"
      | "memory.archive"
      | "memory.delete";
  }
>;
export function CaptureMemoryPanel({
  memories,
  loading,
  error,
  busy,
  deleteEnabled,
  onReload,
  onPrepare,
  onDirtyChange,
}: {
  memories: CaptureMemoryView[] | null;
  loading: boolean;
  error: string | null;
  busy: boolean;
  deleteEnabled: boolean;
  onReload: () => void;
  onPrepare: (text: string) => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [key, setKey] = useState("");
  const [category, setCategory] =
    useState<AssistantMemoryCategory>("preference");
  const [content, setContent] = useState("");
  const [editing, setEditing] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  async function prepare(action: MemoryAction) {
    if (
      (action.kind === "memory.archive" || action.kind === "memory.delete") &&
      (key || content) &&
      !window.confirm(
        "Отменить несохранённую форму памяти и подготовить другое действие?",
      )
    )
      return;
    try {
      const command = captureMemoryCommand(action);
      await onPrepare(command);
      setKey("");
      setContent("");
      setEditing(false);
      onDirtyChange(false);
      setFormError(null);
    } catch {
      setFormError(
        "Не удалось подготовить запись. Проверь ключ, текст и отсутствие секретов; введённое сохранено на экране.",
      );
    }
  }
  return (
    <section aria-label="Явная память LifeOS" className="min-w-0 space-y-4">
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <h2 className="font-semibold text-white">Память по твоему выбору</h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-300">
          Разговоры не становятся постоянными предпочтениями автоматически.
          Подготовь запись, проверь предложение и отдельно подтверди. Не
          сохраняй пароли, университетские cookies и ключи.
        </p>
        <form
          className="mt-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void prepare({
              kind: editing ? "memory.update" : "memory.remember",
              args: { key, category, content },
            });
          }}
        >
          <fieldset disabled={busy} className="min-w-0 space-y-3">
            <label className="block text-sm text-zinc-300">
              Ключ памяти
              <input
                className={captureInputClass}
                value={key}
                readOnly={editing}
                maxLength={80}
                pattern="[a-z0-9][a-z0-9_.-]{0,79}"
                placeholder="study.time"
                required
                onChange={(event) => {
                  setKey(event.target.value);
                  onDirtyChange(true);
                }}
              />
            </label>
            <label className="block text-sm text-zinc-300">
              Категория
              <select
                className={captureInputClass}
                value={category}
                onChange={(event) => {
                  setCategory(event.target.value as AssistantMemoryCategory);
                  onDirtyChange(true);
                }}
              >
                {[
                  ["preference", "Предпочтение"],
                  ["goal", "Цель"],
                  ["constraint", "Ограничение"],
                  ["learning", "Обучение"],
                  ["fact", "Факт"],
                ].map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm text-zinc-300">
              Что явно запомнить
              <input
                className={captureInputClass}
                value={content}
                maxLength={1000}
                required
                placeholder="Я предпочитаю учиться утром"
                onChange={(event) => {
                  setContent(event.target.value);
                  onDirtyChange(true);
                }}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                className={captureButtonClass}
                disabled={busy || !key.trim() || !content.trim()}
              >
                {editing
                  ? "Подготовить изменение памяти"
                  : "Подготовить запись в память"}
              </button>
              <button
                type="button"
                className={captureButtonClass}
                onClick={() => {
                  setKey("");
                  setContent("");
                  setEditing(false);
                  onDirtyChange(false);
                }}
              >
                Очистить форму
              </button>
            </div>
          </fieldset>
        </form>
        {formError ? (
          <p role="alert" className="mt-3 text-sm text-rose-100">
            {formError}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-zinc-100">Сохранённые записи</h3>
        <button
          type="button"
          className={captureButtonClass}
          disabled={busy || loading}
          onClick={onReload}
        >
          Обновить память
        </button>
      </div>
      {loading ? (
        <p role="status" className="text-sm text-zinc-400">
          Загружаем память…
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-rose-300/20 p-3 text-sm text-rose-100"
        >
          {error}
        </p>
      ) : null}
      {memories !== null && memories.length === 0 && !loading ? (
        <p className="rounded-xl border border-white/10 p-4 text-sm text-zinc-400">
          Ты ещё не сохранял память. Это не мешает обычным функциям LifeOS.
        </p>
      ) : null}
      {memories?.map((memory) => (
        <article
          key={memory.key}
          className="min-w-0 rounded-xl border border-white/10 p-4"
        >
          <p className="break-words font-semibold text-zinc-100">
            {memory.key}
          </p>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm text-zinc-300">
            {memory.content}
          </p>
          <p className="mt-2 text-xs text-zinc-400">
            {memory.archivedAt ? "Архивирована" : "Активна"} ·{" "}
            {captureDateTime(memory.updatedAt)}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className={captureButtonClass}
              disabled={busy}
              onClick={() => {
                if (
                  (key || content) &&
                  !window.confirm(
                    "Отменить несохранённую форму и открыть эту память?",
                  )
                )
                  return;
                setKey(memory.key);
                setCategory(memory.category);
                setContent(memory.content);
                setEditing(true);
                onDirtyChange(true);
              }}
            >
              Редактировать память
            </button>
            {!memory.archivedAt ? (
              <button
                type="button"
                className={captureButtonClass}
                disabled={busy}
                onClick={() =>
                  void prepare({
                    kind: "memory.archive",
                    args: { key: memory.key },
                  })
                }
              >
                Подготовить архивацию
              </button>
            ) : null}
            {deleteEnabled ? (
              <button
                type="button"
                className={captureButtonClass}
                disabled={busy}
                onClick={() =>
                  void prepare({
                    kind: "memory.delete",
                    args: { key: memory.key },
                  })
                }
              >
                Подготовить удаление памяти
              </button>
            ) : null}
          </div>
        </article>
      ))}
      {!deleteEnabled ? (
        <p className="text-xs leading-relaxed text-zinc-400">
          Безвозвратное удаление памяти выключено политикой сервера. Можно
          подготовить архивацию.
        </p>
      ) : null}
    </section>
  );
}
