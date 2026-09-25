import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkoutHistorySession } from "../api/workout";

const state = vi.hoisted(() => ({
  history: [] as WorkoutHistorySession[],
}));

vi.mock("../api/workout", () => ({
  useWorkoutHistoryQuery: () => ({ data: state.history }),
  workoutErrorMessage: () => "Не удалось загрузить историю.",
}));

import { WorkoutHistory } from "./WorkoutHistory";

const session: WorkoutHistorySession = {
  id: "workout-a",
  title: "Ноги",
  mode: "completed",
  startedAt: "2026-09-24T10:00:00Z",
  endedAt: "2026-09-24T11:00:00Z",
  completedSets: 1,
  totalSets: 1,
  progressPercent: 100,
  volumeKg: 320,
  exercises: [
    {
      id: "exercise-a",
      name: "Приседания",
      gifUrl: "https://example.com/squat.gif",
      sets: [
        {
          id: "set-a",
          index: 1,
          targetReps: 8,
          targetWeightKg: 40,
          restSeconds: 90,
          completed: true,
          completedAt: "2026-09-24T10:30:00Z",
        },
      ],
    },
  ],
};

beforeEach(() => {
  state.history = [session];
});

describe("workout history", () => {
  it("shows the GIF saved with a completed workout", () => {
    const html = renderToStaticMarkup(createElement(WorkoutHistory));
    expect(html).toContain('src="https://example.com/squat.gif"');
    expect(html).toContain('alt="Техника упражнения: Приседания"');
  });

  it("keeps workouts without a GIF free of an empty image", () => {
    state.history = [
      {
        ...session,
        exercises: [{ ...session.exercises[0], gifUrl: null }],
      },
    ];
    const html = renderToStaticMarkup(createElement(WorkoutHistory));
    expect(html).toContain("Приседания");
    expect(html).not.toContain("<img");
  });
});
