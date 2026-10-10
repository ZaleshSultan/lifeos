import { AlertTriangle, Calculator, Save } from "lucide-react";
import {
  calculateStudyScenario,
  calculateStudyTargetPlan,
  type StudyCalculatorState,
} from "../../../../../packages/core/src/study.js";
import type { StudyWorkspaceCourse } from "../../api/study";
import type { AcademicRecord } from "../../api/types";
import { previewMoodleGrades } from "./grade-import";
import { cx } from "../../lib/styles";
import {
  parseStudyDraft,
  studyDraftIsDirty,
  studyScoreLabel,
  type StudyDraft,
} from "./model";

const inputClass =
  "min-h-11 w-full min-w-0 rounded-lg border border-white/[0.12] bg-graphite-950 px-3 py-2 text-base tabular-nums text-white outline-none focus:border-cyan-400 disabled:opacity-50";
const periods = [
  { id: "att1", label: "Аттестация 1", contribution: "30% итоговой оценки" },
  { id: "att2", label: "Аттестация 2", contribution: "30% итоговой оценки" },
  { id: "exam", label: "Экзамен", contribution: "40% итоговой оценки" },
] as const;

export function StudyScenarioResult({
  state,
}: {
  state: StudyCalculatorState;
}) {
  const result = calculateStudyScenario(state);
  const requiredExamScore =
    result.requiredExamScore === null
      ? null
      : Math.ceil(result.requiredExamScore * 10) / 10;
  return (
    <section
      className="space-y-3 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.04] p-4"
      aria-label="Результат сценария"
      aria-live="polite"
    >
      <h3 className="font-semibold text-white">Твой сценарий</h3>
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: "Аттестация 1", value: result.att1.score },
          { label: "Аттестация 2", value: result.att2.score },
          { label: "Экзамен", value: result.examScore },
          { label: "Итог", value: result.finalScore },
        ].map((metric) => (
          <div
            key={metric.label}
            className="min-w-0 rounded-lg bg-white/[0.03] p-3"
          >
            <p className="text-xs text-zinc-400">{metric.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-white">
              {studyScoreLabel(metric.value)}
            </p>
            {metric.value === null ? (
              <p className="mt-1 text-xs text-zinc-400">Не все баллы введены</p>
            ) : null}
          </div>
        ))}
      </div>
      <p className="text-xs leading-relaxed text-zinc-400">
        Итог = аттестация 1 × 0,3 + аттестация 2 × 0,3 + экзамен × 0,4.
      </p>
      {result.finalScore === null ? (
        <p className="text-sm text-zinc-200">
          Возможный итог:{" "}
          <strong className="tabular-nums">
            {studyScoreLabel(result.minimumFinal)}–
            {studyScoreLabel(result.maximumFinal)}
          </strong>
          . Неизвестные оценки могут быть от 0 до 100.
        </p>
      ) : null}
      <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-3 text-sm text-zinc-200">
        <p>
          Цель: <strong>{studyScoreLabel(state.target)}</strong>
        </p>
        {requiredExamScore === null ? (
          <p className="mt-1 text-zinc-400">
            Заполни обе аттестации, чтобы узнать необходимый балл на экзамене.
          </p>
        ) : requiredExamScore > 100 ? (
          <p className="mt-1 text-amber-200">
            Для этой цели нужно {studyScoreLabel(requiredExamScore)} на экзамене
            — больше 100. Пересмотри баллы аттестаций или цель.
          </p>
        ) : (
          <p className="mt-1">
            Нужно на экзамене:{" "}
            <strong className="text-cyan-200">
              {studyScoreLabel(requiredExamScore)} / 100
            </strong>
          </p>
        )}
        {requiredExamScore !== null && requiredExamScore <= 100 ? (
          <p className="mt-1 text-xs text-zinc-400">
            Необходимый балл округлён вверх до 0,1.
          </p>
        ) : null}
        <p
          className={cx(
            "mt-2 text-xs",
            result.targetStatus === "impossible"
              ? "text-amber-200"
              : "text-zinc-400",
          )}
        >
          {result.targetStatus === "achieved"
            ? "По введённым баллам цель достигнута."
            : result.targetStatus === "impossible"
              ? "При текущих значениях цель недостижима."
              : "Цель достижима в пределах этого сценария."}
        </p>
      </div>
      {result.belowThreshold ? (
        <p className="flex items-start gap-2 rounded-lg border border-amber-400/20 bg-amber-400/[0.08] p-3 text-sm text-amber-100">
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0"
            aria-hidden="true"
          />
          <span>
            Одна из аттестаций ниже {state.definition.attestationThreshold}. В
            загруженном плане для этого случая отмечена пересдача. Уточни
            правило у преподавателя.
          </span>
        </p>
      ) : null}
      <StudyTargetForecast state={state} />
      <p className="text-xs leading-relaxed text-zinc-400">
        Расчёт по твоему учебному плану. Порог каждой аттестации:{" "}
        {state.definition.attestationThreshold}. Официальную оценку определяет
        университет.
      </p>
    </section>
  );
}

