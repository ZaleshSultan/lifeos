import type { AcademicEventInput } from "../../../../../packages/core/src/academic-concierge.js";
import { academicEventDaysAway } from "../../../../../packages/core/src/academic-concierge.js";

export const academicButton =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-sm font-medium text-zinc-100 transition hover:bg-white/[0.06] active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 disabled:opacity-50";
export const academicInput =
  "mt-1 min-h-11 w-full min-w-0 rounded-lg border border-white/15 bg-graphite-950 px-3 py-2 text-base text-zinc-100 focus:border-cyan-300 disabled:opacity-60";
export const academicPanel =
  "min-w-0 rounded-xl border border-white/[0.08] bg-white/[0.03] p-4";
export const academicKindLabel = {
  university_exam: "Экзамен AITU",
  personal_exam: "Личный экзамен",
  calendar_period: "Учебный период",
  holiday: "Праздничный день",
} as const;
export const academicStatusLabel = {
  proposed: "Ожидает проверки",
  confirmed: "Подтверждено",
  cancelled: "Отменено",
} as const;

export function academicDateTime(
  value: string | null,
  timezone: string,
): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "Время неизвестно";
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      timeZone: timezone,
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(value));
  } catch {
    return "Время неизвестно";
  }
}
export function academicCalendarDate(value: string | null): string {
  if (
    !value ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    return "Дата неизвестна";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value + "T12:00:00Z"));
}
export function academicCountdown(
  event: AcademicEventInput,
  now: string | null,
): string {
  if (!now) return "Отсчёт появится после загрузки";
  if (event.startsAt && Date.parse(event.startsAt) < Date.parse(now))
    return event.endsAt && Date.parse(event.endsAt) < Date.parse(now)
      ? "Указанный срок прошёл; результат неизвестен"
      : "Время начала прошло";
  const days = academicEventDaysAway(event, now);
  return days === null
    ? "Дата не подтверждена"
    : days < 0
      ? "Период уже начался"
      : days === 0
        ? "Сегодня"
        : days === 1
          ? "Завтра"
          : `До начала: ${days} дн.`;
}
export function academicError(
  error: unknown,
  fallback: (error: unknown) => string,
): string {
  if (
    error instanceof Error &&
    error.message === "academic_import_time_ambiguous"
  )
    return "Это местное время повторяется при переводе часов. Укажи точный UTC или смещение в нормализованном JSON либо UTC-время в ICS. Изменения не сохранены.";
  const status =
    error && typeof error === "object" && "status" in error
      ? Number(error.status)
      : null;
  if (status === 409)
    return "Запись или настройки изменились. Твои правки остались на экране: обнови сохранённую версию перед повтором.";
  if (status === 400 || status === 413)
    return "Проверь формат, даты, выбранные записи и размер файла. Изменения не сохранены.";
  return fallback(error);
}
export function academicWarning(code: string): string {
  return (
    (
      {
        academic_source_requires_document_review:
          "Сверь каждую выбранную дату, аудиторию и код с исходным документом.",
        academic_import_does_not_enable_notifications:
          "Импорт не включает уведомления.",
        academic_personal_duration_unknown:
          "Длительность личного экзамена неизвестна и останется незаполненной.",
        academic_schedule_verification_required:
          "Актуальность обычного расписания требует проверки.",
        lms_stale_or_reconnect_required:
          "Данные LMS устарели или требуется повторный вход. Старые данные не доказывают отсутствие заданий.",
      } as Record<string, string>
    )[code] ??
    "Источник содержит дополнительное предупреждение. Проверь исходные данные перед подтверждением."
  );
}
