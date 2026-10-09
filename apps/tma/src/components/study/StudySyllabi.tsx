import { BookText, Download, Plus, Save, Trash2, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import {
  validateStudyCalculatorDefinition,
  type StudyCalculatorDefinition,
  type StudyCalculatorField,
  type StudyPeriod,
} from "../../../../../packages/core/src/study.js";
import {
  studyApi,
  useStudyWriteMutation,
  type StudyWorkspaceCourse,
} from "../../api/study";
import { cx } from "../../lib/styles";
import {
  studyButtonClass,
  studyInputClass,
  studyPanelClass,
} from "./StudyWorkspacePanels";

const periods: { id: StudyPeriod; label: string }[] = [
  { id: "att1", label: "ATT1" },
  { id: "att2", label: "ATT2" },
  { id: "exam", label: "Final" },
];

function initialDefinition(
  course: StudyWorkspaceCourse,
): StudyCalculatorDefinition {
  if (course.calculator) return structuredClone(course.calculator.definition);
  return {
    version: 1,
    sourceName: `Ручной силлабус: ${course.code || course.title}`,
    attestationThreshold: 0,
    verification: "needs_review",
    topLevelWeights: { att1: 30, att2: 30, exam: 40 },
    fields: [
      {
        id: "att1-total",
        label: "Итог ATT1",
        period: "att1",
        weightPercent: 100,
        maxScore: 100,
      },
      {
        id: "att2-total",
        label: "Итог ATT2",
        period: "att2",
        weightPercent: 100,
        maxScore: 100,
      },
      {
        id: "exam",
        label: "Final",
        period: "exam",
        weightPercent: 100,
        maxScore: 100,
      },
    ],
  };
}

function CourseSyllabus({ course }: { course: StudyWorkspaceCourse }) {
  const upload = useStudyWriteMutation(studyApi.uploadDocument);
  const create = useStudyWriteMutation(studyApi.createScheme);
  const activate = useStudyWriteMutation(studyApi.activateScheme);
  const [draft, setDraft] = useState(() => initialDefinition(course));
  const [documentId, setDocumentId] = useState("");
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const valid = validateStudyCalculatorDefinition(draft);
  const weights = draft.topLevelWeights ?? { att1: 30, att2: 30, exam: 40 };
  const activeScheme = course.gradingSchemes?.find(
    (scheme) => scheme.isActive || scheme.active,
  );
  const edit = (next: StudyCalculatorDefinition) => {
    setDraft({ ...next, verification: "needs_review" });
    setMessage(null);
  };
  const editField = (id: string, patch: Partial<StudyCalculatorField>) =>
    edit({
      ...draft,
      fields: draft.fields.map((field) =>
        field.id === id
          ? { ...field, ...patch, verification: "needs_review" }
          : field,
      ),
    });
  const addField = (period: StudyPeriod) => {
    let counter = 1;
    while (
      draft.fields.some((field) => field.id === `${period}-manual-${counter}`)
    )
      counter += 1;
    edit({
      ...draft,
      fields: [
        ...draft.fields,
        {
          id: `${period}-manual-${counter}`,
          label: "Новый компонент",
          period,
          weightPercent: 10,
          maxScore: 100,
          type: "assignment",
          verification: "needs_review",
        },
      ],
    });
  };
  const removeField = (id: string) =>
    edit({
      ...draft,
      fields: draft.fields.filter((field) => field.id !== id),
      requirements: draft.requirements?.filter(
        (requirement) => requirement.fieldId !== id,
      ),
    });
  return (
    <div className="space-y-4">
      <section className={studyPanelClass}>
        <h2 className="flex items-center gap-2 font-semibold text-white">
          <BookText
            className="h-5 w-5 shrink-0 text-cyan-400"
            aria-hidden="true"
          />
          Силлабус · {course.code}
        </h2>
        <p className="mt-2 break-words text-sm text-zinc-300">{course.title}</p>
        <p className="mt-2 text-xs text-zinc-400">
          Статус активной схемы:{" "}
          {course.calculator?.definition.verification === "verified"
            ? "проверена по источнику"
            : "требует ручной проверки"}
          . Исторические версии и оценки сохраняются.
        </p>
      </section>
      {course.calculator && !activeScheme && course.gradingSchemes?.length ? (
        <section className="space-y-3 rounded-xl border border-amber-400/20 bg-amber-400/[0.04] p-4">
          <h3 className="text-sm font-semibold text-amber-200">
            Существующие настройки сохранены
          </h3>
          <p className="text-xs text-zinc-300">
            Схемы по PDF предложены как отдельные версии. Сравни веса ниже и
            подтверди нужную версию. Новая схема применяется после активации.
          </p>
          <details>
            <summary className="min-h-11 cursor-pointer py-2 text-sm text-zinc-200">
              Текущие настройки: {course.calculator.definition.sourceName}
            </summary>
            {periods.map((period) => (
              <div key={period.id} className="mt-2 text-xs text-zinc-300">
                <p className="font-semibold">
                  {period.label}:{" "}
                  {
                    (course.calculator!.definition.topLevelWeights ?? {
                      att1: 30,
                      att2: 30,
                      exam: 40,
                    })[period.id]
                  }
                  % итога
                </p>
                {course
                  .calculator!.definition.fields.filter(
                    (field) => field.period === period.id,
                  )
                  .map((field) => (
                    <p className="mt-1 break-words" key={field.id}>
                      {field.label}: {field.weightPercent}%
                    </p>
                  ))}
              </div>
            ))}
          </details>
        </section>
      ) : null}
      <section className={cx(studyPanelClass, "space-y-3")}>
        <h3 className="font-semibold text-white">PDF и источники</h3>
        {(course.documents ?? []).map((document) => (
          <div
            className="space-y-2 rounded-lg bg-white/[0.03] p-3"
            key={document.id}
          >
            <p className="break-words text-sm text-zinc-200">
              {document.fileName} · версия {document.version}
            </p>
            <p className="text-xs text-zinc-400">
              {document.extractionStatus === "verified"
                ? "Проверен"
                : "Требует ручной проверки"}
              {document.sourcePages?.length
                ? ` · страницы ${document.sourcePages.join(", ")}`
                : ""}
            </p>
            {(document.notes ?? []).map((note, index) => (
              <p key={index} className="text-xs text-amber-200">
                {note}
              </p>
            ))}
            <button
              type="button"
              disabled={document.available === false}
              className={studyButtonClass}
              onClick={() => {
                setMessage(null);
                void studyApi
                  .openDocument(document.id)
                  .catch((error: Error) => setMessage(error.message));
              }}
            >
              Открыть PDF
            </button>
            <button
              type="button"
              disabled={document.available === false}
              className={cx(studyButtonClass, "flex items-center gap-2")}
              onClick={() => {
                setMessage(null);
                void studyApi
                  .downloadDocument(document.id, document.fileName)
                  .catch(() =>
                    setMessage(
                      "PDF недоступен. Проверь подключение и повтори.",
                    ),
                  );
              }}
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Скачать PDF
            </button>
            {document.available === false ? (
              <p className="text-xs text-amber-200">
                Сохранён источник и checksum. Загрузи оригинальный PDF, чтобы
                открыть его здесь.
              </p>
            ) : null}
          </div>
        ))}
        {!course.documents?.length ? (
          <p className="text-sm text-zinc-400">
            PDF ещё не прикреплён. Источник компонентов указан в схеме ниже.
          </p>
        ) : null}
        <label className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-cyan-400/30 px-3 py-2 text-sm text-cyan-200">
          <Upload className="h-4 w-4" aria-hidden="true" />
          {uploading ? "Загружаем PDF…" : "Загрузить новый PDF"}
          <input
            type="file"
            accept="application/pdf,.pdf"
            disabled={uploading}
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              event.target.value = "";
              if (
                !file.name.toLowerCase().endsWith(".pdf") ||
                file.size > 60 * 1024 * 1024
              ) {
                setMessage("Выбери PDF размером до 60 МБ.");
                return;
              }
              setUploading(true);
              setMessage(null);
              void upload
                .mutateAsync({
                  courseId: course.id,
                  fileName: file.name,
                  file,
                })
                .then((document) => {
                  setDocumentId(document.id);
                  setMessage(
                    "PDF сохранён как новая версия. Проверь таблицу оценивания и создай схему ниже.",
                  );
                })
                .catch(() =>
                  setMessage(
                    "Не удалось загрузить PDF. Проверь формат и подключение.",
                  ),
                )
                .finally(() => setUploading(false));
            }}
          />
        </label>
        <p className="text-xs leading-relaxed text-zinc-400">
          Новый PDF требует проверки. Номера учебных недель не преобразуются в
          даты без начала триместра.
        </p>
      </section>
      <section className={cx(studyPanelClass, "space-y-4")}>
        <h3 className="font-semibold text-white">Редактор новой версии</h3>
        <label className="block text-sm text-zinc-300">
          Источник / название версии
          <input
            className={studyInputClass}
            maxLength={200}
            value={draft.sourceName}
            onChange={(event) =>
              edit({ ...draft, sourceName: event.target.value })
            }
          />
        </label>
        <label className="block text-sm text-zinc-300">
          Прикреплённый PDF
          <select
            className={studyInputClass}
            value={documentId}
            onChange={(event) => setDocumentId(event.target.value)}
          >
            <option value="">Без нового PDF</option>
            {(course.documents ?? []).map((document) => (
              <option key={document.id} value={document.id}>
                {document.fileName} · v{document.version}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-3 gap-2">
          {periods.map((period) => (
            <label key={period.id} className="text-xs text-zinc-300">
              {period.label} в итоге, %
              <input
                className={studyInputClass}
                inputMode="decimal"
                type="number"
                min="0"
                max="100"
                step="any"
                value={weights[period.id]}
                onChange={(event) =>
                  edit({
                    ...draft,
                    topLevelWeights: {
                      ...weights,
                      [period.id]: Number(event.target.value),
                    },
                  })
                }
              />
            </label>
          ))}
        </div>
        <p className="text-xs text-zinc-400">
          Сумма верхних весов: {weights.att1 + weights.att2 + weights.exam}% /
          100%
        </p>
        {periods.map((period) => {
          const fields = draft.fields.filter(
            (field) => field.period === period.id,
          );
          const sum = fields.reduce(
            (total, field) => total + field.weightPercent,
            0,
          );
          return (
            <div
              key={period.id}
              className="space-y-3 border-t border-white/[0.08] pt-3"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-white">
                  {period.label} · {sum}% / 100%
                </p>
                <button
                  type="button"
                  className={studyButtonClass}
                  aria-label={`Добавить компонент ${period.label}`}
                  onClick={() => addField(period.id)}
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              {fields.map((field) => (
                <div
                  key={field.id}
                  className="space-y-2 rounded-lg bg-white/[0.03] p-3"
                >
                  <label className="block text-xs text-zinc-300">
                    Название
                    <input
                      className={studyInputClass}
                      value={field.label}
                      maxLength={300}
                      onChange={(event) =>
                        editField(field.id, { label: event.target.value })
                      }
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-xs text-zinc-300">
                      Вес в группе, %
                      <input
                        className={studyInputClass}
                        type="number"
                        min="0.01"
                        max="100"
                        step="any"
                        value={field.weightPercent}
                        onChange={(event) =>
                          editField(field.id, {
                            weightPercent: Number(event.target.value),
                          })
                        }
                      />
                    </label>
                    <label className="text-xs text-zinc-300">
                      Максимум баллов
                      <input
                        className={studyInputClass}
                        type="number"
                        min="0.01"
                        step="any"
                        value={field.maxScore ?? 100}
                        onChange={(event) =>
                          editField(field.id, {
                            maxScore: Number(event.target.value),
                          })
                        }
                      />
                    </label>
                  </div>
                  <label className="block text-xs text-zinc-300">
                    Тип
                    <input
                      className={studyInputClass}
                      maxLength={80}
                      value={field.type ?? ""}
                      onChange={(event) =>
                        editField(field.id, { type: event.target.value })
                      }
                    />
                  </label>
                  <label className="block text-xs text-zinc-300">
                    Страница PDF
                    <input
                      className={studyInputClass}
                      type="number"
                      min="1"
                      step="1"
                      value={field.sourcePage ?? ""}
                      onChange={(event) =>
                        editField(field.id, {
                          sourcePage: event.target.value
                            ? Number(event.target.value)
                            : undefined,
                        })
                      }
                    />
                  </label>
                  {field.sourceDocument ? (
                    <p className="break-words text-xs text-zinc-400">
                      Источник: {field.sourceDocument}
                      {field.sourcePage ? ` · стр. ${field.sourcePage}` : ""}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    className={cx(
                      studyButtonClass,
                      "flex w-full items-center justify-center gap-2",
                    )}
                    disabled={fields.length <= 1}
                    onClick={() => removeField(field.id)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    Убрать компонент из новой версии
                  </button>
                </div>
              ))}
            </div>
          );
        })}
        <details className="space-y-3 border-t border-white/[0.08] pt-3">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-zinc-200">
            Пороги и условия допуска
          </summary>
          <label className="block text-sm text-zinc-300">
            Предупреждение о низкой аттестации
            <input
              className={studyInputClass}
              type="number"
              min="0"
              max="100"
              value={draft.attestationThreshold}
              onChange={(event) =>
                edit({
                  ...draft,
                  attestationThreshold: Number(event.target.value),
                })
              }
            />
          </label>
          <p className="text-xs text-zinc-400">
            Этот порог — предупреждение. Подтверждённые ограничения из PDF
            перечислены отдельно.
          </p>
          {(draft.requirements ?? []).map((requirement, index) => (
            <div
              key={requirement.id}
              className="space-y-2 rounded-lg bg-white/[0.03] p-3"
            >
              <p className="text-sm text-zinc-300">
                {requirement.label} ·{" "}
                {requirement.verification === "verified"
                  ? "подтверждено источником"
                  : "требует проверки"}
              </p>
              <label className="block text-xs text-zinc-300">
                Минимум, %
                <input
                  className={studyInputClass}
                  type="number"
                  min="0"
                  max="100"
                  step="any"
                  value={requirement.minimumPercent}
                  onChange={(event) =>
                    edit({
                      ...draft,
                      requirements: draft.requirements?.map((item, current) =>
                        current === index
                          ? {
                              ...item,
                              minimumPercent: Number(event.target.value),
                              verification: "needs_review",
                            }
                          : item,
                      ),
                    })
                  }
                />
              </label>
            </div>
          ))}
        </details>
        {!valid ? (
          <p
            className="rounded-lg bg-amber-400/10 p-3 text-sm text-amber-200"
            role="alert"
          >
            Укажи источник, корректные максимумы и веса: в каждом ATT1 / ATT2 /
            Final и верхнем уровне сумма должна быть 100%.
          </p>
        ) : null}
        <button
          type="button"
          disabled={!valid || create.isPending || uploading}
          className={cx(
            studyButtonClass,
            "flex w-full items-center justify-center gap-2 bg-cyan-400/10 text-cyan-200",
          )}
          onClick={() =>
            create.mutate(
              {
                courseId: course.id,
                definition: draft,
                ...(documentId ? { documentId } : {}),
                activate: false,
              },
              {
                onSuccess: () =>
                  setMessage(
                    "Новая версия сохранена. Проверь её и активируй отдельно ниже.",
                  ),
                onError: () =>
                  setMessage(
                    "Не удалось сохранить версию. Проверь схему и повтори.",
                  ),
              },
            )
          }
        >
          <Save className="h-4 w-4" aria-hidden="true" />
          {create.isPending ? "Сохраняем…" : "Создать новую версию"}
        </button>
      </section>
      <section className={cx(studyPanelClass, "space-y-3")}>
        <h3 className="font-semibold text-white">
          Сохранённые версии и активация
        </h3>
        {(course.gradingSchemes ?? []).map((scheme) => (
          <div
            key={scheme.id}
            className="space-y-3 rounded-lg bg-white/[0.03] p-3"
          >
            <p className="break-words text-sm text-zinc-200">
              Версия {scheme.version}: {scheme.definition.sourceName}
            </p>
            <p className="text-xs text-zinc-400">
              {scheme.isActive || scheme.active ? "Активная" : "Сохранённая"} ·{" "}
              {["verified", "user_confirmed"].includes(
                scheme.verification ?? "",
              )
                ? "проверена"
                : "требует проверки"}
            </p>
            <details>
              <summary className="min-h-11 cursor-pointer py-2 text-sm text-cyan-200">
                Показать дерево компонентов
              </summary>
              {periods.map((period) => (
                <div className="mt-2 text-xs text-zinc-300" key={period.id}>
                  <p className="font-semibold">
                    {period.label}:{" "}
                    {
                      (scheme.definition.topLevelWeights ?? {
                        att1: 30,
                        att2: 30,
                        exam: 40,
                      })[period.id]
                    }
                    % итога
                  </p>
                  {scheme.definition.fields
                    .filter((field) => field.period === period.id)
                    .map((field) => (
                      <p className="mt-1 break-words" key={field.id}>
                        {field.label} · {field.weightPercent}% · max{" "}
                        {field.maxScore ?? 100}
                        {field.sourcePage ? ` · стр. ${field.sourcePage}` : ""}
                      </p>
                    ))}
                </div>
              ))}
            </details>
            <button
              type="button"
              className={cx(studyButtonClass, "w-full")}
              onClick={() => {
                setDraft(structuredClone(scheme.definition));
                setDocumentId(scheme.documentId ?? "");
                setMessage(null);
              }}
            >
              Открыть в редакторе
            </button>
            {!scheme.isActive && !scheme.active ? (
              <>
                <label className="flex min-h-11 items-start gap-2 text-xs text-zinc-300">
                  <input
                    className="mt-1 shrink-0"
                    type="checkbox"
                    checked={confirmed === scheme.id}
                    onChange={(event) =>
                      setConfirmed(event.target.checked ? scheme.id : null)
                    }
                  />
                  <span>
                    Я сверил(а) компоненты и условия с PDF. Эта версия будет
                    использоваться для новых расчётов; прежние оценки
                    сохранятся.
                  </span>
                </label>
                <button
                  type="button"
                  disabled={confirmed !== scheme.id || activate.isPending}
                  className={cx(studyButtonClass, "w-full text-cyan-200")}
                  onClick={() =>
                    activate.mutate(
                      { courseId: course.id, schemeId: scheme.id },
                      {
                        onSuccess: () => {
                          setConfirmed(null);
                          setMessage(
                            "Версия активирована. Обновлённая схема доступна в калькуляторе.",
                          );
                        },
                        onError: () =>
                          setMessage(
                            "Активация не выполнена. Проверь актуальность версии.",
                          ),
                      },
                    )
                  }
                >
                  {activate.isPending
                    ? "Активируем…"
                    : "Подтвердить и активировать"}
                </button>
              </>
            ) : null}
          </div>
        ))}
        {!course.gradingSchemes?.length ? (
          <p className="text-sm text-zinc-400">
            Версий пока нет. Текущие настройки сохранены; создай первую версию
            без их замены.
          </p>
        ) : null}
      </section>
      {message ? (
        <p
          className="rounded-lg border border-white/[0.1] p-3 text-sm text-zinc-200"
          role="status"
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}

export function StudySyllabi({
  courses,
  initialCourseId,
  onCourseChange,
}: {
  courses: StudyWorkspaceCourse[];
  initialCourseId?: string | null;
  onCourseChange?: (id: string) => void;
}) {
  const [courseId, setCourseId] = useState(
    initialCourseId ?? courses[0]?.id ?? "",
  );
  useEffect(() => {
    if (initialCourseId) setCourseId(initialCourseId);
  }, [initialCourseId]);
  const course = courses.find((item) => item.id === courseId) ?? courses[0];
  if (!course)
    return (
      <p className={cx(studyPanelClass, "text-sm text-zinc-400")}>
        Курсы пока не добавлены. Импортируй учебный план или подключи источник.
      </p>
    );
  return (
    <div className="space-y-4">
      <label className="block text-sm text-zinc-300">
        Предмет
        <select
          className={studyInputClass}
          value={course.id}
          onChange={(event) => {
            setCourseId(event.target.value);
            onCourseChange?.(event.target.value);
          }}
        >
          {courses.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
            </option>
          ))}
        </select>
      </label>
      <CourseSyllabus key={course.id} course={course} />
    </div>
  );
}
