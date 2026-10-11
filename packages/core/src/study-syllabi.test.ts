import { describe, expect, it } from "vitest";
import {
  calculateStudyScenario,
  calculateStudyTargetPlan,
  validateStudyCalculatorDefinition,
  type StudyCalculatorDefinition,
  type StudyCalculatorState,
} from "./study.js";
import {
  builtinStudyCalculatorState,
  builtinStudySyllabusDefinition,
  builtinStudySyllabusCourseCodes,
  matchSyllabusProfile,
  resolveStudyCalculator,
  studySyllabusAutoApplication,
  studySyllabusDefinitionMatches,
  syllabusProfiles,
} from "./study-syllabi.js";

const exactItems = [
  [
    "dbms",
    [
      ["Assignment 1", 20],
      ["Assignment 2", 20],
      ["Assignment 3", 20],
      ["Quiz", 10],
      ["Midterm", 30],
    ],
    [
      ["Assignment 4", 20],
      ["Assignment 5", 20],
      ["Assignment 6", 20],
      ["Quiz", 10],
      ["Endterm", 30],
    ],
  ],
  [
    "dld",
    [
      ["Assignment 1", 20],
      ["Assignment 2", 20],
      ["Assignment 3", 20],
      ["Midterm", 40],
    ],
    [
      ["Assignment 4", 20],
      ["Assignment 5", 20],
      ["Assignment 6", 20],
      ["Endterm", 40],
    ],
  ],
  [
    "networks",
    [
      ["Assignment 1", 20],
      ["Assignment 2", 20],
      ["Assignment 3", 20],
      ["Assignment 4", 20],
      ["Midterm", 20],
    ],
    [
      ["Assignment 5", 15],
      ["Assignment 6", 15],
      ["Assignment 7", 15],
      ["Assignment 8", 15],
      ["Cisco certificate", 10],
      ["Endterm", 30],
    ],
  ],
  [
    "os",
    [
      ["Assignment 1", 20],
      ["Assignment 2", 20],
      ["Assignment 3", 20],
      ["Assignment 4", 20],
      ["Midterm", 20],
    ],
    [
      ["Assignment 5", 20],
      ["Assignment 6", 20],
      ["Assignment 7", 20],
      ["Assignment 8", 20],
      ["Endterm", 20],
    ],
  ],
  [
    "russian",
    [
      ["Задание", 60],
      ["Рубежный контроль", 40],
    ],
    [
      ["Задание", 60],
      ["Рубежный контроль", 40],
    ],
  ],
] as const;

function genericState(): StudyCalculatorState {
  return {
    definition: {
      version: 1,
      sourceName: "Generic study fallback",
      attestationThreshold: 25,
      fields: [
        {
          id: "practice1",
          label: "Практики / лабораторные",
          period: "att1",
          weightPercent: 60,
        },
        { id: "mid", label: "Midterm", period: "att1", weightPercent: 40 },
        {
          id: "practice2",
          label: "Практики / лабораторные",
          period: "att2",
          weightPercent: 60,
        },
        { id: "end", label: "Endterm", period: "att2", weightPercent: 40 },
        { id: "exam", label: "Экзамен", period: "exam", weightPercent: 100 },
      ],
    },
    values: {},
    target: 70,
  };
}

