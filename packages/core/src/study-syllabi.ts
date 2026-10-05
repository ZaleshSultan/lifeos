import type { StudyCalculatorDefinition, StudyCalculatorState } from "./study.js";

const SOURCE_NAME = "AITU syllabus (built-in fallback)";
const THRESHOLD = 25;

type Field = StudyCalculatorDefinition["fields"][number];

function field(
  id: string,
  label: string,
  period: Field["period"],
  weightPercent: number,
): Field {
  return { id, label, period, weightPercent };
}

const DEFINITIONS: Record<string, StudyCalculatorDefinition> = {
  "OS52-EN": {
    version: 1,
    sourceName: SOURCE_NAME,
    attestationThreshold: THRESHOLD,
    fields: [
      field("os-a1", "Lab 1 (Week 1)", "att1", 20),
      field("os-a2", "Lab 2 (Week 2)", "att1", 20),
      field("os-a3", "Lab 3 (Week 3)", "att1", 20),
      field("os-a4", "Lab 4 (Week 4)", "att1", 20),
      field("os-mid", "Midterm Exam", "att1", 20),
      field("os-a5", "Lab 5 (Week 6)", "att2", 20),
      field("os-a6", "Lab 6 (Week 7)", "att2", 20),
      field("os-a7", "Lab 7 (Week 8)", "att2", 20),
      field("os-a8", "Lab 8 (Week 9)", "att2", 20),
      field("os-end", "Endterm Exam", "att2", 20),
      field("os-exam", "Экзамен", "exam", 100),
    ],
  },
  "DMS52-EN": {
    version: 1,
    sourceName: SOURCE_NAME,
    attestationThreshold: THRESHOLD,
    fields: [
      field("dms-a1", "Assignment 1: ERD Diagram", "att1", 20),
      field("dms-a2", "Assignment 2: Intro to DDL", "att1", 20),
      field("dms-a3", "Assignment 3: DML & JOINs", "att1", 20),
      field("dms-q1", "Learn Quiz (Moodle)", "att1", 10),
      field("dms-mid", "Midterm Exam (Mixed)", "att1", 30),
      field("dms-a4", "Assignment 4: Subqueries", "att2", 20),
      field("dms-a5", "Assignment 5: Window Functions", "att2", 20),
      field("dms-a6", "Assignment 6: Set Ops & ACID", "att2", 20),
      field("dms-q2", "Learn Quiz (Moodle)", "att2", 10),
      field("dms-end", "Endterm Exam (Mixed)", "att2", 30),
      field("dms-exam", "Экзамен", "exam", 100),
    ],
  },
  "K(RUSSIAN)L51-RU": {
    version: 1,
    sourceName: SOURCE_NAME,
    attestationThreshold: THRESHOLD,
    fields: [
      field("krl-a1", "Задание 1: Анализ языковых норм (Неделя 4)", "att1", 60),
      field("krl-mid", "Midterm Exam (Тестирование)", "att1", 40),
      field("krl-a2", "Задание 2: Презентация «Оратор» (Недели 8-9)", "att2", 60),
      field("krl-end", "Endterm Exam (Тестирование)", "att2", 40),
      field("krl-exam", "Экзамен", "exam", 100),
    ],
  },
  "CNC53-EN": {
    version: 1,
    sourceName: SOURCE_NAME,
    attestationThreshold: THRESHOLD,
    fields: [
      field("cnc-p1", "Практики / лабораторные", "att1", 60),
      field("cnc-mid", "Midterm Exam", "att1", 40),
      field("cnc-p2", "Практики / лабораторные", "att2", 60),
      field("cnc-end", "Endterm Exam", "att2", 40),
      field("cnc-exam", "Экзамен", "exam", 100),
    ],
  },
  "DLD52-EN": {
    version: 1,
    sourceName: SOURCE_NAME,
    attestationThreshold: THRESHOLD,
    fields: [
      field("dld-p1", "Практики / лабораторные", "att1", 60),
      field("dld-mid", "Midterm Exam", "att1", 40),
      field("dld-p2", "Практики / лабораторные", "att2", 60),
      field("dld-end", "Endterm Exam", "att2", 40),
      field("dld-exam", "Экзамен", "exam", 100),
    ],
  },
};

function cloneDefinition(definition: StudyCalculatorDefinition): StudyCalculatorDefinition {
  return {
    ...definition,
    fields: definition.fields.map((item) => ({ ...item })),
  };
}

export function builtinStudySyllabusDefinition(
  courseCode: string,
): StudyCalculatorDefinition | null {
  const definition = DEFINITIONS[courseCode.trim().toUpperCase()];
  return definition ? cloneDefinition(definition) : null;
}

export function builtinStudyCalculatorState(
  courseCode: string,
): StudyCalculatorState | null {
  const definition = builtinStudySyllabusDefinition(courseCode);
  return definition ? { definition, values: {}, target: 70 } : null;
}

export function builtinStudySyllabusCourseCodes(): string[] {
  return Object.keys(DEFINITIONS);
}
