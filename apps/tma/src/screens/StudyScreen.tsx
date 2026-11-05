import {
  BookOpen,
  BookOpenCheck,
  BookText,
  Calculator,
  CalendarDays,
  GraduationCap,
  MapPinned,
  RefreshCw,
} from "lucide-react";
import { useEffect, useState } from "react";
import { ApiError } from "../api/client";
import {
  useConfigureStudyCalculatorMutation,
  useSaveStudyCalculatorMutation,
  useSaveScholarshipPlanMutation,
  useStudyQuery,
} from "../api/study";
import {
  useGradeEventFeed,
  useGradePolicyReviewMutation,
} from "../api/academic-intelligence";
import {
  gradeTargetDefinitionKey,
  gradeTargetBindingsKey,
  gradeTargetContextKey,
} from "../../../../packages/core/src/grade-target.js";
import { GradeTargetBindings } from "../components/study/GradeTargetBindings";
import { ErrorPanel, LoadingPanel } from "../components/AsyncState";
import { StudyCalculator } from "../components/study/StudyCalculator";
import { StudyCampusMap } from "../components/study/StudyCampusMap";
import { StudyGrades } from "../components/study/StudyGrades";
import { StudySchedule } from "../components/study/StudySchedule";
import { StudySyllabi } from "../components/study/StudySyllabi";
import { StudyLmsOverview } from "../components/study/StudyLmsOverview";
import {
  resolveOwnedStudyCourse,
  studyCourseIdFromSearch,
} from "../components/study/grade-target-model";
import {
  STUDY_NAVIGATION_TABS,
  studyTabFromRequest,
  type StudyTabId,
} from "../components/study/study-navigation";
import type { GradeTargetLmsSource } from "../../../../packages/core/src/grade-target.js";
import { AcademicConciergeScreen } from "../components/study/AcademicConciergeScreen";
import {
  createStudyDraft,
  isStudyDrafts,
  reconcileStudyDraft,
  studyDraftIsDirty,
  type StudyDraft,
} from "../components/study/model";
import { cx } from "../lib/styles";
import {
  readSessionDraft,
  useDraftStorageKey,
  writeSessionDraft,
} from "../lib/session-draft";
import { matchSyllabusProfile } from "../components/study/syllabus-profiles";
import { useStudySyllabusProfiles } from "../components/study/useStudySyllabusProfiles";
import {
  studySyllabusAutoApplication,
  studySyllabusDefinitionMatches,
} from "../../../../packages/core/src/study-syllabi.js";

const tabIcons = {
  schedule: CalendarDays,
  work: BookOpenCheck,
  concierge: GraduationCap,
  calculator: Calculator,
  grades: BookOpen,
  syllabi: BookText,
  map: MapPinned,
};
const tabs = STUDY_NAVIGATION_TABS.map((tab) => ({
  ...tab,
  icon: tabIcons[tab.id],
}));

function initialStudyTab(): StudyTabId {
  const requested = new URLSearchParams(window.location.search).get("studyTab");
  return studyTabFromRequest(requested) ?? "schedule";
}
function StudyConnectionStrip({
  lms,
  onOpenLms,
  onOpenWork,
}: {
  lms?: GradeTargetLmsSource;
  onOpenLms: () => void;
  onOpenWork: () => void;
}) {
  return (
    <section
      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] p-3"
      aria-label="Подключение Moodle"
    >
      <p className="text-xs text-zinc-400">
        {!lms
          ? "Статус Moodle пока не загружен"
          : !lms.configured
            ? "Moodle не подключён"
            : lms.stale
              ? "Moodle: требуется свежая синхронизация"
              : "Moodle подключён"}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onOpenWork}
          className="min-h-11 rounded-lg px-2 text-xs text-cyan-200"
        >
          Работы и дедлайны
        </button>
        <button
          type="button"
          onClick={onOpenLms}
          className="min-h-11 rounded-lg border border-white/10 px-2 text-xs text-zinc-300"
        >
          Подключение Moodle
        </button>
      </div>
    </section>
  );
}

