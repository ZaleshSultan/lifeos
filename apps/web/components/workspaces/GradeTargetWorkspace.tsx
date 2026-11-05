"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { GradeEventFeed } from "../../../../packages/core/src/academic-intelligence.js";
import {
  gradeTargetDefinitionKey,
  gradeTargetBindingsKey,
  gradeTargetContextKey,
} from "../../../../packages/core/src/grade-target.js";
import { syllabusProfiles } from "../../../../packages/core/src/study-syllabi.js";
import type { StudyCalculatorState } from "../../../../packages/core/src/study.js";
import type { ScholarshipConfig } from "../../../../packages/core/src/scholarship.js";
import type { StudyWorkspace } from "../../../tma/src/api/study-types";
import { academicIntelligenceTransport } from "../../../tma/src/api/academic-intelligence-transport";
import { StudyCalculator } from "../../../tma/src/components/study/StudyCalculator";
import {
  resolveOwnedStudyCourse,
  studyCourseIdFromSearch,
} from "../../../tma/src/components/study/grade-target-model";
import { CourseGradeHistory } from "../../../tma/src/components/study/CourseGradeHistory";
import { StudyGrades } from "../../../tma/src/components/study/StudyGrades";
import { GradeTargetBindings } from "../../../tma/src/components/study/GradeTargetBindings";
import {
  createStudyDraft,
  reconcileStudyDraft,
  studyDraftIsDirty,
  type StudyDraft,
} from "../../../tma/src/components/study/model";
import {
  useDraftState,
  useDraftRetention,
} from "../../../tma/src/lib/retained-draft";
import {
  Notice,
  useUnsavedGuard,
  buttonClass,
  inputClass,
} from "../WorkspaceUI";
import { webRequest, webErrorMessage } from "../../lib/web-client";
import {
  gradeCalculatorBaseForEdit,
  startOwnedGradeSourceRefresh,
  type GradeCalculatorBases,
} from "./grade-source-refresh";

