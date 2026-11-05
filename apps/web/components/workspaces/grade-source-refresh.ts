import type { GradeEventFeed } from "../../../../packages/core/src/academic-intelligence.js";
import type {
  StudyWorkspace,
  StudyWorkspaceCourse,
} from "../../../tma/src/api/study-types";
import type { StudyCalculatorState } from "../../../../packages/core/src/study.js";
import {
  studyDraftIsDirty,
  type StudyDraft,
} from "../../../tma/src/components/study/model";

export type GradeCalculatorBases = Record<string, StudyCalculatorState | null>;
/** A refresh must not pair an old dirty hypothesis with a newer optimistic save version. */
export function gradeCalculatorBaseForEdit(
  bases: GradeCalculatorBases,
  course: StudyWorkspaceCourse,
  draft: StudyDraft | undefined,
): GradeCalculatorBases {
  return draft && studyDraftIsDirty(draft)
    ? bases
    : { ...bases, [course.id]: course.calculator };
}

/** Owned read adapters only; one request pair at a time, bounded time and lifetime. */
export function startOwnedGradeSourceRefresh(options: {
  loadStudy: (signal: AbortSignal) => Promise<StudyWorkspace>;
  loadFeed: (signal: AbortSignal) => Promise<GradeEventFeed>;
  onStudy: (study: StudyWorkspace) => void;
  onFeed: (feed: GradeEventFeed) => void;
  onFailure: () => void;
  onSuccess: () => void;
  canRefresh: () => boolean;
}) {
  let stopped = false;
  let active: {
    controller: AbortController;
    timeout: ReturnType<typeof setTimeout>;
  } | null = null;
  function abort() {
    if (!active) return;
    clearTimeout(active.timeout);
    active.controller.abort();
    active = null;
  }
  async function refresh() {
    if (stopped || active || !options.canRefresh()) return;
    const controller = new AbortController();
    const request: {
      controller: AbortController;
      timeout: ReturnType<typeof setTimeout>;
    } = {
      controller,
      timeout: setTimeout(() => {
        if (active !== request || stopped) return;
        abort();
        options.onFailure();
      }, 15_000),
    };
    active = request;
    try {
      const [study, feed] = await Promise.allSettled([
        options.loadStudy(controller.signal),
        options.loadFeed(controller.signal),
      ]);
      if (stopped || active !== request || controller.signal.aborted) return;
      if (study.status === "fulfilled") options.onStudy(study.value);
      if (feed.status === "fulfilled") options.onFeed(feed.value);
      if (study.status === "fulfilled" && feed.status === "fulfilled")
        options.onSuccess();
      else options.onFailure();
    } catch {
      if (!stopped && active === request && !controller.signal.aborted)
        options.onFailure();
    } finally {
      clearTimeout(request.timeout);
      if (active === request) active = null;
    }
  }
  const interval = setInterval(() => void refresh(), 60_000);
  void refresh();
  return {
    refresh,
    abort,
    dispose() {
      stopped = true;
      clearInterval(interval);
      abort();
    },
  };
}
