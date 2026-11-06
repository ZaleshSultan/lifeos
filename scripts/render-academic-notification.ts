/** Fixed local JSON bridge: pure grade engine, no database, credentials or models. */
import { pathToFileURL } from "node:url";
import {
  calculateCourseGradeTarget,
  gradeEvidenceIdentity,
  type CourseGradeTargetInput,
} from "../packages/core/src/grade-target.js";
import { safeAcademicMoodleUrl } from "../packages/core/src/academic-intelligence.js";

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const clean = (v: unknown, max = 500) =>
  typeof v === "string"
    ? v
        .replace(/[\x00-\x1f]/g, " ")
        .trim()
        .slice(0, max)
    : "";
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const number = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
const grade = (score: unknown, maximum: unknown) => {
  const value = number(score),
    max = number(maximum);
  if (value === null) return "не опубликована";
  return max !== null && max > 0
    ? `${value}/${max} (${((value / max) * 100).toFixed(1)}%)`
    : `${value} (максимум не подтверждён)`;
};

export function renderAcademicNotification(candidate: unknown, now: string) {
  const c = object(candidate),
    courseId =
      typeof c.courseId === "string" && UUID.test(c.courseId)
        ? c.courseId
        : null;
  const course = clean(c.courseTitle) || "Курс Moodle";
  const links: Array<{ text: string; url: string }> = [];
  const study = `https://lifeos.zalewko.me/tma/?screen=study${courseId ? `&courseId=${courseId}` : ""}`;
  let message: string;
  if (c.kind === "grade") {
    if (!Array.isArray(c.events) || !c.events.length || c.events.length > 2000)
      throw new Error("invalid_candidate");
    const events = c.events.map(object);
    const lines = [
      events.some((e) => e.kind === "corrected")
        ? "🎓 LIFEOS — ИЗМЕНЕНИЯ ОЦЕНОК"
        : "🎓 LIFEOS — НОВАЯ ОЦЕНКА",
      "",
      `Предмет: ${course}`,
    ];
    for (const e of events.slice(0, 5)) {
      lines.push(
        `Работа: ${clean(e.itemTitle)}`,
        ...(e.kind === "corrected"
          ? [`Было: ${grade(e.oldScore, e.oldMaxScore)}`]
          : []),
        `Новая оценка: ${grade(e.newScore, e.newMaxScore)}`,
        "",
      );
    }
    if (events.length > 5)
      lines.push(`Ещё ${events.length - 5} изменений — в истории курса.`, "");
    const forecast = object(c.forecast);
    let confirmed = false;
    let unavailable = "Получена новая оценка. Точный прогноз на 70 пока недоступен: необходимо подтвердить веса оценивания.";
    if (
      courseId &&
      Array.isArray(forecast.records) &&
      forecast.records.length <= 2000
    ) {
      const insight = calculateCourseGradeTarget({
        ...forecast,
        courseId,
        now,
      } as unknown as CourseGradeTargetInput);
      if (insight.observations.some((observation) => observation.status === "stale"))
        unavailable = "Получена новая оценка. Точный прогноз на 70 пока недоступен: сведения об оценках устарели или время их проверки не подтверждено. Обнови данные Moodle.";
      else {
        const lms = object(forecast.lms);
        const checked = Date.parse(String(lms.lastSuccessfulSyncAt ?? ""));
        const at = Date.parse(now);
        if (lms.configured !== true || lms.stale !== false || !Number.isFinite(checked) || checked > at || at - checked > 6 * 3_600_000)
          unavailable = "Получена новая оценка. Точный прогноз на 70 пока недоступен: свежая успешная проверка Moodle не подтверждена. Обнови источник.";
      }
      const bindings = object(forecast.bindings);
      const mappedVisibleEvents = events.every((event) => {
        const matching = (
          forecast.records as CourseGradeTargetInput["records"]
        ).filter((record) => {
          const identity = gradeEvidenceIdentity(record);
          return (
            identity?.course === event.moodleCourseId &&
            identity?.item === event.moodleItemId &&
            record.score === event.newScore &&
            record.maxScore === event.newMaxScore &&
            object(record.rawJson)._grade_visibility_unknown !== true
          );
        });
        return (
          matching.length === 1 &&
          Object.entries(bindings).some(([fieldId, raw]) => {
            const binding = object(raw);
            return (
              binding.ruleConfirmed === true &&
              Array.isArray(binding.entries) &&
              binding.entries.some(
                (entry) => object(entry).recordId === matching[0].id,
              ) &&
              insight.observations.some(
                (observation) =>
                  observation.fieldId === fieldId &&
                  observation.status === "observed",
              )
            );
          })
        );
      });
      if (
        insight.status === "confirmed" &&
        insight.plan &&
        mappedVisibleEvents
      ) {
        const p = insight.plan;
        confirmed = true;
        lines.push(
          `Цель по предмету: ${p.target}/100`,
          `Заработано итоговых баллов: ${p.earnedFinalPoints.toFixed(2)}/100`,
          `Оставшийся вес: ${p.remainingFinalWeight.toFixed(1)}%`,
          p.requiredAverage === null
            ? p.targetPossible
              ? "Цель достигнута по подтверждённым работам."
              : "Цель недостижима в подтверждённой модели."
            : `Нужный средний результат: ${(Math.ceil(p.requiredAverage * 10 - 1e-9) / 10).toFixed(1)}%`,
          ...p.attestationWarnings.slice(0, 2),
        );
      }
    }
    if (!confirmed) lines.push(unavailable);
    if (courseId)
      links.push(
        { text: "Анализ оценок", url: `${study}&studyTab=grades` },
        { text: "Как получить 70+", url: `${study}&studyTab=calculator` },
      );
    links.push({ text: "Открыть учёбу", url: study });
    message = lines.join("\n");
  } else if (c.kind === "assignment" || c.kind === "quiz") {
    const due = new Date(String(c.targetAt)),
      checked = new Date(String(c.lastSuccessfulSyncAt));
    if (!Number.isFinite(due.getTime()) || !Number.isFinite(checked.getTime()))
      throw new Error("invalid_candidate");
    const offset = number(c.offsetMinutes);
    message = [
      "⏰ LIFEOS — ДЕДЛАЙН",
      "",
      `Предмет: ${course}`,
      `Работа: ${clean(c.title)}`,
      `Тип: ${c.kind === "quiz" ? "тест Moodle (закрытие попыток)" : "задание Moodle"}`,
      offset === null
        ? ""
        : `Напоминание за: ${offset % 60 === 0 ? `${offset / 60} ч` : `${offset} мин`}`,
      `Срок: ${due.toLocaleString("ru-RU", { timeZone: String(c.timezone || "UTC") })} (${c.timezone || "UTC"})`,
      "Статус последней проверки: не сдано",
      "Источник: AITU Moodle",
      `Последняя успешная синхронизация: ${checked.toISOString()}`,
    ]
      .filter(Boolean)
      .join("\n");
    const source = safeAcademicMoodleUrl(c.sourceUrl);
    if (source)
      links.push({
        text: c.kind === "quiz" ? "Открыть Quiz" : "Открыть Assignment",
        url: source,
      });
    links.push(
      { text: "Открыть Study", url: `${study}&studyTab=work` },
      {
        text: "Настройки напоминаний",
        url: "https://lifeos.zalewko.me/tma/?screen=settings&settingsTab=notifications",
      },
    );
  } else throw new Error("invalid_candidate");
  return { message: message.slice(0, 3500), links };
}

async function main() {
  let raw = "";
  for await (const chunk of process.stdin) {
    raw += chunk;
    if (Buffer.byteLength(raw) > 2097152) throw new Error("bounded_input");
  }
  const input = object(JSON.parse(raw));
  if (
    Object.keys(input).some((key) => !["candidate", "now"].includes(key)) ||
    typeof input.now !== "string" ||
    !Number.isFinite(Date.parse(input.now))
  )
    throw new Error("invalid_input");
  process.stdout.write(
    JSON.stringify(renderAcademicNotification(input.candidate, input.now)),
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => {
    process.stderr.write("academic_notification_render_failed\n");
    process.exitCode = 1;
  });
