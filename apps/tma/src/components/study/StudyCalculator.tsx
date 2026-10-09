import { AlertTriangle, Save } from "lucide-react";
import { useState } from "react";
import {
  calculateStudyScenario,
  type StudyCalculatorState,
  type StudyScenarioOptions,
} from "../../../../../packages/core/src/study.js";
import type { StudyWorkspaceCourse } from "../../api/study";
import { cx } from "../../lib/styles";
import {
  parseStudyDraft,
  studyDraftIsDirty,
  studyScoreLabel,
  studyProvenanceLabel,
  type StudyDraft,
} from "./model";
import {
  studyButtonClass,
  studyInputClass,
  studyPanelClass,
} from "./StudyWorkspacePanels";

const periods = [
  { id: "att1", label: "Аттестация 1" },
  { id: "att2", label: "Аттестация 2" },
  { id: "exam", label: "Final / экзамен" },
] as const;

export function StudyScenarioResult({
  state,
  options = {},
}: {
  state: StudyCalculatorState;
  options?: StudyScenarioOptions;
}) {
  const result = calculateStudyScenario(state, options);
  const weights = state.definition.topLevelWeights ?? {
    att1: 30,
    att2: 30,
    exam: 40,
  };
  const requiredExamScore =
    result.requiredExamScore === null
      ? null
      : Math.ceil((result.requiredExamScore - 1e-9) * 10) / 10;
  return (
    <section
      className="space-y-3 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.04] p-4"
      aria-label="Результат сценария"
      aria-live="polite"
    >
      <h3 className="font-semibold text-white">
        Твой сценарий · цель {studyScoreLabel(state.target)}
      </h3>
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
      <p className="text-sm text-zinc-200">
        Подтверждённая доля итога:{" "}
        <strong className="text-emerald-200">
          {studyScoreLabel(result.guaranteedFinal)} / 100
        </strong>
      </p>
      <p className="text-sm text-zinc-200">
        Прогноз по известным и предполагаемым:{" "}
        <strong>{studyScoreLabel(result.projection)} / 100</strong>
      </p>
      <p className="text-xs leading-relaxed text-zinc-400">
        Итог = ATT1 × {studyScoreLabel(weights.att1 / 100)} + ATT2 ×{" "}
        {studyScoreLabel(weights.att2 / 100)} + Final ×{" "}
        {studyScoreLabel(weights.exam / 100)}. Каждая работа: earned / max × 100
        × вес в группе × вес группы.
      </p>
      <p className="text-sm text-zinc-200">
        Возможный итог:{" "}
        <strong className="tabular-nums">
          {studyScoreLabel(result.minimumFinal)}–
          {studyScoreLabel(result.maximumFinal)}
        </strong>
        . Неизвестные оценки рассматриваются в диапазоне 0–100; ноль
        используется только для нижней границы прогноза.
      </p>
      <div className="rounded-lg border border-white/[0.08] p-3 text-sm text-zinc-200">
        {requiredExamScore === null ? (
          <p className="text-zinc-400">
            Заполни обе аттестации, чтобы узнать необходимый балл на экзамене.
          </p>
        ) : requiredExamScore > 100 ? (
          <p className="text-amber-200">
            Нужно {studyScoreLabel(requiredExamScore)} на экзамене:
            математически недостижимо при текущих допущениях.
          </p>
        ) : (
          <p>
            Нужно на экзамене:{" "}
            <strong className="text-cyan-200">
              {studyScoreLabel(requiredExamScore)} / 100
            </strong>
            <span className="mt-1 block text-xs text-zinc-400">
              Процент округлён вверх до 0,1. Для сырого балла используй
              выбранный компонент ниже.
            </span>
          </p>
        )}
        <p
          className={cx(
            "mt-2",
            result.targetStatus === "impossible"
              ? "text-amber-200"
              : "text-zinc-200",
          )}
        >
          {result.targetStatus === "achieved"
            ? "Цель достигнута при текущих допущениях."
            : result.targetStatus === "impossible"
              ? "Математически недостижимо или нарушены подтверждённые условия допуска."
              : result.eligibilityStatus === "pending"
                ? "По баллам цель возможна; условия допуска ещё не подтверждены."
                : "Цель достижима в пределах этого сценария."}
        </p>
      </div>
      {result.requiredComponents
        .filter((component) => component.fieldId === options.selectedFieldId)
        .map((component) => (
          <div
            key={component.fieldId}
            className="rounded-lg border border-white/[0.08] p-3 text-sm text-zinc-200"
          >
            <p>
              {
                state.definition.fields.find(
                  (field) => field.id === component.fieldId,
                )?.label
              }
              : нужно{" "}
              <strong className="text-cyan-200">
                {studyScoreLabel(component.requiredPoints)} /{" "}
                {studyScoreLabel(component.maxScore)}
              </strong>{" "}
              ({studyScoreLabel(component.requiredPercent)}%)
            </p>
            <p className="mt-1 text-xs text-zinc-400">
              Баллы округлены вверх до достижимого шага. Остальные неизвестные
              приняты за 0 в этом расчёте.
            </p>
            {!component.possible ? (
              <p className="mt-1 text-amber-200">
                Математически недостижимо одним этим компонентом.
              </p>
            ) : null}
          </div>
        ))}
      {result.scenarioRange && options.unknownFieldIds?.length ? (
        <div className="space-y-2 rounded-lg border border-cyan-400/20 p-3 text-sm text-zinc-200">
          <h4 className="font-semibold">Несколько оставшихся работ</h4>
          <p>
            Границы сценария:{" "}
            {studyScoreLabel(result.scenarioRange.minimumFinal)}–
            {studyScoreLabel(result.scenarioRange.maximumFinal)}.
          </p>
          <p>
            {result.scenarioRange.requiredCommonPercent === null
              ? "Работы не выбраны."
              : `Общий необходимый результат: ${studyScoreLabel(result.scenarioRange.requiredCommonPercent)}%.`}
          </p>
          {result.scenarioRange.components.map((component) => (
            <p key={component.fieldId}>
              {
                state.definition.fields.find(
                  (field) => field.id === component.fieldId,
                )?.label
              }
              : {studyScoreLabel(component.requiredPoints)} /{" "}
              {studyScoreLabel(component.maxScore)}
            </p>
          ))}
          <p
            className={
              result.scenarioRange.feasible
                ? "text-emerald-200"
                : "text-amber-200"
            }
          >
            {result.scenarioRange.feasible
              ? "Сценарий укладывается в выбранные диапазоны."
              : "Цель недостижима в выбранных диапазонах или не выполнены условия допуска."}
          </p>
        </div>
      ) : null}
      {result.belowThreshold ? (
        <p className="flex items-start gap-2 rounded-lg bg-amber-400/[0.08] p-3 text-sm text-amber-100">
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
      {result.warnings.map((warning, index) => (
        <p className="text-xs leading-relaxed text-amber-200" key={index}>
          {warning}
        </p>
      ))}
      {result.requirementResults.length ? (
        <ul className="space-y-1 text-xs text-zinc-400">
          {result.requirementResults.map((item) => (
            <li key={item.id}>
              {item.label}:{" "}
              {item.status === "passed"
                ? "выполнено"
                : item.status === "failed"
                  ? "не выполнено"
                  : item.status === "needs_review"
                    ? "нужна проверка"
                    : "нет данных"}
            </li>
          ))}
        </ul>
      ) : null}
      <details>
        <summary className="min-h-11 cursor-pointer py-2 text-sm text-cyan-200">
          Вклад каждого компонента
        </summary>
        <ul className="space-y-2 text-xs text-zinc-300">
          {result.fieldContributions.map((item) => (
            <li className="rounded-lg bg-white/[0.03] p-2" key={item.id}>
              {
                state.definition.fields.find((field) => field.id === item.id)
                  ?.label
              }
              :{" "}
              {item.kind === "unknown"
                ? "не оценено"
                : `${studyScoreLabel(item.normalizedPercent)}% · ${item.kind === "actual" ? "реальная оценка" : "допущение"}`}
              <span className="mt-1 block text-zinc-400">
                Вес в итоге {studyScoreLabel(item.finalWeightPercent)}% · вклад{" "}
                {studyScoreLabel(item.finalContribution)} балла
              </span>
            </li>
          ))}
        </ul>
      </details>
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
  const [selected, setSelected] = useState("");
  const [multi, setMulti] = useState<string[]>([]);
  const [ranges, setRanges] = useState<
    Record<string, { minPercent: number; maxPercent: number }>
  >({});
  const weights = draft.definition.topLevelWeights ?? {
    att1: 30,
    att2: 30,
    exam: 40,
  };
  const unknown = draft.definition.fields.filter(
    (field) => !draft.inputs[field.id],
  );
  const activeMulti = multi.filter((id) =>
    unknown.some((field) => field.id === id),
  );
  const rangesValid = activeMulti.every(
    (id) =>
      !ranges[id] ||
      (ranges[id].minPercent >= 0 &&
        ranges[id].maxPercent <= 100 &&
        ranges[id].maxPercent >= ranges[id].minPercent),
  );
  const options: StudyScenarioOptions = {
    ...(selected && unknown.some((field) => field.id === selected)
      ? { selectedFieldId: selected }
      : {}),
    ...(activeMulti.length
      ? {
          unknownFieldIds: activeMulti,
          ranges: Object.fromEntries(
            activeMulti
              .filter((id) => ranges[id])
              .map((id) => [id, ranges[id]]),
          ),
        }
      : {}),
  };
  const setValue = (id: string, value: string) =>
    onChange({
      ...draft,
      inputs: { ...draft.inputs, [id]: value },
      sources: {
        ...draft.sources,
        [id]:
          draft.kinds?.[id] === "actual"
            ? "manual_confirmed"
            : "manual_scenario",
      },
    });
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (parsed.state && !saving && dirty && !definitionChanged)
          onSave(parsed.state);
      }}
    >
      <section className={studyPanelClass}>
        <h2 className="font-semibold text-white">
          Калькулятор достижения цели
        </h2>
        <p className="mt-2 break-words text-xs text-zinc-400">
          Источник: {draft.definition.sourceName} ·{" "}
          {draft.definition.verification === "verified"
            ? "проверен"
            : "требует ручной проверки"}
        </p>
        <p className="mt-2 text-sm text-zinc-400">
          Реальные результаты и допущения отмечаются отдельно. Неоценённую
          работу оставь пустой.
        </p>
        <label className="mt-3 block text-sm text-zinc-300">
          Цель 0–100
          <input
            className={studyInputClass}
            inputMode="decimal"
            value={draft.target}
            aria-invalid={parsed.targetInvalid}
            onChange={(event) =>
              onChange({ ...draft, target: event.target.value })
            }
          />
        </label>
        {parsed.targetInvalid ? (
          <p className="mt-1 text-xs text-rose-200">Укажи цель от 0 до 100.</p>
        ) : null}
        {(draft.definition.requirements ?? []).some(
          (item) => item.kind === "attendance_minimum",
        ) ? (
          <label className="mt-3 block text-sm text-zinc-300">
            Посещаемость, % (если известна)
            <input
              className={studyInputClass}
              inputMode="decimal"
              value={draft.attendance ?? ""}
              onChange={(event) =>
                onChange({ ...draft, attendance: event.target.value })
              }
            />
          </label>
        ) : null}
      </section>
      {definitionChanged ? (
        <div className="rounded-xl border border-amber-400/20 p-4 text-sm text-amber-200">
          Схема курса изменилась. Проверь новую версию и нажми «Отменить
          изменения», чтобы принять её.
        </div>
      ) : null}
      {Object.keys(course.actualValues ?? {}).length ? (
        <details className={studyPanelClass}>
          <summary className="min-h-11 cursor-pointer text-sm font-semibold text-white">
            Реальные оценки из источников
          </summary>
          <ul className="mt-2 space-y-2 text-sm text-zinc-300">
            {Object.entries(course.actualValues ?? {}).map(([id, value]) => (
              <li key={id}>
                {draft.definition.fields.find((field) => field.id === id)
                  ?.label ?? "Компонент"}
                :{" "}
                {typeof value === "object" && value
                  ? `${studyScoreLabel(value.earned)} / ${studyScoreLabel(value.max)} · ${studyProvenanceLabel(value.source ?? "источник")}`
                  : studyScoreLabel(typeof value === "number" ? value : null)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {periods.map((period) => (
        <fieldset
          key={period.id}
          className={cx(studyPanelClass, "space-y-4")}
          disabled={saving}
        >
          <legend className="px-1 text-sm font-semibold text-white">
            {period.label}
          </legend>
          <p className="text-xs text-zinc-400">
            {weights[period.id]}% итоговой оценки
          </p>
          {draft.definition.fields
            .filter((field) => field.period === period.id)
            .map((field) => (
              <div key={field.id} className="space-y-2">
                <p className="break-words text-sm font-semibold text-zinc-200">
                  {field.label}
                  <span className="mt-1 block text-xs font-normal text-zinc-400">
                    Вес в группе {field.weightPercent}% · в итоге{" "}
                    {studyScoreLabel(
                      (field.weightPercent * weights[period.id]) / 100,
                    )}
                    %
                  </span>
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs text-zinc-400">
                    Набрано
                    <input
                      aria-label={`${field.label}: набрано`}
                      readOnly={course.actualValues?.[field.id] != null}
                      className={cx(
                        studyInputClass,
                        parsed.invalidFields.includes(field.id) &&
                          "border-rose-400",
                      )}
                      inputMode="decimal"
                      placeholder="Не оценено"
                      value={draft.inputs[field.id] ?? ""}
                      onChange={(event) =>
                        setValue(field.id, event.target.value)
                      }
                    />
                  </label>
                  <label className="text-xs text-zinc-400">
                    Из максимума
                    <input
                      aria-label={`${field.label}: максимум`}
                      readOnly={course.actualValues?.[field.id] != null}
                      className={studyInputClass}
                      inputMode="decimal"
                      value={draft.maxima?.[field.id] ?? "100"}
                      onChange={(event) =>
                        onChange({
                          ...draft,
                          maxima: {
                            ...draft.maxima,
                            [field.id]: event.target.value,
                          },
                          pointValues: {
                            ...draft.pointValues,
                            [field.id]: true,
                          },
                          sources: {
                            ...draft.sources,
                            [field.id]:
                              draft.kinds?.[field.id] === "actual"
                                ? "manual_confirmed"
                                : "manual_scenario",
                          },
                        })
                      }
                    />
                  </label>
                </div>
                {course.actualValues?.[field.id] != null ? (
                  <p className="text-xs text-zinc-400">
                    Реальная оценка источника. Ручное изменение доступно на
                    вкладке «Оценки».
                  </p>
                ) : (
                  <label className="block text-xs text-zinc-400">
                    Откуда значение
                    <select
                      aria-label={`${field.label}: происхождение`}
                      className={studyInputClass}
                      value={draft.kinds?.[field.id] ?? "assumed"}
                      onChange={(event) =>
                        onChange({
                          ...draft,
                          kinds: {
                            ...draft.kinds,
                            [field.id]: event.target.value as
                              | "actual"
                              | "assumed",
                          },
                          pointValues: {
                            ...draft.pointValues,
                            [field.id]: true,
                          },
                          sources: {
                            ...draft.sources,
                            [field.id]:
                              event.target.value === "actual"
                                ? "manual_confirmed"
                                : "manual_scenario",
                          },
                        })
                      }
                    >
                      <option value="assumed">Предполагаемая оценка</option>
                      <option value="actual">
                        Реальная оценка, введена вручную
                      </option>
                    </select>
                  </label>
                )}
                {draft.sources?.[field.id] ? (
                  <p className="break-words text-xs text-zinc-400">
                    Источник: {studyProvenanceLabel(draft.sources[field.id])}
                  </p>
                ) : null}
                {parsed.invalidFields.includes(field.id) ? (
                  <p className="text-xs text-rose-200">
                    Набрано должно быть от 0 до максимума; максимум больше 0.
                  </p>
                ) : null}
              </div>
            ))}
        </fieldset>
      ))}
      <section className={cx(studyPanelClass, "space-y-3")}>
        <h3 className="text-sm font-semibold text-white">
          Какие оценки ещё нужны?
        </h3>
        <label className="block text-sm text-zinc-300">
          Один выбранный компонент
          <select
            className={studyInputClass}
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
          >
            <option value="">Выбери неоценённую работу</option>
            {unknown.map((field) => (
              <option value={field.id} key={field.id}>
                {field.label}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-zinc-400">
          Или выбери несколько оставшихся работ и задавай допустимые диапазоны
          результата, %.
        </p>
        {unknown.map((field) => (
          <div key={field.id} className="space-y-2">
            <label className="flex min-h-11 items-center gap-3 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={multi.includes(field.id)}
                onChange={(event) =>
                  setMulti((current) =>
                    event.target.checked
                      ? [...current, field.id]
                      : current.filter((id) => id !== field.id),
                  )
                }
              />
              {field.label}
            </label>
            {multi.includes(field.id) ? (
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-zinc-400">
                  Минимум, %
                  <input
                    className={studyInputClass}
                    type="number"
                    min="0"
                    max="100"
                    step="any"
                    value={ranges[field.id]?.minPercent ?? 0}
                    onChange={(event) =>
                      setRanges((current) => ({
                        ...current,
                        [field.id]: {
                          minPercent: Number(event.target.value),
                          maxPercent: current[field.id]?.maxPercent ?? 100,
                        },
                      }))
                    }
                  />
                </label>
                <label className="text-xs text-zinc-400">
                  Максимум, %
                  <input
                    className={studyInputClass}
                    type="number"
                    min="0"
                    max="100"
                    step="any"
                    value={ranges[field.id]?.maxPercent ?? 100}
                    onChange={(event) =>
                      setRanges((current) => ({
                        ...current,
                        [field.id]: {
                          minPercent: current[field.id]?.minPercent ?? 0,
                          maxPercent: Number(event.target.value),
                        },
                      }))
                    }
                  />
                </label>
              </div>
            ) : null}
          </div>
        ))}
        {!unknown.length ? (
          <p className="text-xs text-zinc-400">
            Все компоненты заполнены. Очисти оценку, чтобы рассчитать
            необходимый результат.
          </p>
        ) : null}
      </section>
      {parsed.state && rangesValid ? (
        <StudyScenarioResult state={parsed.state} options={options} />
      ) : (
        <p
          className="rounded-xl border border-rose-400/20 p-4 text-sm text-rose-200"
          role="alert"
        >
          Исправь отмеченные оценки и диапазоны 0–100, чтобы увидеть расчёт.
        </p>
      )}
      <div className={studyPanelClass}>
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
              className={cx(studyButtonClass, "mt-2")}
            >
              Обновить данные
            </button>
          </div>
        ) : null}
        <button
          type="submit"
          disabled={!dirty || !parsed.state || saving || definitionChanged}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-cyan-400 px-4 py-3 text-sm font-semibold text-graphite-950 hover:bg-cyan-300 active:scale-[0.98] disabled:opacity-50"
        >
          <Save className="h-4 w-4" aria-hidden="true" />
          {saving ? "Сохраняем…" : "Сохранить сценарий"}
        </button>
        {dirty || definitionChanged ? (
          <button
            type="button"
            disabled={saving}
            onClick={onReset}
            className={cx(studyButtonClass, "mt-2 w-full")}
          >
            Отменить изменения
          </button>
        ) : null}
      </div>
    </form>
  );
}
