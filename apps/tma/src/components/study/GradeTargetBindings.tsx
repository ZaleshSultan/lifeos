import { useEffect, useState } from "react";
import {
  gradeEvidenceIdentity,
  gradeTargetDefinitionKey,
  gradeTargetBindingsKey,
  gradeTargetContextKey,
} from "../../../../../packages/core/src/grade-target.js";
import { useDraftState, useDraftRetention } from "../../lib/retained-draft";
import {
  defaultScholarshipConfig,
  type ScholarshipConfig,
} from "../../../../../packages/core/src/scholarship.js";
import type { StudyWorkspaceCourse } from "../../api/study-types";
import type { AcademicRecord } from "../../api/types";

/** Explicit mapping UI: no label matching, guessed weights or automatic writes. */
export function GradeTargetBindings({
  course,
  records,
  onSave,
  saving,
  error,
}: {
  course: StudyWorkspaceCourse;
  records: AcademicRecord[];
  onSave: (config: ScholarshipConfig) => void;
  saving: boolean;
  error?: string | null;
}) {
  const fields = course.calculator?.definition.fields ?? [];
  const scope = `grade-bindings:${course.id}`;
  const [field, setField] = useDraftState(scope, "field", fields[0]?.id ?? "");
  const [record, setRecord] = useDraftState(scope, "record", "");
  const [confirmed, setConfirmed] = useState(false);
  const [confirmedFor, setConfirmedFor] = useState<string | null>(null);
  const own = records.filter((row) => {
    const identity = gradeEvidenceIdentity(row);
    return (
      identity &&
      `moodle:${identity.course}` === course.externalCourseKey &&
      row.rawJson?._is_mocked !== true
    );
  });
  const config =
    course.scholarship ??
    defaultScholarshipConfig(course.calculator?.target ?? 70);
  useDraftRetention(scope, record !== "");
  const context =
    gradeTargetContextKey({
      externalCourseKey: course.externalCourseKey,
      startsOn: course.startsOn,
      endsOn: course.endsOn,
    }) +
    (course.calculator
      ? gradeTargetDefinitionKey(course.calculator.definition)
      : "") +
    gradeTargetBindingsKey(config.bindings);
  useEffect(() => {
    setConfirmed(false);
  }, [context, course.id]);
  const consentKey = JSON.stringify([context, field, record]);
  const consentValid = confirmed && confirmedFor === consentKey;
  const used = new Set(
    Object.entries(config.bindings)
      .filter(([id]) => id !== field)
      .flatMap(([, binding]) => binding.entries.map((e) => e.recordId)),
  );
  const canSave =
    consentValid &&
    !!record &&
    !used.has(record) &&
    fields.some((row) => row.id === field) &&
    own.some((row) => row.id === record);
  const selectClass =
    "mt-2 min-h-11 w-full min-w-0 rounded-lg border border-white/10 bg-graphite-950 px-3 text-base text-white";
  return (
    <details className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
      <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-white">
        Сопоставить компоненты с Moodle
      </summary>
      <p className="text-xs leading-relaxed text-zinc-400">
        Только стабильный идентификатор курса и элемента. Выбери готовый итог
        одного компонента. Для объединения нескольких работ с разными весами
        используй настройки стипендии. Сохранение связи отменяет предыдущую
        проверку политики.
      </p>
      {!own.length ? (
        <p className="mt-3 text-xs text-amber-200">
          Нет оценок со стабильной связью этого курса. Синхронизируй Moodle и
          проверь привязку курса; совпадения названия недостаточно.
        </p>
      ) : (
        <>
          <label className="mt-3 block text-xs text-zinc-300">
            Компонент силабуса
            <select
              className={selectClass}
              value={field}
              onChange={(e) => {
                setField(e.target.value);
                setConfirmed(false);
              }}
              disabled={saving}
            >
              {fields.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.label} · {row.period} · {row.weightPercent}% периода
                </option>
              ))}
            </select>
          </label>
          <label className="mt-3 block text-xs text-zinc-300">
            Элемент Moodle
            <select
              className={selectClass}
              value={record}
              onChange={(e) => {
                setRecord(e.target.value);
                setConfirmed(false);
              }}
              disabled={saving}
            >
              <option value="">Выбери запись</option>
              {own.map((row) => (
                <option key={row.id} value={row.id} disabled={used.has(row.id)}>
                  {row.title}
                  {used.has(row.id) ? " · уже связан" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-3 flex min-h-11 items-start gap-3 text-xs text-zinc-300">
            <input
              type="checkbox"
              className="mt-1 h-5 w-5 shrink-0"
              checked={consentValid}
              onChange={(e) => {
                setConfirmed(e.target.checked);
                setConfirmedFor(consentKey);
              }}
              disabled={saving}
            />
            Я проверил(а), что выбранная запись — весь итог этого компонента
            (100%), а не дочерняя работа или общий итог, уже учтённый в других
            компонентах.
          </label>
          <button
            type="button"
            disabled={!canSave || saving}
            onClick={() => {
              setConfirmed(false);
              onSave({
                ...config,
                bindings: {
                  ...config.bindings,
                  [field]: {
                    mode: "aggregate",
                    ruleConfirmed: true,
                    entries: [{ recordId: record, weight: 100 }],
                  },
                },
              });
            }}
            className="mt-3 min-h-11 w-full rounded-lg border border-cyan-400/20 px-3 text-sm text-cyan-200 disabled:opacity-50"
          >
            Сохранить проверенную связь
          </button>
        </>
      )}
      <ul className="mt-3 divide-y divide-white/[0.06]">
        {Object.entries(config.bindings).map(([id, binding]) => (
          <li
            key={id}
            className="flex min-w-0 items-center gap-2 py-2 text-xs text-zinc-300"
          >
            <span className="min-w-0 flex-1 break-words">
              {fields.find((row) => row.id === id)?.label ??
                "Устаревший компонент"}{" "}
              · {binding.entries.length} записей
            </span>
            <button
              type="button"
              className="min-h-11 shrink-0 px-2 text-amber-200"
              disabled={saving}
              onClick={() => {
                const bindings = { ...config.bindings };
                delete bindings[id];
                onSave({ ...config, bindings });
              }}
            >
              Снять связь
            </button>
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-rose-200">
          {error}
        </p>
      ) : null}
    </details>
  );
}
