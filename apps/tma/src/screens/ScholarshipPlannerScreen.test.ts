import { ScoreInput } from "../components/scholarship/ScoreInput";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  builtinStudyCalculatorState,
  syllabusProfiles,
} from "../../../../packages/core/src/study-syllabi.js";
import { defaultScholarshipConfig } from "../../../../packages/core/src/scholarship.js";
import type { StudyWorkspace, StudyWorkspaceCourse } from "../api/study";
import type { AcademicRecord } from "../api/types";
import { ScholarshipPlannerScreen } from "./ScholarshipPlannerScreen";
import { StudyDashboardScreen } from "./StudyDashboardScreen";
import { ScholarshipDailySummary } from "../components/scholarship/ScholarshipDailySummary";
const mocks = vi.hoisted(() => ({
  study: vi.fn(),
  work: vi.fn(),
  save: vi.fn(),
}));
vi.mock("../api/study", () => ({
  useStudyQuery: mocks.study,
  useSaveScholarshipPlanMutation: mocks.save,
}));
vi.mock("../api/lms", () => ({ useLmsWorkQuery: mocks.work }));
vi.mock("../components/study/useStudySyllabusProfiles", () => ({
  useStudySyllabusProfiles: vi.fn(),
}));
const props = {
  onOpenCalculator: vi.fn(),
  onOpenStudy: vi.fn(),
  onOpenLms: vi.fn(),
};
function courses(): StudyWorkspaceCourse[] {
  return syllabusProfiles.map((p) => ({
    id: p.id,
    title: p.title,
    code: p.courseCode,
    calculator: builtinStudyCalculatorState(p.courseCode),
    scholarship: defaultScholarshipConfig(),
    startsOn: null,
    endsOn: null,
    externalCourseKey: null,
    schedules: [],
  }));
}
function grade(
  course: StudyWorkspaceCourse,
  title: string,
  score: number | null,
): AcademicRecord {
  return {
    id: title,
    userId: "owner",
    sourceEventId: null,
    courseTitle: course.title,
    title,
    recordType: "grade",
    score,
    maxScore: 100,
    percentage: score,
    valueText: null,
    occursAt: null,
    dueAt: null,
    createdAt: "2026-10-11T00:00:00Z",
    updatedAt: "2026-10-11T00:00:00Z",
  };
}
function data(c = courses(), records: AcademicRecord[] = []) {
  mocks.study.mockReturnValue({
    data: {
      timezone: "Asia/Almaty",
      courses: c,
      records,
    } satisfies StudyWorkspace,
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  });
}
const render = () =>
  renderToStaticMarkup(createElement(ScholarshipPlannerScreen, props));
beforeEach(() => {
  vi.clearAllMocks();
  data();
  mocks.work.mockReturnValue({
    data: { items: [], stale: false, truncated: false },
    refetch: vi.fn(),
  });
  mocks.save.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
  });
});
describe("Scholarship dashboard regression", () => {
  it("shows all five courses, editable scenarios, targets and remaining-work guidance", () => {
    const html = render();
    for (const p of syllabusProfiles) expect(html).toContain(p.title);
    expect(html).toContain("Стипендия");
    expect(html).toContain("С чего начать");
    expect(html).toContain("Пессимистичный");
    expect(html).toContain("Реалистичный");
    expect(html).toContain("Оптимистичный");
    for (const target of [70, 75, 80, 90])
      expect(html).toContain(`value="${target}"`);
    expect(html).toContain("Своё значение");
    expect(html).toContain("Lecture Async");
    expect(html).toContain("Cisco certificate");
    expect(html).toContain("Assignment 8");
    expect(html).toContain("Рубежный контроль");
    expect(html).toContain("не гарантирует выплату");
    expect(html).toContain("а не запись нулей");
    expect(html).toContain("Индивидуальные допущения");
    expect(html).toContain("два знака после запятой");
  });
  it("displays critical DBMS and OS examples with hypothetical ATT2 and exam requirements", () => {
    const c = courses().filter((course) => ["dbms", "os"].includes(course.id));
    c[0].scholarship!.scenarios.realistic.periodTotals.att2 = 80;
    c[1].scholarship!.scenarios.realistic.periodTotals.att2 = 70;
    data(c, [
      grade(c[0], "ATT1", 72.1),
      grade(c[0], "Final Exam", 61),
      grade(c[1], "ATT1", 66.25),
      grade(c[1], "Final Exam", 73),
    ]);
    const html = render();
    expect(html).toContain("70,03");
    expect(html).toContain("70,08");
    expect(html).toContain("60,93");
    expect(html).toContain("72,82");
    expect(html).toContain("оценок гипотетические");
  });
  it("updates risk and the daily summary when verified grades change", () => {
    const [c] = courses();
    data([c], [grade(c, "Final Exam", 90)]);
    expect(render()).toContain("Запас: 75,00+");
    data([c], [grade(c, "Final Exam", 0)]);
    const html = render();
    expect(html).toContain("Порог математически недостижим");
    expect(html).toContain("Даже все оставшиеся работы на 100");
    const daily = renderToStaticMarkup(
      createElement(ScholarshipDailySummary, { onOpen: vi.fn() }),
    );
    expect(daily).toContain("недостижимый порог: 1");
    expect(daily).toContain("Как сохранить стипендию");
  });
  it("makes scholarship the default dashboard while retaining the academic overview", () => {
    const html = renderToStaticMarkup(
      createElement(StudyDashboardScreen, props),
    );
    expect(html).toContain("Обзор учёбы");
    expect(html).toContain("Scholarship Survival Planner");
  });
  it("handles no courses, unknown formulas and stale deadlines honestly", () => {
    data([]);
    expect(render()).toContain("Нет активных предметов");
    data([
      {
        ...courses()[0],
        code: "CUSTOM",
        title: "Unconfigured course",
        calculator: null,
      },
    ]);
    expect(render()).toContain("Нет подтверждённой схемы оценивания");
    mocks.work.mockReturnValue({ isError: true, refetch: vi.fn() });
    expect(render()).toContain("Дедлайны могут быть неполными");
  });
  it("exposes loading and failure states without inventing grades", () => {
    mocks.study.mockReturnValue({ isLoading: true });
    expect(render()).toContain("Считаем план");
    mocks.study.mockReturnValue({
      isError: true,
      error: new Error("read failed"),
      refetch: vi.fn(),
    });
    expect(render()).toContain("Не удалось загрузить");
  });
});

it("keeps the score label stable and describes validation errors separately", () => {
  const html = renderToStaticMarkup(
    createElement(ScoreInput, {
      label: "Порог",
      value: 101,
      onChange: vi.fn(),
    }),
  );
  expect(html).toMatch(/<label[^>]*>Порог<\/label>/);
  expect(html).toContain('aria-invalid="true"');
  expect(html).toContain("aria-describedby=");
  expect(html).toContain("Число от 0 до 100");
});
