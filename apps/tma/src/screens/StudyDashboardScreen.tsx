import { useState } from "react";
import { ScholarshipPlannerScreen } from "./ScholarshipPlannerScreen";
import {
  ArrowRight,
  BookOpen,
  CalendarClock,
  ChartNoAxesCombined,
  GraduationCap,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Target,
} from "lucide-react";
import { calculateStudyTargetPlan } from "../../../../packages/core/src/study.js";
import {
  resolveStudyCalculator,
  studySyllabusDefinitionMatches,
} from "../../../../packages/core/src/study-syllabi.js";
import { useLmsWorkQuery } from "../api/lms";
import { useStudyQuery, type StudyWorkspaceCourse } from "../api/study";
import type { AcademicRecord } from "../api/types";
import { ErrorPanel, LoadingPanel } from "../components/AsyncState";
import { studyGradeBelongsToCourse } from "../components/study/grade-import";
import { studyScoreLabel } from "../components/study/model";
import { matchSyllabusProfile } from "../components/study/syllabus-profiles";
import { useStudySyllabusProfiles } from "../components/study/useStudySyllabusProfiles";

interface Props {
  onOpenCalculator: (courseId: string) => void;
  onOpenStudy: () => void;
  onOpenLms: () => void;
}

function gradeInsight(record: AcademicRecord): string {
  const raw = record.rawJson?._lifeos_grade_analysis;
  if (
    raw &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    "summary" in raw &&
    typeof raw.summary === "string"
  )
    return raw.summary;
  if (record.score === null) return "Оценка ещё не опубликована; это не ноль.";
  return "Анализ появится после следующего обновления оценок.";
}

