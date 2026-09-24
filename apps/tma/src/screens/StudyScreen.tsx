import { BookOpen, Calculator, CalendarDays, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { ApiError } from "../api/client";
import { useSaveStudyCalculatorMutation, useStudyQuery } from "../api/study";
import { ErrorPanel, LoadingPanel } from "../components/AsyncState";
import { StudyCalculator } from "../components/study/StudyCalculator";
import { StudyGrades } from "../components/study/StudyGrades";
import { StudySchedule } from "../components/study/StudySchedule";
import {
  createStudyDraft,
  reconcileStudyDraft,
  studyDraftIsDirty,
  type StudyDraft,
} from "../components/study/model";
import { cx } from "../lib/styles";

const tabs = [
  { id: "schedule", label: "Расписание", icon: CalendarDays },
  { id: "calculator", label: "Калькулятор", icon: Calculator },
  { id: "grades", label: "Оценки", icon: BookOpen },
] as const;

export function StudyScreen() {
  const query = useStudyQuery();
  const save = useSaveStudyCalculatorMutation();
  const [tab, setTab] = useState<(typeof tabs)[number]["id"]>("schedule");
  const [courseId, setCourseId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, StudyDraft>>({});
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [savedCourse, setSavedCourse] = useState<string | null>(null);

  useEffect(() => {
    if (!query.data) return;
    setDrafts((current) => {
      const updated = { ...current };
      for (const course of query.data.courses) {
        if (course.calculator)
          updated[course.id] = reconcileStudyDraft(
            current[course.id],
            course.calculator,
          );
      }
      return updated;
    });
  }, [query.data]);

  if (query.isLoading) return <LoadingPanel title="Загружаем учёбу…" />;
  if (!query.data)
    return (
      <ErrorPanel
        title="Не удалось загрузить учёбу"
        detail="Проверь подключение и попробуй ещё раз."
        onRetry={() => void query.refetch()}
      />
    );

  const data = query.data;
  const course =
    data.courses.find((item) => item.id === courseId) ??
    data.courses.find((item) => item.calculator) ??
    data.courses[0];
  const draft = course?.calculator
    ? (drafts[course.id] ?? createStudyDraft(course.calculator))
    : null;
  const dirtyCount = Object.values(drafts).filter(studyDraftIsDirty).length;
  return (
    <div className="min-w-0 space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[26px] font-semibold text-white">Учёба</h1>
          <p className="mt-1 text-sm text-zinc-400">
            {data.courses.length} курсов · {data.records.length} оценочных
            записей
          </p>
        </div>
        <button
          type="button"
          onClick={() => void query.refetch()}
          disabled={query.isFetching || save.isPending}
          aria-label="Обновить учёбу"
          className="grid min-h-11 min-w-11 shrink-0 place-items-center rounded-lg border border-white/[0.08] text-zinc-300 hover:bg-white/[0.05] active:scale-[0.98] disabled:opacity-50"
        >
          <RefreshCw className="h-5 w-5" aria-hidden="true" />
        </button>
      </header>
      {query.isError ? (
        <ErrorPanel
          title="Не удалось обновить данные"
          detail="Показаны ранее загруженные данные. Несохранённые значения калькулятора сохранены на экране."
          onRetry={() => void query.refetch()}
        />
      ) : null}
      {dirtyCount ? (
        <p className="text-xs text-amber-200" role="status">
          Есть несохранённые сценарии: {dirtyCount}. Сохрани их перед выходом из
          раздела.
        </p>
      ) : null}
      <div
        className="grid grid-cols-3 gap-1 rounded-xl border border-white/[0.08] bg-white/[0.03] p-1"
        role="tablist"
        aria-label="Разделы учёбы"
      >
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            id={`study-tab-${id}`}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls="study-panel"
            tabIndex={tab === id ? 0 : -1}
            onKeyDown={(event) => {
              if (event.key !== "ArrowRight" && event.key !== "ArrowLeft")
                return;
              event.preventDefault();
              const next =
                tabs[
                  (tabs.findIndex((item) => item.id === tab) +
                    (event.key === "ArrowRight" ? 1 : 2)) %
                    tabs.length
                ];
              setTab(next.id);
              document.getElementById(`study-tab-${next.id}`)?.focus();
            }}
            onClick={() => setTab(id)}
            className={cx(
              "flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-1 py-2 text-[11px] font-semibold transition-colors hover:bg-white/[0.06] active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400",
              tab === id ? "bg-cyan-400/10 text-cyan-200" : "text-zinc-400",
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
      <div
        id="study-panel"
        role="tabpanel"
        aria-labelledby={`study-tab-${tab}`}
      >
        {tab === "schedule" ? (
          <StudySchedule courses={data.courses} timezone={data.timezone} />
        ) : null}
        {tab === "grades" ? <StudyGrades records={data.records} /> : null}
        {tab === "calculator" ? (
          <div className="space-y-4">
            {!data.courses.length ? (
              <p className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 text-sm text-zinc-400">
                Курсы пока не добавлены. Импортируй учебный план, затем обнови
                этот экран.
              </p>
            ) : (
              <label className="block text-sm text-zinc-300">
                Предмет
                <select
                  className="mt-2 min-h-11 w-full min-w-0 max-w-full rounded-lg border border-white/[0.12] bg-graphite-900 px-3 py-3 text-base text-white"
                  value={course?.id}
                  onChange={(event) => setCourseId(event.target.value)}
                >
                  {data.courses.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                      {drafts[item.id] && studyDraftIsDirty(drafts[item.id])
                        ? " • не сохранено"
                        : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {course && draft ? (
              <StudyCalculator
                key={course.id}
                course={course}
                draft={draft}
                onChange={(next) => {
                  setDrafts((current) => ({ ...current, [course.id]: next }));
                  setSavedCourse(null);
                  setErrors((current) => ({ ...current, [course.id]: null }));
                }}
                onReset={() => {
                  if (course.calculator)
                    setDrafts((current) => ({
                      ...current,
                      [course.id]: createStudyDraft(course.calculator!),
                    }));
                  setErrors((current) => ({ ...current, [course.id]: null }));
                }}
                onSave={(state) => {
                  setErrors((current) => ({ ...current, [course.id]: null }));
                  save.mutate(
                    { courseId: course.id, state },
                    {
                      onSuccess: (stored) => {
                        setDrafts((current) => ({
                          ...current,
                          [course.id]: createStudyDraft(stored),
                        }));
                        setSavedCourse(course.id);
                      },
                      onError: (error) =>
                        setErrors((current) => ({
                          ...current,
                          [course.id]:
                            error instanceof ApiError && error.status === 409
                              ? "Данные курса изменились. Обнови их и попробуй сохранить ещё раз. Твои введённые значения останутся на экране."
                              : "Не удалось сохранить сценарий. Проверь подключение и повтори сохранение.",
                        })),
                    },
                  );
                }}
                saving={save.isPending}
                saved={savedCourse === course.id}
                saveError={errors[course.id] ?? null}
                onRefresh={() => void query.refetch()}
              />
            ) : course ? (
              <p className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 text-sm text-zinc-400">
                Для этого предмета ещё нет схемы расчёта. Добавь её в учебный
                план и обнови экран. Оценки Moodle доступны на вкладке «Оценки».
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
