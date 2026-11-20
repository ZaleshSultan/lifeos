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
describe("Scholarship syllabus worksheet", () => {
  const answer = (html: string) =>
    html.match(/<output[^>]*>([^<]+)<\/output>/)?.[1];
  const os = () => courses().find((c) => c.id === "os")!;

  it("opens the actual dashboard route on the worksheet and exposes the courses and syllabus source", () => {
    const html = renderToStaticMarkup(
      createElement(StudyDashboardScreen, props),
    );
    for (const p of syllabusProfiles) expect(html).toContain(p.title);
    expect(html).toContain("Оценки и веса");
    expect(html).toContain("Первая аттестация");
    expect(answer(html)).toBe("70");
    expect(html).not.toContain("Реалистичный");
    expect(html).not.toContain("Учебные дашборды");
  });

  it("shows stored points on first render even without a syllabus and omits private or simulated marks", () => {
    const course = {
      ...os(),
      code: "custom",
      title: "Other",
      calculator: null,
    };
    data(
      [course],
      [
        {
          ...grade(course, "Lab measurement", 8),
          maxScore: 10,
          percentage: 80,
        },
        {
          ...grade(course, "Hidden row", 50),
          rawJson: { _grade_visibility_unknown: true },
        },
        {
          ...grade(course, "Simulated row", 70),
          rawJson: { _is_mocked: true },
        },
      ],
    );
    const html = render();
    expect(html).toContain("Полученные оценки");
    expect(html).toContain("Lab measurement");
    expect(html).toContain("8 / 10");
    expect(html).toContain("Нет схемы оценивания");
    expect(html).not.toContain("Hidden row");
    expect(html).not.toContain("Simulated row");
  });
  it("uses the actual OS stage weights with eight assignments, five scored at 80 and a midterm of 85", () => {
    const course = os();
    course.scholarship!.scenarios.realistic.overrides = {
      assignment_1: 80,
      assignment_2: 80,
      assignment_3: 80,
      assignment_4: 80,
      assignment_5: 80,
      midterm: 85,
    };
    data([course]);
    const html = render();
    expect(answer(html)).toBe("63,91");
    expect(html).toContain("29,1");
    expect(html).toContain("40,9");
    expect(html).toContain("64");
    expect(html).toContain("Assignment 8");
    expect(html).toContain("Syllabus Operating Systems CS.pdf");
  });

  it("uses verified scores before saved hypotheses, keeps an unknown blank, and never imports hidden grades", () => {
    const course = os();
    course.externalCourseKey = "moodle:1";
    course.scholarship!.scenarios.realistic.overrides.assignment_1 = 100;
    data(
      [course],
      [
        {
          ...grade(course, "Assignment 1", 50),
          rawJson: { moodle_course_id: 1 },
        },
        {
          ...grade(course, "Assignment 2", 90),
          rawJson: { _grade_visibility_unknown: true },
        },
        {
          ...grade(course, "Assignment 3", 90),
          rawJson: { moodle_course_id: "2" },
        },
      ],
    );
    expect(answer(render())).toBe("71,28"); // 3 points earned on 6% of final weight.
  });

  it("uses linked Moodle grades after a course rename, ignoring a same-named foreign course", () => {
    const course = os();
    course.title = "My systems course";
    course.externalCourseKey = "moodle:42";
    data(
      [course],
      [
        {
          ...grade(course, "Assignment 1", 50),
          courseTitle: "Archived course name",
          rawJson: { moodle_course_id: 42 },
        },
        {
          ...grade(course, "Assignment 2", 100),
          rawJson: { moodle_course_id: 43 },
        },
        grade(course, "Assignment 3", 100),
      ],
    );
    expect(answer(render())).toBe("71,28");
  });

  it("keeps unlinked Moodle sections separate even when their assignment names do not overlap", () => {
    const course = os();
    const records = [
      {
        ...grade(course, "Assignment 1", 50),
        courseTitle: course.title + " | A",
        rawJson: { moodle_course_id: 10 },
      },
      {
        ...grade(course, "Assignment 2", 100),
        courseTitle: course.title + " | B",
        rawJson: { moodle_course_id: 11 },
      },
    ];
    data([course], records);
    expect(answer(render())).toBe("70");
    expect(render()).toContain("несколько подходящих курсов Moodle");
    course.title += " | A";
    data([course], records);
    expect(answer(render())).toBe("71,28");
  });

  it("preserves unambiguous title-only grades from older imports", () => {
    const course = os();
    course.externalCourseKey = "moodle:42";
    data([course], [grade(course, "Assignment 1", 50)]);
    expect(answer(render())).toBe("71,28");
  });

  it("distinguishes an explicit zero, an impossible target and a completed target", () => {
    const course = os();
    data([course], [grade(course, "Final Exam", 0)]);
    expect(answer(render())).toBe("Цель недостижима");
    course.calculator!.values = Object.fromEntries(
      course.calculator!.definition.fields.map((f) => [f.id, 100]),
    );
    data([course]);
    expect(answer(render())).toBe("Цель достигнута");
  });
  it("keeps a linked entry point in the daily summary", () => {
    expect(
      renderToStaticMarkup(
        createElement(ScholarshipDailySummary, { onOpen: vi.fn() }),
      ),
    ).toContain("стипенди");
  });
  it("handles missing courses and missing formulas without a made-up forecast", () => {
    data([]);
    expect(render()).toContain("Нет активных предметов");
    data([{ ...os(), code: "custom", title: "Other", calculator: null }]);
    expect(render()).toContain("Нет схемы оценивания");
    expect(answer(render())).toBeUndefined();
  });
  it("exposes loading and failure states", () => {
    mocks.study.mockReturnValue({ isLoading: true });
    expect(render()).toContain("Загружаем оценки");
    mocks.study.mockReturnValue({ isError: true, refetch: vi.fn() });
    expect(render()).toContain("Не удалось загрузить предметы");
  });
});

