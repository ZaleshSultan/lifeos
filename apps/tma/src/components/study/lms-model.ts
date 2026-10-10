import type { LmsConnectionState } from "../../api/lms";

export const lmsConnectionLabels: Record<LmsConnectionState, string> = {
  not_configured: "Сессия не подключена",
  legacy_configuration: "Используется прежняя конфигурация",
  connected: "Сессия подключена",
  session_expired: "Сессия истекла",
  reauthentication_required: "Нужен повторный вход",
  syncing: "Идёт синхронизация",
  error: "Ошибка подключения",
};

const featureLabels: Record<string, string> = {
  previous_due_date_retained:
    "Новый срок недоступен. Показан срок из предыдущей синхронизации.",
  previous_opens_at_retained:
    "Новое время открытия недоступно. Сохранено прежнее время.",
  previous_closes_at_retained:
    "Новое время закрытия недоступно. Сохранено прежнее время.",
  grade_link_retained:
    "Оценка не обновилась. Сохранена ранее полученная оценка.",
  grade_status_retained:
    "Новый статус оценивания недоступен. Показан ранее подтверждённый статус.",
  submission_status_retained:
    "Новый статус сдачи недоступен. Показан ранее подтверждённый статус.",
  activity_date_unrecognized:
    "Дата задания или теста не распознана и остаётся неизвестной.",
  submission_status_unknown: "Статус сдачи недоступен на странице LMS.",
  due_date_unknown: "Срок сдачи не указан в доступных данных LMS.",
  grade_html_incomplete: "Страница оценок неполная. Прежние оценки сохранены.",
  html_inventory_not_provably_complete:
    "Полнота списка заданий не подтверждена. Ранее загруженные записи сохранены.",
  session_html_unavailable: "Страницы Moodle недоступны через эту сессию.",
  activity_html_incomplete:
    "Страницы заданий или тестов неполные. Недостающие данные можно добавить вручную.",
};

export function lmsFeatureLabel(feature: string): string {
  return featureLabels[feature] ?? feature;
}

export function lmsDateLabel(
  value: string | null,
  timezone?: string,
  fallback = "Неизвестно",
): string {
  if (!value) return fallback;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Неизвестно";
  return new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

// Read once, immediately wipe the DOM input, and never put this value in state.
export function takeLmsCookie(input: { value: string } | null): string {
  if (!input) return "";
  const cookie = input.value;
  input.value = "";
  return cookie;
}

export function manualDeadlineInstant(value: string): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match)
    throw new Error("Укажи корректные дату и время или оставь срок пустым.");
  const date = new Date(value);
  const parts = [
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
  ];
  if (
    !Number.isFinite(date.getTime()) ||
    parts.some((part, index) => part !== Number(match[index + 1]))
  ) {
    throw new Error(
      "Это время не существует в часовом поясе устройства. Уточни дату или оставь срок пустым.",
    );
  }
  return date.toISOString();
}
