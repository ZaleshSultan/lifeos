import {
  ACADEMIC_TIMEZONE,
  type AcademicOverview,
} from "./academic-concierge.js";
import type { GradeEventFeed } from "./academic-intelligence.js";

export interface AcademicCourseRisk {
  courseId: string;
  title: string;
  target: number;
  maximumFinal: number;
  requiredRemainingAverage: number | null;
  confirmed: boolean;
}
export interface AcademicHomeRow {
  key: string;
  courseId: string | null;
  title: string;
  detail: string;
  tab: "grades" | "calculator" | "concierge" | "work";
  academicTab?: "exams" | "personal";
}
/** UI-only references: never creates delivery jobs, receipts or read markers. */
export function buildAcademicHome(input: {
  feed: GradeEventFeed | null;
  concierge: AcademicOverview | null;
  risks: AcademicCourseRisk[];
  now: string;
}) {
  const now = Date.parse(input.now);
  if (!Number.isFinite(now)) throw new RangeError("Invalid briefing clock");
  const dateTime = (instant: string) =>
    new Intl.DateTimeFormat("ru-RU", {
      timeZone: ACADEMIC_TIMEZONE,
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(instant));
  const feed = input.feed;
  const lastSync = Date.parse(feed?.lms.lastSuccessfulSyncAt ?? "");
  const fresh = Boolean(
    feed?.lms.configured &&
    !feed.lms.stale &&
    Number.isFinite(lastSync) &&
    lastSync >= now - 6 * 3600_000 &&
    lastSync <= now + 300_000,
  );
  const warnings: string[] = [];
  const historyPending = feed?.historyPending === true;
  if (historyPending)
    warnings.push(
      "История оценок ещё обновляется после успешной синхронизации. Новые изменения появятся после проверки; просмотр не отправляет уведомлений.",
    );
  if (!fresh)
    warnings.push(
      "Данные Moodle устарели или недоступны. Это не означает, что оценок и заданий нет.",
    );
  if (feed?.truncated || input.concierge?.truncated)
    warnings.push("Выборка ограничена: обзор не охватывает все записи.");
  if (!input.concierge)
    warnings.push("Подтверждённый календарь временно недоступен.");
  const seen = new Set<string>();
  const grades: AcademicHomeRow[] =
    fresh && !historyPending
      ? (feed?.events ?? [])
          .filter((event) => {
            const at = Date.parse(event.observedAt);
            if (
              seen.has(event.id) ||
              !Number.isFinite(at) ||
              at < now - 24 * 3600_000 ||
              at > now + 300_000
            )
              return false;
            seen.add(event.id);
            return true;
          })
          .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))
          .slice(0, 3)
          .map((event) => ({
            key: event.id,
            courseId: event.courseId,
            title: `${event.courseTitle} · ${event.itemTitle}`,
            detail: `${event.kind === "corrected" ? "Исправлена оценка" : "Новая оценка"}: ${event.newScore}${event.newMaxScore === null ? " баллов; максимум неизвестен" : `/${event.newMaxScore}`}${event.kind === "corrected" && event.oldScore !== null ? ` (было ${event.oldScore}${event.oldMaxScore === null ? "" : `/${event.oldMaxScore}`})` : ""}`,
            tab: "grades",
          }))
      : [];
  const deadlines: AcademicHomeRow[] = fresh
    ? (feed?.eligibleDeadlines ?? [])
        .filter(
          (item) =>
            Number.isFinite(Date.parse(item.dueAt)) &&
            Date.parse(item.dueAt) >= now &&
            Date.parse(item.dueAt) <= now + 7 * 86400_000,
        )
        .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))
        .slice(0, 3)
        .map((item) => ({
          key: item.key,
          courseId: item.courseId,
          title: `${item.courseTitle ?? "Moodle"} · ${item.title}`,
          detail: `${item.kind === "quiz" ? "Тест: подтверждённое закрытие" : "Срок сдачи (не сдано)"} · ${dateTime(item.dueAt)} (${ACADEMIC_TIMEZONE})`,
          tab: "work",
        }))
    : [];
  const exams: AcademicHomeRow[] = (input.concierge?.events ?? [])
    .filter(
      (event) =>
        event.status === "confirmed" &&
        (event.kind === "university_exam" || event.kind === "personal_exam") &&
        event.startsAt !== null &&
        Date.parse(event.startsAt) >= now &&
        Date.parse(event.startsAt) <= now + 14 * 86400_000,
    )
    .sort((a, b) => Date.parse(a.startsAt!) - Date.parse(b.startsAt!))
    .slice(0, 2)
    .map((event) => ({
      key: event.key,
      courseId: null,
      title: event.title,
      detail: `${event.kind === "personal_exam" ? "Личный экзамен" : `Университетский экзамен (${event.sourceTypeCode})`} · ${dateTime(event.startsAt!)} (${ACADEMIC_TIMEZONE})${event.endsAt ? "" : " · длительность неизвестна"}`,
      tab: "concierge",
      academicTab: event.kind === "personal_exam" ? "personal" : "exams",
    }));
  const risks: AcademicHomeRow[] = fresh
    ? input.risks
        .filter(
          (risk) =>
            risk.confirmed &&
            (risk.maximumFinal < risk.target ||
              (risk.requiredRemainingAverage ?? 0) > 90),
        )
        .slice(0, 3)
        .map((risk) => ({
          key: risk.courseId,
          courseId: risk.courseId,
          title: risk.title,
          detail:
            risk.maximumFinal < risk.target
              ? `Цель ${risk.target}/100 недостижима при подтверждённой схеме.`
              : `Для цели ${risk.target}/100 требуется более 90% на оставшихся работах.`,
          tab: "calculator",
        }))
    : [];
  return {
    fresh,
    historyPending,
    lastSuccessfulSyncAt: feed?.lms.lastSuccessfulSyncAt ?? null,
    grades,
    deadlines,
    exams,
    risks,
    warnings,
  };
}
