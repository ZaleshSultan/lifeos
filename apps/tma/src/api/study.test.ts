import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StudyCalculatorState } from "../../../../packages/core/src/study.js";
import { resolveStudyCalculator } from "../../../../packages/core/src/study-syllabi.js";
import {
  studyQueryKey,
  useConfigureStudyCalculatorMutation,
  useSaveStudyCalculatorMutation,
  type SaveStudyCalculatorInput,
  type ConfigureStudyCalculatorInput,
  type StudyWorkspace,
  type StudyWorkspaceCourse,
} from "./study";

const mocks = vi.hoisted(() => ({
  client: null as unknown,
  options: null as unknown,
  request: vi.fn(),
  hapticImpact: vi.fn(),
}));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => mocks.client,
  useMutation: (options: unknown) => {
    mocks.options = options;
    return {};
  },
}));
vi.mock("./client", () => ({ request: mocks.request }));
vi.mock("../telegram", () => ({
  telegram: { hapticImpact: mocks.hapticImpact },
}));

interface ConfigurationCallbacks {
  mutationFn: (
    input: ConfigureStudyCalculatorInput,
  ) => Promise<StudyCalculatorState>;
  onSuccess: (
    state: StudyCalculatorState,
    input: ConfigureStudyCalculatorInput,
  ) => Promise<void>;
}

const course: StudyWorkspaceCourse = {
  id: "course-1",
  title: "Database Management Systems",
  code: "DBMS",
  startsOn: null,
  endsOn: null,
  externalCourseKey: null,
  calculator: null,
  schedules: [],
};
const syllabus = resolveStudyCalculator(course)!;

function setup(calculator: StudyCalculatorState | null = null) {
  const client = new QueryClient();
  client.setQueryData<StudyWorkspace>(studyQueryKey, {
    timezone: "Asia/Almaty",
    records: [],
    courses: [
      { ...course, calculator },
      { ...course, id: "other-course" },
    ],
  });
  mocks.client = client;
  useConfigureStudyCalculatorMutation();
  return {
    client,
    callbacks: mocks.options as ConfigurationCallbacks,
    cached: () => client.getQueryData<StudyWorkspace>(studyQueryKey)!.courses,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("Study syllabus persistence", () => {
  it("sends an explicit null expected state and mapped zero/missing values for automatic application", async () => {
    const { callbacks } = setup();
    mocks.request.mockResolvedValue(syllabus);
    const application: ConfigureStudyCalculatorInput = {
      courseId: course.id,
      definition: syllabus.definition,
      values: { assignment_1: 0, assignment_2: null },
      target: 70,
      expectedState: null,
    };
    await callbacks.mutationFn(application);
    expect(mocks.request).toHaveBeenCalledWith(
      "/api/tma/study/courses/course-1/syllabus",
      {
        method: "PUT",
        body: JSON.stringify({
          definition: application.definition,
          target: 70,
          values: application.values,
          expectedState: null,
        }),
      },
    );
  });

  it("updates only the automatic application's course when its cached state is unchanged", async () => {
    const { callbacks, cached } = setup();
    await callbacks.onSuccess(syllabus, {
      courseId: course.id,
      definition: syllabus.definition,
      expectedState: null,
    });
    expect(cached()[0].calculator).toEqual(syllabus);
    expect(cached()[1].calculator).toBeNull();
    expect(mocks.hapticImpact).not.toHaveBeenCalled();
  });

  it.each(["definition", "values", "target"])(
    "preserves a newer cached %s edit when an automatic response arrives late",
    async (edited) => {
      const newer = structuredClone(syllabus);
      if (edited === "definition")
        newer.definition.sourceName = "My custom formula";
      if (edited === "values") newer.values = { assignment_1: 95 };
      if (edited === "target") newer.target = 90;
      const { callbacks, cached, client } = setup(newer);
      const invalidate = vi.spyOn(client, "invalidateQueries");
      await callbacks.onSuccess(syllabus, {
        courseId: course.id,
        definition: syllabus.definition,
        expectedState: null,
      });
      expect(cached()[0].calculator).toEqual(newer);
      expect(invalidate).toHaveBeenCalledWith({ queryKey: studyQueryKey });
      expect(mocks.hapticImpact).not.toHaveBeenCalled();
    },
  );

  it("accepts a refresh that already contains the saved syllabus", async () => {
    const { callbacks, cached, client } = setup(syllabus);
    const invalidate = vi.spyOn(client, "invalidateQueries");
    await callbacks.onSuccess(syllabus, {
      courseId: course.id,
      definition: syllabus.definition,
      expectedState: null,
    });
    expect(cached()[0].calculator).toEqual(syllabus);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("retains explicit manual configuration and its confirmation feedback", async () => {
    const { callbacks, cached } = setup(syllabus);
    const manual = { ...syllabus, target: 80 };
    await callbacks.onSuccess(manual, {
      courseId: course.id,
      definition: manual.definition,
      target: manual.target,
    });
    expect(cached()[0].calculator).toEqual(manual);
    expect(mocks.hapticImpact).toHaveBeenCalledWith("light");
  });
});

describe("Study scenario save concurrency", () => {
  it("serializes the original edit base even when the query cache has a newer scenario", async () => {
    const base = structuredClone(syllabus);
    const current = { ...structuredClone(syllabus), target: 90 };
    setup(current);
    useSaveStudyCalculatorMutation();
    const save = mocks.options as {
      mutationFn: (
        input: SaveStudyCalculatorInput,
      ) => Promise<StudyCalculatorState>;
    };
    const state = { ...structuredClone(base), target: 75 };
    mocks.request.mockResolvedValue(state);
    await save.mutationFn({ courseId: course.id, state, expectedState: base });
    const body = JSON.parse(mocks.request.mock.lastCall![1].body as string);
    expect(body).toEqual({
      values: state.values,
      target: 75,
      expectedState: base,
    });
    expect(body.expectedState.target).toBe(70);
  });
  it.each([undefined, null])(
    "preserves explicit null and legacy omitted expectations (%s)",
    async (expectedState) => {
      setup(syllabus);
      useSaveStudyCalculatorMutation();
      const save = mocks.options as {
        mutationFn: (
          input: SaveStudyCalculatorInput,
        ) => Promise<StudyCalculatorState>;
      };
      mocks.request.mockResolvedValue(syllabus);
      await save.mutationFn({
        courseId: course.id,
        state: syllabus,
        expectedState,
      });
      const body = JSON.parse(mocks.request.mock.lastCall![1].body as string);
      expect(Object.hasOwn(body, "expectedState")).toBe(
        expectedState !== undefined,
      );
      if (expectedState === null) expect(body.expectedState).toBeNull();
    },
  );
});
