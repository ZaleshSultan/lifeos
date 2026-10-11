import { useEffect, useState } from "react";
import {
  calculateScholarshipCourse,
  withScholarshipAssignmentAssumption,
  scholarshipConfigsMatch,
  SCHOLARSHIP_KINDS,
  SCHOLARSHIP_SCENARIOS,
  type ScholarshipConfig,
  type ScholarshipScenarioId,
  type ScholarshipWorkInput,
} from "../../../../../packages/core/src/scholarship.js";
import {
  useSaveScholarshipPlanMutation,
  type StudyWorkspaceCourse,
} from "../../api/study";
import type { AcademicRecord } from "../../api/types";
import { cx } from "../../lib/styles";
import { GradeBindings } from "./GradeBindings";
import { ScoreInput } from "./ScoreInput";
import {
  kindLabels,
  reconcileScholarshipDraft,
  riskLabels,
  scholarshipDraftDirty,
  scholarshipScore as score,
  scenarioLabels,
} from "./model";

export function CourseScholarshipCard({
  course,
  records,
  work,
  selected,
  target,
  onOpenCalculator,
  onDraftChange,
}: {
  course: StudyWorkspaceCourse;
  records: AcademicRecord[];
  work: ScholarshipWorkInput[];
  selected: ScholarshipScenarioId;
  target?: number;
  onOpenCalculator: (courseId: string) => void;
  onDraftChange?: (courseId: string, config: ScholarshipConfig) => void;
}) {
  const remote = course.scholarship ?? null;
  const [draft, setDraft] = useState(() =>
    reconcileScholarshipDraft(undefined, remote, course.calculator?.target),
  );
  const [saved, setSaved] = useState(false);
  const save = useSaveScholarshipPlanMutation();
  useEffect(() => {
    setDraft((previous) =>
      reconcileScholarshipDraft(previous, remote, course.calculator?.target),
    );
  }, [remote, course.calculator?.target]);
  const config = draft.config;
  useEffect(() => {
    onDraftChange?.(course.id, config);
  }, [course.id, config, onDraftChange]);
  const change = (next: ScholarshipConfig) => {
    setDraft({ ...draft, config: next });
    setSaved(false);
  };
  const dirty = scholarshipDraftDirty(draft);
  const conflict = !scholarshipConfigsMatch(draft.base, remote);
  const plan = calculateScholarshipCourse(
    { ...course, scholarship: config },
    records,
    { selected, target, work, now: new Date().toISOString() },
  );
  const scenario = config.scenarios[selected];
  const projection = plan.scenarios?.[selected];
  const updateScenario = (next: typeof scenario) =>
    change({ ...config, scenarios: { ...config.scenarios, [selected]: next } });
  return (
    <article
      className={cx(
        "space-y-4 rounded-2xl border bg-[#171e29] p-4",
        plan.risk === "impossible" || plan.risk === "at_risk"
          ? "border-rose-300/30"
          : "border-white/10",
      )}
      aria-label={course.title}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="break-words text-base font-semibold text-white">
            {course.title}
          </h3>
          <p className="mt-1 text-xs text-zinc-400">
            {course.code} · цель {score(plan.target)} · порог{" "}
            {score(plan.threshold)}
          </p>
        </div>
        <span className="shrink-0 text-sm font-semibold text-cyan-200">
          {score(projection?.finalScore ?? null)}
        </span>
      </div>
      <p
        className={cx(
          "text-sm font-semibold",
          plan.risk === "safe" ? "text-emerald-200" : "text-amber-200",
        )}
      >
        {plan.risk === "narrow"
          ? `Малый запас: ${score(plan.threshold)}–74,99`
          : plan.risk === "safe"
            ? `Запас: ${score(Math.max(75, plan.threshold))}+`
            : riskLabels[plan.risk]}
        {!plan.included ? " · исключён из сводки" : ""}
      </p>
      <p className="text-xs text-zinc-400">
        {plan.scholarshipPossible === false
          ? `Даже все оставшиеся работы на 100 не дадут ${score(plan.threshold)}.`
          : plan.scholarshipPossible === true
            ? `Порог ${score(plan.threshold)} математически достижим.`
            : "Без схемы оценивания достижимость неизвестна."}{" "}
        {plan.targetPossible === false && plan.scholarshipPossible !== false
          ? `Выбранная цель ${score(plan.target)} недостижима.`
          : ""}
      </p>
      {plan.configured ? (
        <>
          <dl className="grid grid-cols-3 gap-2 rounded-xl bg-white/[0.035] p-3 text-xs">
            <div>
              <dt className="text-zinc-400">Гарантированный минимум*</dt>
              <dd className="mt-1 text-base tabular-nums text-white">
                {score(plan.minimum)}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-400">Возможный максимум</dt>
              <dd className="mt-1 text-base tabular-nums text-white">
                {score(plan.maximum)}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-400">Среднее на остаток</dt>
              <dd className="mt-1 text-base tabular-nums text-white">
                {score(plan.requiredAverage)}
              </dd>
            </div>
          </dl>
          <p className="text-[11px] leading-relaxed text-zinc-400">
            * Нижняя граница по {plan.confirmedCount} подтверждённым оценкам,
            если за весь остаток получить 0. Это граница расчёта, а не запись
            нулей вместо неизвестных оценок. Максимум предполагает 100 за
            остаток. Среднее взвешено по силабусу для цели {score(plan.target)};
            значение выше 100 означает недостижимость.
          </p>
          <div className="grid grid-cols-3 gap-2">
            {SCHOLARSHIP_SCENARIOS.map((id) => (
              <div
                className={cx(
                  "min-w-0 rounded-lg border p-2",
                  id === selected
                    ? "border-cyan-300/35 bg-cyan-300/5"
                    : "border-white/10",
                )}
                key={id}
              >
                <p className="break-words text-[11px] text-zinc-400">
                  {scenarioLabels[id]}
                </p>
                <p className="mt-1 text-lg tabular-nums text-white">
                  {score(plan.scenarios![id].finalScore)}
                </p>
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-cyan-300/20 bg-cyan-300/5 p-3">
            <p className="text-sm font-semibold text-cyan-100">
              Требуемый Final Exam: {score(projection?.requiredExam ?? null)}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-zinc-300">
              {projection?.requiredExam !== null &&
              projection?.requiredExam !== undefined
                ? `Если экзамен оценивают целыми баллами — минимум ${projection.requiredExamInteger}. `
                : "Укажите все недостающие оценки или итоговые допущения ATT1/ATT2. "}
              При {scenarioLabels[selected].toLowerCase()} сценарии: ATT1 ={" "}
              {score(projection?.att1 ?? null)}, ATT2 ={" "}
              {score(projection?.att2 ?? null)}.{" "}
              {projection?.assumedFields ?? 0} оценок гипотетические.{" "}
              {projection?.requiredExam !== null &&
              projection?.requiredExam !== undefined &&
              projection.requiredExam > 100
                ? "При этих допущениях цели не достичь; улучшите аттестации."
                : ""}
            </p>
          </div>
          {plan.attestationChecks.map((check) => (
            <p
              key={check.period}
              className={cx(
                "text-xs",
                check.matches === false ? "text-amber-200" : "text-emerald-200",
              )}
            >
              {check.period.toUpperCase()}: официальный итог Moodle{" "}
              {score(check.official)}; по компонентам {score(check.calculated)}.{" "}
              {check.matches === true
                ? "Совпадает — агрегат не добавлен повторно."
                : check.matches === null
                  ? "Недостаточно компонентов для сверки."
                  : "Есть расхождение; проверьте сопоставления."}
            </p>
          ))}
          <details className="rounded-xl border border-white/10 p-3">
            <summary className="min-h-11 cursor-pointer text-sm font-semibold text-white">
              Что нужно получить за оставшиеся работы
            </summary>
            <p className="mb-3 text-[11px] leading-relaxed text-zinc-400">
              Каждый ориентир рассчитан отдельно: остальные оценки фиксированы
              по выбранному сценарию. Эти минимумы нельзя одновременно
              подставлять во все работы. Абсолютный минимум предполагает 100 за
              все остальные работы.
            </p>
            <div className="space-y-3">
              {plan.actions.map((action) => (
                <div
                  key={action.fieldId}
                  className="rounded-lg bg-white/[0.035] p-3"
                >
                  <p className="break-words text-sm text-white">
                    {action.label} ·{" "}
                    {plan.evidence
                      .find((row) => row.id === action.fieldId)
                      ?.period.toUpperCase()}
                  </p>
                  <p className="mt-1 text-xs text-zinc-300">
                    Нужно {score(action.requiredUnderScenario)} / 100 при
                    остальных оценках сценария; абсолютный минимум{" "}
                    {score(action.minimumIfOthers100)}.
                  </p>
                  <p className="mt-1 text-xs text-zinc-400">
                    Вес в итоге: {score(action.weightInFinal)}%. Улучшение на 10
                    даёт +{score(action.gainPer10)} к итогу.{" "}
                    {action.requiredUnderScenario !== null &&
                    action.requiredUnderScenario > 100
                      ? "В этом сценарии одной этой работы недостаточно."
                      : ""}
                  </p>
                </div>
              ))}
            </div>
            {!plan.actions.length ? (
              <p className="text-xs text-zinc-400">
                Все компоненты имеют подтверждённую оценку.
              </p>
            ) : null}
          </details>
          <details className="rounded-xl border border-white/10 p-3">
            <summary className="min-h-11 cursor-pointer text-sm text-white">
              Подтверждённые оценки и допущения
            </summary>
            <div className="space-y-3">
              {plan.evidence.map((row) => (
                <div key={row.id} className="text-xs leading-relaxed">
                  <p className="break-words text-zinc-200">
                    {row.label} · {row.period.toUpperCase()} · вес{" "}
                    {score(row.weightInFinal)}% итога
                  </p>
                  <p className="text-zinc-400">
                    Moodle: {score(row.confirmed)}
                    {row.updatedAt
                      ? ` · ${new Date(row.updatedAt).toLocaleString("ru-RU")}`
                      : ""}
                    . Сценарий: {score(projection?.values[row.id] ?? null)}
                    {row.confirmed === null
                      ? " (допущение)"
                      : " (подтверждено)"}
                    .
                    {row.manual !== null
                      ? ` Ручное значение в калькуляторе: ${score(row.manual)}.`
                      : ""}
                  </p>
                </div>
              ))}
            </div>
          </details>
        </>
      ) : null}
      {plan.warnings.map((warning, index) => (
        <p
          key={index}
          role="status"
          className="text-xs leading-relaxed text-amber-200"
        >
          {warning}
        </p>
      ))}
      <details className="rounded-xl border border-white/10 p-3">
        <summary className="min-h-11 cursor-pointer text-sm font-semibold text-cyan-200">
          Изменить сценарии и цель
        </summary>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (save.isPending) return;
            save.mutate(
              { courseId: course.id, config, expectedConfig: draft.base },
              {
                onSuccess: (next) => {
                  setDraft({ config: next, base: next, initial: next });
                  setSaved(true);
                },
              },
            );
          }}
        >
          <fieldset disabled={save.isPending} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <ScoreInput
                label="Личная цель итоговой оценки"
                value={config.target}
                required
                onChange={(value) =>
                  value !== null && change({ ...config, target: value })
                }
              />
              <ScoreInput
                label="Порог для числовой проверки"
                value={config.threshold}
                required
                onChange={(value) =>
                  value !== null && change({ ...config, threshold: value })
                }
              />
            </div>
            <label className="flex min-h-11 items-center gap-2 text-xs text-zinc-300">
              <input
                type="checkbox"
                checked={config.included}
                onChange={(e) =>
                  change({ ...config, included: e.target.checked })
                }
              />
              Учитывать этот предмет в стипендии
            </label>
            <label className="flex min-h-11 items-center gap-2 text-xs text-zinc-300">
              <input
                type="checkbox"
                checked={config.useManualValues}
                onChange={(e) =>
                  change({ ...config, useManualValues: e.target.checked })
                }
              />
              Использовать сохранённые ручные оценки как допущения для
              неизвестных работ
            </label>
            <p className="text-sm font-semibold text-white">
              {scenarioLabels[selected]} сценарий
            </p>
            <p className="text-xs leading-relaxed text-zinc-400">
              Допущения для оставшихся работ. Например, поставьте 70 для
              Assignment, чтобы проверить «все оставшиеся асики на 70».
              Индивидуальные допущения и включённые ручные значения имеют
              приоритет. Пустое допущение оставляет оценку неизвестной.
            </p>
            <button
              type="button"
              className="min-h-11 w-full rounded-lg border border-cyan-300/20 px-3 text-sm text-cyan-200"
              onClick={() =>
                change(
                  withScholarshipAssignmentAssumption(
                    config,
                    selected,
                    plan.evidence,
                    70,
                  ),
                )
              }
            >
              Все оставшиеся Assignments на 70
            </button>
            <p className="text-xs text-zinc-400">
              Эта кнопка задаёт ровно 70 для всех ещё не оценённых заданий
              выбранного сценария. Ранее предполагаемые итоги затронутых
              аттестаций пересчитываются по компонентам; подтверждённые и
              сохранённые ручные оценки не меняются.
            </p>
            <div className="grid grid-cols-2 gap-3">
              {SCHOLARSHIP_KINDS.map((kind) => (
                <ScoreInput
                  key={kind}
                  label={kindLabels[kind]}
                  value={scenario.defaults[kind]}
                  onChange={(value) =>
                    updateScenario({
                      ...scenario,
                      defaults: { ...scenario.defaults, [kind]: value },
                    })
                  }
                />
              ))}
            </div>
            <details>
              <summary className="min-h-11 cursor-pointer text-xs text-cyan-200">
                Допущения об итогах аттестаций
              </summary>
              <p className="mb-3 text-xs text-zinc-400">
                Если общий итог аттестации неизвестен, можно предположить ATT2 =
                80. Подтверждённые компоненты сохраняются, остаток
                распределяется так, чтобы получить указанный итог. Это допущение
                имеет приоритет над остальными прогнозами этой аттестации.
              </p>
              <div className="grid grid-cols-2 gap-3">
                {(["att1", "att2"] as const).map((period) => (
                  <ScoreInput
                    key={period}
                    label={`Предполагаемый итог ${period.toUpperCase()}`}
                    value={scenario.periodTotals[period]}
                    onChange={(value) =>
                      updateScenario({
                        ...scenario,
                        periodTotals: {
                          ...scenario.periodTotals,
                          [period]: value,
                        },
                      })
                    }
                  />
                ))}
              </div>
            </details>
            <details>
              <summary className="min-h-11 cursor-pointer text-xs text-cyan-200">
                Индивидуальные допущения
              </summary>
              <div className="space-y-3">
                {plan.evidence
                  .filter((row) => row.confirmed === null)
                  .map((row) => {
                    const overridden = Object.hasOwn(
                      scenario.overrides,
                      row.id,
                    );
                    return (
                      <div key={row.id}>
                        <label className="block text-xs text-zinc-300">
                          {row.label} · {row.period.toUpperCase()}
                          <select
                            aria-label={`${row.label} · ${row.period.toUpperCase()}: способ допущения`}
                            className="my-1 min-h-11 w-full rounded-lg bg-graphite-950 px-2"
                            value={
                              !overridden
                                ? "default"
                                : scenario.overrides[row.id] === null
                                  ? "unknown"
                                  : "custom"
                            }
                            onChange={(e) => {
                              const overrides = { ...scenario.overrides };
                              if (e.target.value === "default")
                                delete overrides[row.id];
                              else
                                overrides[row.id] =
                                  e.target.value === "unknown" ? null : 70;
                              updateScenario({ ...scenario, overrides });
                            }}
                          >
                            <option value="default">
                              Общее допущение / ручная оценка
                            </option>
                            <option value="unknown">
                              Оставить неизвестным
                            </option>
                            <option value="custom">
                              Своя предполагаемая оценка
                            </option>
                          </select>
                        </label>
                        {overridden && scenario.overrides[row.id] !== null ? (
                          <ScoreInput
                            label="Предполагаемая оценка"
                            value={scenario.overrides[row.id]}
                            onChange={(value) =>
                              updateScenario({
                                ...scenario,
                                overrides: {
                                  ...scenario.overrides,
                                  [row.id]: value,
                                },
                              })
                            }
                          />
                        ) : null}
                      </div>
                    );
                  })}
              </div>
            </details>
            <GradeBindings
              course={course}
              records={records}
              config={config}
              onChange={change}
            />
            <button
              type="submit"
              className="min-h-11 w-full rounded-xl bg-cyan-300/15 px-3 font-semibold text-cyan-100"
              disabled={save.isPending || conflict}
            >
              {save.isPending
                ? "Сохраняем…"
                : "Сохранить три сценария и настройки"}
            </button>
          </fieldset>
          {dirty ? (
            <p className="text-xs text-amber-200">
              Есть несохранённые изменения. Обновление Moodle их не сбрасывает.
            </p>
          ) : null}
          {saved ? (
            <p role="status" className="text-xs text-emerald-200">
              Настройки сохранены.
            </p>
          ) : null}
          {conflict ||
          (save.error &&
            "status" in save.error &&
            save.error.status === 409) ? (
            <div role="alert" className="text-xs text-amber-200">
              <p>
                Настройки изменились в другой сессии. Черновик сохранён на
                экране; обновите данные для проверки. Чтобы принять серверную
                версию, сбросьте черновик.
              </p>
              <button
                type="button"
                className="min-h-11 underline"
                onClick={() => {
                  setDraft(
                    reconcileScholarshipDraft(
                      undefined,
                      remote,
                      course.calculator?.target,
                    ),
                  );
                  save.reset();
                }}
              >
                Принять сохранённые настройки
              </button>
            </div>
          ) : save.isError ? (
            <p role="alert" className="text-xs text-amber-200">
              Не удалось сохранить. Черновик остался на экране; повторите
              попытку.
            </p>
          ) : null}
        </form>
      </details>
      <button
        type="button"
        className="min-h-11 w-full rounded-xl border border-white/15 px-3 text-sm text-zinc-200"
        onClick={() => onOpenCalculator(course.id)}
      >
        Открыть существующий калькулятор и формулу
      </button>
    </article>
  );
}
