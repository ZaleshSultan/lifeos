import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StudyWorkspace, StudyWorkspaceCourse } from "../api/study";
import type { AcademicRecord } from "../api/types";
import { syllabusProfiles } from "../components/study/syllabus-profiles";
import { AcademicDashboardScreen as StudyDashboardScreen } from "./StudyDashboardScreen";

const mocks = vi.hoisted(() => ({
  study: vi.fn(),
  profiles: vi.fn(),
  work: vi.fn(),
}));

vi.mock("../api/study", () => ({ useStudyQuery: mocks.study }));
vi.mock("../api/lms", () => ({ useLmsWorkQuery: mocks.work }));
vi.mock("../components/study/useStudySyllabusProfiles", () => ({
  useStudySyllabusProfiles: mocks.profiles,
}));

const course = (
  overrides: Partial<StudyWorkspaceCourse> = {},
): StudyWorkspaceCourse => ({
  id: "course-1",
  title: "Database Management Systems",
  code: "DMS52-EN",
  calculator: null,
  schedules: [],
  startsOn: null,
  endsOn: null,
  externalCourseKey: null,
  ...overrides,
});

function renderDashboard(
  courses: StudyWorkspaceCourse[],
  records: AcademicRecord[] = [],
) {
  const data: StudyWorkspace = {
    timezone: "Asia/Almaty",
    courses,
    records,
  };
  mocks.study.mockReturnValue({
    data,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  const html = renderToStaticMarkup(
    createElement(StudyDashboardScreen, {
      onOpenCalculator: vi.fn(),
      onOpenStudy: vi.fn(),
      onOpenLms: vi.fn(),
    }),
  );
  return { html, text: html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ") };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.work.mockReturnValue({ data: { items: [] }, refetch: vi.fn() });
  mocks.profiles.mockImplementation((data?: StudyWorkspace) => ({
    courses: data?.courses ?? [],
    pending: false,
    errors: {},
    retry: vi.fn(),
  }));
});

describe("Study dashboard syllabus forecasts", () => {
  it("renders every matched course with exact assessment guidance and default target 70", () => {
    const { html, text } = renderDashboard(
      syllabusProfiles.map((profile, index) =>
        course({
          id: String(index),
          title: profile.title,
          code: "",
        }),
      ),
    );
    expect(html.match(/Силабус подтверждён/g)).toHaveLength(5);
    expect(html).toContain("Assignment 8");
    expect(html).toContain("Cisco certificate");
    expect(html).toContain("Рубежный контроль");
    expect(text).toContain("Цель 70");
    expect(text).toContain("Нужно дальше 70");
    expect(text).toContain(
      "По сохранённым значениям набрано 0 из 100; максимально возможно 100.",
    );
    expect(html).not.toContain("Практики / лабораторные");
    expect(mocks.profiles).toHaveBeenCalledWith(
      expect.objectContaining({ courses: expect.any(Array) }),
    );
  });

  it("uses separate syllabus assignments immediately for a stored grouped fallback", () => {
    const { html, text } = renderDashboard([
      course({
        title: "Digital Logic Design",
        code: "DLD52-EN",
        calculator: {
          target: 70,
          values: {},
          definition: {
            version: 1,
            sourceName: "AITU syllabus (built-in fallback)",
            attestationThreshold: 25,
            fields: [
              {
                id: "dld-p1",
                label: "Практики / лабораторные",
                period: "att1",
                weightPercent: 60,
              },
              {
                id: "dld-mid",
                label: "Midterm Exam",
                period: "att1",
                weightPercent: 40,
              },
              {
                id: "dld-p2",
                label: "Практики / лабораторные",
                period: "att2",
                weightPercent: 60,
              },
              {
                id: "dld-end",
                label: "Endterm Exam",
                period: "att2",
                weightPercent: 40,
              },
              {
                id: "dld-exam",
                label: "Экзамен",
                period: "exam",
                weightPercent: 100,
              },
            ],
          },
        },
      }),
    ]);
    expect(html).toContain("Assignment 1");
    expect(html).toContain("Assignment 6");
    expect(html).not.toContain("Практики / лабораторные");
    expect(text).toContain("Ориентиры по работам (9)");
  });

  it("calculates guaranteed points and the remaining average from the same exact fields", () => {
    const profile = syllabusProfiles.find((item) => item.id === "dbms")!;
    const { text } = renderDashboard([
      course({
        calculator: {
          definition: profile.definition,
          target: 70,
          values: { assignment_1: 100 },
        },
      }),
    ]);
    expect(text).toContain(
      "По сохранённым значениям набрано 6 из 100; максимально возможно 100.",
    );
    expect(text).toContain("Нужно дальше 68,1");
    expect(text).toContain("Ориентиры по работам (10)");
  });

  it("preserves a custom formula and does not label it as a confirmed syllabus", () => {
    const profile = syllabusProfiles.find((item) => item.id === "dbms")!;
    const { html, text } = renderDashboard([
      course({
        calculator: {
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
          target: 80,
          values: { assignment_1: 100 },
        },
      }),
    ]);
    expect(html).toContain("Пользовательская схема");
    expect(html).not.toContain("Силабус подтверждён");
    expect(text).toContain("По сохранённым значениям набрано 9 из 100");
    expect(text).toContain("Цель 80");
  });

  it("recognizes the exact syllabus independently of descriptive source names and field order", () => {
    const profile = syllabusProfiles.find((item) => item.id === "dbms")!;
    const { html, text } = renderDashboard([
      course({
        calculator: {
          definition: {
            ...profile.definition,
            sourceName: "My syllabus copy",
            fields: [...profile.definition.fields].reverse(),
          },
          target: 70,
          values: { assignment_1: 100 },
        },
      }),
    ]);
    expect(html).toContain("Силабус подтверждён");
    expect(html).not.toContain("Пользовательская схема");
    expect(text).toContain("По сохранённым значениям набрано 6 из 100");
  });

  it("clearly marks an impossible target with the actual maximum", () => {
    const profile = syllabusProfiles.find((item) => item.id === "dbms")!;
    const { text } = renderDashboard([
      course({
        calculator: {
          definition: profile.definition,
          target: 70,
          values: { final_exam: 0 },
        },
      }),
    ]);
    expect(text).toContain("максимально возможно 60");
    expect(text).toContain("По текущему сценарию цель недостижима.");
    expect(text).toContain("Недостижимо");
  });

  it("keeps the latest grade and record count scoped to the course's teacher or group section", () => {
    const ownCourse = course({
      title: "Database Management Systems | Teacher A",
    });
    const ownGrade: AcademicRecord = {
      id: "own-grade",
      userId: "user",
      sourceEventId: null,
      courseTitle: ownCourse.title,
      recordType: "assignment",
      title: "Assignment 1 from Teacher A",
      valueText: null,
      score: 80,
      maxScore: 100,
      percentage: 80,
      occursAt: null,
      dueAt: null,
      createdAt: "2026-10-10T00:00:00Z",
      updatedAt: "2026-10-10T00:00:00Z",
    };
    const otherGrade: AcademicRecord = {
      ...ownGrade,
      id: "other-grade",
      courseTitle: "Database Management Systems | Teacher B",
      title: "Assignment 2 from Teacher B",
      score: 95,
      percentage: 95,
      updatedAt: "2026-10-11T00:00:00Z",
    };
    const { html } = renderDashboard([ownCourse], [ownGrade, otherGrade]);
    const card = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/)?.[1];
    expect(card).toBeDefined();
    const text = card!.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
    expect(text).toContain("1 записей об оценках");
    expect(text).toContain(
      "Последняя оценка Assignment 1 from Teacher A 80 / 100",
    );
    expect(text).not.toContain("Assignment 2 from Teacher B");
    expect(text).not.toContain("95 / 100");
  });

  it("exposes failed auto-application with a retry action", () => {
    mocks.profiles.mockImplementation((data: StudyWorkspace) => ({
      courses: data.courses,
      pending: false,
      errors: { "course-1": "Network unavailable" },
      retry: vi.fn(),
    }));
    const { html } = renderDashboard([course()]);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Не удалось сохранить некоторые схемы силабусов");
    expect(html).toContain("Повторить сохранение");
  });
});
