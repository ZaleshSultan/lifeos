import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { resolveStudyCalculator } from "../../../../../packages/core/src/study-syllabi.js";
import { ApiError } from "../../api/client";
import {
  studyQueryKey,
  useConfigureStudyCalculatorMutation,
  type StudyWorkspace,
} from "../../api/study";
import {
  applyStudySyllabusProfiles,
  studySyllabusApplications,
} from "./syllabus-application";

// Share in-flight upgrades across screen changes and StrictMode effect replays.
const inFlight = new WeakMap<QueryClient, Map<string, Promise<unknown>>>();

export function useStudySyllabusProfiles(data?: StudyWorkspace) {
  const queryClient = useQueryClient();
  const { mutateAsync: configure } = useConfigureStudyCalculatorMutation();
  const attempted = useRef(new Set<string>());
  const [revision, setRevision] = useState(0);
  const [active, setActive] = useState(0);
  const [failures, setFailures] = useState<Record<string, string>>({});
  const courses = useMemo(
    () =>
      (data?.courses ?? []).map((course) => ({
        ...course,
        calculator: resolveStudyCalculator(course),
      })),
    [data],
  );
  const applications = useMemo(
    () => studySyllabusApplications(data?.courses ?? []),
    [data],
  );

  useEffect(() => {
    const next = applications.filter((application) => {
      const key = JSON.stringify(application);
      if (attempted.current.has(key)) return false;
      attempted.current.add(key);
      return true;
    });
    if (!next.length) return;
    let running = inFlight.get(queryClient);
    if (!running) {
      running = new Map();
      inFlight.set(queryClient, running);
    }
    const jobs = running;
    setActive((count) => count + 1);
    void applyStudySyllabusProfiles(next, (application) => {
      const key = JSON.stringify(application);
      const existing = jobs.get(key);
      if (existing) return existing;
      const promise = configure(application);
      jobs.set(key, promise);
      void promise.then(
        () => jobs.delete(key),
        () => jobs.delete(key),
      );
      return promise;
    }).then((failed) => {
      setFailures((current) => {
        const updated = { ...current };
        for (const application of next) delete updated[application.courseId];
        for (const { courseId, error } of failed) {
          updated[courseId] =
            error instanceof ApiError && error.status === 409
              ? "Сценарий курса изменился. Данные обновляются; повтори применение формулы."
              : "Не удалось сохранить формулу из силабуса. Проверь соединение и повтори.";
        }
        return updated;
      });
      setActive((count) => count - 1);
      if (
        failed.some(
          ({ error }) => error instanceof ApiError && error.status === 409,
        )
      )
        void queryClient.invalidateQueries({ queryKey: studyQueryKey });
    });
  }, [applications, configure, queryClient, revision]);

  // Errors stop being relevant if a refresh reveals a custom or updated formula.
  const errors = Object.fromEntries(
    applications
      .filter(({ courseId }) => failures[courseId])
      .map(({ courseId }) => [courseId, failures[courseId]]),
  );
  return {
    courses,
    pending: active > 0,
    errors,
    retry: () => {
      attempted.current.clear();
      setFailures({});
      setRevision((value) => value + 1);
    },
  };
}