export function StudyScreen({
  onOpenLms,
  onDirtyChange,
}: {
  onOpenLms: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const query = useStudyQuery();
  const syllabi = useStudySyllabusProfiles(query.data);
  const save = useSaveStudyCalculatorMutation();
  const configure = useConfigureStudyCalculatorMutation();
  const policyFeed = useGradeEventFeed();
  const reviewPolicy = useGradePolicyReviewMutation();
  const saveBindings = useSaveScholarshipPlanMutation();
  const [pendingProfile, setPendingProfile] = useState<string | null>(null);
  const [tab, setTab] = useState<StudyTabId>(initialStudyTab);
  const [academicDirty, setAcademicDirty] = useState(false);
  function selectStudyTab(next: StudyTabId) {
    if (
      next !== tab &&
      academicDirty &&
      !window.confirm(
        "Отменить несохранённые правки учебных событий и открыть другой раздел?",
      )
    )
      return false;
    if (next !== tab) {
      setAcademicDirty(false);
      onDirtyChange?.(false);
    }
    setTab(next);
    return true;
  }
  const [courseId, setCourseId] = useState<string | null>(() =>
    studyCourseIdFromSearch(new URLSearchParams(window.location.search)),
  );
  useEffect(() => {
    const navigate = () => {
      const params = new URLSearchParams(window.location.search);
      if (params.get("screen") !== "study") return;
      const requested = studyTabFromRequest(params.get("studyTab"));
      if (requested) {
        if (!selectStudyTab(requested)) {
          const restored = new URL(window.location.href);
          restored.searchParams.set("studyTab", tab);
          if (courseId) restored.searchParams.set("courseId", courseId);
          else restored.searchParams.delete("courseId");
          window.history.replaceState(null, "", restored);
          return;
        }
      }
      const requestedCourse = studyCourseIdFromSearch(params);
      setCourseId(requestedCourse);
    };
    window.addEventListener("lifeos:navigation", navigate);
    window.addEventListener("popstate", navigate);
    return () => {
      window.removeEventListener("lifeos:navigation", navigate);
      window.removeEventListener("popstate", navigate);
    };
  }, [academicDirty, tab, courseId, onDirtyChange]);
  const storageKey = useDraftStorageKey("study");
  const [drafts, setDrafts] = useState<Record<string, StudyDraft>>(
    () => readSessionDraft(storageKey, isStudyDrafts) ?? {},
  );
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [savedCourse, setSavedCourse] = useState<string | null>(null);

  useEffect(() => {
    const unsaved = Object.fromEntries(
      Object.entries(drafts).filter(([, draft]) => studyDraftIsDirty(draft)),
    );
    writeSessionDraft(
      storageKey,
      Object.keys(unsaved).length ? unsaved : undefined,
    );
  }, [storageKey, drafts]);

  useEffect(() => {
    const url = new URL(window.location.href);
    // Visited screens remain mounted under primary navigation. A hidden Study
    // screen must not replace another screen's URL when background data updates.
    if (url.searchParams.get("screen") !== "study") return;
    url.searchParams.set("screen", "study");
    url.searchParams.set("studyTab", tab);
    if (courseId) url.searchParams.set("courseId", courseId);
    else if (courseId === null) url.searchParams.delete("courseId");
    window.history.replaceState(null, "", url);
  }, [tab, courseId]);

  useEffect(() => {
    setDrafts((current) => {
      const updated = { ...current };
      for (const course of syllabi.courses) {
        if (course.calculator)
          updated[course.id] = reconcileStudyDraft(
            current[course.id],
            course.calculator,
          );
      }
      return updated;
    });
  }, [syllabi.courses]);

  if (query.isLoading)
    return (
      <div className="min-w-0 space-y-4">
        <StudyConnectionStrip
          lms={policyFeed.data?.lms}
          onOpenLms={onOpenLms}
          onOpenWork={() => selectStudyTab("work")}
        />
        <LoadingPanel title="Загружаем учёбу…" />
      </div>
    );
  if (!query.data)
    return (
      <div className="min-w-0 space-y-4">
        <StudyConnectionStrip
          lms={policyFeed.data?.lms}
          onOpenLms={onOpenLms}
          onOpenWork={() => selectStudyTab("work")}
        />
        <ErrorPanel
          title="Не удалось загрузить учёбу"
          detail="Проверь подключение и попробуй ещё раз."
          onRetry={() => void query.refetch()}
        />
      </div>
    );

  const data = { ...query.data, courses: syllabi.courses };
  const course = resolveOwnedStudyCourse(data.courses, courseId);
  const unavailableCourse = courseId !== null && !course;
  const draft = course?.calculator
    ? (drafts[course.id] ?? createStudyDraft(course.calculator))
    : null;
  const dirtyCount = Object.values(drafts).filter(studyDraftIsDirty).length;
  const syllabusProfile = course
    ? matchSyllabusProfile(course.title, course.code)
    : null;
  const profileApplied = Boolean(
    syllabusProfile &&
    course?.calculator &&
    studySyllabusDefinitionMatches(
      course.calculator.definition,
      syllabusProfile.definition,
    ),
  );
  const storedCourse = query.data.courses.find(
    (item) => item.id === course?.id,
  );
  const autoApplication = storedCourse
    ? studySyllabusAutoApplication(storedCourse)
    : null;
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
          disabled={
            query.isFetching ||
            save.isPending ||
            configure.isPending ||
            syllabi.pending
          }
          aria-label="Обновить учёбу"
          className="grid min-h-11 min-w-11 shrink-0 place-items-center rounded-lg border border-white/[0.08] text-zinc-300 hover:bg-white/[0.05] active:scale-[0.98] disabled:opacity-50"
        >
          <RefreshCw className="h-5 w-5" aria-hidden="true" />
        </button>
      </header>
      <StudyConnectionStrip
        lms={policyFeed.data?.lms}
        onOpenLms={onOpenLms}
        onOpenWork={() => selectStudyTab("work")}
      />
      {syllabi.pending ? (
        <p role="status" className="text-xs text-emerald-200">
          Сохраняем формулы из силабусов для найденных предметов…
        </p>
      ) : null}
      {Object.keys(syllabi.errors).length > 0 ? (
        <div
          role="alert"
          className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-4 text-sm text-amber-100"
        >
          <p>
            Формулы показаны на экране, но ещё не сохранены для{" "}
            {Object.keys(syllabi.errors).length} курсов.
          </p>
          <p className="mt-1 text-xs">{Object.values(syllabi.errors)[0]}</p>
          <button
            type="button"
            onClick={syllabi.retry}
            disabled={syllabi.pending}
            className="mt-2 min-h-11 rounded-lg border border-white/10 px-3 hover:bg-white/5 active:scale-[0.98] disabled:opacity-50"
          >
            Повторить сохранение формул
          </button>
        </div>
      ) : null}
      {query.isError ? (
        <ErrorPanel
          title="Не удалось обновить данные"
          detail="Показаны ранее загруженные данные. Несохранённые значения калькулятора сохранены на экране."
          onRetry={() => void query.refetch()}
        />
      ) : null}
      {dirtyCount ? (
        <p className="text-xs text-amber-200" role="status">
          Есть несохранённые сценарии: {dirtyCount}. Черновики восстанавливаются
          после обновления страницы в этой вкладке. Сохрани их для постоянного
          хранения.
        </p>
      ) : null}
      <div
        className="grid grid-cols-4 gap-1 rounded-xl border border-white/[0.08] bg-white/[0.03] p-1 sm:grid-cols-7"
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
                    (event.key === "ArrowRight" ? 1 : tabs.length - 1)) %
                    tabs.length
                ];
              if (selectStudyTab(next.id))
                document.getElementById(`study-tab-${next.id}`)?.focus();
            }}
            onClick={() => selectStudyTab(id)}
            className={cx(
              "flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-0.5 py-2 text-[10px] font-semibold transition-colors hover:bg-white/[0.06] active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400",
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
        {tab === "work" ? (
          <StudyLmsOverview onOpenConnection={onOpenLms} />
        ) : null}
        {tab === "concierge" ? (
          <AcademicConciergeScreen
            onDirtyChange={(value) => {
              setAcademicDirty(value);
              onDirtyChange?.(value);
            }}
          />
        ) : null}
        {tab === "grades" ? (
          <StudyGrades
            records={data.records}
            courses={query.data.courses}
            reviews={policyFeed.data?.preferences.courseReviews}
            lms={policyFeed.data?.lms}
            selectedCourseId={courseId}
            onSelectCourse={setCourseId}
            events={policyFeed.data?.events}
            historyTruncated={policyFeed.data?.truncated}
            onAnalyze={(id) => {
              setCourseId(id);
              selectStudyTab("calculator");
            }}
          />
        ) : null}
        {tab === "syllabi" ? <StudySyllabi courses={data.courses} /> : null}
        {tab === "map" ? <StudyCampusMap /> : null}
        {tab === "calculator" ? (
          <div className="space-y-4">
            {unavailableCourse ? (
              <div
                role="status"
                className="rounded-xl border border-amber-400/20 p-4 text-sm text-amber-200"
              >
                <p>Запрошенный курс недоступен. Выбери свой курс ниже.</p>
                <button
                  type="button"
                  onClick={() => setCourseId(null)}
                  className="mt-2 min-h-11 rounded-lg border border-white/10 px-3 text-xs"
                >
                  Снять выбор курса
                </button>
              </div>
            ) : null}
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
                  value={course?.id ?? ""}
                  onChange={(event) => setCourseId(event.target.value)}
                >
                  {unavailableCourse ? (
                    <option value="" disabled>
                      Выбери свой курс
                    </option>
                  ) : null}
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
            {course && syllabusProfile && !profileApplied ? (
              <section className="rounded-2xl border border-emerald-300/20 bg-emerald-300/[0.06] p-4">
                <div className="text-[11px] font-bold uppercase tracking-widest text-emerald-200">
                  Схема найдена в силабусе
                </div>
                <h2 className="mt-1 text-base font-bold text-white">
                  {syllabusProfile.title}
                </h2>
                <p className="mt-2 text-xs text-zinc-300">
                  {syllabusProfile.source} · стр. {syllabusProfile.sourcePage}.
                  У курса сохранена собственная формула. Она сохранена без
                  изменений. По подтверждению можно заменить её формулой из
                  силабуса. Сохранятся только оценки с теми же идентификаторами
                  работ.
                </p>
                {pendingProfile === course.id ? (
                  <div className="mt-3 flex flex-col gap-2">
                    <button
                      type="button"
                      disabled={configure.isPending || save.isPending}
                      onClick={() => {
                        configure.mutate(
                          {
                            courseId: course.id,
                            definition: syllabusProfile.definition,
                            target: course.calculator?.target ?? 70,
                            expectedState: storedCourse?.calculator ?? null,
                          },
                          {
                            onSuccess: (state) => {
                              setDrafts((current) => ({
                                ...current,
                                [course.id]: createStudyDraft(state),
                              }));
                              setPendingProfile(null);
                              setSavedCourse(null);
                            },
                            onError: () => setPendingProfile(null),
                          },
                        );
                      }}
                      className="min-h-11 rounded-xl bg-emerald-200 px-3 text-sm font-bold text-graphite-950 disabled:opacity-50"
                    >
                      {configure.isPending
                        ? "Применяем…"
                        : "Подтвердить: применить веса"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingProfile(null)}
                      className="min-h-11 rounded-xl border border-white/10 text-sm text-zinc-300"
                    >
                      Отмена
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={configure.isPending || save.isPending}
                    onClick={() => setPendingProfile(course.id)}
                    className="mt-3 min-h-11 w-full rounded-xl bg-emerald-200 px-3 text-sm font-bold text-graphite-950 disabled:opacity-50"
                  >
                    Использовать формулу из силабуса
                  </button>
                )}
              </section>
            ) : null}
            {configure.isError ? (
              <p role="alert" className="text-sm text-rose-200">
                Не удалось применить схему. Проверь соединение и попробуй снова.
              </p>
            ) : null}
            {course && draft ? (
              <>
                <GradeTargetBindings
                  key={`bindings-${course.id}`}
                  course={storedCourse ?? course}
                  records={data.records}
                  saving={saveBindings.isPending}
                  error={
                    saveBindings.isError
                      ? "Не удалось сохранить связь. Обнови данные и повтори: параллельные правки не перезаписываются."
                      : null
                  }
                  onSave={(config) =>
                    saveBindings.mutate({
                      courseId: course.id,
                      config,
                      expectedConfig: storedCourse?.scholarship ?? null,
                    })
                  }
                />
                {policyFeed.isError ? (
                  <p className="text-xs text-amber-200">
                    Проверку политики загрузить не удалось. Расчёт остаётся
                    условным.
                  </p>
                ) : null}
                <StudyCalculator
                  key={course.id}
                  course={storedCourse ?? course}
                  records={data.records}
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
                  saving={
                    save.isPending ||
                    configure.isPending ||
                    Boolean(autoApplication && syllabi.pending)
                  }
                  syllabusUnpersisted={Boolean(autoApplication)}
                  saved={savedCourse === course.id}
                  saveError={errors[course.id] ?? null}
                  onRefresh={() => void query.refetch()}
                  policyReview={
                    policyFeed.data?.preferences.courseReviews[course.id]
                  }
                  lms={policyFeed.data?.lms}
                  onReview={
                    policyFeed.data && storedCourse?.calculator
                      ? (sourceRef) =>
                          reviewPolicy.mutate({
                            courseId: course.id,
                            expectedRevision:
                              policyFeed.data!.preferences.revision,
                            definitionKey: gradeTargetDefinitionKey(
                              storedCourse.calculator!.definition,
                            ),
                            bindingsKey: gradeTargetBindingsKey(
                              storedCourse.scholarship?.bindings ?? {},
                            ),
                            contextKey: gradeTargetContextKey({
                              externalCourseKey: storedCourse.externalCourseKey,
                              startsOn: storedCourse.startsOn,
                              endsOn: storedCourse.endsOn,
                            }),
                            sourceRef,
                          })
                      : undefined
                  }
                  reviewing={reviewPolicy.isPending}
                  reviewError={
                    reviewPolicy.isError
                      ? "Проверка не сохранена. Обнови данные: формула, связи или настройки могли измениться."
                      : null
                  }
                />
              </>
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
