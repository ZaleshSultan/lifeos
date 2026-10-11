import { createElement, type EffectCallback } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StudyWorkspace, StudyWorkspaceCourse } from "../api/study";
import { syllabusProfiles } from "../components/study/syllabus-profiles";
import { StudyScreen } from "./StudyScreen";

const mocks = vi.hoisted(() => ({
  effects: [] as EffectCallback[],
  configure: vi.fn(),
  study: vi.fn(),
  queryClient: null as QueryClient | null,
}));

// Run the screen's real shared syllabus hook. Only effects are captured for
// explicit execution because the existing TMA test environment uses SSR.
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
vi.mock("../api/study", () => ({
  studyQueryKey: ["study"],
  useStudyQuery: mocks.study,
  useConfigureStudyCalculatorMutation: () => ({ mutateAsync: mocks.configure }),
  useSaveStudyCalculatorMutation: () => ({ isPending: false }),
}));
vi.mock("../telegram", () => ({ telegram: {} }));
vi.mock("../components/study/StudyLmsOverview", () => ({
  StudyLmsOverview: () => null,
}));

function courses(): StudyWorkspaceCourse[] {
  return syllabusProfiles.map((profile, index) => ({
    id: `course-${index}`,
    title: profile.title,
    code: "",
    calculator: null,
    schedules: [],
    startsOn: null,
    endsOn: null,
    externalCourseKey: null,
  }));
}

function renderStudy(items: StudyWorkspaceCourse[], search: string) {
  const data: StudyWorkspace = {
    timezone: "Asia/Almaty",
    courses: items,
    records: [],
  };
  vi.stubGlobal("window", {
    location: { search, href: `https://lifeos.example/${search}` },
    history: { replaceState: vi.fn() },
  });
  mocks.study.mockReturnValue({
    data,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  mocks.effects = [];
  const html = renderToStaticMarkup(
    createElement(StudyScreen, { onOpenLms: vi.fn() }),
  );
  const effects = [...mocks.effects];
  return { html, runLoadEffects: () => effects.forEach((effect) => effect()) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.queryClient?.clear();
  mocks.queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  mocks.configure.mockImplementation(async () => undefined);
});

afterEach(() => vi.unstubAllGlobals());

describe("Study screen syllabus application", () => {
  it("applies every matched course on load even while the schedule tab is selected", async () => {
    const items = courses();
    items.push({
      ...items[0],
      id: "another-dbms",
      title: "Database Management Systems | Other group",
    });
    items.push({ ...items[0], id: "unknown", title: "Unrelated subject" });
    const { runLoadEffects } = renderStudy(items, "?studyTab=schedule");
    runLoadEffects();
    await vi.waitFor(() => expect(mocks.configure).toHaveBeenCalledTimes(6));
    expect(mocks.configure.mock.calls.map(([input]) => input.courseId)).toEqual(
      [
        "course-0",
        "course-1",
        "course-2",
        "course-3",
        "course-4",
        "another-dbms",
      ],
    );
  });

  it.each(syllabusProfiles)(
    "renders $title fields immediately with no manual application prompt",
    (profile) => {
      const index = syllabusProfiles.indexOf(profile);
      const { html } = renderStudy(
        courses(),
        `?studyTab=calculator&courseId=course-${index}`,
      );
      for (const field of profile.definition.fields) {
        expect(html).toContain(field.label);
      }
      expect(html).toContain("Аттестация 1");
      expect(html).toContain("Аттестация 2");
      expect(html).toContain("Финальный экзамен");
      expect(html).not.toContain("Использовать формулу из силабуса");
      expect(html).not.toContain("Практики / лабораторные");
      expect(html.match(/inputMode="decimal"/g)).toHaveLength(
        profile.definition.fields.length + 1,
      );
    },
  );

  it("keeps a custom formula visible and requires confirmation before replacing it", async () => {
    const items = courses();
    const profile = syllabusProfiles[0];
    const custom = {
      definition: {
        ...profile.definition,
        fields: profile.definition.fields.map((field) => ({
          ...field,
          label:
            field.id === "assignment_1" ? "My custom assessment" : field.label,
        })),
      },
      target: 85,
      values: { assignment_1: 95 },
    };
    items[0].calculator = custom;
    const { html, runLoadEffects } = renderStudy(
      items,
      "?studyTab=calculator&courseId=course-0",
    );
    expect(html).toContain("My custom assessment");
    expect(html).toContain("Использовать формулу из силабуса");
    expect(html).toContain('value="95"');
    expect(html).toContain('value="85"');
    runLoadEffects();
    await vi.waitFor(() => expect(mocks.configure).toHaveBeenCalledTimes(4));
    expect(
      mocks.configure.mock.calls.some(
        ([input]) => input.courseId === "course-0",
      ),
    ).toBe(false);
    expect(items[0].calculator).toBe(custom);
  });

  it("does not offer replacement when the exact definition has another source name or field order", () => {
    const items = courses();
    const profile = syllabusProfiles[0];
    items[0].calculator = {
      definition: {
        ...profile.definition,
        sourceName: "My copy of the syllabus",
        fields: [...profile.definition.fields].reverse(),
      },
      target: 70,
      values: {},
    };
    const { html } = renderStudy(
      items,
      "?studyTab=calculator&courseId=course-0",
    );
    expect(html).not.toContain("Использовать формулу из силабуса");
  });
});
