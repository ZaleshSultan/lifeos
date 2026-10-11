import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { StudyCalculatorState } from "../../../../../packages/core/src/study.js";
import type { StudyWorkspaceCourse } from "../../api/study";
import type { AcademicRecord } from "../../api/types";
import {
  StudyCalculator,
  StudyScenarioResult,
  StudyTargetForecast,
} from "./StudyCalculator";
import { StudyGrades } from "./StudyGrades";
import { syllabusProfiles } from "./syllabus-profiles";
import {
  createStudyDraft,
  parseStudyDraft,
  parseStudyScore,
  reconcileStudyDraft,
  studyDaySessions,
  studyDraftIsDirty,
  studyWeekday,
} from "./model";

const scenario: StudyCalculatorState = {
  definition: {
    version: 1,
    sourceName: "Учебный план",
    attestationThreshold: 25,
    fields: [
      { id: "a1", label: "Работа 1", period: "att1", weightPercent: 100 },
      { id: "a2", label: "Работа 2", period: "att2", weightPercent: 100 },
      { id: "exam", label: "Экзамен", period: "exam", weightPercent: 100 },
    ],
  },
  values: { a1: null, a2: 0, exam: null },
  target: 80,
};

function renderCalculator(
  state: StudyCalculatorState,
  options: {
    storedState?: StudyCalculatorState | null;
    syllabusUnpersisted?: boolean;
  } = {},
) {
  const course: StudyWorkspaceCourse = {
    id: "course-1",
    code: "TEST",
    title: "Тестовый курс",
    startsOn: null,
    endsOn: null,
    calculator: options.storedState === undefined ? state : options.storedState,
    externalCourseKey: null,
    schedules: [],
  };
  return renderToStaticMarkup(
    createElement(StudyCalculator, {
      course,
      records: [],
      draft: createStudyDraft(state),
      onChange: () => {},
      onSave: () => {},
      onReset: () => {},
      saving: false,
      saveError: null,
      saved: false,
      onRefresh: () => {},
      syllabusUnpersisted: options.syllabusUnpersisted,
    }),
  );
}

const renderingCases = [
  {
    id: "dbms",
    att1: ["Assignment 1", "Assignment 2", "Assignment 3", "Quiz", "Midterm"],
    att2: ["Assignment 4", "Assignment 5", "Assignment 6", "Quiz", "Endterm"],
    weights: [
      [20, 20, 20, 10, 30],
      [20, 20, 20, 10, 30],
    ],
  },
  {
    id: "dld",
    att1: ["Assignment 1", "Assignment 2", "Assignment 3", "Midterm"],
    att2: ["Assignment 4", "Assignment 5", "Assignment 6", "Endterm"],
    weights: [
      [20, 20, 20, 40],
      [20, 20, 20, 40],
    ],
  },
  {
    id: "networks",
    att1: [
      "Assignment 1",
      "Assignment 2",
      "Assignment 3",
      "Assignment 4",
      "Midterm",
    ],
    att2: [
      "Assignment 5",
      "Assignment 6",
      "Assignment 7",
      "Assignment 8",
      "Cisco certificate",
      "Endterm",
    ],
    weights: [
      [20, 20, 20, 20, 20],
      [15, 15, 15, 15, 10, 30],
    ],
  },
  {
    id: "os",
    att1: [
      "Assignment 1",
      "Assignment 2",
      "Assignment 3",
      "Assignment 4",
      "Midterm",
    ],
    att2: [
      "Assignment 5",
      "Assignment 6",
      "Assignment 7",
      "Assignment 8",
      "Endterm",
    ],
    weights: [
      [20, 20, 20, 20, 20],
      [20, 20, 20, 20, 20],
    ],
  },
  {
    id: "russian",
    att1: ["Задание", "Рубежный контроль"],
    att2: ["Задание", "Рубежный контроль"],
    weights: [
      [60, 40],
      [60, 40],
    ],
  },
];

