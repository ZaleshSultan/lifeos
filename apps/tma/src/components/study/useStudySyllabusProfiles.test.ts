import { createElement, type EffectCallback } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/client";
import type {
  ConfigureStudyCalculatorInput,
  StudyWorkspace,
  StudyWorkspaceCourse,
} from "../../api/study";
import { syllabusProfiles } from "./syllabus-profiles";
import { useStudySyllabusProfiles } from "./useStudySyllabusProfiles";

const mocks = vi.hoisted(() => ({
  effects: [] as EffectCallback[],
  configure: vi.fn(),
  queryClient: null as QueryClient | null,
}));

// SSR keeps React's real state/memo/ref hooks. Capture only the load effect so
// the test can run its persistence work explicitly without a browser dependency.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: (effect: EffectCallback) => mocks.effects.push(effect),
  };
});
vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return { ...actual, useQueryClient: () => mocks.queryClient };
});
vi.mock("../../api/study", () => ({
  studyQueryKey: ["study"],
  useConfigureStudyCalculatorMutation: () => ({
    mutateAsync: mocks.configure,
  }),
}));
vi.mock("../../telegram", () => ({ telegram: {} }));

function course(title: string, index = 0): StudyWorkspaceCourse {
  return {
    id: `course-${index}`,
    title,
    code: "",
    calculator: null,
    schedules: [],
    startsOn: null,
    endsOn: null,
    externalCourseKey: null,
  };
}

function renderProfiles(courses?: StudyWorkspaceCourse[]) {
  let profiles!: ReturnType<typeof useStudySyllabusProfiles>;
  const data: StudyWorkspace | undefined = courses && {
    timezone: "Asia/Almaty",
    courses,
    records: [],
  };
  function Probe() {
    profiles = useStudySyllabusProfiles(data);
    return null;
  }
  mocks.effects = [];
  renderToStaticMarkup(createElement(Probe));
  const effects = [...mocks.effects];
  const runLoadEffect = () => effects.forEach((effect) => effect());
  return { profiles, runLoadEffect };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.queryClient?.clear();
  mocks.queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  mocks.configure.mockImplementation(async () => undefined);
});

describe("useStudySyllabusProfiles load effect", () => {
  it("renders exact definitions immediately and persists all five subjects without selecting a course", async () => {
    const courses = syllabusProfiles.map((profile, index) =>
      course(profile.title, index),
    );
    const { profiles, runLoadEffect } = renderProfiles(courses);
    expect(mocks.configure).not.toHaveBeenCalled();
    expect(profiles.courses.map((item) => item.calculator?.target)).toEqual([
      70, 70, 70, 70, 70,
    ]);
    for (const [index, item] of profiles.courses.entries()) {
      expect(item.calculator?.definition).toEqual(
        syllabusProfiles[index].definition,
      );
      expect(item.calculator?.values).toEqual({});
    }
    runLoadEffect();
    await vi.waitFor(() => expect(mocks.configure).toHaveBeenCalledTimes(5));
    expect(mocks.configure.mock.calls.map(([input]) => input.courseId)).toEqual(
      courses.map((item) => item.id),
    );
    expect(mocks.configure).toHaveBeenCalledWith(
      expect.objectContaining({
        courseId: "course-0",
        expectedState: null,
        values: {},
        target: 70,
      }),
    );
  });

  it("skips unknown, already applied, and custom formulas while upgrading grouped fallbacks", async () => {
    const profile = syllabusProfiles[1];
    const exact = {
      definition: profile.definition,
      target: 85,
      values: { assignment_1: 90 },
    };
    const custom = {
      ...exact,
      definition: {
        ...profile.definition,
        fields: profile.definition.fields.map((field) => ({
          ...field,
          weightPercent:
            field.id === "assignment_1"
              ? 30
              : field.id === "assignment_2"
                ? 10
                : field.weightPercent,
        })),
      },
    };
    const grouped: NonNullable<StudyWorkspaceCourse["calculator"]> = {
      definition: {
        version: 1,
        sourceName: "Generic fallback",
        attestationThreshold: 25,
        fields: [
          {
            id: "work_1",
            label: "Практики / лабораторные",
            period: "att1",
            weightPercent: 60,
          },
          {
            id: "midterm",
            label: "Midterm",
            period: "att1",
            weightPercent: 40,
          },
          {
            id: "work_2",
            label: "Практики / лабораторные",
            period: "att2",
            weightPercent: 60,
          },
          {
            id: "endterm",
            label: "Endterm",
            period: "att2",
            weightPercent: 40,
          },
          { id: "exam", label: "Экзамен", period: "exam", weightPercent: 100 },
        ],
      },
      target: 80,
      values: { work_1: 90, midterm: 75, exam: null },
    };
    const courses = [
      course("Unknown elective"),
      { ...course(profile.title, 1), calculator: exact },
      { ...course(profile.title, 2), calculator: custom },
      { ...course(profile.title, 3), calculator: grouped },
    ];
    const { profiles, runLoadEffect } = renderProfiles(courses);
    expect(profiles.courses[0].calculator).toBeNull();
    expect(profiles.courses[1].calculator).toBe(exact);
    expect(profiles.courses[2].calculator).toBe(custom);
    expect(profiles.courses[3].calculator?.definition).toEqual(
      profile.definition,
    );
    expect(profiles.courses[3].calculator?.values).toEqual({
      midterm: 75,
      final_exam: null,
    });
    runLoadEffect();
    await vi.waitFor(() => expect(mocks.configure).toHaveBeenCalledTimes(1));
    expect(mocks.configure).toHaveBeenCalledWith({
      courseId: "course-3",
      definition: profile.definition,
      target: 80,
      values: { midterm: 75, final_exam: null },
      expectedState: grouped,
    });
  });

  it("does not duplicate writes on effect replay or a screen change with the same request still pending", async () => {
    let complete!: () => void;
    const waiting = new Promise<void>((resolve) => {
      complete = resolve;
    });
    mocks.configure.mockReturnValue(waiting);
    const courses = [course(syllabusProfiles[0].title)];
    const calculator = renderProfiles(courses);
    calculator.runLoadEffect();
    calculator.runLoadEffect();
    const dashboard = renderProfiles(courses);
    dashboard.runLoadEffect();
    expect(mocks.configure).toHaveBeenCalledTimes(1);
    complete();
    await waiting;
  });

  it("isolates a failed course and refreshes stale state after a concurrent custom edit", async () => {
    const invalidate = vi.spyOn(mocks.queryClient!, "invalidateQueries");
    mocks.configure.mockImplementation(
      async (application: ConfigureStudyCalculatorInput) => {
        if (application.courseId === "course-1") {
          throw new ApiError("study_calculator_conflict", 409);
        }
      },
    );
    const { runLoadEffect } = renderProfiles(
      syllabusProfiles.map((profile, index) => course(profile.title, index)),
    );
    runLoadEffect();
    await vi.waitFor(() => {
      expect(mocks.configure).toHaveBeenCalledTimes(5);
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["study"] });
    });
  });

  it("does no work before the workspace has loaded", () => {
    const { profiles, runLoadEffect } = renderProfiles();
    expect(profiles.courses).toEqual([]);
    runLoadEffect();
    expect(mocks.configure).not.toHaveBeenCalled();
  });
});
