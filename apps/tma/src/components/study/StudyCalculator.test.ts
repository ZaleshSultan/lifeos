import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { StudyCalculatorState } from "../../../../../packages/core/src/study.js";
import type { StudyWorkspaceCourse } from "../../api/study";
import { StudyCalculator, StudyTargetForecast } from "./StudyCalculator";
import { createStudyDraft, type StudyDraft } from "./model";
import { syllabusProfiles } from "./syllabus-profiles";

function renderCalculator(state: StudyCalculatorState, draft?: StudyDraft) {
  const course: StudyWorkspaceCourse = {
    id: "course-1",
    code: "",
    title: "Study course",
    startsOn: null,
    endsOn: null,
    externalCourseKey: null,
    schedules: [],
    calculator: state,
  };
  return renderToStaticMarkup(
    createElement(StudyCalculator, {
      course,
      records: [],
      draft: draft ?? createStudyDraft(state),
      onChange: () => {},
      onSave: () => {},
      onReset: () => {},
      saving: false,
      saveError: null,
      saved: false,
      onRefresh: () => {},
    }),
  );
}

function inputByName(html: string, name: string): string | undefined {
  return [...html.matchAll(/<input\b[^>]*>/g)]
    .map((match) => match[0])
    .find((input) => input.includes(`name="${name}"`));
}

function textContent(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

describe("StudyCalculator assessment inputs", () => {
  it.each(syllabusProfiles)(
    "keeps every $title assessment value attached to its own field",
    ({ definition }) => {
      const values = Object.fromEntries(
        definition.fields.map((field, index) => [field.id, index * 7]),
      );
      const html = renderCalculator({ definition, values, target: 70 });
      const fieldsets = [
        ...html.matchAll(/<fieldset\b[^>]*>(.*?)<\/fieldset>/gs),
      ].map((match) => match[1]);

      expect(fieldsets).toHaveLength(3);
      for (const [index, period] of ["att1", "att2", "exam"].entries()) {
        const fields = definition.fields.filter(
          (field) => field.period === period,
        );
        expect(fieldsets[index].match(/<input\b/g)).toHaveLength(fields.length);
        for (const field of fields) {
          const input = inputByName(fieldsets[index], field.id);
          expect(input).toContain(`value="${values[field.id]}"`);
          expect(input).toContain(`id="study-course-1-${field.id}"`);
          expect(fieldsets[index]).toContain(`>${field.label}</label>`);
        }
      }
      const ids = [...html.matchAll(/<input\b[^>]*\bid="([^"]+)"/g)].map(
        (match) => match[1],
      );
      expect(new Set(ids).size).toBe(definition.fields.length);
      expect(html).not.toContain("Практики / лабораторные");
    },
  );

  it.each([
    { profileId: "dbms", label: "Quiz", first: "quiz_1", second: "quiz_2" },
    {
      profileId: "russian",
      label: "Задание",
      first: "att1_work",
      second: "att2_work",
    },
  ])(
    "keeps repeated $label labels independent across attestations",
    ({ profileId, label, first, second }) => {
      const definition = syllabusProfiles.find(
        (profile) => profile.id === profileId,
      )!.definition;
      const html = renderCalculator({
        definition,
        target: 70,
        values: { [first]: 0, [second]: 95 },
      });
      const labels = [
        ...html.matchAll(/<label\b[^>]*>(.*?)<\/label>/gs),
      ].filter((match) => match[1] === label);

      expect(labels).toHaveLength(2);
      expect(labels[0][0]).toContain(`for="study-course-1-${first}"`);
      expect(labels[1][0]).toContain(`for="study-course-1-${second}"`);
      expect(inputByName(html, first)).toContain('value="0"');
      expect(inputByName(html, second)).toContain('value="95"');
    },
  );

  it("marks only the invalid individual assessment and retains the other inputs", () => {
    const definition = syllabusProfiles.find(
      (profile) => profile.id === "dld",
    )!.definition;
    const state = { definition, values: { assignment_2: 0 }, target: 70 };
    const draft = createStudyDraft(state);
    draft.inputs.assignment_1 = "101";
    const html = renderCalculator(state, draft);

    expect(inputByName(html, "assignment_1")).toContain('aria-invalid="true"');
    expect(inputByName(html, "assignment_1")).toContain(
      'aria-describedby="study-course-1-assignment_1-weight study-course-1-assignment_1-error"',
    );
    expect(inputByName(html, "assignment_2")).toContain('aria-invalid="false"');
    expect(inputByName(html, "assignment_2")).toContain('value="0"');
    expect(inputByName(html, "assignment_3")).toContain('value=""');
    expect(html).toContain("Исправь отмеченные поля, чтобы увидеть расчёт");
    expect(html).not.toContain('aria-label="Прогноз до цели"');
  });
});

describe("StudyCalculator forecast guidance", () => {
  it("shows guidance for the unknown Quiz in its own attestation and excludes the recorded zero", () => {
    const definition = syllabusProfiles.find(
      (profile) => profile.id === "dbms",
    )!.definition;
    const html = renderToStaticMarkup(
      createElement(StudyTargetForecast, {
        state: { definition, target: 70, values: { quiz_1: 0 } },
      }),
    );
    const rows = [...html.matchAll(/<li\b[^>]*>(.*?)<\/li>/gs)].map((match) =>
      textContent(match[1]),
    );
    const quizzes = rows.filter((row) => row.startsWith("Quiz "));

    expect(rows).toHaveLength(definition.fields.length - 1);
    expect(quizzes).toHaveLength(1);
    expect(quizzes[0]).toContain("Аттестация 2");
    expect(textContent(html)).toContain("Максимальный итог 97");
    expect(textContent(html)).toContain("Нужно в среднем дальше 72,2 / 100");
  });

  it("shows a completed impossible target without inventing remaining assessments", () => {
    const definition = syllabusProfiles.find(
      (profile) => profile.id === "os",
    )!.definition;
    const values = Object.fromEntries(
      definition.fields.map((field) => [field.id, 0]),
    );
    const html = renderToStaticMarkup(
      createElement(StudyTargetForecast, {
        state: { definition, target: 70, values },
      }),
    );

    expect(textContent(html)).toContain("Гарантировано в итог 0");
    expect(textContent(html)).toContain("Максимальный итог 0");
    expect(textContent(html)).toContain("Цель уже недостижима");
    expect(html).not.toContain("<li");
    expect(html).not.toContain("Все оценки введены: расчёт завершён");
  });
});