describe("study calculator form", () => {
  it("explains unsaved syllabus application without suggesting a draft reset", () => {
    const html = renderCalculator(scenario, {
      storedState: null,
      syllabusUnpersisted: true,
    });
    expect(html).toContain("Формула из силабуса уже показана");
    expect(html).toContain("повтори сохранение формул выше");
    expect(html).toContain("Формула ещё не сохранена");
    expect(html).not.toContain("Схема курса изменилась");
    expect(html).not.toContain("Все изменения сохранены");
    expect(html.match(/<button[^>]*type="submit"[^>]*>/)?.[0]).toContain(
      "disabled",
    );
  });

  it("keeps unknown scores blank and a real zero editable as zero", () => {
    const draft = createStudyDraft(scenario);
    expect(draft.inputs).toEqual({ a1: "", a2: "0", exam: "" });
    expect(parseStudyDraft(draft).state).toEqual(scenario);
    expect(studyDraftIsDirty(draft)).toBe(false);
    const html = renderCalculator(scenario);
    expect(
      html.match(/<input[^>]*id="study-course-1-a1"[^>]*>/)?.[0],
    ).toContain('value=""');
    expect(
      html.match(/<input[^>]*id="study-course-1-a2"[^>]*>/)?.[0],
    ).toContain('value="0"');
  });

  it.each(renderingCases)(
    "renders every $id syllabus assessment separately in its section",
    ({ id, att1, att2, weights }) => {
      const definition = syllabusProfiles.find(
        (profile) => profile.id === id,
      )!.definition;
      const html = renderCalculator({ definition, values: {}, target: 70 });
      const sections = [
        ...html.matchAll(/<fieldset\b[^>]*>(.*?)<\/fieldset>/gs),
      ].map((match) => match[1]);
      const expectedLabels = [att1, att2, ["Финальный экзамен"]];
      const expectedSections = [
        "Аттестация 1",
        "Аттестация 2",
        "Финальный экзамен",
      ];

      expect(sections).toHaveLength(3);
      sections.forEach((section, index) => {
        expect(section.match(/<legend[^>]*>(.*?)<\/legend>/s)?.[1]).toBe(
          expectedSections[index],
        );
        expect(
          [...section.matchAll(/<label\b[^>]*>(.*?)<\/label>/gs)].map(
            (match) => match[1],
          ),
        ).toEqual(expectedLabels[index]);
        expect(section.match(/<input\b/g)).toHaveLength(
          expectedLabels[index].length,
        );
        expect(
          [...section.matchAll(/Вес в (?:аттестации|экзамене): (\d+)%/g)].map(
            (match) => Number(match[1]),
          ),
        ).toEqual(index < 2 ? weights[index] : [100]);
        expect(section).toContain(`${index < 2 ? 30 : 40}% итоговой оценки`);
      });
      for (const field of definition.fields) {
        const inputId = `study-course-1-${field.id}`;
        expect(html).toContain(`for="${inputId}"`);
        const input = [...html.matchAll(/<input\b[^>]*>/g)].find((match) =>
          match[0].includes(`id="${inputId}"`),
        )?.[0];
        expect(input).toContain(`name="${field.id}"`);
        expect(input).toContain(`aria-describedby="${inputId}-weight"`);
      }
      expect(html).not.toContain("Практики / лабораторные");
      expect(html.match(/<input\b/g)).toHaveLength(
        definition.fields.length + 1,
      );
    },
  );

  it("renders custom labels verbatim and keeps same-period assignments independent", () => {
    const definition: StudyCalculatorState["definition"] = {
      ...scenario.definition,
      fields: [
        { id: "first", label: "Практика 1", period: "att1", weightPercent: 50 },
        {
          id: "second",
          label: "Лабораторная 2",
          period: "att1",
          weightPercent: 50,
        },
        ...scenario.definition.fields.filter(
          (field) => field.period !== "att1",
        ),
      ],
    };
    const html = renderCalculator({
      ...scenario,
      definition,
      values: { first: 0, second: 87 },
    });
    expect(
      html.match(/<label for="study-course-1-first"[^>]*>(.*?)<\/label>/)?.[1],
    ).toBe("Практика 1");
    expect(
      html.match(/<label for="study-course-1-second"[^>]*>(.*?)<\/label>/)?.[1],
    ).toBe("Лабораторная 2");
    expect(html.match(/<input[^>]*name="first"[^>]*>/)?.[0]).toContain(
      'value="0"',
    );
    expect(html.match(/<input[^>]*name="second"[^>]*>/)?.[0]).toContain(
      'value="87"',
    );
  });

  it("accepts decimal comma while rejecting out of range and nonnumeric values", () => {
    expect(parseStudyScore("82,5")).toBe(82.5);
    expect(parseStudyScore("0")).toBe(0);
    expect(parseStudyScore("100")).toBe(100);
    expect(parseStudyScore(" ")).toBeNull();
    for (const value of ["-1", "100.1", "abc", "Infinity", "1e2", "12,3,4"]) {
      expect(parseStudyScore(value)).toBe("invalid");
    }
    const draft = createStudyDraft(scenario);
    expect(parseStudyDraft({ ...draft, target: "" }).state).toBeNull();
    expect(
      parseStudyDraft({ ...draft, inputs: { ...draft.inputs, a1: "101" } })
        .invalidFields,
    ).toEqual(["a1"]);
  });

  it("preserves unsaved course inputs across background refreshes and adopts remote values after save", () => {
    const clean = createStudyDraft(scenario);
    const dirty = { ...clean, inputs: { ...clean.inputs, a1: "83" } };
    const remote = { ...scenario, values: { ...scenario.values, a1: 60 } };
    expect(studyDraftIsDirty(dirty)).toBe(true);
    expect(reconcileStudyDraft(dirty, remote)).toBe(dirty);
    expect(reconcileStudyDraft(clean, remote).inputs.a1).toBe("60");
    expect(reconcileStudyDraft(undefined, remote).inputs.a1).toBe("60");
  });

  it("renders incomplete results as unknown, preserves zero and explains the range", () => {
    const html = renderToStaticMarkup(
      createElement(StudyScenarioResult, { state: scenario }),
    );
    expect(html).toContain("Не все баллы введены");
    expect(html).toContain("Возможный итог");
    expect(html).toContain("0–70");
    expect(html).toContain("отмечена пересдача");
    expect(html).toContain("Заполни обе аттестации");
  });

  it("rounds the required exam score upward so the recommendation reaches the target", () => {
    const html = renderToStaticMarkup(
      createElement(StudyScenarioResult, {
        state: { ...scenario, values: { a1: 80.09, a2: 80, exam: null } },
      }),
    );
    expect(html).toContain("80 / 100");
    expect(html).toContain("округлён вверх до 0,1");
  });

  it("shows guaranteed points, maximum and a forecast for each remaining field", () => {
    const html = renderToStaticMarkup(
      createElement(StudyTargetForecast, {
        state: {
          ...scenario,
          values: { a1: 100, a2: null, exam: null },
          target: 65,
        },
      }),
    );
    const text = html.replace(/<[^>]+>/g, "");
    expect(text).toContain("Гарантировано в итог30");
    expect(text).toContain("Максимальный итог100");
    expect(text).toContain("Нужно в среднем дальше50 / 100");
    expect(html).toContain("<details open=");
    expect(html.match(/<li\b/g)).toHaveLength(2);
    expect(text).toContain("Работа 2");
    expect(text).toContain("Экзамен");
    expect(text).not.toContain("Работа 1");
  });

  it("clearly marks an impossible target and impossible per-item guidance", () => {
    const html = renderToStaticMarkup(
      createElement(StudyTargetForecast, { state: scenario }),
    );
    expect(html).toContain("Цель уже недостижима даже при 100 баллах");
    expect(html).toContain("Недостижимо");
    expect(html.match(/<li\b/g)).toHaveLength(2);
    expect(html).not.toContain("Работа 2");
  });
});