/** Same pure components and engine as TMA; all I/O stays on the authenticated web bridge. */
export function GradeTargetWorkspace({
  initial,
  initialFeed,
  initialCourseId = null,
  initialTab = "grades",
}: {
  initial: StudyWorkspace;
  initialFeed: GradeEventFeed | null;
  initialCourseId?: string | null;
  initialTab?: "grades" | "calculator";
}) {
  const [study, setStudy] = useState(initial);
  const [feed, setFeed] = useState(initialFeed);
  const [error, setError] = useState<string | null>(null);
  const [sourceError, setSourceError] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const sourceRefresh = useRef<ReturnType<
    typeof startOwnedGradeSourceRefresh
  > | null>(null);
  const transport = useMemo(
    () => academicIntelligenceTransport(webRequest),
    [],
  );
  const scope = "web-grade-target";
  const routeParams =
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search);
  const routeCourseId = routeParams
    ? studyCourseIdFromSearch(routeParams)
    : initialCourseId;
  const requestedTab = routeParams ? routeParams.get("studyTab") : initialTab;
  const [courseId, setCourseId] = useDraftState<string | null>(
    scope,
    "courseId",
    () => routeCourseId,
  );
  const [tab, setTab] = useDraftState<"grades" | "calculator">(
    scope,
    "tab",
    () => (requestedTab === "calculator" ? "calculator" : "grades"),
  );
  const [drafts, setDrafts] = useDraftState<Record<string, StudyDraft>>(
    scope,
    "drafts",
    {},
  );
  const [calculatorBases, setCalculatorBases] =
    useDraftState<GradeCalculatorBases>(scope, "calculatorBases", () =>
      Object.fromEntries(
        initial.courses.map((course) => [course.id, course.calculator]),
      ),
    );
  const [profileId, setProfileId] = useState("");
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const dirty = Object.values(drafts).some(studyDraftIsDirty);
  const retained = useDraftRetention(scope, dirty);
  useUnsavedGuard(dirty || busy, retained && !busy);
  // Explicit route selectors take precedence over a retained previous draft's selection.
  const activeCourseId = routeCourseId ?? courseId;
  const activeTab =
    requestedTab === "calculator" || requestedTab === "grades"
      ? requestedTab
      : tab;
  const course = resolveOwnedStudyCourse(study.courses, activeCourseId);
  const draft = course?.calculator
    ? (drafts[course.id] ?? createStudyDraft(course.calculator))
    : null;

  useEffect(() => {
    // Source DTOs are ephemeral. Retained form fields and their save bases stay separate.
    setStudy(initial);
    setFeed(initialFeed);
    const refresh = startOwnedGradeSourceRefresh({
      loadStudy: (signal) => webRequest<StudyWorkspace>("study", { signal }),
      loadFeed: (signal) => transport.feed(signal),
      onStudy: setStudy,
      onFeed: setFeed,
      onSuccess: () => setSourceError(false),
      onFailure: () => {
        setSourceError(true);
        setFeed((current) =>
          current ? { ...current, lms: { ...current.lms, stale: true } } : null,
        );
      },
      canRefresh: () =>
        !inFlight.current && document.visibilityState !== "hidden",
    });
    sourceRefresh.current = refresh;
    const visible = () => {
      if (document.visibilityState === "hidden") {
        refresh.abort();
        setFeed((current) =>
          current ? { ...current, lms: { ...current.lms, stale: true } } : null,
        );
      } else void refresh.refresh();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      document.removeEventListener("visibilitychange", visible);
      refresh.dispose();
      if (sourceRefresh.current === refresh) sourceRefresh.current = null;
    };
  }, [initial, initialFeed, transport]);

  useEffect(() => {
    setDrafts((current) => {
      const next = { ...current };
      for (const item of study.courses)
        if (item.calculator)
          next[item.id] = reconcileStudyDraft(
            current[item.id],
            item.calculator,
          );
      return next;
    });
  }, [study.courses, setDrafts]);
  useEffect(() => {
    setReplaceConfirmed(false);
  }, [course?.id, course?.calculator?.definition, profileId]);
  useEffect(() => {
    const navigate = () => {
      const params = new URLSearchParams(window.location.search);
      const id = studyCourseIdFromSearch(params);
      setCourseId(id);
      const requested = params.get("studyTab");
      if (requested === "calculator" || requested === "grades")
        setTab(requested);
    };
    window.addEventListener("popstate", navigate);
    window.addEventListener("lifeos:navigation", navigate);
    navigate();
    return () => {
      window.removeEventListener("popstate", navigate);
      window.removeEventListener("lifeos:navigation", navigate);
    };
  }, [setCourseId, setTab]);
  async function work(action: () => Promise<void>) {
    if (inFlight.current) return;
    sourceRefresh.current?.abort();
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      await action();
    } catch (e) {
      setError(webErrorMessage(e));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  function updateCalculator(id: string, calculator: StudyCalculatorState) {
    setCalculatorBases((current) => ({ ...current, [id]: calculator }));
    setStudy((current) => ({
      ...current,
      courses: current.courses.map((row) =>
        row.id === id ? { ...row, calculator } : row,
      ),
    }));
    setDrafts((current) => ({
      ...current,
      [id]: createStudyDraft(calculator),
    }));
    setSaved(id);
  }
  function openCalculator(id: string) {
    setCourseId(id);
    setTab("calculator");
    const url = new URL(window.location.href);
    url.searchParams.set("courseId", id);
    url.searchParams.set("studyTab", "calculator");
    window.history.replaceState(null, "", url);
  }
  function selectGradeCourse(id: string | null) {
    setCourseId(id);
    const url = new URL(window.location.href);
    if (id !== null) url.searchParams.set("courseId", id);
    else url.searchParams.delete("courseId");
    window.history.replaceState(null, "", url);
  }
  function openTab(value: "grades" | "calculator") {
    setTab(value);
    const url = new URL(window.location.href);
    url.searchParams.set("studyTab", value);
    window.history.replaceState(null, "", url);
  }
  return (
    <section
      className="min-w-0 space-y-4"
      aria-label="Оценки и симулятор по курсам"
    >
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={activeTab === "grades"}
          className={buttonClass}
          onClick={() => openTab("grades")}
        >
          Оценки и цель 70+
        </button>
        <button
          type="button"
          aria-pressed={activeTab === "calculator"}
          className={buttonClass}
          onClick={() => openTab("calculator")}
        >
          Симулятор по предмету
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={busy}
          onClick={() => void sourceRefresh.current?.refresh()}
        >
          {busy ? "Загружаем…" : "Обновить фактические данные"}
        </button>
      </div>
      {error ? <Notice error>{error}</Notice> : null}
      {sourceError ? (
        <Notice>
          Не удалось обновить фактические данные. Расчёт остаётся условным до
          успешной синхронизации; твой сценарий сохранён на экране.
        </Notice>
      ) : null}
      {!feed ? (
        <Notice>
          История и проверка политики недоступны. Расчёты остаются условными;
          сохранённые данные не заменяются.
        </Notice>
      ) : null}
      {activeTab === "grades" ? (
        <StudyGrades
          courses={study.courses}
          records={study.records}
          reviews={feed?.preferences.courseReviews}
          lms={feed?.lms}
          selectedCourseId={activeCourseId}
          onSelectCourse={selectGradeCourse}
          events={feed?.events}
          historyTruncated={feed?.truncated}
          onAnalyze={openCalculator}
        />
      ) : (
        <>
          <label className="block text-sm text-zinc-300">
            Предмет
            <select
              className={inputClass}
              value={course?.id ?? ""}
              disabled={busy}
              onChange={(e) => openCalculator(e.target.value)}
            >
              {!course ? (
                <option value="" disabled>
                  Выбери свой курс
                </option>
              ) : null}
              {study.courses.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.title}
                  {drafts[row.id] && studyDraftIsDirty(drafts[row.id])
                    ? " · не сохранено"
                    : ""}
                </option>
              ))}
            </select>
          </label>

          {!course ? (
            <Notice>
              {activeCourseId !== null
                ? "Запрошенный курс недоступен. Выбери свой курс выше."
                : "Курсы пока не добавлены. Оценки Moodle могут быть доступны отдельно."}
              {activeCourseId !== null ? (
                <button
                  type="button"
                  className={buttonClass}
                  onClick={() => selectGradeCourse(null)}
                >
                  Снять выбор курса
                </button>
              ) : null}
            </Notice>
          ) : (
            <>
              <details className="rounded-xl border border-white/10 p-4">
                <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-white">
                  Проверить или выбрать сохранённый профиль силабуса
                </summary>
                <p className="text-xs text-zinc-400">
                  Название предмета не доказывает текущую политику. Сверь
                  документ, семестр, веса и пороги. Применение формулы —
                  отдельное действие; последующая проверка политики потребуется
                  заново.
                </p>
                <label className="mt-3 block text-xs text-zinc-300">
                  Документ
                  <select
                    className={inputClass}
                    value={profileId}
                    disabled={busy}
                    onChange={(e) => {
                      setProfileId(e.target.value);
                      setReplaceConfirmed(false);
                    }}
                  >
                    <option value="">Выбери профиль</option>
                    {syllabusProfiles.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.title} · {row.source}, стр. {row.sourcePage}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="mt-3 flex min-h-11 items-start gap-3 text-xs text-zinc-300">
                  <input
                    type="checkbox"
                    checked={replaceConfirmed}
                    onChange={(e) => setReplaceConfirmed(e.target.checked)}
                    className="mt-1 h-5 w-5 shrink-0"
                  />
                  Я сверил(а) выбранный профиль с текущим курсом. Замена схемы
                  сбросит значения этого сценария; оценки Moodle сохранятся
                  отдельно.
                </label>
                <button
                  type="button"
                  className={buttonClass}
                  disabled={busy || !replaceConfirmed || !profileId}
                  onClick={() =>
                    void work(async () => {
                      const profile = syllabusProfiles.find(
                        (row) => row.id === profileId,
                      );
                      if (!profile) return;
                      const calculator = await webRequest<StudyCalculatorState>(
                        `study/courses/${encodeURIComponent(course.id)}/calculator/configure`,
                        {
                          method: "PUT",
                          body: JSON.stringify({
                            definition: profile.definition,
                            target: course.calculator?.target ?? 70,
                            values: {},
                            expectedState: course.calculator,
                          }),
                        },
                      );
                      updateCalculator(course.id, calculator);
                      setReplaceConfirmed(false);
                    })
                  }
                >
                  Применить выбранную формулу
                </button>
              </details>
              {draft ? (
                <>
                  <GradeTargetBindings
                    key={course.id}
                    course={course}
                    records={study.records}
                    saving={busy}
                    onSave={(config) =>
                      void work(async () => {
                        const savedConfig = await webRequest<ScholarshipConfig>(
                          `study/courses/${encodeURIComponent(course.id)}/scholarship`,
                          {
                            method: "PUT",
                            body: JSON.stringify({
                              config,
                              expectedConfig: course.scholarship ?? null,
                            }),
                          },
                        );
                        setStudy((current) => ({
                          ...current,
                          courses: current.courses.map((row) =>
                            row.id === course.id
                              ? { ...row, scholarship: savedConfig }
                              : row,
                          ),
                        }));
                      })
                    }
                  />
                  <StudyCalculator
                    key={course.id}
                    course={course}
                    records={study.records}
                    draft={draft}
                    onChange={(next) => {
                      setCalculatorBases((current) =>
                        gradeCalculatorBaseForEdit(current, course, draft),
                      );
                      setDrafts((current) => ({
                        ...current,
                        [course.id]: next,
                      }));
                      setSaved(null);
                    }}
                    onReset={() => {
                      setCalculatorBases((current) => ({
                        ...current,
                        [course.id]: course.calculator,
                      }));
                      if (course.calculator)
                        setDrafts((current) => ({
                          ...current,
                          [course.id]: createStudyDraft(course.calculator!),
                        }));
                    }}
                    onSave={(state) =>
                      void work(async () => {
                        const calculator =
                          await webRequest<StudyCalculatorState>(
                            `study/courses/${encodeURIComponent(course.id)}/calculator`,
                            {
                              method: "PUT",
                              body: JSON.stringify({
                                values: state.values,
                                target: state.target,
                                expectedState:
                                  calculatorBases[course.id] ?? null,
                              }),
                            },
                          );
                        updateCalculator(course.id, calculator);
                      })
                    }
                    saving={busy}
                    saved={saved === course.id}
                    saveError={null}
                    onRefresh={() => void sourceRefresh.current?.refresh()}
                    policyReview={feed?.preferences.courseReviews[course.id]}
                    lms={feed?.lms}
                    reviewing={busy}
                    reviewError={error}
                    onReview={
                      feed && course.calculator
                        ? (sourceRef) =>
                            void work(async () => {
                              setFeed(
                                await transport.review({
                                  courseId: course.id,
                                  expectedRevision: feed.preferences.revision,
                                  definitionKey: gradeTargetDefinitionKey(
                                    course.calculator!.definition,
                                  ),
                                  bindingsKey: gradeTargetBindingsKey(
                                    course.scholarship?.bindings ?? {},
                                  ),
                                  contextKey: gradeTargetContextKey({
                                    externalCourseKey: course.externalCourseKey,
                                    startsOn: course.startsOn,
                                    endsOn: course.endsOn,
                                  }),
                                  sourceRef,
                                }),
                              );
                            })
                        : undefined
                    }
                  />
                </>
              ) : (
                <Notice>
                  У курса нет сохранённых весов. Выбери и проверь профиль выше;
                  точный итог пока неизвестен.
                </Notice>
              )}
              {feed ? (
                <CourseGradeHistory
                  events={feed.events}
                  courseId={course.id}
                  title={course.title}
                  truncated={feed.truncated}
                />
              ) : null}
            </>
          )}
        </>
      )}
    </section>
  );
}