/**
 * The forecast is a what-if projection, not a prediction of Moodle results.
 * All future fields stay unknown until explicitly entered by the user.
 */
export function StudyTargetForecast({ state }: { state: StudyCalculatorState }) {
  const plan = calculateStudyTargetPlan(state);
  const value = (score: number | null) =>
    score == null ? "—" : `${studyScoreLabel(score)} / 100`;

  return (
    <div className="mt-4 space-y-3 rounded-2xl border border-emerald-300/20 bg-emerald-300/[0.06] p-4">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[.11em] text-emerald-200">План до цели</p>
        <h4 className="mt-1 text-lg font-bold text-white">Как закрыть предмет на {studyScoreLabel(plan.target)}+</h4>
        <p className="mt-1 text-xs leading-relaxed text-zinc-300">
          Точная формула по весам курса. Будущие оценки не считаются нулями.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-white/[0.05] p-3">
          <p className="text-[11px] text-zinc-400">Уже набрано в итог</p>
          <p className="mt-1 text-xl font-bold tabular-nums text-white">{studyScoreLabel(plan.earnedFinalPoints)}</p>
          <p className="text-[10px] text-zinc-400">из 100 итоговых баллов</p>
        </div>
        <div className="rounded-xl bg-white/[0.05] p-3">
          <p className="text-[11px] text-zinc-400">Нужно в среднем дальше</p>
          <p className="mt-1 text-xl font-bold tabular-nums text-emerald-200">{value(plan.requiredAverage)}</p>
          <p className="text-[10px] text-zinc-400">по оставшемуся весу {studyScoreLabel(plan.remainingFinalWeight)}%</p>
        </div>
      </div>
      <p className="text-sm text-zinc-200">
        Возможный итог: <strong>{studyScoreLabel(plan.minimumFinal)}–{studyScoreLabel(plan.maximumFinal)}</strong>.
      </p>
      {!plan.targetPossible ? (
        <p role="status" className="text-sm font-semibold text-amber-200">
          Цель уже недостижима даже при 100 баллах за все оставшиеся работы.
        </p>
      ) : plan.requiredAverage === null ? (
        <p className="text-sm text-emerald-200">Все оценки введены: расчёт завершён.</p>
      ) : plan.requiredAverage > 100 ? (
        <p role="status" className="text-sm font-semibold text-amber-200">
          Понадобилось бы в среднем больше 100. Измени цель либо проверь исходные оценки.
        </p>
      ) : (
        <p className="text-xs leading-relaxed text-zinc-300">
          Если получишь примерно <strong className="text-emerald-200">{studyScoreLabel(Math.ceil(plan.requiredAverage))}+</strong> за каждую оставшуюся работу, итог достигнет цели (при соблюдении порогов аттестаций).
        </p>
      )}
      {plan.missing.length > 0 ? (
        <details className="border-t border-white/10 pt-3">
          <summary className="min-h-10 cursor-pointer text-sm font-semibold text-white">Что нужно на следующих работах ({plan.missing.length})</summary>
          <p className="mt-2 text-xs text-zinc-400">Для каждой строки показан ориентир, если по всем другим ещё неизвестным работам будет {studyScoreLabel(plan.target)}/100. Это отдельные сценарии, а не требования получить все эти баллы одновременно.</p>
          <ul className="mt-3 divide-y divide-white/10">
            {plan.missing.map((item) => (
              <li className="flex items-center justify-between gap-3 py-3" key={item.id}>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white">{item.label}</p>
                  <p className="text-[11px] text-zinc-400">
                    {item.period === "att1" ? "Аттестация 1" : item.period === "att2" ? "Аттестация 2" : "Экзамен"} · вес в итог {studyScoreLabel(item.weightInFinal)}%
                  </p>
                </div>
                <div className={item.requiredIfOthersAtTarget > 100 ? "shrink-0 text-sm font-bold tabular-nums text-amber-200" : "shrink-0 text-sm font-bold tabular-nums text-emerald-200"}>
                  {studyScoreLabel(item.requiredIfOthersAtTarget)}+
                </div>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {plan.attestationWarnings.map((warning) => (
        <p key={warning} role="status" className="text-xs font-semibold text-amber-200">{warning}</p>
      ))}
      <p className="text-[11px] text-zinc-400">
        Прогноз не является официальной оценкой. Для предметов без явно указанного в силабусе минимального порога проверяй условия допуска отдельно.
      </p>
    </div>
  );
}

export function StudyCalculator({
  course,
  records,
  draft,
  onChange,
  onSave,
  onReset,
  saving,
  saveError,
  saved,
  onRefresh,
}: {
  course: StudyWorkspaceCourse;
  records: AcademicRecord[];
  draft: StudyDraft;
  onChange: (draft: StudyDraft) => void;
  onSave: (state: StudyCalculatorState) => void;
  onReset: () => void;
  saving: boolean;
  saveError: string | null;
  saved: boolean;
  onRefresh: () => void;
}) {
  const parsed = parseStudyDraft(draft);
  const dirty = studyDraftIsDirty(draft);
  const importPreview = previewMoodleGrades(course, draft, records);
  const definitionChanged =
    JSON.stringify(draft.definition) !==
    JSON.stringify(course.calculator?.definition);
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (parsed.state && !saving && dirty && !definitionChanged)
          onSave(parsed.state);
      }}
    >
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
        <h2 className="flex items-center gap-2 font-semibold text-white">
          <Calculator
            className="h-5 w-5 shrink-0 text-cyan-400"
            aria-hidden="true"
          />
          Калькулятор оценок
        </h2>
        <p className="mt-2 break-words text-sm text-zinc-300">{course.title}</p>
        <p className="mt-2 text-xs leading-relaxed text-zinc-400">
          Введи баллы от 0 до 100. Пустое поле означает неизвестную оценку. Это
          отдельный сценарий: оценки из Moodle здесь не изменяются.
        </p>
        <p className="mt-2 break-words text-xs text-zinc-400">
          Схема: {draft.definition.sourceName}
        </p>
        <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.035] p-3">
          <p className="text-xs font-semibold text-white">Импорт оценок из Moodle</p>
          <p className="mt-1 text-xs leading-relaxed text-zinc-400">
            LifeOS подставит только однозначно найденные оценки отдельных работ,
            не перезаписывая ручные значения и не изменяя Moodle.
            Квизы-агрегаты и неоднозначные Midterm не угадываются.
          </p>
          <button
            type="button"
            disabled={saving || definitionChanged || importPreview.matches === 0}
            onClick={() => onChange({
              ...draft,
              inputs: { ...draft.inputs, ...importPreview.updates },
            })}
            className="mt-3 min-h-11 w-full rounded-xl border border-emerald-300/20 bg-emerald-300/10 px-3 text-sm font-semibold text-emerald-200 disabled:opacity-50"
          >
            Подставить подтверждённые оценки ({importPreview.matches})
          </button>
          {importPreview.ambiguous > 0 ? (
            <p className="mt-2 text-xs text-amber-200">
              {importPreview.ambiguous} элементов пропущено: в Moodle несколько возможных оценок.
            </p>
          ) : null}
          <p className="mt-2 text-[11px] text-zinc-400">
            После подстановки проверь числа и нажми «Сохранить сценарий».
          </p>
        </div>
        {definitionChanged ? (
          <p className="mt-3 text-sm text-amber-200" role="alert">
            Схема курса изменилась. Твои значения остались на экране. Нажми
            «Отменить изменения», чтобы загрузить новую схему; текущий черновик
            будет сброшен.
          </p>
        ) : null}
        <label className="mt-4 block text-sm text-zinc-300">
          Целевая итоговая оценка
          <input
            aria-invalid={parsed.targetInvalid}
            aria-describedby={
              parsed.targetInvalid ? "study-target-error" : undefined
            }
            className={cx(
              inputClass,
              "mt-2",
              parsed.targetInvalid && "border-rose-400/60",
            )}
            inputMode="decimal"
            autoComplete="off"
            maxLength={8}
            disabled={saving}
            value={draft.target}
            onChange={(event) =>
              onChange({ ...draft, target: event.target.value })
            }
          />
        </label>
        {parsed.targetInvalid ? (
          <p id="study-target-error" className="mt-1 text-xs text-rose-200">
            Укажи число от 0 до 100.
          </p>
        ) : null}
      </div>
      {periods.map((period) => (
        <fieldset
          key={period.id}
          className="min-w-0 rounded-xl border border-white/[0.08] bg-white/[0.03] p-4"
          disabled={saving}
        >
          <legend className="px-1 text-sm font-semibold text-white">
            {period.label}
          </legend>
          <p className="mb-4 text-xs text-zinc-400">{period.contribution}</p>
          <div className="space-y-4">
            {draft.definition.fields
              .filter((field) => field.period === period.id)
              .map((field) => {
                const invalid = parsed.invalidFields.includes(field.id);
                const inputId = `study-${course.id}-${field.id}`;
                return (
                  <div key={field.id}>
                    <label
                      htmlFor={inputId}
                      className="block break-words text-sm text-zinc-300"
                    >
                      {field.label}
                      <span className="mt-1 block text-xs text-zinc-400">
                        Вес в {period.id === "exam" ? "экзамене" : "аттестации"}
                        : {field.weightPercent}%
                      </span>
                    </label>
                    <input
                      id={inputId}
                      inputMode="decimal"
                      autoComplete="off"
                      maxLength={8}
                      aria-invalid={invalid}
                      aria-describedby={
                        invalid ? `${inputId}-error` : undefined
                      }
                      className={cx(
                        inputClass,
                        "mt-2",
                        invalid && "border-rose-400/60",
                      )}
                      placeholder="Пока неизвестно"
                      value={draft.inputs[field.id] ?? ""}
                      onChange={(event) =>
                        onChange({
                          ...draft,
                          inputs: {
                            ...draft.inputs,
                            [field.id]: event.target.value,
                          },
                        })
                      }
                    />
                    {invalid ? (
                      <p
                        id={`${inputId}-error`}
                        className="mt-1 text-xs text-rose-200"
                      >
                        Укажи число от 0 до 100 или оставь поле пустым.
                      </p>
                    ) : null}
                  </div>
                );
              })}
          </div>
        </fieldset>
      ))}
      {parsed.state ? (
        <StudyScenarioResult state={parsed.state} />
      ) : (
        <p
          className="rounded-xl border border-rose-400/20 bg-rose-400/[0.05] p-4 text-sm text-rose-200"
          role="alert"
        >
          Исправь отмеченные поля, чтобы увидеть расчёт.
        </p>
      )}
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
        <p
          className={cx(
            "mb-3 text-sm",
            dirty ? "text-amber-200" : "text-zinc-400",
          )}
          role="status"
        >
          {saving
            ? "Сохраняем…"
            : dirty
              ? "Есть несохранённые изменения"
              : saved
                ? "Сценарий сохранён"
                : "Все изменения сохранены"}
        </p>
        {saveError ? (
          <div className="mb-3 text-sm text-rose-200" role="alert">
            <p>{saveError}</p>
            <button
              type="button"
              onClick={onRefresh}
              className="mt-2 min-h-11 rounded-lg border border-white/[0.08] px-3 text-zinc-200 hover:bg-white/[0.05] active:scale-[0.98]"
            >
              Обновить данные
            </button>
          </div>
        ) : null}
        <button
          type="submit"
          disabled={!dirty || !parsed.state || saving || definitionChanged}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-cyan-400 px-4 py-3 text-sm font-semibold text-graphite-950 transition-colors hover:bg-cyan-300 active:scale-[0.98] disabled:opacity-50"
        >
          <Save className="h-4 w-4" aria-hidden="true" />
          {saving ? "Сохраняем…" : "Сохранить сценарий"}
        </button>
        {dirty || definitionChanged ? (
          <button
            type="button"
            disabled={saving}
            onClick={onReset}
            className="mt-2 min-h-11 w-full rounded-lg px-3 text-sm text-zinc-300 hover:bg-white/[0.05] active:scale-[0.98] disabled:opacity-50"
          >
            Отменить изменения
          </button>
        ) : null}
      </div>
    </form>
  );
}
