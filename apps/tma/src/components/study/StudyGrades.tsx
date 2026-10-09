import { BookOpen, Save } from "lucide-react";
import { useState } from "react";
import {
  studyApi,
  useStudyWriteMutation,
  type StudyAssignment,
  type StudyWorkspace,
} from "../../api/study";
import type { AcademicRecord } from "../../api/types";
import { cx } from "../../lib/styles";
import { studyLocalTime, studyScoreLabel } from "./model";
import {
  SourceLink,
  StudyFreshness,
  studyButtonClass,
  studyInputClass,
  studyPanelClass,
} from "./StudyWorkspacePanels";

function AssignmentGrade({
  item,
  workspace,
}: {
  item: StudyAssignment;
  workspace: StudyWorkspace;
}) {
  const override = useStudyWriteMutation(studyApi.overrideGrade);
  const mapping = useStudyWriteMutation(studyApi.mapGrade);
  const [earned, setEarned] = useState(
    item.override ? String(item.override.earned) : "",
  );
  const [max, setMax] = useState(
    String(item.override?.max ?? item.maxScore ?? 100),
  );
  const [note, setNote] = useState(item.override?.note ?? "");
  const course = workspace.courses.find(
    (entry) => entry.id === item.studyCourseId,
  );
  const activeScheme = course?.gradingSchemes?.find(
    (scheme) => scheme.isActive,
  );
  const previousMapping = Boolean(
    item.schemeId && item.schemeId !== activeScheme?.id,
  );
  const invalid =
    earned.trim() === "" ||
    !Number.isFinite(Number(earned)) ||
    !Number.isFinite(Number(max)) ||
    Number(max) <= 0 ||
    Number(earned) < 0 ||
    Number(earned) > Number(max);
  const score = item.override
    ? item.override.earned
    : (item.effectiveScore ?? item.actualScore);
  const denominator = item.override
    ? item.override.max
    : (item.effectiveMax ?? item.maxScore);
  return (
    <details className={studyPanelClass}>
      <summary className="min-h-11 cursor-pointer break-words text-sm font-semibold text-white">
        {item.title}
        <span className="mt-1 block font-normal text-zinc-300">
          {score === null
            ? "Ещё не оценено"
            : `${studyScoreLabel(score)} / ${studyScoreLabel(denominator)}`}
        </span>
        <span className="mt-1 block text-xs font-normal text-zinc-400">
          {item.courseTitle} · {item.override ? "ручное значение" : item.source}
        </span>
      </summary>
      <div className="mt-3 space-y-3 border-t border-white/[0.08] pt-3">
        <p className="text-sm text-zinc-300">
          Синхронизировано:{" "}
          {item.actualScore === null
            ? "Ещё не оценено"
            : `${studyScoreLabel(item.actualScore)} / ${studyScoreLabel(item.maxScore)}`}
        </p>
        <p className="text-xs text-zinc-400">
          Источник: {item.source} ·{" "}
          {studyLocalTime(item.updatedAt, workspace.timezone)}
        </p>
        <SourceLink value={item.sourceUrl} />
        {!item.id.startsWith("source:") ? (
          <>
            <label className="block text-sm text-zinc-300">
              Компонент силлабуса
              <select
                className={studyInputClass}
                value={previousMapping ? "" : (item.componentId ?? "")}
                disabled={
                  mapping.isPending ||
                  !course?.gradingSchemes?.some((scheme) => scheme.isActive)
                }
                onChange={(event) =>
                  mapping.mutate({
                    id: item.id,
                    componentId: event.target.value || null,
                  })
                }
              >
                <option value="">Требует сопоставления</option>
                {course?.calculator?.definition.fields.map((field) => (
                  <option key={field.id} value={field.id}>
                    {field.label} ({field.period.toUpperCase()})
                  </option>
                ))}
              </select>
            </label>
            <p className="text-xs text-zinc-400">
              Сопоставление подтверждается явно. Похожее название не означает
              совпадение.
            </p>
            {previousMapping ? (
              <p className="text-xs text-amber-200">
                Сохранённое сопоставление относится к предыдущей версии схемы.
                Выбери компонент активной версии; исторические данные
                сохранятся.
              </p>
            ) : null}
            {mapping.isError ? (
              <p className="text-sm text-rose-200" role="alert">
                Не удалось сохранить сопоставление.
              </p>
            ) : null}
            <form
              className="space-y-3 rounded-lg border border-amber-400/20 p-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (!invalid)
                  override.mutate({
                    id: item.id,
                    value: {
                      earned: Number(earned),
                      max: Number(max),
                      note: note.trim(),
                    },
                  });
              }}
            >
              <h3 className="text-sm font-semibold text-zinc-200">
                Ручной override
              </h3>
              <p className="text-xs text-zinc-400">
                Сохраняется отдельно. Следующая синхронизация обновляет исходную
                оценку и сохраняет ручное значение.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-zinc-300">
                  Набрано
                  <input
                    aria-label={`${item.title}: ручной балл`}
                    className={studyInputClass}
                    inputMode="decimal"
                    value={earned}
                    onChange={(event) => setEarned(event.target.value)}
                  />
                </label>
                <label className="text-xs text-zinc-300">
                  Максимум
                  <input
                    aria-label={`${item.title}: ручной максимум`}
                    className={studyInputClass}
                    inputMode="decimal"
                    value={max}
                    onChange={(event) => setMax(event.target.value)}
                  />
                </label>
              </div>
              <label className="block text-xs text-zinc-300">
                Причина / источник
                <input
                  className={studyInputClass}
                  maxLength={500}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
              </label>
              {override.isError ? (
                <p className="text-xs text-rose-200" role="alert">
                  Не удалось сохранить ручную оценку.
                </p>
              ) : null}
              {override.isSuccess ? (
                <p className="text-xs text-emerald-200" role="status">
                  Изменение сохранено.
                </p>
              ) : null}
              <button
                type="submit"
                disabled={invalid || override.isPending}
                className={cx(
                  studyButtonClass,
                  "flex w-full items-center justify-center gap-2",
                )}
              >
                <Save className="h-4 w-4" aria-hidden="true" />
                {override.isPending ? "Сохраняем…" : "Сохранить override"}
              </button>
              {item.override ? (
                <button
                  type="button"
                  disabled={override.isPending}
                  className={cx(studyButtonClass, "w-full")}
                  onClick={() =>
                    override.mutate(
                      { id: item.id, value: null },
                      { onSuccess: () => setEarned("") },
                    )
                  }
                >
                  Использовать оценку источника
                </button>
              ) : null}
            </form>
          </>
        ) : (
          <p className="text-xs text-zinc-400">
            Работа сохранена в университетском источнике; для оценивания сначала
            требуется импортировать соответствующий assessment.
          </p>
        )}
      </div>
    </details>
  );
}

