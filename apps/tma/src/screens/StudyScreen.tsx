import {
  BookOpen,
  BookText,
  Calculator,
  CalendarDays,
  ClipboardList,
  GraduationCap,
  MapPinned,
  RefreshCw,
  Timer,
  Sun,
} from "lucide-react";
import { useEffect, useState } from "react";
import { ApiError } from "../api/client";
import {
  useSaveStudyCalculatorMutation,
  useStudyQuery,
  type StudyWorkspaceCourse,
} from "../api/study";
import { ErrorPanel, LoadingPanel } from "../components/AsyncState";
import { StudyCalculator } from "../components/study/StudyCalculator";
import { StudyCampusMap } from "../components/study/StudyCampusMap";
import { StudyGrades } from "../components/study/StudyGrades";
import { StudySchedule } from "../components/study/StudySchedule";
import { StudySyllabi } from "../components/study/StudySyllabi";
import {
  StudyAssignments,
  StudyCourses,
  StudyDeadlines,
  StudyToday,
  studyInputClass,
  studyPanelClass,
} from "../components/study/StudyWorkspacePanels";
import {
  createStudyDraft,
  reconcileStudyDraft,
  studyDraftIsDirty,
  studyTimezone,
  type StudyDraft,
} from "../components/study/model";
import {
  studyNavigationUrl,
  studyTabFromSearch,
  type StudyTabId,
} from "../components/study/navigation";
import { cx } from "../lib/styles";
import { telegram } from "../telegram";

const tabs = [
  { id: "today", label: "Сегодня", icon: Sun },
  { id: "courses", label: "Предметы", icon: GraduationCap },
  { id: "assignments", label: "Задания", icon: ClipboardList },
  { id: "deadlines", label: "Дедлайны", icon: Timer },
  { id: "schedule", label: "Расписание", icon: CalendarDays },
  { id: "grades", label: "Оценки", icon: BookOpen },
  { id: "calculator", label: "Цель 70+", icon: Calculator },
  { id: "syllabi", label: "Силлабусы", icon: BookText },
  { id: "map", label: "Карта", icon: MapPinned },
] as const;

function calculatorForCourse(course: StudyWorkspaceCourse) {
  return course.calculator
    ? {
        ...course.calculator,
        values: { ...course.calculator.values, ...course.actualValues },
      }
    : null;
}