describe("built-in study syllabi", () => {
  it("contains valid calculator definitions for all five current courses", () => {
    expect(builtinStudySyllabusCourseCodes()).toHaveLength(5);
    for (const code of builtinStudySyllabusCourseCodes()) {
      const state = builtinStudyCalculatorState(code);
      expect(state).not.toBeNull();
      expect(validateStudyCalculatorDefinition(state!.definition)).toBe(true);
      expect(state!.target).toBe(70);
    }
  });

  it("does not invent a syllabus for an unknown course", () => {
    expect(builtinStudyCalculatorState("UNKNOWN-101")).toBeNull();
  });

  it.each(exactItems)(
    "preserves every exact %s item and the 30/30/40 final formula",
    (id, att1, att2) => {
      const profile = syllabusProfiles.find((item) => item.id === id)!;
      const storedDefault = builtinStudySyllabusDefinition(profile.courseCode)!;
      for (const [period, expected] of [
        ["att1", att1],
        ["att2", att2],
      ] as const) {
        expect(
          storedDefault.fields
            .filter((item) => item.period === period)
            .map((item) => [item.label, item.weightPercent]),
        ).toEqual(expected);
      }
      expect(
        storedDefault.fields.filter((item) => item.period === "exam"),
      ).toEqual([
        {
          id: "final_exam",
          label: "Финальный экзамен",
          period: "exam",
          weightPercent: 100,
        },
      ]);
      const values = Object.fromEntries(
        storedDefault.fields.map((item) => [
          item.id,
          item.period === "att1" ? 80 : item.period === "att2" ? 60 : 90,
        ]),
      );
      expect(
        calculateStudyScenario({
          definition: storedDefault,
          values,
          target: 70,
        }).finalScore,
      ).toBe(78);
    },
  );

  it("returns independent built-in definitions", () => {
    const first = builtinStudyCalculatorState("DMS52-EN")!;
    first.definition.fields[0].weightPercent = 99;
    first.values.assignment_1 = 95;
    expect(
      builtinStudyCalculatorState("DMS52-EN")!.definition.fields[0]
        .weightPercent,
    ).toBe(20);
    expect(builtinStudyCalculatorState("DMS52-EN")!.values).toEqual({});
  });

  it.each(syllabusProfiles)(
    "forecasts every remaining $title item with its own final-grade weight",
    (profile) => {
      const state = builtinStudyCalculatorState(profile.courseCode)!;
      const first = state.definition.fields[0];
      state.values[first.id] = 80;
      state.values.final_exam = null;
      const plan = calculateStudyTargetPlan(state);
      const earned = first.weightPercent * 0.3 * 0.8;
      expect(plan.earnedFinalPoints).toBeCloseTo(earned);
      expect(plan.maximumFinal).toBeCloseTo(
        100 - first.weightPercent * 0.3 * 0.2,
      );
      expect(plan.missing.map((item) => [item.id, item.label])).toEqual(
        state.definition.fields.slice(1).map((item) => [item.id, item.label]),
      );
      expect(
        plan.missing.find((item) => item.id === "final_exam")!.weightInFinal,
      ).toBe(40);
      expect(plan.targetPossible).toBe(true);

      const values = {
        ...state.values,
        ...Object.fromEntries(
          plan.missing.map((item) => [item.id, plan.requiredAverage!]),
        ),
      };
      expect(
        calculateStudyScenario({ ...state, values }).minimumFinal,
      ).toBeGreaterThanOrEqual(70);
    },
  );
});

describe("safe syllabus matching", () => {
  it.each(syllabusProfiles)(
    "matches $title by known code and subject title",
    (profile) => {
      expect(matchSyllabusProfile(profile.title)?.id).toBe(profile.id);
      expect(
        matchSyllabusProfile(
          "Unknown imported title",
          ` ${profile.courseCode.toLowerCase()} `,
        )?.id,
      ).toBe(profile.id);
      expect(matchSyllabusProfile(`${profile.title} | Teacher Name`)?.id).toBe(
        profile.id,
      );
    },
  );

  it.each([
    "Русский язык C1_4",
    "Русский Язык, С1_4",
    "Russian language C1",
    "Russian C1",
  ])("recognizes the C1 title %s", (title) => {
    expect(matchSyllabusProfile(title)?.id).toBe("russian");
  });

  it.each([
    "Русский язык",
    "Russian language",
    "Russian C2",
    "Русский язык B2",
    "Русский язык С2",
    "Networking",
    "Advanced Computer Networks",
    "Operating Systems Design",
    "Database Management for Business",
  ])("does not guess an unrelated or unspecified subject: %s", (title) => {
    expect(matchSyllabusProfile(title)).toBeNull();
  });

  it("refuses contradictory matched subjects and explicit Russian levels", () => {
    expect(matchSyllabusProfile("Computer Networks", "OS52-EN")).toBeNull();
    expect(
      matchSyllabusProfile("Русский язык B2", "K(RUSSIAN)L51-RU"),
    ).toBeNull();
    expect(
      matchSyllabusProfile("Русский язык С2", "K(RUSSIAN)L51-RU"),
    ).toBeNull();
  });
});

