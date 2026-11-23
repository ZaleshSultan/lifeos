import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fullBodyTemplate } from "@lifeos/core/personal-workout";
import { personalKey } from "../api/personal-workout";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkoutSession } from "../api/workout";

vi.mock("../telegram", () => ({
  telegram: { initData: "", hapticImpact: vi.fn() },
}));
const state = vi.hoisted(() => ({
  session: null as WorkoutSession | null,
  pending: false,
  error: false,
}));

vi.mock("../api/workout", () => ({
  useWorkoutSessionQuery: () => ({ data: state.session }),
  useWorkoutProgramQuery: () => ({ data: null }),
  useWorkoutActions: () => ({
    start: { isPending: false },
    set: {
      isPending: state.pending,
      variables: { setId: "set-a" },
      isError: state.error,
      error: new Error("failure"),
    },
    finish: { isPending: false },
  }),
  useWorkoutHistoryQuery: () => ({ data: [] }),
  useSaveWorkoutProgram: () => ({ isPending: false }),
  workoutErrorMessage: () => "Не удалось сохранить подход.",
}));

import { WorkoutScreen } from "./WorkoutScreen";

function renderWorkout(owner?: boolean) {
  const client = new QueryClient();
  const account = owner === undefined ? undefined : 11;
  if (account) {
    client.setQueryData(
      [...personalKey, account],
      owner ? { revision: 0, exercises: fullBodyTemplate() } : null,
    );
  }
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(WorkoutScreen, { account }),
    ),
  );
}

beforeEach(() => {
  state.pending = false;
  state.error = false;
  state.session = {
    id: "workout-a",
    title: "День A",
    mode: "active",
    startedAt: "2026-09-24T10:00:00Z",
    completedSets: 1,
    totalSets: 1,
    progressPercent: 100,
    exercises: [
      {
        id: "exercise-a",
        name: "Приседания",
        sets: [
          {
            id: "set-a",
            index: 1,
            targetReps: 12,
            targetWeightKg: 0,
            restSeconds: 0,
            completed: true,
            completedAt: "2026-09-24T10:00:01Z",
          },
        ],
      },
    ],
  };
});

describe("workout screen", () => {
  it("keeps completed set controls enabled after a mutation and displays zero values", () => {
    const html = renderWorkout();
    expect(html).toContain("Отменить");
    expect(html).not.toContain("disabled=");
    expect(html).toContain('aria-label="Приседания, подход 1: Вес, кг"');
    expect(html.match(/value="0"/g)).toHaveLength(2);
    expect(html).not.toContain("<img");
  });

  it("shows a saved exercise GIF beside the active workout", () => {
    state.session!.exercises[0].gifUrl = "https://example.com/squat.gif";
    const html = renderWorkout();
    expect(html).toContain('src="https://example.com/squat.gif"');
    expect(html).toContain('alt="Техника упражнения: Приседания"');
    expect(html).toContain('loading="lazy"');
  });

  it("blocks input while saving and displays a failed set mutation", () => {
    state.pending = true;
    expect(renderWorkout()).toContain("disabled=");
    state.pending = false;
    state.error = true;
    expect(renderWorkout()).toContain("Не удалось сохранить подход.");
  });

  it("offers creation of the user's program without silently starting defaults", () => {
    state.session = null;
    const html = renderWorkout();
    expect(html).toContain("Создать свою программу");
    expect(html).toContain("Начать стандартный план LifeOS");
    expect(html).not.toContain("Приседания");
  });
  it("puts Full Body first for its owner, and keeps the existing program immediately available for other accounts", () => {
    state.session = null;
    const personal = renderWorkout(true);
    expect(personal.indexOf("Мой Full Body")).toBeLessThan(
      personal.indexOf("Другие программы тренировок"),
    );
    expect(personal).toMatch(
      /<details(?![^>]*\bopen)[^>]*><summary[^>]*>Другие программы тренировок/,
    );
    const ordinary = renderWorkout(false);
    expect(ordinary).not.toContain("Мой Full Body");
    expect(ordinary).toMatch(/<details[^>]*\bopen[^>]*>/);
  });
});