function CourseForecast({
  course,
  records,
  onOpenCalculator,
}: {
  course: StudyWorkspaceCourse;
  records: AcademicRecord[];
  onOpenCalculator: (courseId: string) => void;
}) {
  const profile = matchSyllabusProfile(course.title, course.code);
  const state = resolveStudyCalculator(course);
  const confirmed =
    profile &&
    state &&
    studySyllabusDefinitionMatches(state.definition, profile.definition);
  const plan = state ? calculateStudyTargetPlan(state) : null;
  const lastGrade = records
    .filter((item) => item.score != null && item.rawJson?._is_mocked !== true)
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))[0];

  return (
    <article className="rounded-2xl border border-white/[0.08] bg-[#171e29] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-widest text-emerald-200">
            {confirmed
              ? "Силабус подтверждён"
              : profile && state
                ? "Пользовательская схема"
                : "Схема не подтверждена"}
          </p>
          <h3 className="mt-1 break-words text-base font-bold leading-snug text-white">
            {course.title}
          </h3>
          <p className="mt-1 text-xs text-zinc-400">
            {records.length} записей об оценках
          </p>
        </div>
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-300/10 text-emerald-200">
          <BookOpen className="h-5 w-5" />
        </div>
      </div>
      {plan ? (
        <>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-white/[0.04] p-2">
              <div className="text-[10px] text-zinc-400">Цель</div>
              <div className="mt-1 text-lg font-extrabold text-white">
                {studyScoreLabel(state!.target)}
              </div>
            </div>
            <div className="rounded-xl bg-white/[0.04] p-2">
              <div className="text-[10px] text-zinc-400">Потенциал</div>
              <div className="mt-1 text-lg font-extrabold text-white">
                {studyScoreLabel(plan.maximumFinal)}
              </div>
            </div>
            <div className="rounded-xl bg-white/[0.04] p-2">
              <div className="text-[10px] text-zinc-400">Нужно дальше</div>
              <div className="mt-1 text-lg font-extrabold text-emerald-200">
                {plan.requiredAverage === null
                  ? "—"
                  : studyScoreLabel(plan.requiredAverage)}
              </div>
            </div>
          </div>
          <div
            className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10"
            aria-label="Уже набранные баллы от 100 итоговых"
          >
            <div
              className="h-full rounded-full bg-emerald-300"
              style={{
                width:
                  String(Math.max(0, Math.min(100, plan.earnedFinalPoints))) +
                  "%",
              }}
            />
          </div>
          <p className="mt-2 text-xs leading-relaxed text-zinc-400">
            По сохранённым значениям набрано {studyScoreLabel(plan.earnedFinalPoints)} из
            100; максимально возможно {studyScoreLabel(plan.maximumFinal)}.
            Ручные значения могут быть гипотетическими. Подтверждённый диапазон Moodle — во вкладке «Стипендия». Неизвестные оценки остаются неизвестными.
          </p>
          {!plan.targetPossible ? (
            <p className="mt-2 text-xs font-semibold text-amber-200">
              По текущему сценарию цель недостижима.
            </p>
          ) : plan.missing.length > 0 ? (
            <p className="mt-2 text-xs font-semibold text-emerald-200">
              Осталось {plan.missing.length} оценочных элементов.{" "}
              {plan.requiredAverage !== null && plan.requiredAverage <= 100
                ? "Ориентир по оставшимся работам рассчитан."
                : "Проверь достижимость цели."}
            </p>
          ) : null}
          {plan.attestationWarnings.length ? (
            <p className="mt-2 text-xs text-amber-200">
              {plan.attestationWarnings.join(" ")}
            </p>
          ) : null}
          {plan.missing.length > 0 ? (
            <details className="mt-3 border-t border-white/10 pt-3">
              <summary className="min-h-11 cursor-pointer text-sm font-semibold text-white">
                Ориентиры по работам ({plan.missing.length})
              </summary>
              <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                Каждая строка — отдельный сценарий: сколько нужно за эту работу,
                если все остальные неизвестные оценки будут{" "}
                {studyScoreLabel(plan.target)}/100.
              </p>
              <ul className="mt-2 divide-y divide-white/10">
                {plan.missing.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center justify-between gap-3 py-3"
                  >
                    <div className="min-w-0">
                      <p className="break-words text-sm text-white">
                        {item.label}
                      </p>
                      <p className="mt-0.5 text-[11px] text-zinc-400">
                        {item.period === "att1"
                          ? "Аттестация 1"
                          : item.period === "att2"
                            ? "Аттестация 2"
                            : "Финальный экзамен"}{" "}
                        · {studyScoreLabel(item.weightInFinal)}% итога
                      </p>
                    </div>
                    <strong
                      className={
                        item.requiredIfOthersAtTarget > 100
                          ? "shrink-0 text-sm tabular-nums text-amber-200"
                          : "shrink-0 text-sm tabular-nums text-emerald-200"
                      }
                    >
                      {item.requiredIfOthersAtTarget > 100
                        ? "Недостижимо"
                        : studyScoreLabel(item.requiredIfOthersAtTarget) + "+"}
                    </strong>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      ) : (
        <p className="mt-3 text-sm text-zinc-300">
          Формула не загружена. Открой калькулятор и выбери схему из силабуса
          для расчёта цели.
        </p>
      )}
      {lastGrade ? (
        <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.035] p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
            Последняя оценка
          </p>
          <div className="mt-1 flex items-center justify-between gap-3">
            <span className="min-w-0 break-words text-sm text-white">
              {lastGrade.title}
            </span>
            <strong className="shrink-0 text-sm tabular-nums text-emerald-200">
              {lastGrade.score}
              {lastGrade.maxScore != null ? " / " + lastGrade.maxScore : ""}
            </strong>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-zinc-300">
            {gradeInsight(lastGrade)}
          </p>
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => onOpenCalculator(course.id)}
        className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#2c4442] px-3 text-sm font-bold text-emerald-100"
      >
        Открыть прогноз и калькулятор <ArrowRight className="h-4 w-4" />
      </button>
    </article>
  );
}

export function AcademicDashboardScreen({
  onOpenCalculator,
  onOpenStudy,
  onOpenLms,
}: Props) {
  const study = useStudyQuery();
  const work = useLmsWorkQuery();
  const profiles = useStudySyllabusProfiles(study.data);

  if (study.isLoading)
    return <LoadingPanel title="Собираем учебный дашборд…" />;
  if (study.isError && !study.data)
    return (
      <ErrorPanel
        title="Учебные данные недоступны"
        onRetry={() => void study.refetch()}
      />
    );
  if (!study.data)
    return (
      <ErrorPanel
        title="Пока нет учебных данных"
        onRetry={() => void study.refetch()}
      />
    );

  const courses = profiles.courses;
  const records = study.data.records.filter(
    (record) => record.rawJson?._is_mocked !== true,
  );
  const upcoming =
    work.data?.items.filter((item) => item.category === "upcoming") ?? [];
  const overdue =
    work.data?.items.filter((item) => item.category === "overdue") ?? [];
  const analysed = records.filter((record) => {
    const value = record.rawJson?._lifeos_grade_analysis;
    return value !== null && typeof value === "object" && !Array.isArray(value);
  });
  const latestInsights = [...analysed]
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
    .slice(0, 4);

  return (
    <div className="space-y-4">
      <header className="rounded-[23px] border border-emerald-300/20 bg-gradient-to-br from-[#213e3c] to-[#18232e] p-5">
        <p className="text-[11px] font-bold uppercase tracking-[.15em] text-emerald-200">
          LifeOS · Academic
        </p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-white">
          Учебный дашборд
        </h1>
        <p className="mt-2 text-sm text-zinc-300">
          Прогноз успеваемости, следующие дедлайны и анализ оценок — в одном
          месте.
        </p>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-black/20 p-3 text-center">
            <GraduationCap className="mx-auto h-4 w-4 text-emerald-200" />
            <div className="mt-1 text-xl font-bold">{courses.length}</div>
            <div className="text-[10px] text-zinc-300">курсов</div>
          </div>
          <div className="rounded-xl bg-black/20 p-3 text-center">
            <ChartNoAxesCombined className="mx-auto h-4 w-4 text-emerald-200" />
            <div className="mt-1 text-xl font-bold">
              {records.filter((r) => r.score !== null).length}
            </div>
            <div className="text-[10px] text-zinc-300">оценок</div>
          </div>
          <div className="rounded-xl bg-black/20 p-3 text-center">
            <CalendarClock className="mx-auto h-4 w-4 text-amber-200" />
            <div className="mt-1 text-xl font-bold">
              {work.data ? upcoming.length + overdue.length : "—"}
            </div>
            <div className="text-[10px] text-zinc-300">дел</div>
          </div>
        </div>
      </header>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-bold text-white">
            <Target className="h-5 w-5 text-emerald-200" /> Следующие дедлайны
          </h2>
          <button
            type="button"
            className="text-xs font-semibold text-emerald-200"
            onClick={onOpenStudy}
          >
            Все задачи →
          </button>
        </div>
        {work.data ? (
          [...overdue, ...upcoming].slice(0, 5).length > 0 ? (
            <div className="space-y-2">
              {[...overdue, ...upcoming].slice(0, 5).map((item, index) => (
                <div
                  key={index}
                  className="flex gap-3 rounded-xl border border-white/10 bg-[#171e29] p-3"
                >
                  <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-amber-300" />
                  <div className="min-w-0">
                    <p className="break-words text-sm font-semibold text-white">
                      {item.title}
                    </p>
                    <p className="mt-1 text-xs text-zinc-400">
                      {item.courseTitle ?? "Предмет неизвестен"} ·{" "}
                      {item.dueAt
                        ? new Date(item.dueAt).toLocaleString("ru-RU", {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "Срок неизвестен"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-xl bg-white/[0.04] p-4 text-sm text-zinc-400">
              Подтверждённых ближайших сроков сейчас нет. LMS может содержать
              неполные данные.
            </p>
          )
        ) : (
          <p className="rounded-xl bg-white/[0.04] p-4 text-sm text-zinc-400">
            Нет свежей информации о дедлайнах. Проверь синхронизацию.
          </p>
        )}
        {work.data?.stale || work.data?.truncated ? (
          <p className="text-xs text-amber-200">
            <ShieldAlert className="mr-1 inline h-3.5 w-3.5" /> Данные LMS могут
            быть неполными или устаревшими.
          </p>
        ) : null}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-white">
            Прогноз по предметам
          </h2>
          <button
            type="button"
            onClick={() => {
              void study.refetch();
              void work.refetch();
            }}
            className="grid h-10 w-10 place-items-center rounded-xl bg-white/5 text-zinc-300"
            aria-label="Обновить дашборд"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
        {profiles.pending ? (
          <p role="status" className="text-xs text-zinc-400">
            Сохраняем схемы силабусов…
          </p>
        ) : null}
        {Object.keys(profiles.errors).length > 0 ? (
          <div
            role="alert"
            className="rounded-xl border border-amber-300/20 bg-amber-300/[0.06] p-3"
          >
            <p className="text-xs leading-relaxed text-amber-200">
              Не удалось сохранить некоторые схемы силабусов. Прогноз рассчитан
              по точным заданиям; повтори сохранение.
            </p>
            <button
              type="button"
              onClick={profiles.retry}
              disabled={profiles.pending}
              className="mt-2 min-h-11 rounded-xl bg-white/5 px-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              Повторить сохранение
            </button>
          </div>
        ) : null}
        {courses.length > 0 ? (
          courses.map((course) => (
            <CourseForecast
              key={course.id}
              course={course}
              records={records.filter((record) =>
                studyGradeBelongsToCourse(record, course),
              )}
              onOpenCalculator={onOpenCalculator}
            />
          ))
        ) : (
          <p className="rounded-2xl bg-white/[0.04] p-4 text-sm text-zinc-300">
            В учебном плане пока нет курсов. Сначала добавь их в разделе
            «Учёба».
          </p>
        )}
      </section>

      <section className="space-y-2 rounded-2xl border border-white/[0.08] bg-[#171e29] p-4">
        <h2 className="flex items-center gap-2 text-base font-bold text-white">
          <Sparkles className="h-5 w-5 text-emerald-200" /> Анализ последних
          оценок
        </h2>
        <p className="text-xs leading-relaxed text-zinc-400">
          Короткий анализ создаётся во время синхронизации и сохраняется вместе
          с оценкой. Сравнение идёт с ориентиром 70% за конкретную работу, а не
          с итогом предмета.
        </p>
        {latestInsights.length ? (
          <ul className="divide-y divide-white/10">
            {latestInsights.map((grade) => (
              <li key={grade.id} className="py-3">
                <div className="flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="break-words font-semibold text-white">
                      {grade.title}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-400">
                      {grade.courseTitle}
                    </p>
                  </div>
                  <strong className="shrink-0 tabular-nums text-emerald-200">
                    {grade.percentage == null
                      ? "—"
                      : studyScoreLabel(grade.percentage) + "%"}
                  </strong>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-zinc-300">
                  {gradeInsight(grade)}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-zinc-400">
            Анализ появится после следующей синхронизации оценок обновлённым
            worker.
          </p>
        )}
      </section>
      <button
        type="button"
        onClick={onOpenLms}
        className="min-h-12 w-full rounded-xl border border-white/10 bg-white/5 text-sm font-semibold text-white"
      >
        Настроить подключение Moodle
      </button>
    </div>
  );
}

export function StudyDashboardScreen(props: Props) {
  const [overview,setOverview]=useState(false);
  return <div className="space-y-4"><div className="grid grid-cols-2 gap-2" role="group" aria-label="Учебные дашборды">
    <button type="button" className="min-h-11 rounded-xl border border-white/15 px-3 text-sm text-cyan-200" aria-pressed={!overview} onClick={()=>setOverview(false)}>Стипендия</button>
    <button type="button" className="min-h-11 rounded-xl border border-white/15 px-3 text-sm text-zinc-300" aria-pressed={overview} onClick={()=>setOverview(true)}>Обзор учёбы</button>
    </div>{overview?<AcademicDashboardScreen {...props}/>:<ScholarshipPlannerScreen {...props}/>}</div>;
}
