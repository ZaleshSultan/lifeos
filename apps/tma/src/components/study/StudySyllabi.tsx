import { BookText, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  StudyCalculatorDefinition,
  StudyCalculatorField,
} from "../../../../../packages/core/src/study.js";
import {
  useConfigureStudyCalculatorMutation,
  type StudyWorkspaceCourse,
} from "../../api/study";

type EditablePeriod = "att1" | "att2";

type SyllabusDraft = {
  sourceName: string;
  attestationThreshold: string;
  fields: StudyCalculatorField[];
};

const periodLabels: Record<StudyCalculatorField["period"], string> = {
  att1: "Аттестация 1",
  att2: "Аттестация 2",
  exam: "Экзамен",
};

function draftForCourse(course: StudyWorkspaceCourse): SyllabusDraft {
  const definition = course.calculator?.definition;
  if (definition) {
    return {
      sourceName: definition.sourceName,
      attestationThreshold: String(definition.attestationThreshold),
      fields: definition.fields.map((field) => ({ ...field })),
    };
  }
  return {
    sourceName: `Ручной силабус: ${course.code || course.title}`,
    attestationThreshold: "25",
    fields: [
      {
        id: "att1-total",
        label: "Итог ATT1",
        period: "att1",
        weightPercent: 100,
      },
      {
        id: "att2-total",
        label: "Итог ATT2",
        period: "att2",
        weightPercent: 100,
      },
      {
        id: "exam",
        label: "Экзамен",
        period: "exam",
        weightPercent: 100,
      },
    ],
  };
}

function nextFieldId(period: EditablePeriod, fields: StudyCalculatorField[]) {
  const ids = new Set(fields.map((field) => field.id));
  let index = 1;
  while (ids.has(`${period}-manual-${index}`)) index += 1;
  return `${period}-manual-${index}`;
}

function periodWeight(fields: StudyCalculatorField[], period: EditablePeriod) {
  return fields
    .filter((field) => field.period === period)
    .reduce((sum, field) => sum + field.weightPercent, 0);
}

