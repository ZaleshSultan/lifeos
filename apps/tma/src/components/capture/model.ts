import { assistantLocalInstant } from "../../../../../packages/core/src/assistant-router.js";
import type {
  CaptureActionKind,
  CaptureActionPayload,
  CaptureActionView,
  CaptureState,
} from "../../../../../packages/core/src/universal-capture.js";

export const captureStateLabels: Record<CaptureState, string> = {
  queued: "Ожидает разбора",
  processing: "Обрабатывается",
  awaiting_transcript: "Нужна расшифровка",
  needs_review: "Нужен твой выбор",
  completed: "Обработано",
  failed: "Нужна повторная попытка",
  cancelled: "Отменено",
};
export const captureActionLabels: Record<CaptureActionKind, string> = {
  "task.create": "Создать задачу",
  "task.update": "Изменить задачу",
  "task.complete": "Завершить задачу",
  "reminder.create": "Добавить напоминание",
  "planning.suggest": "Предложить план",
  "study.record": "Записать учёбу",
  "learning.note": "Добавить учебную заметку",
  "meal.record": "Записать питание",
  "water.log": "Записать воду",
  "workout.note": "Добавить заметку о тренировке",
  "reflection.add": "Добавить рефлексию",
  "filming.idea": "Сохранить идею съёмки",
  "note.save": "Сохранить личную заметку",
  "question.read": "Ответить по данным LifeOS",
  "memory.remember": "Сохранить в память",
  "memory.update": "Изменить память",
  "memory.archive": "Архивировать память",
  "memory.delete": "Удалить память навсегда",
};
export const captureOriginLabels = {
  deterministic: "Правила LifeOS",
  model: "Предложение AI — проверь детали",
  edited: "Отредактировано тобой",
} as const;

export function captureDateTime(
  value: string | null,
  timezone = "Asia/Almaty",
) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Не указано";
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      timeZone: timezone,
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return "Время недоступно";
  }
}

export function localInstantInput(value: string | null, timezone: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return "";
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("sv-SE", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(new Date(value))
        .map((part) => [part.type, part.value]),
    );
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  } catch {
    return "";
  }
}

export function instantFromInput(value: string, timezone: string) {
  if (!value) return null;
  const [date, time] = value.split("T");
  return assistantLocalInstant(date, time, timezone);
}

export function canApproveCaptureAction(action: CaptureActionView) {
  return action.status === "pending" && action.missingFields.length === 0;
}

export function reviewExpired(value: string | null, now = Date.now()) {
  return (
    value === null ||
    !Number.isFinite(Date.parse(value)) ||
    Date.parse(value) <= now
  );
}

export function emptyCaptureAction(
  kind: CaptureActionKind,
  date: string,
): CaptureActionPayload {
  switch (kind) {
    case "task.create":
      return { kind, args: { title: "", notes: "", dueAt: null } };
    case "task.update":
      return {
        kind,
        args: {
          taskId: null,
          expectedUpdatedAt: null,
          title: "",
        },
      };
    case "task.complete":
      return {
        kind,
        args: { taskId: null, expectedUpdatedAt: null, title: "" },
      };
    case "reminder.create":
      return { kind, args: { title: "", remindAt: null } };
    case "planning.suggest":
      return { kind, args: { date, title: "", notes: "", time: null } };
    case "study.record":
      return {
        kind,
        args: {
          date,
          topic: "",
          minutes: null,
          notes: "",
          category: "other",
          completed: null,
        },
      };
    case "learning.note":
      return { kind, args: { date, topic: "", content: "" } };
    case "meal.record":
      return {
        kind,
        args: {
          date,
          label: "",
          caloriesKcal: null,
          proteinG: null,
          fatG: null,
          carbsG: null,
          mealTime: null,
          portion: "",
          estimated: true,
        },
      };
    case "water.log":
      return { kind, args: { amountMl: null } };
    case "workout.note":
    case "reflection.add":
    case "filming.idea":
      return { kind, args: { date, content: "" } };
    case "note.save":
      return { kind, args: { title: "", content: "" } };
    case "question.read":
      return { kind, args: { text: "", tool: null } };
    case "memory.remember":
    case "memory.update":
      return { kind, args: { key: "", category: "preference", content: "" } };
    case "memory.archive":
    case "memory.delete":
      return { kind, args: { key: "" } };
  }
}

/** UI retry identity only. No content is saved in browser storage or sent to a provider. */
export function operationIdentity(
  previous: { payload: string; requestId: string } | null,
  payload: unknown,
) {
  const encoded = JSON.stringify(payload);
  return previous?.payload === encoded
    ? previous
    : { payload: encoded, requestId: crypto.randomUUID() };
}