export function StudyScreen() {
  const query = useStudyQuery();
  const save = useSaveStudyCalculatorMutation();
  const [tab, setTab] = useState<StudyTabId>(() =>
    studyTabFromSearch(window.location.search, telegram.initData),
  );
  const [courseId, setCourseId] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get("studyCourse"),
  );
  const [drafts, setDrafts] = useState<Record<string, StudyDraft>>({});
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [savedCourse, setSavedCourse] = useState<string | null>(null);

  useEffect(() => {
    window.history.replaceState(
      null,
      "",
      studyNavigationUrl(window.location.href, tab, courseId),
    );
  }, [tab, courseId]);
  useEffect(() => {
    const update = () => {
      setTab(studyTabFromSearch(window.location.search, telegram.initData));
      setCourseId(
        new URLSearchParams(window.location.search).get("studyCourse"),
      );
    };
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  useEffect(() => {
    if (!query.data) return;
    setDrafts((current) => {
      const updated: Record<string, StudyDraft> = {};
      for (const course of query.data.courses) {
        const calculator = calculatorForCourse(course);
        if (calculator)
          updated[course.id] = reconcileStudyDraft(
            current[course.id],
            calculator,
          );
      }
      return updated;
    });
  }, [query.data]);

  if (!query.data && tab === "map")
    return (
      <div className="space-y-4">
        <StudyCampusMap />
        <button
          type="button"
          className="min-h-11 w-full rounded-lg border border-white/[0.12] px-3 text-sm text-cyan-200"
          onClick={() => setTab("today")}
        >
          Открыть учебные разделы
        </button>
      </div>
    );
  if (query.isLoading) return <LoadingPanel title="Загружаем учёбу…" />;
  if (!query.data)
    return (
      <ErrorPanel
        title="Не удалось загрузить учёбу"
        detail="Проверь подключение и попробуй ещё раз."
        onRetry={() => void query.refetch()}
      />
    );
  const data = { ...query.data, timezone: studyTimezone(query.data.timezone) };
  const course =
    data.courses.find((item) => item.id === courseId) ??
    data.courses.find((item) => item.calculator) ??
    data.courses[0];
  const calculator = course ? calculatorForCourse(course) : null;
  const draft =
    calculator && course
      ? (drafts[course.id] ?? createStudyDraft(calculator))
      : null;
  const dirtyCount = Object.values(drafts).filter(studyDraftIsDirty).length;
  const navigate = (next: string, id?: string) => {
    const nextTab = tabs.find((item) => item.id === next)?.id ?? "today";
    window.history.pushState(
      null,
      "",
      studyNavigationUrl(window.location.href, nextTab, id ?? null),
    );
    setTab(nextTab);
    setCourseId(id ?? null);
  };

  return (
    <div className="min-w-0 space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[26px] font-semibold text-white">Учёба</h1>
          <p className="mt-1 text-sm text-zinc-400">
            {data.courses.length} предметов · {(data.assignments ?? []).length}{" "}
            работ
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
          detail="Показаны ранее загруженные данные. Введённые сценарии сохранены на экране."
          onRetry={() => void query.refetch()}
        />
      ) : null}
      {dirtyCount ? (
        <p className="text-xs text-amber-200" role="status">
          Есть несохранённые сценарии: {dirtyCount}. Сохрани их перед выходом.
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
              if (
                !["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)
              )
                return;
              event.preventDefault();
              const index = tabs.findIndex((item) => item.id === tab);
              const next =
                event.key === "Home"
                  ? tabs[0]
                  : event.key === "End"
                    ? tabs[tabs.length - 1]
                    : tabs[
                        (index +
                          (event.key === "ArrowRight" ? 1 : tabs.length - 1)) %
                          tabs.length
                      ];
              navigate(next.id, courseId ?? undefined);
              document.getElementById(`study-tab-${next.id}`)?.focus();
            }}
            onClick={() => navigate(id, courseId ?? undefined)}
            className={cx(
              "flex min-h-14 min-w-0 items-center justify-center gap-1.5 rounded-lg px-1 py-2 text-[11px] font-semibold transition-colors hover:bg-white/[0.06] active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400",
              tab === id ? "bg-cyan-400/10 text-cyan-200" : "text-zinc-400",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
      <div
        id="study-panel"
        role="tabpanel"
        aria-labelledby={`study-tab-${tab}`}
      >
        {tab === "today" ? (
          <StudyToday data={data} onNavigate={navigate} />
        ) : null}
        {tab === "courses" ? (
          <StudyCourses data={data} onNavigate={navigate} />
        ) : null}
        {tab === "assignments" ? (
          <StudyAssignments
            data={data}
            courseId={courseId}
            onCourseChange={setCourseId}
          />
        ) : null}
        {tab === "deadlines" ? (
          <StudyDeadlines
            data={data}
            onAssignments={(id) => navigate("assignments", id)}
          />
        ) : null}
        {tab === "schedule" ? (
          <StudySchedule courses={data.courses} timezone={data.timezone} />
        ) : null}
        {tab === "grades" ? (
          <StudyGrades
            records={data.records}
            workspace={data}
            courseId={courseId}
          />
        ) : null}
        {tab === "syllabi" ? (
          <StudySyllabi
            courses={data.courses}
            initialCourseId={courseId}
            onCourseChange={setCourseId}
          />
        ) : null}
        {tab === "map" ? <StudyCampusMap /> : null}
        {tab === "calculator" ? (
          <div className="space-y-4">
            {data.courses.length ? (
              <label className="block text-sm text-zinc-300">
                Предмет
                <select
                  className={studyInputClass}
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
            ) : (
              <p className={cx(studyPanelClass, "text-sm text-zinc-400")}>
                Курсы пока не добавлены. Подключи источник или импортируй
                учебный план.
              </p>
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
                  if (calculator)
                    setDrafts((current) => ({
                      ...current,
                      [course.id]: createStudyDraft(calculator),
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
                              ? "Схема изменилась. Обнови данные и проверь введённые значения."
                              : "Не удалось сохранить сценарий. Повтори сохранение.",
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
              <div className={studyPanelClass}>
                <p className="text-sm text-zinc-400">
                  Для предмета нет проверенной схемы. Загрузи PDF и настрой
                  компоненты.
                </p>
                <button
                  type="button"
                  className="mt-3 min-h-11 text-sm text-cyan-200"
                  onClick={() => navigate("syllabi", course.id)}
                >
                  Открыть силлабусы
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
