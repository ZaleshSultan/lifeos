import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RecordedWorkoutExercise, WorkoutSession } from "../api/workout";
import { nextPersonalSet, PersonalSession } from "./PersonalSession";

vi.mock("../telegram", () => ({ telegram: { hapticImpact: vi.fn() } }));

function exercise(
  id: string,
  ...completed: boolean[]
): RecordedWorkoutExercise {
  return {
    id,
    name: id,
    load: {
      key: id,
      name: id,
      mode: "dumbbells",
      variant: "",
      baseKg: null,
      step: 1,
      previous: [],
      order: 0,
    },
    sets: completed.map((done, index) => ({
      id: id + index,
      index: index + 1,
      completed: done,
      restSeconds: 90,
      targetWeightKg: 9,
      targetReps: 12,
    })),
  };
}
afterEach(() => vi.unstubAllGlobals());
describe("personal workout on a phone", () => {
  it("advances from the confirmed set in program order, then wraps to a skipped exercise", () => {
    const exercises = [
      exercise("a", false),
      exercise("b", false, true, false),
      exercise("c", false),
    ];
    expect(nextPersonalSet(exercises, "b1")).toEqual({
      exercise: "b",
      set: "b2",
    });
    exercises[1] = exercise("b", true, true, true);
    expect(nextPersonalSet(exercises, "b2")).toEqual({
      exercise: "c",
      set: "c0",
    });
    exercises[2] = exercise("c", true);
    expect(nextPersonalSet(exercises, "c0")).toEqual({
      exercise: "a",
      set: "a0",
    });
    exercises[0] = exercise("a", true);
    expect(nextPersonalSet(exercises, "a0")).toEqual({
      exercise: "a",
      set: "a0",
    });
  });
  it("restores the selected set and fractional step; exposes the primary action before secondary controls", () => {
    const session: WorkoutSession = {
      id: "run",
      title: "Мой Full Body",
      mode: "active",
      startedAt: "2026-11-23T10:00:00Z",
      completedSets: 1,
      totalSets: 2,
      progressPercent: 50,
      personalRevision: 1,
      exercises: [exercise("press", true, false)],
    };
    vi.stubGlobal("localStorage", {
      getItem: (key: string) =>
        key === "lifeos:full-body:7:run"
          ? JSON.stringify({
              exercise: "press",
              set: "press1",
              fields: {},
              steps: { press: "0,75" },
            })
          : null,
    });
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(PersonalSession, {
          session,
          account: 7,
          onFinish: vi.fn(),
        }),
      ),
    );
    expect(html).toContain('value="0,75"');
    expect(html).toContain("Черновик на этом устройстве");
    expect(html).not.toContain("Сохранено на сервере");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Завершить тренировку/);
    expect(html.indexOf(">Выполнено</button>")).toBeGreaterThan(0);
    expect(html.indexOf(">Выполнено</button>")).toBeLessThan(
      html.indexOf("Разминочный подход"),
    );
    expect(html.indexOf(">Выполнено</button>")).toBeLessThan(
      html.indexOf("Итоги тренировки"),
    );
  });
});
