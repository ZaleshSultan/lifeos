import { BookOpen, CalendarDays, ExternalLink, Plus, Save } from "lucide-react";
import { useState } from "react";
import {
  studyApi,
  useStudyWriteMutation,
  type StudyAssignment,
  type StudyDeadline,
  type StudyWorkspace,
} from "../../api/study";
import { cx } from "../../lib/styles";
import {
  studyDaySessions,
  studyIsoToWallTime,
  studyLocalDate,
  studyLocalTime,
  studyScoreLabel,
  studySessionIsOnline,
  studyWallTimeToIso,
  studyWeekday,
} from "./model";

export const studyPanelClass =
  "rounded-xl border border-white/[0.08] bg-white/[0.03] p-4";
export const studyInputClass =
  "mt-1 min-h-11 w-full min-w-0 rounded-lg border border-white/[0.12] bg-graphite-900 px-3 py-2 text-base text-white focus:border-cyan-400";
export const studyButtonClass =
  "min-h-11 rounded-lg border border-white/[0.12] px-3 py-2 text-sm text-zinc-200 transition-colors hover:bg-white/[0.06] active:scale-[0.98] disabled:opacity-50";
export type AssignmentFilter = "today" | "overdue" | "week" | "all";

export function studySafeSourceUrl(value?: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function SourceLink({ value }: { value?: string | null }) {
  const url = studySafeSourceUrl(value);
  return url ? (
    <a
      className="inline-flex min-h-11 items-center gap-2 break-all text-sm text-cyan-200 underline underline-offset-2"
      href={url}
      target="_blank"
      rel="noreferrer"
    >
      Открыть источник{" "}
      <ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />
    </a>
  ) : null;
}

const statusLabels: Record<string, string> = {
  new: "Новое",
  pending: "Не сдано",
  submitted: "Сдано",
  graded: "Оценено",
  missing: "Пропущено",
  missed: "Пропущено",
  overdue: "Просрочено",
  completed: "Завершено",
  done: "Завершено",
  cancelled: "Отменено",
  planned: "Запланировано",
};
export function studyStatus(
  status: string,
  dueAt: string | null,
  now = new Date(),
): string {
  if (
    dueAt &&
    new Date(dueAt) < now &&
    !["graded", "submitted", "completed", "done", "cancelled"].includes(status)
  )
    return "Просрочено";
  return statusLabels[status] ?? status;
}

export function filterStudyDueItems<
  T extends { dueAt: string | null; status: string },
>(
  items: T[],
  filter: AssignmentFilter,
  timezone: string,
  now = new Date(),
): T[] {
  return items
    .filter((item) => {
      if (filter === "all") return true;
      if (!item.dueAt) return false;
      const due = new Date(item.dueAt);
      if (filter === "today")
        return studyLocalDate(due, timezone) === studyLocalDate(now, timezone);
      if (filter === "overdue")
        return (
          due < now &&
          !["graded", "submitted", "completed", "done", "cancelled"].includes(
            item.status,
          )
        );
      return due >= now && due.getTime() < now.getTime() + 7 * 86_400_000;
    })
    .sort((a, b) => (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999"));
}

export function StudyFreshness({ data }: { data: StudyWorkspace }) {
  return (
    <div
      className="space-y-1 rounded-lg border border-white/[0.08] px-3 py-2 text-xs text-zinc-400"
      role="status"
    >
      <p>
        Синхронизация:{" "}
        {data.sync?.updatedAt
          ? studyLocalTime(data.sync.updatedAt, data.timezone)
          : "ещё не подтверждена"}{" "}
        · {data.sync?.status ?? "нет сведений"}
      </p>
      {data.sync?.message ? <p>{data.sync.message}</p> : null}
      {(data.sources ?? []).map((source) => (
        <p key={source.id}>
          {source.title}:{" "}
          {source.lastSyncedAt
            ? studyLocalTime(source.lastSyncedAt, data.timezone)
            : "не синхронизировано"}
          {source.lastError ? " · ошибка последней синхронизации" : ""}
        </p>
      ))}
      <p>
        Пустой список означает отсутствие сохранённых данных. Проверь
        актуальность источника.
      </p>
    </div>
  );
}

export function StudyToday({
  data,
  onNavigate,
}: {
  data: StudyWorkspace;
  onNavigate: (tab: string, courseId?: string) => void;
}) {
  const sessions = studyDaySessions(data.courses, studyWeekday(data.timezone));
  const firstOnline = sessions.find((item) =>
    studySessionIsOnline(item.schedule),
  );
  const firstCampus = sessions.find(
    (item) =>
      Boolean(item.schedule.room) && !studySessionIsOnline(item.schedule),
  );
  const upcoming = filterStudyDueItems(
    data.deadlines ?? [],
    "week",
    data.timezone,
  );
  return (
    <div className="space-y-4">
      <section className={studyPanelClass}>
        <h2 className="font-semibold text-white">
          Сегодня · {studyLocalDate(new Date(), data.timezone)}
        </h2>
        <p className="mt-1 text-xs text-zinc-400">
          Время профиля: {data.timezone}
        </p>
        {[
          { label: "Первая онлайн", item: firstOnline },
          { label: "Первая очная", item: firstCampus },
        ].map(({ label, item }) => (
          <div key={label} className="mt-3 rounded-lg bg-white/[0.03] p-3">
            <p className="text-xs text-zinc-400">{label}</p>
            <p className="mt-1 break-words font-semibold text-white">
              {item
                ? `${item.schedule.startTime.slice(0, 5)} · ${item.course.title}`
                : "Не указана в расписании"}
            </p>
            {item ? (
              <p className="mt-1 break-words text-sm text-zinc-300">
                {item.schedule.room ?? "Место не указано"}
                {item.schedule.instructorName
                  ? ` · ${item.schedule.instructorName}`
                  : ""}
              </p>
            ) : null}
          </div>
        ))}
        <button
          className={cx(studyButtonClass, "mt-3 w-full")}
          onClick={() => onNavigate("schedule")}
          type="button"
        >
          Полное расписание дня
        </button>
      </section>
      <section className={studyPanelClass}>
        <h2 className="font-semibold text-white">Полный учебный день</h2>
        {!sessions.length ? (
          <p className="mt-2 text-sm text-zinc-400">
            На сегодня занятия в сохранённом расписании не указаны.
          </p>
        ) : null}
        <ol className="mt-2 space-y-3">
          {sessions.map(({ course, schedule }) => (
            <li key={schedule.id} className="rounded-lg bg-white/[0.03] p-3">
              <p className="text-sm font-semibold tabular-nums text-cyan-200">
                {schedule.startTime.slice(0, 5)}–{schedule.endTime.slice(0, 5)}
              </p>
              <p className="mt-1 break-words text-sm text-zinc-200">
                {course.title}
              </p>
              <p className="mt-1 break-words text-xs text-zinc-400">
                {studySessionIsOnline(schedule)
                  ? "Онлайн"
                  : schedule.room
                    ? `Аудитория ${schedule.room}`
                    : "Формат и место не указаны"}
                {schedule.instructorName ? ` · ${schedule.instructorName}` : ""}
              </p>
            </li>
          ))}
        </ol>
      </section>
      <section className={studyPanelClass}>
        <h2 className="font-semibold text-white">
          Задания и ближайшие контрольные
        </h2>
        {upcoming.slice(0, 5).map((item) => (
          <div key={item.id} className="mt-3 border-t border-white/[0.08] pt-3">
            <p className="break-words text-sm text-white">{item.title}</p>
            <p className="mt-1 text-xs text-amber-200">
              {studyLocalTime(item.dueAt, data.timezone)}
              {item.courseTitle ? ` · ${item.courseTitle}` : ""}
            </p>
          </div>
        ))}
        {!upcoming.length ? (
          <p className="mt-2 text-sm text-zinc-400">
            На ближайшую неделю сроки в сохранённых данных не указаны.
          </p>
        ) : null}
      </section>
      <div className="grid grid-cols-2 gap-2">
        {[
          { id: "assignments", label: "Задания" },
          { id: "deadlines", label: "Дедлайны" },
          { id: "grades", label: "Оценки" },
          { id: "calculator", label: "Калькулятор 70+" },
        ].map((item) => (
          <button
            className={studyButtonClass}
            key={item.id}
            onClick={() => onNavigate(item.id)}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>
      <StudyFreshness data={data} />
    </div>
  );
}

export function StudyCourses({
  data,
  onNavigate,
}: {
  data: StudyWorkspace;
  onNavigate: (tab: string, courseId?: string) => void;
}) {
  return (
    <div className="space-y-3">
      {!data.courses.length ? (
        <p className={studyPanelClass}>
          Предметов пока нет. Подключи университетский источник или импортируй
          учебный план.
        </p>
      ) : null}
      {data.courses.map((course) => {
        const assignments = (data.assignments ?? []).filter(
          (item) => item.studyCourseId === course.id,
        );
        const graded = assignments.filter(
          (item) => (item.effectiveScore ?? item.actualScore) !== null,
        ).length;
        return (
          <section className={studyPanelClass} key={course.id}>
            <h2 className="flex items-start gap-2 break-words font-semibold text-white">
              <BookOpen
                className="mt-0.5 h-5 w-5 shrink-0 text-cyan-400"
                aria-hidden="true"
              />
              {course.title}
            </h2>
            <p className="mt-2 break-words text-xs text-zinc-400">
              {course.code}
              {course.term ? ` · ${course.term}` : ""}
            </p>
            {course.instructorName ? (
              <p className="mt-2 text-sm text-zinc-300">
                {course.instructorName}
              </p>
            ) : null}
            <p className="mt-2 text-sm text-zinc-300">
              Работ: {assignments.length} · с оценками: {graded} · схема:{" "}
              {course.calculator ? "настроена" : "требует проверки"}
            </p>
            {course.updatedAt ? (
              <p className="mt-1 text-xs text-zinc-400">
                Данные курса: {studyLocalTime(course.updatedAt, data.timezone)}
              </p>
            ) : null}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                className={studyButtonClass}
                onClick={() => onNavigate("assignments", course.id)}
              >
                Работы
              </button>
              <button
                type="button"
                className={studyButtonClass}
                onClick={() => onNavigate("calculator", course.id)}
              >
                Цель 70+
              </button>
              <button
                type="button"
                className={studyButtonClass}
                onClick={() => onNavigate("grades", course.id)}
              >
                Оценки
              </button>
              <button
                type="button"
                className={studyButtonClass}
                onClick={() => onNavigate("syllabi", course.id)}
              >
                Силлабус
              </button>
            </div>
          </section>
        );
      })}
      <StudyFreshness data={data} />
    </div>
  );
}

function DueFilters({
  value,
  onChange,
}: {
  value: AssignmentFilter;
  onChange: (value: AssignmentFilter) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2" aria-label="Период заданий">
      {[
        { id: "today", label: "Сегодня" },
        { id: "overdue", label: "Просрочено" },
        { id: "week", label: "Неделя" },
        { id: "all", label: "Все" },
      ].map((item) => (
        <button
          type="button"
          key={item.id}
          aria-pressed={value === item.id}
          className={cx(
            studyButtonClass,
            value === item.id &&
              "border-cyan-400/40 bg-cyan-400/10 text-cyan-200",
          )}
          onClick={() => onChange(item.id as AssignmentFilter)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function AssignmentForm({
  data,
  item,
  defaultCourseId,
  onDone,
}: {
  data: StudyWorkspace;
  item?: StudyAssignment;
  defaultCourseId?: string | null;
  onDone: () => void;
}) {
  const save = useStudyWriteMutation(studyApi.saveAssignment);
  const [courseId, setCourseId] = useState(
    item?.studyCourseId ?? defaultCourseId ?? data.courses[0]?.id ?? "",
  );
  const [title, setTitle] = useState(item?.title ?? "");
  const [kind, setKind] = useState(item?.assessmentType ?? "assignment");
  const [due, setDue] = useState(
    studyIsoToWallTime(item?.dueAt ?? null, data.timezone),
  );
  const [max, setMax] = useState(
    item?.maxScore == null ? "" : String(item.maxScore),
  );
  const [status, setStatus] = useState(item?.status ?? "pending");
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [url, setUrl] = useState(item?.sourceUrl ?? "");
  const invalid =
    !courseId ||
    !title.trim() ||
    (max !== "" && (!Number.isFinite(Number(max)) || Number(max) <= 0)) ||
    (url !== "" && !studySafeSourceUrl(url));
  return (
    <form
      className={cx(studyPanelClass, "space-y-3")}
      onSubmit={(event) => {
        event.preventDefault();
        if (invalid) return;
        save.mutate(
          {
            id: item?.id,
            input: {
              studyCourseId: courseId,
              title: title.trim(),
              assessmentType: kind.trim() || null,
              dueAt: studyWallTimeToIso(due, data.timezone),
              maxScore: max ? Number(max) : null,
              status,
              notes: notes.trim() || null,
              sourceUrl: url || null,
            },
          },
          { onSuccess: onDone },
        );
      }}
    >
      <h3 className="font-semibold text-white">
        {item ? "Редактировать задание" : "Новое задание"}
      </h3>
      <label className="block text-sm text-zinc-300">
        Предмет
        <select
          className={studyInputClass}
          value={courseId}
          onChange={(event) => setCourseId(event.target.value)}
          disabled={Boolean(item)}
        >
          {data.courses.map((course) => (
            <option key={course.id} value={course.id}>
              {course.title}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm text-zinc-300">
        Название
        <input
          required
          maxLength={300}
          className={studyInputClass}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label className="block text-sm text-zinc-300">
        Тип работы
        <input
          maxLength={80}
          className={studyInputClass}
          value={kind}
          onChange={(event) => setKind(event.target.value)}
          list="study-assessment-types"
        />
        <datalist id="study-assessment-types">
          {[
            "assignment",
            "quiz",
            "midterm",
            "endterm",
            "final",
            "certificate",
            "presentation",
          ].map((type) => (
            <option key={type} value={type} />
          ))}
        </datalist>
      </label>
      <label className="block text-sm text-zinc-300">
        Срок ({data.timezone})
        <input
          className={studyInputClass}
          type="datetime-local"
          value={due}
          onChange={(event) => setDue(event.target.value)}
        />
      </label>
      <p className="text-xs text-zinc-400">
        Оставь срок пустым, если источник его не указывает.
      </p>
      <label className="block text-sm text-zinc-300">
        Максимум баллов
        <input
          className={studyInputClass}
          type="number"
          step="any"
          min="0.01"
          value={max}
          onChange={(event) => setMax(event.target.value)}
        />
      </label>
      <label className="block text-sm text-zinc-300">
        Статус
        <select
          className={studyInputClass}
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          {[
            ...new Set([status, "pending", "submitted", "graded", "missed"]),
          ].map((id) => (
            <option key={id} value={id}>
              {statusLabels[id] ?? id}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm text-zinc-300">
        Ссылка на источник
        <input
          className={studyInputClass}
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />
      </label>
      <label className="block text-sm text-zinc-300">
        Заметка
        <textarea
          maxLength={2000}
          className={studyInputClass}
          rows={3}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </label>
      {save.isError ? (
        <p className="text-sm text-rose-200" role="alert">
          Не удалось сохранить. Проверь значения и попробуй ещё раз.
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="submit"
          disabled={invalid || save.isPending}
          className={cx(
            studyButtonClass,
            "flex items-center justify-center gap-2 bg-cyan-400/10 text-cyan-200",
          )}
        >
          <Save className="h-4 w-4" aria-hidden="true" />
          {save.isPending ? "Сохраняем…" : "Сохранить"}
        </button>
        <button
          type="button"
          className={studyButtonClass}
          disabled={save.isPending}
          onClick={onDone}
        >
          Отмена
        </button>
      </div>
    </form>
  );
}

export function StudyAssignments({
  data,
  courseId,
  onCourseChange,
}: {
  data: StudyWorkspace;
  courseId: string | null;
  onCourseChange: (id: string | null) => void;
}) {
  const [filter, setFilter] = useState<AssignmentFilter>("all");
  const [sort, setSort] = useState("due");
  const [editing, setEditing] = useState<StudyAssignment | "new" | null>(null);
  const items = filterStudyDueItems(
    (data.assignments ?? []).filter(
      (item) => !courseId || item.studyCourseId === courseId,
    ),
    filter,
    data.timezone,
  );
  if (sort === "title") items.sort((a, b) => a.title.localeCompare(b.title));
  if (sort === "updated")
    items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
        <label className="block min-w-0 text-sm text-zinc-300">
          Предмет
          <select
            className={studyInputClass}
            value={courseId ?? ""}
            onChange={(event) => onCourseChange(event.target.value || null)}
          >
            <option value="">Все предметы</option>
            {data.courses.map((course) => (
              <option value={course.id} key={course.id}>
                {course.title}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          aria-label="Создать задание"
          className={studyButtonClass}
          disabled={!data.courses.length}
          onClick={() => setEditing("new")}
        >
          <Plus className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      <DueFilters value={filter} onChange={setFilter} />
      <label className="block text-sm text-zinc-300">
        Сортировка
        <select
          className={studyInputClass}
          value={sort}
          onChange={(event) => setSort(event.target.value)}
        >
          <option value="due">По сроку</option>
          <option value="title">По названию</option>
          <option value="updated">По обновлению</option>
        </select>
      </label>
      {editing ? (
        <AssignmentForm
          key={typeof editing === "string" ? editing : editing.id}
          data={data}
          item={typeof editing === "string" ? undefined : editing}
          defaultCourseId={courseId}
          onDone={() => setEditing(null)}
        />
      ) : null}
      {!items.length ? (
        <p className={cx(studyPanelClass, "text-sm text-zinc-400")}>
          Для выбранного фильтра сохранённых заданий нет. Можно создать задание
          вручную.
        </p>
      ) : null}
      {items.map((item) => (
        <details className={studyPanelClass} key={item.id}>
          <summary className="min-h-11 cursor-pointer break-words text-sm font-semibold text-white">
            <span>{item.title}</span>
            <span className="mt-1 block text-xs font-normal text-zinc-400">
              {item.courseTitle} · {studyStatus(item.status, item.dueAt)}
            </span>
            <span className="mt-1 block text-xs font-normal text-amber-200">
              {item.dueAt
                ? studyLocalTime(item.dueAt, data.timezone)
                : "Календарный срок не указан"}
            </span>
          </summary>
          <div className="mt-3 space-y-2 border-t border-white/[0.08] pt-3 text-sm text-zinc-300">
            <p>
              Тип: {item.assessmentType ?? "не указан"} · источник:{" "}
              {item.source}
            </p>
            <p>
              Баллы:{" "}
              {(item.effectiveScore ?? item.actualScore) === null
                ? "Ещё не оценено"
                : studyScoreLabel(item.effectiveScore ?? item.actualScore)}{" "}
              / {studyScoreLabel(item.effectiveMax ?? item.maxScore)}
            </p>
            {item.override ? (
              <p className="text-amber-200">
                Ручное значение; исходный результат сохранён отдельно.
              </p>
            ) : null}
            <p className="text-xs text-zinc-400">
              Обновлено: {studyLocalTime(item.updatedAt, data.timezone)}
            </p>
            {item.notes ? (
              <p className="whitespace-pre-wrap break-words">{item.notes}</p>
            ) : null}
            <SourceLink value={item.sourceUrl} />
            {item.editable !== false && item.source === "manual" ? (
              <button
                type="button"
                className={cx(studyButtonClass, "w-full")}
                onClick={() => setEditing(item)}
              >
                Редактировать
              </button>
            ) : (
              <p className="text-xs text-zinc-400">
                Данные источника обновляются синхронизацией. Ручной результат
                можно задать на вкладке «Оценки» после сопоставления работы.
              </p>
            )}
          </div>
        </details>
      ))}
      <StudyFreshness data={data} />
    </div>
  );
}

export function StudyDeadlines({
  data,
  onAssignments,
}: {
  data: StudyWorkspace;
  onAssignments: (courseId?: string) => void;
}) {
  const [filter, setFilter] = useState<AssignmentFilter>("all");
  const items: StudyDeadline[] = filterStudyDueItems(
    data.deadlines ?? [],
    filter,
    data.timezone,
  );
  return (
    <div className="space-y-3">
      <section className={studyPanelClass}>
        <h2 className="flex items-center gap-2 font-semibold text-white">
          <CalendarDays className="h-5 w-5 text-amber-300" aria-hidden="true" />
          Все учебные сроки
        </h2>
        <p className="mt-2 text-sm text-zinc-400">
          Сохранённые работы, университетские источники и ручные задачи LifeOS.
          Время: {data.timezone}.
        </p>
      </section>
      <DueFilters value={filter} onChange={setFilter} />
      {!items.length ? (
        <p className={cx(studyPanelClass, "text-sm text-zinc-400")}>
          В сохранённых данных подходящих сроков нет. Сверь актуальность
          синхронизации.
        </p>
      ) : null}
      {items.map((item) => (
        <section className={studyPanelClass} key={item.id}>
          <h3 className="break-words text-sm font-semibold text-white">
            {item.title}
          </h3>
          {item.courseTitle ? (
            <p className="mt-1 text-xs text-zinc-400">{item.courseTitle}</p>
          ) : null}
          <p className="mt-2 text-sm tabular-nums text-amber-200">
            {studyLocalTime(item.dueAt, data.timezone)}
          </p>
          <p className="mt-1 text-xs text-zinc-400">
            {studyStatus(item.status, item.dueAt)} · {item.source}
          </p>
          <SourceLink value={item.sourceUrl} />
          {item.assessmentId ? (
            <button
              type="button"
              className={cx(studyButtonClass, "mt-2 w-full")}
              onClick={() => onAssignments(item.courseId ?? undefined)}
            >
              Открыть задания
            </button>
          ) : null}
        </section>
      ))}
      <button
        type="button"
        className={cx(studyButtonClass, "w-full")}
        onClick={() => onAssignments()}
      >
        Создать или изменить задание
      </button>
      <StudyFreshness data={data} />
    </div>
  );
}
