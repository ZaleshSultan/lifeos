import { useState } from "react";
import { resolveStudyCalculator } from "../../../../../packages/core/src/study-syllabi.js";
import {
  studyEvidenceBelongsToCourse,
  studyEvidenceIsAggregate,
  studyEvidenceIsMocked,
  studyEvidencePeriodTotal,
} from "../../../../../packages/core/src/study-evidence.js";
import {
  validateScholarshipConfig,
  type ScholarshipConfig,
} from "../../../../../packages/core/src/scholarship.js";
import type { StudyWorkspaceCourse } from "../../api/study";
import type { AcademicRecord } from "../../api/types";

/** Explicit fallback for custom Moodle names; built-in DBMS mapping needs no configuration. */
export function GradeBindings({
  course,
  records,
  config,
  onChange,
}: {
  course: StudyWorkspaceCourse;
  records: AcademicRecord[];
  config: ScholarshipConfig;
  onChange: (config: ScholarshipConfig) => void;
}) {
  const fields =
    resolveStudyCalculator(course)?.definition.fields.filter(
      (field) => field.period !== "exam",
    ) ?? [];
  const [fieldId, setFieldId] = useState(fields[0]?.id ?? "");
  const [mode, setMode] = useState<"aggregate" | "weighted">("aggregate");
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const own = records.filter(
    (row) =>
      studyEvidenceBelongsToCourse(row, course) &&
      !studyEvidenceIsMocked(row) &&
      !studyEvidencePeriodTotal(row) &&
      !/calculated grade register/i.test(row.title),
  );
  const apply = () => {
    const entries = Object.entries(selected)
      .filter(([, weight]) => weight.trim())
      .map(([recordId, weight]) => ({
        recordId,
        weight: Number(weight.replace(",", ".")),
      }));
    if (
      !confirmed ||
      entries.length < 1 ||
      (mode === "aggregate" && entries.length !== 1) ||
      entries.some(
        (entry) => !Number.isFinite(entry.weight) || entry.weight <= 0,
      ) ||
      Math.abs(entries.reduce((sum, e) => sum + e.weight, 0) - 100) > 1e-7
    ) {
      setError(
        "Выберите один готовый итог с весом 100% или отдельные работы с суммой весов 100% и подтвердите правило.",
      );
      return;
    }
    const used = new Set(
      Object.entries(config.bindings)
        .filter(([id]) => id !== fieldId)
        .flatMap(([, binding]) => binding.entries.map((e) => e.recordId)),
    );
    if (entries.some((e) => used.has(e.recordId))) {
      setError("Эта оценка уже связана с другим компонентом.");
      return;
    }
    const next: ScholarshipConfig = {
      ...config,
      bindings: {
        ...config.bindings,
        [fieldId]: { mode, ruleConfirmed: true, entries },
      },
    };
    if (!validateScholarshipConfig(next)) {
      setError(
        "Слишком много сопоставлений или недопустимые веса. Максимум 20 компонентов и 60 связанных работ.",
      );
      return;
    }
    onChange(next);
    setError("");
  };
  return (
    <details className="rounded-xl border border-white/10 p-3">
      <summary className="min-h-11 cursor-pointer text-sm text-cyan-200">
        Сопоставление оценок Moodle
      </summary>
      <p className="my-2 text-xs leading-relaxed text-zinc-400">
        DBMS: Lecture Async 1/2 → Quiz 1/2, Quiz Midterm → Midterm. Async уже
        содержит итог внешней платформы. Отдельные квизы автоматически не
        усредняются. Для других названий выберите готовый итог либо укажите
        реальные веса работ внутри компонента.
      </p>
      <label className="block text-xs text-zinc-300">
        Компонент
        <select
          aria-label="Компонент Moodle"
          className="my-1 min-h-11 w-full rounded-lg bg-graphite-950 px-2"
          value={fieldId}
          onChange={(e) => {
            setFieldId(e.target.value);
            setSelected({});
            setConfirmed(false);
          }}
        >
          {fields.map((field) => (
            <option key={field.id} value={field.id}>
              {field.label} · {field.period.toUpperCase()}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs text-zinc-300">
        Правило
        <select
          aria-label="Правило подсчёта компонента"
          className="my-1 min-h-11 w-full rounded-lg bg-graphite-950 px-2"
          value={mode}
          onChange={(e) => {
            setMode(e.target.value as typeof mode);
            setSelected({});
            setConfirmed(false);
          }}
        >
          <option value="aggregate">Один опубликованный итог компонента</option>
          <option value="weighted">Взвешенные отдельные работы</option>
        </select>
      </label>
      <p className="my-2 text-xs text-zinc-400">
        В режиме суммы баллов вес каждой работы = её максимум / общий максимум ×
        100. Используйте это только если так устроено оценивание курса.
      </p>
      <div className="max-h-72 space-y-2 overflow-auto">
        {own
          .filter(
            (row) => mode === "aggregate" || !studyEvidenceIsAggregate(row),
          )
          .map((row) => (
            <label
              key={row.id}
              className="flex items-center gap-3 text-xs text-zinc-300"
            >
              <span className="min-w-0 flex-1 break-words">
                {row.title} · {row.score ?? "?"}/{row.maxScore ?? "?"}
              </span>
              <input
                aria-label={`Вес ${row.title} внутри компонента, %`}
                className="min-h-11 w-20 rounded-lg bg-graphite-950 px-2 text-base"
                inputMode="decimal"
                value={selected[row.id] ?? ""}
                placeholder="Вес %"
                onChange={(e) =>
                  setSelected(
                    mode === "aggregate"
                      ? { [row.id]: e.target.value }
                      : { ...selected, [row.id]: e.target.value },
                  )
                }
              />
            </label>
          ))}
      </div>
      {!own.length ? (
        <p className="text-xs text-zinc-400">
          Нет доступных записей Moodle. Неизвестные оценки остаются пустыми.
        </p>
      ) : null}
      <label className="my-3 flex min-h-11 items-center gap-2 text-xs text-zinc-300">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        Я проверил правило и веса по реальному оцениванию курса
      </label>
      <button
        type="button"
        className="min-h-11 rounded-lg bg-cyan-300/10 px-3 text-sm text-cyan-200"
        disabled={!fields.length}
        onClick={apply}
      >
        Применить сопоставление
      </button>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-amber-200">
          {error}
        </p>
      ) : null}
      {Object.entries(config.bindings).map(([id, binding]) => (
        <div
          className="mt-2 flex items-center gap-2 text-xs text-zinc-400"
          key={id}
        >
          <span>
            {fields.find((f) => f.id === id)?.label ?? id} · {id} ·{" "}
            {binding.mode === "aggregate"
              ? "готовый итог"
              : `${binding.entries.length} работ`}
          </span>
          <button
            type="button"
            className="min-h-11 px-2 text-amber-200"
            onClick={() => {
              const next = { ...config.bindings };
              delete next[id];
              onChange({ ...config, bindings: next });
            }}
          >
            Снять связь
          </button>
        </div>
      ))}
    </details>
  );
}
