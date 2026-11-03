"use client";
import { useState, type ChangeEvent, type ReactNode } from "react";
import type { TaskWorkspaceItem } from "../../../../../packages/core/src/daily-life.js";
import type {
  CaptureActionKind,
  CaptureActionPayload,
  CaptureActionView,
} from "../../../../../packages/core/src/universal-capture.js";
import { parseCaptureActionPayload } from "../../../../../packages/core/src/universal-capture.js";
import type { AssistantToolName } from "../../../../../packages/core/src/assistant.js";
import {
  captureActionLabels,
  emptyCaptureAction,
  instantFromInput,
  localInstantInput,
} from "./model";

export const captureInputClass =
  "mt-1 min-h-11 w-full min-w-0 rounded-lg border border-white/15 bg-graphite-950 px-3 py-2 text-sm text-zinc-100 disabled:opacity-50";
export const captureButtonClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-sm text-cyan-100 hover:bg-white/[0.06] active:scale-[0.98] disabled:opacity-40";

export function CaptureActionEditor({
  action,
  date,
  timezone,
  tasks,
  kinds,
  busy,
  onSave,
  onCancel,
  onDirtyChange,
}: {
  action: CaptureActionView;
  date: string;
  timezone: string;
  tasks: TaskWorkspaceItem[];
  kinds: CaptureActionKind[];
  busy: boolean;
  onSave: (action: CaptureActionPayload) => Promise<void>;
  onCancel: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState<CaptureActionPayload>({
    kind: action.kind,
    args: { ...action.args },
  } as CaptureActionPayload);
  const [error, setError] = useState<string | null>(null);
  const args = draft.args as unknown as Record<string, unknown>;
  function change(key: string, value: unknown) {
    setDraft(
      (old) =>
        ({
          ...old,
          args: {
            ...old.args,
            [key]: value,
            ...(old.kind === "question.read" && key === "text"
              ? { tool: null }
              : {}),
          },
        }) as CaptureActionPayload,
    );
    onDirtyChange(true);
    setError(null);
  }
  function text(
    key: string,
    label: string,
    multiline = false,
    maxLength = 2000,
  ) {
    const original =
      draft.kind === "task.update" &&
      key === "notes" &&
      !Object.hasOwn(args, key)
        ? tasks.find((task) => task.id === args.taskId)?.notes
        : args[key];
    const props = {
      value: typeof original === "string" ? original : "",
      maxLength,
      className: captureInputClass,
      onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        change(key, event.target.value),
    };
    return (
      <label key={key} className="block text-sm text-zinc-300">
        {label}
        {multiline ? <textarea {...props} rows={3} /> : <input {...props} />}
      </label>
    );
  }
  function day() {
    return (
      <label className="block text-sm text-zinc-300">
        Дата
        <input
          type="date"
          className={captureInputClass}
          value={String(args.date ?? "")}
          onChange={(event) => change("date", event.target.value)}
        />
      </label>
    );
  }
  function number(key: string, label: string, max: number, step = "any") {
    return (
      <label key={key} className="block text-sm text-zinc-300">
        {label}
        <input
          type="number"
          min="0"
          max={max}
          step={step}
          placeholder="Неизвестно"
          className={captureInputClass}
          value={typeof args[key] === "number" ? Number(args[key]) : ""}
          onChange={(event) =>
            change(
              key,
              event.target.value === "" ? null : Number(event.target.value),
            )
          }
        />
      </label>
    );
  }
  function instant(key: string, label: string) {
    const original =
      draft.kind === "task.update" &&
      key === "dueAt" &&
      !Object.hasOwn(args, key)
        ? tasks.find((task) => task.id === args.taskId)?.dueAt
        : args[key];
    return (
      <label className="block text-sm text-zinc-300">
        {label} · {timezone}
        <input
          type="datetime-local"
          className={captureInputClass}
          value={localInstantInput(
            typeof original === "string" ? original : null,
            timezone,
          )}
          onChange={(event) => {
            try {
              change(key, instantFromInput(event.target.value, timezone));
            } catch {
              setError(
                "Это местное время не существует или неоднозначно. Выбери другое время.",
              );
            }
          }}
        />
      </label>
    );
  }
  function clock(key: string, label: string) {
    return (
      <label className="block text-sm text-zinc-300">
        {label}
        <input
          type="time"
          className={captureInputClass}
          value={String(args[key] ?? "")}
          onChange={(event) => change(key, event.target.value || null)}
        />
      </label>
    );
  }
  function target() {
    return (
      <label className="block text-sm text-zinc-300">
        Существующая задача
        <select
          className={captureInputClass}
          value={
            tasks.some((task) => task.id === args.taskId)
              ? String(args.taskId)
              : ""
          }
          onChange={(event) => {
            const selected = tasks.find(
              (task) => task.id === event.target.value,
            );
            setDraft(
              (old) =>
                ({
                  ...old,
                  args: {
                    ...old.args,
                    taskId: selected?.id ?? null,
                    expectedUpdatedAt: selected?.updatedAt ?? null,
                    title:
                      old.kind === "task.update" && old.args.title.trim()
                        ? old.args.title
                        : (selected?.title ?? ""),
                  },
                }) as CaptureActionPayload,
            );
            onDirtyChange(true);
          }}
        >
          <option value="">Выбери задачу из твоего LifeOS</option>
          {tasks.map((task) => (
            <option key={task.id} value={task.id}>
              {task.title}
              {task.status === "done" ? " · завершена" : ""}
            </option>
          ))}
        </select>
      </label>
    );
  }
  let fields: ReactNode;
  switch (draft.kind) {
    case "task.create":
      fields = (
        <>
          {text("title", "Название задачи", false, 240)}
          {text("notes", "Заметки", true)}
          {instant("dueAt", "Срок, если известен")}
        </>
      );
      break;
    case "task.update":
      fields = (
        <>
          {target()}
          {text("title", "Новое название", false, 240)}
          {text("notes", "Заметки задачи", true)}
          {instant("dueAt", "Срок, если известен")}
        </>
      );
      break;
    case "task.complete":
      fields = (
        <>
          {target()}
          <p className="text-xs text-amber-100">
            Подтверждай завершение только фактически выполненной задачи.
          </p>
        </>
      );
      break;
    case "reminder.create":
      fields = (
        <>
          {text("title", "Текст напоминания", false, 240)}
          {instant("remindAt", "Когда напомнить")}
        </>
      );
      break;
    case "planning.suggest":
      fields = (
        <>
          {day()}
          {text("title", "Занятие", false, 240)}
          {text("notes", "Пожелания и ограничения", true)}
          {clock("time", "Предпочтительное время, необязательно")}
          <p className="text-xs text-zinc-400">
            Предложение не изменяет календарь и не означает выполнение.
          </p>
        </>
      );
      break;
    case "study.record":
      fields = (
        <>
          {day()}
          {text("topic", "Тема учёбы", false, 240)}
          {number("minutes", "Продолжительность, минуты", 900, "1")}
          {text("notes", "Заметки об учёбе", true)}
          <label className="block text-sm text-zinc-300">
            Направление
            <select
              className={captureInputClass}
              value={String(args.category)}
              onChange={(event) => change("category", event.target.value)}
            >
              {[
                ["programming", "Программирование"],
                ["english", "Английский"],
                ["cybersecurity", "Кибербезопасность"],
                ["science", "Наука"],
                ["other", "Другое"],
              ].map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm text-zinc-300">
            Статус занятия
            <select
              className={captureInputClass}
              value={args.completed === null ? "" : String(args.completed)}
              onChange={(event) =>
                change(
                  "completed",
                  event.target.value === ""
                    ? null
                    : event.target.value === "true",
                )
              }
            >
              <option value="">Уточни фактический статус</option>
              <option value="true">Занятие фактически завершено</option>
              <option value="false">Занятие ещё не завершено</option>
            </select>
          </label>
        </>
      );
      break;
    case "learning.note":
      fields = (
        <>
          {day()}
          {text("topic", "Тема заметки", false, 240)}
          {text("content", "Учебная заметка", true)}
        </>
      );
      break;
    case "meal.record":
      fields = (
        <>
          {day()}
          {text("label", "Что было съедено", false, 240)}
          {clock("mealTime", "Время приёма пищи, если известно")}
          {text("portion", "Порция, если известна", false, 240)}
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            {number("caloriesKcal", "Калории, ккал", 10000)}
            {number("proteinG", "Белки, г", 400)}
            {number("fatG", "Жиры, г", 1000)}
            {number("carbsG", "Углеводы, г", 2000)}
          </div>
          <label className="flex min-h-11 items-center gap-3 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={args.estimated === true}
              onChange={(event) => change("estimated", event.target.checked)}
              className="h-5 w-5 accent-cyan-300"
            />
            Значения являются оценкой
          </label>
          <p className="text-xs text-zinc-400">
            Неизвестные значения остаются пустыми; LifeOS не запишет их как
            нули.
          </p>
        </>
      );
      break;
    case "water.log":
      fields = number("amountMl", "Количество воды, мл", 5000, "1");
      break;
    case "workout.note":
      fields = (
        <>
          {day()}
          {text("content", "Заметка о тренировке", true)}
          <p className="text-xs text-zinc-400">
            Заметка не отмечает тренировку выполненной.
          </p>
        </>
      );
      break;
    case "reflection.add":
      fields = (
        <>
          {day()}
          {text("content", "Текст рефлексии", true)}
        </>
      );
      break;
    case "filming.idea":
      fields = (
        <>
          {day()}
          {text("content", "Идея для документального фильма", true)}
          <p className="text-xs text-zinc-400">
            Идея не означает, что материал уже снят.
          </p>
        </>
      );
      break;
    case "note.save":
      fields = (
        <>
          {text("title", "Заголовок заметки", false, 240)}
          {text("content", "Личная заметка", true)}
        </>
      );
      break;
    case "question.read":
      fields = (
        <>
          {text("text", "Вопрос к существующим данным LifeOS", true)}
          <label className="block text-sm text-zinc-300">
            Разрешённый источник ответа
            <select
              className={captureInputClass}
              value={draft.args.tool?.tool ?? ""}
              onChange={(event) =>
                change(
                  "tool",
                  event.target.value
                    ? {
                        tool: event.target.value as AssistantToolName,
                        args: {},
                      }
                    : null,
                )
              }
            >
              <option value="">Выбери источник</option>
              {[
                ["classes.today", "Занятия сегодня"],
                ["classes.tomorrow", "Занятия завтра"],
                ["classes.next", "Следующее занятие"],
                ["study.deadlines", "Учебные сроки"],
                ["productivity.tasks", "Мои задачи"],
                ["productivity.calendar", "Обязательства календаря"],
                ["productivity.availability", "Свободное время"],
              ].map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-zinc-400">
            Вопрос не даёт разрешения на изменение данных или передачу
            провайдеру.
          </p>
        </>
      );
      break;
    case "memory.remember":
    case "memory.update":
      fields = (
        <>
          {text("key", "Ключ памяти", false, 80)}
          <label className="block text-sm text-zinc-300">
            Тип памяти
            <select
              className={captureInputClass}
              value={String(args.category)}
              onChange={(event) => change("category", event.target.value)}
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
          {text("content", "Что явно сохранить в памяти", false, 1000)}
          <p className="text-xs text-zinc-400">
            Не сохраняй пароли, cookies и ключи. Каждая запись памяти требует
            отдельного подтверждения.
          </p>
        </>
      );
      break;
    case "memory.archive":
    case "memory.delete":
      fields = (
        <>
          {text("key", "Ключ памяти", false, 80)}
          <p className="text-xs text-amber-100">
            {draft.kind === "memory.delete"
              ? "Это безвозвратное удаление выбранной памяти."
              : "Архивированная память не используется как активное предпочтение."}
          </p>
        </>
      );
      break;
  }
  return (
    <form
      className="mt-3 space-y-3 border-t border-white/10 pt-3"
      onSubmit={(event) => {
        event.preventDefault();
        try {
          const parsed = parseCaptureActionPayload(draft);
          void onSave(parsed).catch(() => {});
        } catch {
          setError(
            "Проверь поля, даты и значения. Пароли, cookies и ключи нельзя сохранять в памяти.",
          );
        }
      }}
    >
      <fieldset disabled={busy} className="min-w-0 space-y-3">
        <label className="block text-sm text-zinc-300">
          Тип действия
          <select
            className={captureInputClass}
            value={draft.kind}
            onChange={(event) => {
              setDraft(
                emptyCaptureAction(
                  event.target.value as CaptureActionKind,
                  date,
                ),
              );
              onDirtyChange(true);
            }}
          >
            {kinds.map((kind) => (
              <option key={kind} value={kind}>
                {captureActionLabels[kind]}
              </option>
            ))}
          </select>
        </label>
        {fields}
        {error ? (
          <p role="alert" className="text-sm text-rose-100">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            className={captureButtonClass}
            disabled={busy || error !== null}
          >
            Сохранить предложение
          </button>
          <button
            type="button"
            className={captureButtonClass}
            onClick={onCancel}
          >
            Отменить редактирование
          </button>
        </div>
      </fieldset>
    </form>
  );
}