export function StudySyllabi({ courses }: { courses: StudyWorkspaceCourse[] }) {
  const configure = useConfigureStudyCalculatorMutation();
  const [courseId, setCourseId] = useState(courses[0]?.id ?? "");
  const course = courses.find((item) => item.id === courseId) ?? courses[0];
  const [draft, setDraft] = useState<SyllabusDraft | null>(
    course ? draftForCourse(course) : null,
  );
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!courses.some((item) => item.id === courseId))
      setCourseId(courses[0]?.id ?? "");
  }, [courseId, courses]);

  useEffect(() => {
    if (!course) {
      setDraft(null);
      return;
    }
    setDraft(draftForCourse(course));
    setSaved(false);
  }, [course?.id, course?.calculator?.definition]);

  const validation = useMemo(() => {
    if (!draft) return { error: "Нет курса", att1: 0, att2: 0 };
    const att1 = periodWeight(draft.fields, "att1");
    const att2 = periodWeight(draft.fields, "att2");
    const threshold = Number(draft.attestationThreshold);
    if (!draft.sourceName.trim())
      return { error: "Укажи источник или название силабуса.", att1, att2 };
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100)
      return { error: "Порог аттестации должен быть от 0 до 100.", att1, att2 };
    if (draft.fields.some((field) => !field.label.trim()))
      return { error: "У всех компонентов должно быть название.", att1, att2 };
    if (
      draft.fields.some(
        (field) =>
          !Number.isFinite(field.weightPercent) ||
          field.weightPercent <= 0 ||
          field.weightPercent > 100,
      )
    )
      return { error: "Вес каждого компонента должен быть от 0 до 100.", att1, att2 };
    if (Math.abs(att1 - 100) > 0.000001 || Math.abs(att2 - 100) > 0.000001)
      return {
        error: "Вес компонентов каждой аттестации должен давать ровно 100%.",
        att1,
        att2,
      };
    return { error: null, att1, att2 };
  }, [draft]);

  if (!courses.length) {
    return (
      <p className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 text-sm text-zinc-400">
        Курсы пока не добавлены. Сначала импортируй учебный план.
      </p>
    );
  }

  if (!course || !draft) return null;

  const updateField = (
    id: string,
    patch: Partial<Pick<StudyCalculatorField, "label" | "weightPercent">>,
  ) => {
    setSaved(false);
    setDraft((current) =>
      current
        ? {
            ...current,
            fields: current.fields.map((field) =>
              field.id === id ? { ...field, ...patch } : field,
            ),
          }
        : current,
    );
  };

  const addField = (period: EditablePeriod) => {
    setSaved(false);
    setDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        fields: [
          ...current.fields,
          {
            id: nextFieldId(period, current.fields),
            label: "Новый компонент",
            period,
            weightPercent: 10,
          },
        ],
      };
    });
  };

  const removeField = (id: string, period: EditablePeriod) => {
    if (draft.fields.filter((field) => field.period === period).length <= 1)
      return;
    setSaved(false);
    setDraft((current) =>
      current
        ? { ...current, fields: current.fields.filter((field) => field.id !== id) }
        : current,
    );
  };

  const save = () => {
    if (validation.error) return;
    const definition: StudyCalculatorDefinition = {
      version: 1,
      sourceName: draft.sourceName.trim(),
      attestationThreshold: Number(draft.attestationThreshold),
      fields: draft.fields.map((field) => ({
        ...field,
        label: field.label.trim(),
      })),
    };
    configure.mutate(
      {
        courseId: course.id,
        definition,
        target: course.calculator?.target ?? 70,
      },
      {
        onSuccess: () => setSaved(true),
        onError: () => setSaved(false),
      },
    );
  };

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
        <h2 className="flex items-center gap-2 font-semibold text-white">
          <BookText className="h-5 w-5 text-cyan-400" aria-hidden="true" />
          Силабусы и схема оценивания
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          Настрой компоненты ATT1 и ATT2 по силабусу предмета. Если точной схемы
          ещё нет, базовый вариант позволяет вводить итог ATT1/ATT2 целиком —
          веса отдельных работ не выдумываются.
        </p>
      </section>

      <label className="block text-sm text-zinc-300">
        Предмет
        <select
          className="mt-2 min-h-11 w-full rounded-lg border border-white/[0.12] bg-graphite-900 px-3 py-3 text-base text-white"
          value={course.id}
          onChange={(event) => setCourseId(event.target.value)}
        >
          {courses.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
            </option>
          ))}
        </select>
      </label>

      <section className="space-y-4 rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
        <div>
          <h3 className="font-semibold text-white">{course.title}</h3>
          <p className="mt-1 text-xs text-zinc-500">{course.code}</p>
        </div>

        <label className="block text-sm text-zinc-300">
          Источник / версия силабуса
          <input
            value={draft.sourceName}
            onChange={(event) => {
              setSaved(false);
              setDraft({ ...draft, sourceName: event.target.value });
            }}
            className="mt-2 min-h-11 w-full rounded-lg border border-white/[0.12] bg-graphite-900 px-3 py-2 text-base text-white"
            placeholder="Например: Syllabus OS, Fall 2026"
          />
        </label>

        <label className="block text-sm text-zinc-300">
          Порог аттестации
          <input
            type="number"
            min="0"
            max="100"
            step="1"
            inputMode="decimal"
            value={draft.attestationThreshold}
            onChange={(event) => {
              setSaved(false);
              setDraft({ ...draft, attestationThreshold: event.target.value });
            }}
            className="mt-2 min-h-11 w-full rounded-lg border border-white/[0.12] bg-graphite-900 px-3 py-2 text-base text-white"
          />
        </label>

        {(["att1", "att2"] as const).map((period) => {
          const fields = draft.fields.filter((field) => field.period === period);
          const sum = period === "att1" ? validation.att1 : validation.att2;
          return (
            <div key={period} className="space-y-3 border-t border-white/[0.07] pt-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-zinc-100">{periodLabels[period]}</p>
                  <p className={sum === 100 ? "text-xs text-emerald-300" : "text-xs text-amber-200"}>
                    Сумма весов: {sum}% / 100%
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => addField(period)}
                  className="flex min-h-11 items-center gap-1 rounded-lg border border-white/[0.1] px-3 text-xs font-semibold text-cyan-200"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Добавить
                </button>
              </div>

              {fields.map((field) => (
                <div key={field.id} className="grid grid-cols-[minmax(0,1fr)_78px_44px] gap-2">
                  <input
                    aria-label={`Название компонента ${periodLabels[period]}`}
                    value={field.label}
                    onChange={(event) => updateField(field.id, { label: event.target.value })}
                    className="min-h-11 min-w-0 rounded-lg border border-white/[0.1] bg-graphite-900 px-3 text-sm text-white"
                  />
                  <input
                    aria-label={`Вес ${field.label}`}
                    type="number"
                    min="0.01"
                    max="100"
                    step="0.01"
                    inputMode="decimal"
                    value={field.weightPercent}
                    onChange={(event) =>
                      updateField(field.id, {
                        weightPercent: Number(event.target.value),
                      })
                    }
                    className="min-h-11 min-w-0 rounded-lg border border-white/[0.1] bg-graphite-900 px-2 text-right text-sm tabular-nums text-white"
                  />
                  <button
                    type="button"
                    aria-label={`Удалить ${field.label}`}
                    disabled={fields.length <= 1}
                    onClick={() => removeField(field.id, period)}
                    className="grid min-h-11 place-items-center rounded-lg border border-white/[0.1] text-zinc-400 disabled:opacity-30"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          );
        })}

        <div className="space-y-2 border-t border-white/[0.07] pt-4">
          <p className="font-medium text-zinc-100">Экзамен</p>
          {draft.fields
            .filter((field) => field.period === "exam")
            .map((field) => (
              <div key={field.id} className="grid grid-cols-[minmax(0,1fr)_78px] gap-2">
                <input
                  value={field.label}
                  onChange={(event) => updateField(field.id, { label: event.target.value })}
                  className="min-h-11 min-w-0 rounded-lg border border-white/[0.1] bg-graphite-900 px-3 text-sm text-white"
                />
                <div className="grid min-h-11 place-items-center rounded-lg border border-white/[0.1] bg-white/[0.025] text-sm tabular-nums text-zinc-400">
                  100%
                </div>
              </div>
            ))}
        </div>

        <p className="text-xs leading-relaxed text-zinc-500">
          Итоговая формула LifeOS остаётся 30% ATT1 + 30% ATT2 + 40% экзамен.
          Внутри ATT1 и ATT2 веса выше задаются по силабусу.
        </p>

        {validation.error ? (
          <p className="rounded-lg bg-amber-400/10 px-3 py-2 text-sm text-amber-200" role="alert">
            {validation.error}
          </p>
        ) : null}
        {configure.isError ? (
          <p className="rounded-lg bg-rose-400/10 px-3 py-2 text-sm text-rose-200" role="alert">
            Не удалось сохранить силабус. Обнови данные и попробуй ещё раз.
          </p>
        ) : null}
        {saved ? (
          <p className="text-sm text-emerald-300" role="status">
            Силабус сохранён — калькулятор уже использует эту схему.
          </p>
        ) : null}

        <button
          type="button"
          disabled={Boolean(validation.error) || configure.isPending}
          onClick={save}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-cyan-400 px-4 py-3 text-sm font-semibold text-graphite-950 active:scale-[0.98] disabled:opacity-50"
        >
          <Save className="h-4 w-4" aria-hidden="true" />
          {configure.isPending ? "Сохраняем…" : "Сохранить силабус"}
        </button>
      </section>
    </div>
  );
}