describe("automatic syllabus application", () => {
  it("compares definitions independently of source descriptions and field order", () => {
    const definition = builtinStudySyllabusDefinition("DMS52-EN")!;
    const reordered = {
      ...definition,
      sourceName: "Imported DBMS syllabus",
      fields: [...definition.fields].reverse(),
    };
    expect(studySyllabusDefinitionMatches(definition, reordered)).toBe(true);
    reordered.fields = reordered.fields.map((item) => ({ ...item }));
    reordered.fields[0].label = "Custom exam";
    expect(studySyllabusDefinitionMatches(definition, reordered)).toBe(false);
  });

  it.each(syllabusProfiles)(
    "automatically configures every empty or grouped $title course",
    (profile) => {
      for (const calculator of [null, genericState()]) {
        const course = {
          title: profile.title,
          code: "imported-code",
          calculator,
        };
        const request = studySyllabusAutoApplication(course)!;
        expect(request.definition).toEqual(profile.definition);
        expect(request.target).toBe(70);
        const resolved = resolveStudyCalculator(course)!;
        expect(resolved.definition).toEqual(profile.definition);
        expect(resolved.values).toEqual({});
        expect(
          studySyllabusAutoApplication({ ...course, calculator: resolved }),
        ).toBeNull();
      }
    },
  );

  it("preserves custom targets and maps only individual grades when expanding grouped formulas", () => {
    const calculator = genericState();
    calculator.values = {
      practice1: 91,
      mid: 0,
      practice2: 88,
      end: null,
      exam: 77,
    };
    calculator.target = 85;
    const course = { title: "Computer Networks", code: "CNC53-EN", calculator };
    const resolved = resolveStudyCalculator(course)!;
    expect(resolved.target).toBe(85);
    expect(resolved.values).toEqual({
      midterm: 0,
      endterm: null,
      final_exam: 77,
    });
    expect(
      resolved.definition.fields
        .filter((item) => item.id.startsWith("assignment_"))
        .every((item) => resolved.values[item.id] === undefined),
    ).toBe(true);
    expect(calculator.values).toEqual({
      practice1: 91,
      mid: 0,
      practice2: 88,
      end: null,
      exam: 77,
    });
  });

  it("never reuses a grouped score even when its ID resembles an assignment", () => {
    const calculator = genericState();
    calculator.definition.fields[0].id = "assignment_1";
    calculator.values.assignment_1 = 90;
    const resolved = resolveStudyCalculator({
      title: "Digital Logic Design",
      code: "",
      calculator,
    })!;
    expect(resolved.values.assignment_1).toBeUndefined();
  });

  it("preserves uniquely identified Russian controls when replacing the grouped fallback", () => {
    const calculator = genericState();
    calculator.values = {
      practice1: 88,
      mid: 0,
      practice2: 92,
      end: 75,
      exam: null,
    };
    const resolved = resolveStudyCalculator({
      title: "Русский язык C1",
      code: "",
      calculator,
    })!;
    expect(resolved.values).toEqual({
      att1_control: 0,
      att2_control: 75,
      final_exam: null,
    });
  });

  it("preserves a custom threshold on a grouped formula", () => {
    const calculator = genericState();
    calculator.definition.attestationThreshold = 50;
    const course = { title: "Computer Networks", code: "CNC53-EN", calculator };
    expect(resolveStudyCalculator(course)).toBe(calculator);
    expect(studySyllabusAutoApplication(course)).toBeNull();
  });

  it("upgrades the known manual total fallback without inventing assignment scores from totals", () => {
    const calculator: StudyCalculatorState = {
      definition: {
        version: 1,
        sourceName: "Ручной силабус: DLD52-EN",
        attestationThreshold: 25,
        fields: [
          {
            id: "att1-total",
            label: "Итог ATT1",
            period: "att1",
            weightPercent: 100,
          },
          {
            id: "att2-total",
            label: "Итог ATT2",
            period: "att2",
            weightPercent: 100,
          },
          { id: "exam", label: "Экзамен", period: "exam", weightPercent: 100 },
        ],
      },
      values: { "att1-total": 80, "att2-total": 70, exam: 0 },
      target: 75,
    };
    const resolved = resolveStudyCalculator({
      title: "Digital Logic Design",
      code: "DLD52-EN",
      calculator,
    })!;
    expect(resolved.definition).toEqual(
      syllabusProfiles.find((item) => item.id === "dld")!.definition,
    );
    expect(resolved.values).toEqual({ final_exam: 0 });
    expect(resolved.target).toBe(75);
  });

  it("recognizes a stored historical DBMS definition and migrates its uniquely corresponding grades", () => {
    const definition: StudyCalculatorDefinition = {
      version: 1,
      sourceName: "AITU syllabus (built-in fallback)",
      attestationThreshold: 25,
      fields: [
        {
          id: "dms-a1",
          label: "Assignment 1: ERD Diagram",
          period: "att1",
          weightPercent: 20,
        },
        {
          id: "dms-a2",
          label: "Assignment 2: Intro to DDL",
          period: "att1",
          weightPercent: 20,
        },
        {
          id: "dms-a3",
          label: "Assignment 3: DML & JOINs",
          period: "att1",
          weightPercent: 20,
        },
        {
          id: "dms-q1",
          label: "Learn Quiz (Moodle)",
          period: "att1",
          weightPercent: 10,
        },
        {
          id: "dms-mid",
          label: "Midterm Exam (Mixed)",
          period: "att1",
          weightPercent: 30,
        },
        {
          id: "dms-a4",
          label: "Assignment 4: Subqueries",
          period: "att2",
          weightPercent: 20,
        },
        {
          id: "dms-a5",
          label: "Assignment 5: Window Functions",
          period: "att2",
          weightPercent: 20,
        },
        {
          id: "dms-a6",
          label: "Assignment 6: Set Ops & ACID",
          period: "att2",
          weightPercent: 20,
        },
        {
          id: "dms-q2",
          label: "Learn Quiz (Moodle)",
          period: "att2",
          weightPercent: 10,
        },
        {
          id: "dms-end",
          label: "Endterm Exam (Mixed)",
          period: "att2",
          weightPercent: 30,
        },
        {
          id: "dms-exam",
          label: "Экзамен",
          period: "exam",
          weightPercent: 100,
        },
      ],
    };
    const calculator = {
      definition,
      values: { "dms-a1": 88, "dms-q1": 0, "dms-q2": 70, "dms-mid": null },
      target: 80,
    };
    const resolved = resolveStudyCalculator({
      title: "Database Management Systems",
      code: "DMS52-EN",
      calculator,
    })!;
    expect(resolved.definition).toEqual(syllabusProfiles[0].definition);
    expect(resolved.values).toEqual({
      assignment_1: 88,
      quiz_1: 0,
      quiz_2: 70,
      midterm: null,
    });
    expect(resolved.target).toBe(80);
  });

  it.each(syllabusProfiles)(
    "updates historical frontend $title labels while preserving same-ID values",
    (profile) => {
      const definition = structuredClone(profile.definition);
      definition.fields.find((item) => item.period === "exam")!.label =
        "Итоговый экзамен";
      if (profile.id === "dbms") {
        definition.fields.find((item) => item.id === "quiz_1")!.label =
          "Learn quizzes · аттестация 1";
        definition.fields.find((item) => item.id === "quiz_2")!.label =
          "Learn quizzes · аттестация 2";
      }
      if (profile.id === "russian") {
        for (const [id, label] of [
          ["att1_work", "Задание 1 · 4 неделя"],
          ["att1_control", "Рубежный контроль · 5 неделя"],
          ["att2_work", "Задание 2 · 8–9 недели"],
          ["att2_control", "Рубежный контроль · 10 неделя"],
        ])
          definition.fields.find((item) => item.id === id)!.label = label;
      }
      const values = Object.fromEntries(
        definition.fields.map((item) => [item.id, 74]),
      );
      const resolved = resolveStudyCalculator({
        title: profile.title,
        code: "",
        calculator: { definition, values, target: 75 },
      })!;
      expect(resolved.definition).toEqual(profile.definition);
      expect(resolved.values).toEqual(values);
      expect(resolved.target).toBe(75);
    },
  );

  it("leaves unrelated courses and custom formulas untouched even under a built-in source name", () => {
    const grouped = genericState();
    const unknown = {
      title: "Statistics",
      code: "UNKNOWN",
      calculator: grouped,
    };
    expect(resolveStudyCalculator(unknown)).toBe(grouped);
    expect(studySyllabusAutoApplication(unknown)).toBeNull();
    expect(resolveStudyCalculator({ ...unknown, calculator: null })).toBeNull();
    const custom = genericState();
    custom.definition.sourceName = "AITU syllabus (built-in fallback)";
    for (const item of custom.definition.fields)
      if (item.period !== "exam") item.weightPercent = 50;
    const course = {
      title: "Digital Logic Design",
      code: "DLD52-EN",
      calculator: custom,
    };
    expect(validateStudyCalculatorDefinition(custom.definition)).toBe(true);
    expect(resolveStudyCalculator(course)).toBe(custom);
    expect(studySyllabusAutoApplication(course)).toBeNull();
  });

  it("does not overwrite custom weights, labels, or thresholds in an otherwise canonical profile", () => {
    for (const change of ["weight", "label", "threshold"] as const) {
      const calculator = builtinStudyCalculatorState("DMS52-EN")!;
      if (change === "weight") {
        calculator.definition.fields[0].weightPercent = 25;
        calculator.definition.fields[1].weightPercent = 15;
      } else if (change === "label")
        calculator.definition.fields[0].label = "Custom project";
      else calculator.definition.attestationThreshold = 50;
      const course = {
        title: "Database Management Systems",
        code: "DMS52-EN",
        calculator,
      };
      expect(resolveStudyCalculator(course)).toBe(calculator);
      expect(studySyllabusAutoApplication(course)).toBeNull();
    }
  });
});
