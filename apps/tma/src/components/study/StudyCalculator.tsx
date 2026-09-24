import { AlertTriangle, Calculator, Save } from "lucide-react";
import {
  calculateStudyScenario,
  type StudyCalculatorState,
} from "../../../../../packages/core/src/study.js";
import type { StudyWorkspaceCourse } from "../../api/study";
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
      <p className="text-xs leading-relaxed text-zinc-400">
        Расчёт по твоему учебному плану. Порог каждой аттестации:{" "}
        {state.definition.attestationThreshold}. Официальную оценку определяет
        университет.
      </p>
    </section>
  );
}

export function StudyCalculator({
  course,
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