describe("result for a fully graded subject", () => {
  function osGradebook() {
    const course = courses().find((item) => item.id === "os")!;
    course.externalCourseKey = "moodle:7";
    const titles = [
      ...Array.from(
        { length: 8 },
        (_, i) => "Assignment Assignment " + (i + 1),
      ),
      "Assignment Midterm",
      "Assignment Endterm",
      "Assignment Final exam",
    ];
    // All 75 except one real zero worth 6% of the final grade: syllabus total 70.5.
    const modules = titles.map((title, index) => ({
      ...grade(course, title, index === 0 ? 0 : 75),
      sourceEventId: "source-" + index,
      rawJson: {
        moodle_course_id: "7",
        moodle_item_id: String(index + 1),
        moodle_module: "assign",
        item_name: title,
      },
    }));
    function register(total: number): AcademicRecord {
      return {
        ...grade(course, "Calculated grade Register Final", 75),
        sourceEventId: "source-register",
        rawJson: {
          item_name: "Calculated grade Register Final",
          moodle_course_id: "7",
          moodle_item_id: "final-register",
          lifeos_course_total: {
            source: "moodle_course_total",
            moodle_course_id: "7",
            moodle_item_id: "course-total",
            score: total,
            max_score: 100,
          },
        },
      };
    }
    return { course, modules, register };
  }
  function labeledOutput(html: string, label: string) {
    return html.match(
      new RegExp(
        '<output[^>]*aria-label="' + label + '"[^>]*>([^<]*)</output>',
      ),
    )?.[1];
  }

  it.each([71, 0])(
    "shows the official course total %s when every work has a published score",
    (published) => {
      const { course, modules, register } = osGradebook();
      data([course], [...modules, register(published)]);
      const html = render();
      expect(labeledOutput(html, "Итог по предмету")).toBe(String(published));
      expect(labeledOutput(html, "Итог по силабусу")).toBeUndefined();
      expect(html).not.toContain("Цель по предмету");
      expect(html).not.toContain("План по работам");
    },
  );

  it("shows a distinctly labeled syllabus total when fully graded without an official Moodle total", () => {
    const { course, modules } = osGradebook();
    data([course], modules);
    const html = render();
    expect(labeledOutput(html, "Итог по силабусу")).toBe("70,5");
    expect(labeledOutput(html, "Итог по предмету")).toBeUndefined();
    expect(html).not.toContain("Цель по предмету");
    expect(html).not.toContain("План по работам");
  });

  it.each(["missing", "mocked", "hidden"] as const)(
    "retains the forecast alongside a published running total when a work is %s",
    (kind) => {
      const { course, modules, register } = osGradebook();
      const [first, ...other] = modules;
      const remaining =
        kind === "missing"
          ? other
          : [
              ...other,
              {
                ...first,
                rawJson: {
                  ...first.rawJson,
                  [kind === "mocked"
                    ? "_is_mocked"
                    : "_grade_visibility_unknown"]: true,
                },
              },
            ];
      data([course], [...remaining, register(71)]);
      const html = render();
      expect(html).toContain("Ведомость Moodle");
      expect(html).toContain("Итог курса");
      expect(html).toContain("Цель по предмету");
      expect(html).toContain("План по работам");
      expect(labeledOutput(html, "Итог по предмету")).toBeUndefined();
      expect(labeledOutput(html, "Итог по силабусу")).toBeUndefined();
    },
  );

  it("keeps the editable plan when the only filled-in works are the student's manual values", () => {
    const { course } = osGradebook();
    const calculator = course.calculator!;
    calculator.values = Object.fromEntries(
      calculator.definition.fields.map((field) => [field.id, 85]),
    );
    data([course]);
    const html = render();
    expect(html).toContain("Цель по предмету");
    expect(html).toContain("План по работам");
    expect(labeledOutput(html, "Итог по силабусу")).toBeUndefined();
    expect(labeledOutput(html, "Итог по предмету")).toBeUndefined();
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
