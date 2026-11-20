import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { StudyWorkspaceCourse } from "../api/study";
import type { AcademicRecord } from "../api/types";
import { builtinStudyCalculatorState } from "../../../../packages/core/src/study-syllabi.js";
import { StudyDashboardScreen } from "./StudyDashboardScreen";

const study = vi.hoisted(() => vi.fn());
vi.mock("../api/study", () => ({
  useStudyQuery: study,
  useSaveScholarshipPlanMutation: () => ({}),
}));
const course = (): StudyWorkspaceCourse => ({
  id: "1",
  code: "DMS52-EN",
  title: "Database Management Systems | Teacher A",
  calculator: builtinStudyCalculatorState("DMS52-EN"),
  externalCourseKey: null,
  startsOn: null,
  endsOn: null,
  schedules: [],
});
function render(
  c: StudyWorkspaceCourse,
  records: Partial<AcademicRecord>[] = [],
) {
  study.mockReturnValue({ data: { courses: [c], records } });
  const html = renderToStaticMarkup(
    createElement(StudyDashboardScreen, {
      onOpenStudy: vi.fn(),
      onOpenLms: vi.fn(),
      onOpenCalculator: vi.fn(),
    }),
  );
  return { html, text: html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ") };
}
describe("syllabus math on the public dashboard route", () => {
  it("uses saved manual marks and course targets with an explicitly customized formula", () => {
    const c = course();
    const state = c.calculator!;
    state.definition.sourceName = "My course formula";
    for (const field of state.definition.fields) {
      if (field.id === "assignment_1") field.weightPercent = 30;
      if (field.id === "assignment_2") field.weightPercent = 10;
    }
    state.values = { assignment_1: 100 };
    state.target = 80;
    const { html, text } = render(c);
    expect(text).toContain("My course formula");
    expect(text).toContain("Набрано 9 / 100");
    expect(text).toContain("Вес остатка 91%");
    expect(html).toContain("78,03");
    expect(html).toContain('value="80"');
    expect(html).not.toContain("Database management systems.pdf");
  });
  it("resolves an exact syllabus when no calculator was configured", () => {
    const c = course();
    c.calculator = null;
    const { html } = render(c);
    expect(html).toContain("Assignment 1");
    expect(html).toContain("Database management systems.pdf");
    expect(html).toContain("Нужный средний балл");
  });
  it("keeps different course sections out of the calculation and preserves a verified period total", () => {
    const c = course();
    const record = {
      id: "a",
      title: "ATT1",
      score: 72.1,
      maxScore: 100,
      courseTitle: c.title,
      updatedAt: "",
    };
    const { text } = render(c, [
      record,
      {
        ...record,
        id: "b",
        title: "Final Exam",
        score: 0,
        courseTitle: "Database Management Systems | Teacher B",
      },
    ]);
    expect(text).toContain("Подтверждённый итог ATT1");
    expect(text).toContain("Набрано 21,63 / 100");
    expect(text).toContain("Вес остатка 70%");
    expect(text).toContain("69,1");
  });
  it("does not declare the subject closed when 70 is earned but the syllabus attestation floor is impossible", () => {
    const c = course();
    c.calculator!.values = Object.fromEntries(
      c.calculator!.definition.fields.map((f) => [
        f.id,
        f.period === "att1" ? 0 : 100,
      ]),
    );
    const { text } = render(c);
    expect(text).toContain("Порог аттестации недостижим");
    expect(text).not.toContain("Цель достигнута");
  });
  it("includes the attestation minimum when the target is secured but a whole stage is ungraded", () => {
    const c = course();
    c.calculator!.values = Object.fromEntries(
      c.calculator!.definition.fields.map((f) => [
        f.id,
        f.period === "att1" ? null : 100,
      ]),
    );
    const { text } = render(c);
    expect(text).toContain("Нужный средний балл 25");
    expect(text).not.toContain("Цель достигнута");
  });
});