export function StudyGrades({
  records,
  workspace,
  courseId,
}: {
  records: AcademicRecord[];
  workspace?: StudyWorkspace;
  courseId?: string | null;
}) {
  const groups = new Map<string, AcademicRecord[]>();
  const selectedCourse = workspace?.courses.find(
    (course) => course.id === courseId,
  );
  for (const record of records) {
    if (selectedCourse && selectedCourse.title !== record.courseTitle) continue;
    const items = groups.get(record.courseTitle) ?? [];
    items.push(record);
    groups.set(record.courseTitle, items);
  }
  const assignments = (workspace?.assignments ?? []).filter(
    (item) => !courseId || item.studyCourseId === courseId,
  );
  return (
    <section className="space-y-3" aria-label="Оценки из Moodle">
      <div className={studyPanelClass}>
        <h2 className="flex items-center gap-2 font-semibold text-white">
          <BookOpen className="h-5 w-5 text-cyan-400" aria-hidden="true" />
          Оценки и сопоставление
        </h2>
        <p className="mt-2 text-sm text-zinc-400">
          {records.length} записей · {groups.size} курсов
        </p>
        <p className="mt-2 text-xs leading-relaxed text-zinc-400">
          Здесь показаны последние синхронизированные данные. Задание без оценки
          не считается нулём. Значения калькулятора сохраняются отдельно.
        </p>
      </div>
      {!records.length && !assignments.length ? (
        <p className={cx(studyPanelClass, "text-sm text-zinc-400")}>
          Оценок пока нет. Подключи Moodle и запусти синхронизацию, затем обнови
          экран.
        </p>
      ) : null}
      {workspace
        ? assignments.map((item) => (
            <AssignmentGrade key={item.id} item={item} workspace={workspace} />
          ))
        : null}
      {[...groups].map(([title, items]) => (
        <details
          key={title}
          className="rounded-xl border border-white/[0.08] bg-white/[0.03]"
        >
          <summary className="min-h-11 cursor-pointer break-words rounded-xl p-4 text-sm font-semibold text-white hover:bg-white/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400">
            {title}{" "}
            <span className="font-normal text-zinc-400">
              ({items.length} записей источника)
            </span>
          </summary>
          <ul className="divide-y divide-white/[0.06] px-4 pb-2">
            {items.map((record) => (
              <li key={record.id} className="space-y-1 py-3">
                <p className="break-words text-sm text-zinc-300">
                  {record.title}
                </p>
                <p className="text-sm font-semibold tabular-nums text-white">
                  {record.score === null
                    ? "Ещё не оценено"
                    : record.maxScore === null
                      ? studyScoreLabel(record.score)
                      : `${studyScoreLabel(record.score)} / ${studyScoreLabel(record.maxScore)}`}
                </p>
                <p className="text-xs text-zinc-400">
                  Источник Moodle ·{" "}
                  {studyLocalTime(
                    record.updatedAt,
                    workspace?.timezone ?? "Asia/Almaty",
                  )}
                </p>
                {record.rawJson?._is_mocked === true ? (
                  <p className="text-xs text-amber-300">
                    Демонстрационные данные
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ))}
      {workspace ? <StudyFreshness data={workspace} /> : null}
    </section>
  );
}
