import { useCallback, useState } from "react";
import { RefreshCw, GraduationCap } from "lucide-react";
import {
  calculateScholarshipDashboard,
  SCHOLARSHIP_SCENARIOS,
  type ScholarshipScenarioId,
  type ScholarshipConfig,
  scholarshipConfigsMatch,
} from "../../../../packages/core/src/scholarship.js";
import { useStudyQuery } from "../api/study";
import { useLmsWorkQuery } from "../api/lms";
import { ErrorPanel, LoadingPanel } from "../components/AsyncState";
import { CourseScholarshipCard } from "../components/scholarship/CourseScholarshipCard";
import { ScoreInput } from "../components/scholarship/ScoreInput";
import {
  scholarshipScore as score,
  scenarioLabels,
} from "../components/scholarship/model";
import { cx } from "../lib/styles";

export interface ScholarshipPlannerProps {
  onOpenCalculator: (courseId: string) => void;
  onOpenStudy: () => void;
  onOpenLms: () => void;
}
export function ScholarshipPlannerScreen({
  onOpenCalculator,
  onOpenStudy,
  onOpenLms,
}: ScholarshipPlannerProps) {
  const query = useStudyQuery();
  const workQuery = useLmsWorkQuery();
  const [drafts, setDrafts] = useState<Record<string, ScholarshipConfig>>({});
  const onDraftChange = useCallback(
    (courseId: string, config: ScholarshipConfig) =>
      setDrafts((previous) =>
        scholarshipConfigsMatch(previous[courseId] ?? null, config)
          ? previous
          : { ...previous, [courseId]: config },
      ),
    [],
  );
  const [selected, setSelected] = useState<ScholarshipScenarioId>("realistic");
  const [targetMode, setTargetMode] = useState("course");
  const [customTarget, setCustomTarget] = useState(70);
  const target =
    targetMode === "course"
      ? undefined
      : targetMode === "custom"
        ? customTarget
        : Number(targetMode);
  if (query.isLoading)
    return <LoadingPanel title="Считаем план сохранения стипендии…" />;
  if (query.isError)
    return (
      <ErrorPanel
        title="Не удалось загрузить стипендиальный план"
        detail={query.error.message}
        onRetry={() => void query.refetch()}
      />
    );
  if (!query.data)
    return (
      <ErrorPanel
        title="Учебные данные пока недоступны"
        onRetry={() => void query.refetch()}
      />
    );
  const workspace = query.data;
  const work = workQuery.data?.items ?? [];
  const dashboard = calculateScholarshipDashboard(
    workspace.courses.map((course) => ({
      ...course,
      scholarship: drafts[course.id] ?? course.scholarship,
    })),
    workspace.records,
    { target, selected, work, now: new Date().toISOString() },
  );
  const firstAction = dashboard.priorities[0];
  const impossible = dashboard.courses.find(
    (course) => course.included && course.scholarshipPossible === false,
  );
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.05] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-cyan-200">
              Scholarship Survival Planner
            </p>
            <h2 className="mt-1 text-2xl font-semibold text-white">
              Стипендия
            </h2>
          </div>
          <GraduationCap
            className="h-7 w-7 shrink-0 text-cyan-200"
            aria-hidden="true"
          />
        </div>
        <p className="mt-3 text-sm leading-relaxed text-zinc-300">
          По умолчанию цель — 70+ по каждому предмету. Расчёт не гарантирует
          выплату.
        </p>
        {impossible ? (
          <div className="mt-3 rounded-xl border border-rose-300/25 bg-rose-300/5 p-3">
            <p className="text-sm text-amber-100">
              Сначала проверьте {impossible.title}: даже 100 за весь остаток не
              дадут порог {score(impossible.threshold)}. Уточните официальные
              условия и возможность пересдачи.
            </p>
            <button
              type="button"
              className="mt-1 min-h-11 text-xs font-semibold text-cyan-200"
              onClick={() =>
                document
                  .getElementById(`scholarship-${impossible.courseId}`)
                  ?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
            >
              Проверить расчёт предмета
            </button>
          </div>
        ) : firstAction ? (
          <div className="mt-3 rounded-xl border border-cyan-300/20 bg-cyan-300/[0.04] p-3">
            <p className="text-xs font-semibold text-cyan-100">С чего начать</p>
            <p className="mt-1 text-sm text-white">
              {firstAction.courseTitle} · {firstAction.label}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-zinc-300">
              Ориентир {score(firstAction.requiredUnderScenario)} при остальных
              оценках выбранного сценария. +10 за работу → +
              {score(firstAction.gainPer10)} к итогу.
              {firstAction.requiredUnderScenario !== null &&
              firstAction.requiredUnderScenario > 100
                ? " Одной этой работы при текущих допущениях недостаточно."
                : ""}
            </p>
            <button
              type="button"
              className="mt-1 min-h-11 text-xs font-semibold text-cyan-200"
              onClick={() =>
                document
                  .getElementById(`scholarship-${firstAction.courseId}`)
                  ?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
            >
              Открыть план предмета
            </button>
          </div>
        ) : null}
        <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
          <p className="rounded-lg bg-white/5 p-3 text-zinc-200">
            Учитываемых предметов: {dashboard.relevantCount}
          </p>
          <p className="rounded-lg bg-white/5 p-3 text-amber-200">
            Недостижимый порог: {dashboard.impossibleCount}
          </p>
          <p className="rounded-lg bg-white/5 p-3 text-amber-200">
            Риск: {dashboard.atRiskCount} · малый запас: {dashboard.narrowCount}
          </p>
          <p className="rounded-lg bg-white/5 p-3 text-zinc-300">
            Недостаточно данных: {dashboard.unknownCount}
          </p>
        </div>
        <details className="mt-3 text-xs leading-relaxed text-zinc-400">
          <summary className="min-h-11 cursor-pointer">
            Условие стипендии и обновление оценок
          </summary>
          <p>
            Плановое условие: каждый учитываемый активный предмет должен
            завершиться на 70/100 или выше. Порог и список предметов можно
            менять. Отдельно проверьте допуск к экзаменам и остальные правила
            университета. Прогнозы пересчитываются из сохранённых оценок Moodle
            при обновлении экрана, возвращении в приложение и каждые 60 секунд.
            Это не запускает новый вход в Moodle.
          </p>
        </details>
        <button
          type="button"
          className="mt-3 flex min-h-11 items-center gap-2 rounded-lg border border-white/15 px-3 text-sm text-white"
          onClick={() => {
            void query.refetch();
            void workQuery.refetch();
          }}
          disabled={query.isFetching}
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Обновить оценки и прогноз
        </button>
      </section>
      <section
        className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.025] p-4"
        aria-label="Цель и сценарий"
      >
        <div className="block text-sm text-zinc-300">
          <label htmlFor="scholarship-comparison-target">
            Сравнить все предметы с целью
          </label>
          <select
            id="scholarship-comparison-target"
            className="mt-1 min-h-11 w-full rounded-lg bg-graphite-950 px-3 text-base"
            value={targetMode}
            onChange={(e) => setTargetMode(e.target.value)}
          >
            <option value="course">Сохранённая цель каждого предмета</option>
            {[70, 75, 80, 90].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
            <option value="custom">Своё значение</option>
          </select>
        </div>
        {targetMode === "custom" ? (
          <ScoreInput
            label="Общая цель для сравнения"
            value={customTarget}
            required
            onChange={(value) => value !== null && setCustomTarget(value)}
          />
        ) : null}
        <p className="text-xs text-zinc-400">
          Общая цель временно меняет расчёт на этом экране. Сохранённые цели и
          пороги предметов редактируются в их карточках.
        </p>
        <div
          className="grid grid-cols-3 gap-2"
          role="group"
          aria-label="Выбранный сценарий"
        >
          {SCHOLARSHIP_SCENARIOS.map((id) => (
            <button
              key={id}
              type="button"
              className={cx(
                "min-h-11 break-words rounded-lg border px-2 text-xs",
                id === selected
                  ? "border-cyan-300/40 bg-cyan-300/10 text-cyan-100"
                  : "border-white/10 text-zinc-300",
              )}
              aria-pressed={id === selected}
              onClick={() => setSelected(id)}
            >
              {scenarioLabels[id]}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-zinc-400">
          Сводка учитывает текущие черновики карточек. Чтобы использовать их на
          главной и в Telegram, сохраните настройки. Риск в сводке оценивается
          по реалистичному сценарию. Ориентиры работ и экзамена используют
          выбранный сценарий.
        </p>
      </section>
      <section className="rounded-2xl border border-white/10 p-4">
        <h3 className="font-semibold text-white">
          На что потратить время в первую очередь
        </h3>
        <p className="mt-2 text-xs leading-relaxed text-zinc-400">
          Приоритет учитывает доступный прирост итогового балла, близость
          известного дедлайна и риск предмета. Время подготовки неизвестно,
          поэтому это ориентир влияния, а не оценка отдачи за час.
        </p>
        <ol className="mt-3 space-y-3">
          {dashboard.priorities.slice(0, 5).map((action) => (
            <li
              key={action.courseId + action.fieldId}
              className="rounded-lg bg-white/[0.035] p-3"
            >
              <p className="break-words text-sm text-white">
                {action.courseTitle} · {action.label}
              </p>
              <p className="mt-1 text-xs text-zinc-300">
                Ориентир: {score(action.requiredUnderScenario)}. +10 за работу →
                +{score(action.gainPer10)} к итогу.{" "}
                {action.scenarioScore === null
                  ? `Сценарный балл неизвестен; диапазон влияния работы: 0–${score(action.weightInFinal)}.`
                  : `Если улучшить предполагаемые ${score(action.scenarioScore)} до 100, итог вырастет на ${score(action.possibleGain)}.`}
              </p>
              <p className="mt-1 text-xs text-zinc-400">
                {action.dueAt
                  ? `Срок: ${new Date(action.dueAt).toLocaleString("ru-RU", { timeZone: workspace.timezone })}`
                  : "Дедлайн неизвестен — проверьте Moodle."}
              </p>
              <button
                type="button"
                className="mt-2 min-h-11 text-xs font-semibold text-cyan-200"
                onClick={() =>
                  document
                    .getElementById(`scholarship-${action.courseId}`)
                    ?.scrollIntoView({ behavior: "smooth", block: "start" })
                }
              >
                Посмотреть предмет
              </button>
            </li>
          ))}
        </ol>
        {!dashboard.priorities.length ? (
          <p className="mt-3 text-sm text-zinc-400">
            Пока нет достижимых предметов с известной формулой и оставшимися
            работами.
          </p>
        ) : null}
        {workQuery.isError ||
        workQuery.data?.stale ||
        workQuery.data?.truncated ? (
          <p role="status" className="mt-3 text-xs text-amber-200">
            Дедлайны могут быть неполными или устаревшими. Расчёт оценок
            доступен; проверьте сроки в Moodle.
          </p>
        ) : null}
      </section>
      {!workspace.courses.length ? (
        <section className="rounded-xl border border-white/10 p-4">
          <p className="text-sm text-zinc-300">
            Нет активных предметов. Добавьте курсы в разделе «Учёба» и
            подключите Moodle.
          </p>
          <button
            type="button"
            className="mt-3 min-h-11 px-3 text-cyan-200"
            onClick={onOpenStudy}
          >
            Открыть учёбу
          </button>
        </section>
      ) : null}
      {dashboard.courses.map((plan) => {
        const course = workspace.courses.find((c) => c.id === plan.courseId)!;
        return (
          <div
            id={`scholarship-${course.id}`}
            className="scroll-mt-20"
            key={course.id}
          >
            <CourseScholarshipCard
              course={course}
              records={workspace.records}
              work={work}
              selected={selected}
              target={target}
              onOpenCalculator={onOpenCalculator}
              onDraftChange={onDraftChange}
            />
          </div>
        );
      })}
      <p className="px-1 text-xs leading-relaxed text-zinc-400">
        Итог = ATT1 × 0,30 + ATT2 × 0,30 + Exam × 0,40. Веса работ внутри
        аттестаций берутся из существующего силабуса или вашей формулы. На
        экране показаны два знака после запятой; достижимость проверяется до
        округления.
      </p>
      <button
        type="button"
        className="min-h-11 w-full rounded-xl border border-white/15 px-3 text-sm text-zinc-200"
        onClick={onOpenLms}
      >
        Проверить подключение и синхронизацию Moodle
      </button>
    </div>
  );
}