describe("study weekly schedule", () => {
  it("selects Sunday using the user timezone instead of the browser UTC day", () => {
    const date = new Date("2026-09-26T22:00:00Z");
    expect(studyWeekday("UTC", date)).toBe("saturday");
    expect(studyWeekday("Asia/Almaty", date)).toBe("sunday");
  });

  it("sorts all selected day sessions and retains independent labs and lectures", () => {
    const course: StudyWorkspaceCourse = {
      id: "course-1",
      code: "TEST",
      title: "Тестовый курс",
      startsOn: null,
      endsOn: null,
      calculator: null,
      externalCourseKey: null,
      schedules: [
        {
          id: "late",
          dayOfWeek: "monday",
          startTime: "14:00:00",
          endTime: "15:00:00",
          room: null,
          sessionType: "lab",
          instructorName: null,
        },
        {
          id: "early",
          dayOfWeek: "monday",
          startTime: "09:00:00",
          endTime: "10:00:00",
          room: null,
          sessionType: "lecture",
          instructorName: null,
        },
        {
          id: "other",
          dayOfWeek: "tuesday",
          startTime: "08:00:00",
          endTime: "09:00:00",
          room: null,
          sessionType: null,
          instructorName: null,
        },
      ],
    };
    expect(
      studyDaySessions([course], "monday").map(({ schedule }) => schedule.id),
    ).toEqual(["early", "late"]);
    expect(studyDaySessions([course], "sunday")).toEqual([]);
  });
});

describe("study synced grades", () => {
  it("shows ungraded and zero values separately without substituting calculator values", () => {
    const record: AcademicRecord = {
      id: "grade-1",
      userId: "user-a",
      sourceEventId: null,
      courseTitle: "Тестовый курс",
      recordType: "assignment",
      title: "Работа",
      valueText: null,
      score: null,
      maxScore: 10,
      percentage: null,
      occursAt: null,
      dueAt: null,
      createdAt: "2026-09-24T00:00:00Z",
      updatedAt: "2026-09-24T00:00:00Z",
    };
    const html = renderToStaticMarkup(
      createElement(StudyGrades, {
        records: [record, { ...record, id: "grade-2", score: 0 }],
      }),
    );
    expect(html).toContain("Ещё не оценено");
    expect(html).toContain("0 / 10");
    expect(html).toContain("Значения калькулятора сохраняются отдельно");
  });
});
