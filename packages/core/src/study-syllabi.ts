import type {
  StudyCalculatorDefinition,
  StudyCalculatorField,
  StudyCalculatorState,
} from "./study.js";

export interface SyllabusProfile {
  id: string;
  title: string;
  courseCode: string;
  aliases: string[];
  source: string;
  sourcePage: number;
  definition: StudyCalculatorDefinition;
}

function field(
  id: string,
  label: string,
  period: StudyCalculatorField["period"],
  weightPercent: number,
): StudyCalculatorField {
  return { id, label, period, weightPercent };
}
function assignments(
  start: number,
  count: number,
  period: "att1" | "att2",
  weight: number,
): StudyCalculatorField[] {
  return Array.from({ length: count }, (_, i) =>
    field(`assignment_${start + i}`, `Assignment ${start + i}`, period, weight),
  );
}
function definition(
  sourceName: string,
  attestationThreshold: number,
  fields: StudyCalculatorField[],
): StudyCalculatorDefinition {
  return {
    version: 1,
    sourceName,
    attestationThreshold,
    fields: [...fields, field("final_exam", "Финальный экзамен", "exam", 100)],
  };
}

/**
 * Values and assessment weights transcribed from the user's 2026–27 syllabi.
 * 0 as a threshold means that this syllabus did not specify a fail threshold;
 * it is NOT a claim that the university has no other admission requirements.
 */
export const syllabusProfiles: SyllabusProfile[] = [
  {
    id: "dbms",
    courseCode: "DMS52-EN",
    title: "Database Management Systems",
    aliases: ["database management systems", "database management", "dbms"],
    source: "Database management systems.pdf",
    sourcePage: 2,
    definition: definition("DBMS · Syllabus 2026–27, p. 2", 25, [
      ...assignments(1, 3, "att1", 20),
      field("quiz_1", "Quiz", "att1", 10),
      field("midterm", "Midterm", "att1", 30),
      ...assignments(4, 3, "att2", 20),
      field("quiz_2", "Quiz", "att2", 10),
      field("endterm", "Endterm", "att2", 30),
    ]),
  },
  {
    id: "dld",
    courseCode: "DLD52-EN",
    title: "Digital Logic Design",
    aliases: ["digital logic design", "digital logic", "dld"],
    source: "Digital Logic Design (CS)-1.pdf",
    sourcePage: 4,
    definition: definition("DLD · Syllabus 2026–27, p. 4", 25, [
      ...assignments(1, 3, "att1", 20),
      field("midterm", "Midterm", "att1", 40),
      ...assignments(4, 3, "att2", 20),
      field("endterm", "Endterm", "att2", 40),
    ]),
  },
  {
    id: "networks",
    courseCode: "CNC53-EN",
    title: "Computer Networks",
    aliases: ["computer networks", "computer network"],
    source: "Computer Networks (CS).pdf",
    sourcePage: 8,
    definition: definition("Computer Networks · Syllabus 2026–27, p. 8", 0, [
      ...assignments(1, 4, "att1", 20),
      field("midterm", "Midterm", "att1", 20),
      ...assignments(5, 4, "att2", 15),
      field("cisco", "Cisco certificate", "att2", 10),
      field("endterm", "Endterm", "att2", 30),
    ]),
  },
  {
    id: "os",
    courseCode: "OS52-EN",
    title: "Operating Systems",
    aliases: ["operating systems", "operating system"],
    source: "Syllabus Operating Systems CS.pdf",
    sourcePage: 8,
    definition: definition("Operating Systems · Syllabus 2026–27, p. 8", 0, [
      ...assignments(1, 4, "att1", 20),
      field("midterm", "Midterm", "att1", 20),
      ...assignments(5, 4, "att2", 20),
      field("endterm", "Endterm", "att2", 20),
    ]),
  },
  {
    id: "russian",
    courseCode: "K(RUSSIAN)L51-RU",
    title: "Русский язык C1",
    aliases: ["русский язык c1", "russian language c1", "russian c1"],
    source: "Русский Язык, С1_4, 2026-2027.pdf",
    sourcePage: 7,
    definition: definition("Русский язык C1 · Syllabus 2026–27, pp. 7–8", 0, [
      field("att1_work", "Задание", "att1", 60),
      field("att1_control", "Рубежный контроль", "att1", 40),
      field("att2_work", "Задание", "att2", 60),
      field("att2_control", "Рубежный контроль", "att2", 40),
    ]),
  },
];

/** Exact historical definitions used only to recognize safe upgrades. */
const SOURCE_NAME = "AITU syllabus (built-in fallback)";
const THRESHOLD = 25;
const LEGACY_BUILTIN_DEFINITIONS: Record<string, StudyCalculatorDefinition> = {
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
      field(
        "krl-a2",
        "Задание 2: Презентация «Оратор» (Недели 8-9)",
        "att2",
        60,
      ),
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

function normalize(value: string): string {
  return value
    .toLocaleLowerCase("ru-RU")
    .replace(/с(?=1(?:\D|$))/gu, "c")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function subjectTitle(title: string): string {
  // Teacher names and group labels are metadata, not additional subjects.
  return normalize(
    title
      .split(/\s*(?:\||[–—]|\s-\s)\s*/u)[0]
      .replace(/\s*\(CS\)\s*$/iu, "")
      .replace(/([cс]1)[_-]\d+\s*$/iu, "$1"),
  );
}

/** Match only a known code or a conservative complete subject title. */
export function matchSyllabusProfile(
  title: string,
  code?: string,
): SyllabusProfile | null {
  const normalizedTitle = subjectTitle(title);
  const normalizedCode = code?.trim().toUpperCase();
  const matches = syllabusProfiles.filter(
    (profile) =>
      profile.courseCode === normalizedCode ||
      profile.aliases.some(
        (alias) =>
          normalize(alias) === normalizedTitle ||
          (code != null && normalize(alias) === normalize(code)),
      ),
  );
  if (matches.length !== 1) return null;
  const match = matches[0];
  // A Russian course explicitly marked at another level must never inherit C1.
  if (
    match.id === "russian" &&
    /(?:^|\s)[abcавс][12](?=\s|$)/iu.test(normalizedTitle) &&
    !/(?:^|\s)c1(?=\s|$)/u.test(normalizedTitle)
  )
    return null;
  return match;
}

function cloneDefinition(
  value: StudyCalculatorDefinition,
): StudyCalculatorDefinition {
  return { ...value, fields: value.fields.map((item) => ({ ...item })) };
}

/** Source names are descriptive; only a complete known formula may be upgraded. */
export function studySyllabusDefinitionMatches(
  left: StudyCalculatorDefinition,
  right: StudyCalculatorDefinition,
): boolean {
  return (
    left.version === right.version &&
    left.attestationThreshold === right.attestationThreshold &&
    left.fields.length === right.fields.length &&
    left.fields.every((item) =>
      right.fields.some(
        (other) =>
          item.id === other.id &&
          item.label === other.label &&
          item.period === other.period &&
          item.weightPercent === other.weightPercent,
      ),
    )
  );
}

const groupedLabels = new Set([
  "практики лабораторные",
  "практики и лабораторные",
  "практики",
  "лабораторные",
  "assignments",
  "labs",
  "laboratories",
  "practices labs",
  "practices laboratories",
]);

function isGenericGrouped(value: StudyCalculatorDefinition): boolean {
  if (value.attestationThreshold !== THRESHOLD || value.fields.length !== 5)
    return false;
  return (
    (["att1", "att2"] as const).every((period) => {
      const items = value.fields.filter((item) => item.period === period);
      const controlLabel = period === "att1" ? "midterm" : "endterm";
      return (
        items.length === 2 &&
        items.some(
          (item) =>
            item.weightPercent === 60 &&
            groupedLabels.has(normalize(item.label)),
        ) &&
        items.some(
          (item) =>
            item.weightPercent === 40 &&
            [controlLabel, `${controlLabel} exam`].includes(
              normalize(item.label),
            ),
        )
      );
    }) &&
    value.fields.some(
      (item) => item.period === "exam" && item.weightPercent === 100,
    )
  );
}

const DEFAULT_TOTAL_DEFINITION: StudyCalculatorDefinition = {
  version: 1,
  sourceName: "Manual syllabus default",
  attestationThreshold: 25,
  fields: [
    field("att1-total", "Итог ATT1", "att1", 100),
    field("att2-total", "Итог ATT2", "att2", 100),
    field("exam", "Экзамен", "exam", 100),
  ],
};

/** The previous frontend profiles had the same items but longer labels. */
function oldFrontendDefinition(
  profile: SyllabusProfile,
): StudyCalculatorDefinition {
  const value = cloneDefinition(profile.definition);
  const labels: Record<string, string> =
    profile.id === "russian"
      ? {
          att1_work: "Задание 1 · 4 неделя",
          att1_control: "Рубежный контроль · 5 неделя",
          att2_work: "Задание 2 · 8–9 недели",
          att2_control: "Рубежный контроль · 10 неделя",
        }
      : profile.id === "dbms"
        ? {
            quiz_1: "Learn quizzes · аттестация 1",
            quiz_2: "Learn quizzes · аттестация 2",
          }
        : {};
  value.fields = value.fields.map((item) => ({
    ...item,
    label:
      item.period === "exam"
        ? "Итоговый экзамен"
        : (labels[item.id] ?? item.label),
  }));
  return value;
}

function semanticKey(
  item: StudyCalculatorField,
  profile: SyllabusProfile,
): string | null {
  if (item.period === "exam") return "exam";
  if (groupedLabels.has(normalize(item.label))) return null;
  if (profile.id === "russian") {
    if (
      /^(?:att[12]_work|krl-a[12])$/u.test(item.id) ||
      /^задание(?:\s|$)/u.test(normalize(item.label))
    ) {
      return `${item.period}:work`;
    }
    if (
      /^(?:att[12]_control|krl-(?:mid|end))$/u.test(item.id) ||
      /^рубежный контроль(?:\s|$)/u.test(normalize(item.label)) ||
      (item.period === "att1" &&
        /^midterm(?:\s|$)/u.test(normalize(item.label))) ||
      (item.period === "att2" &&
        /^endterm(?:\s|$)/u.test(normalize(item.label)))
    ) {
      return `${item.period}:control`;
    }
  }
  const assignment =
    /^(?:assignment_|(?:dms|os)-a)(\d+)$/u.exec(item.id) ??
    /^(?:assignment|lab) (\d+)(?:\s|$)/u.exec(normalize(item.label));
  if (assignment) return `${item.period}:assignment:${Number(assignment[1])}`;
  if (
    /^(?:quiz_[12]|dms-q[12])$/u.test(item.id) ||
    /\bquiz(?:zes)?\b/u.test(normalize(item.label))
  )
    return `${item.period}:quiz`;
  if (
    /^(?:midterm|[a-z]+-mid)$/u.test(item.id) ||
    /^midterm(?:\s|$)/u.test(normalize(item.label))
  )
    return `${item.period}:midterm`;
  if (
    /^(?:endterm|[a-z]+-end)$/u.test(item.id) ||
    /^endterm(?:\s|$)/u.test(normalize(item.label))
  )
    return `${item.period}:endterm`;
  if (item.id === "cisco" || normalize(item.label) === "cisco certificate")
    return `${item.period}:cisco`;
  return null;
}

function migrateValues(
  current: StudyCalculatorState,
  next: StudyCalculatorDefinition,
  profile: SyllabusProfile,
): StudyCalculatorState["values"] {
  const values: StudyCalculatorState["values"] = {};
  for (const item of next.fields) {
    const key = semanticKey(item, profile);
    if (!key) continue;
    const sources = current.definition.fields.filter(
      (other) => semanticKey(other, profile) === key,
    );
    const destinations = next.fields.filter(
      (other) => semanticKey(other, profile) === key,
    );
    if (
      sources.length !== 1 ||
      destinations.length !== 1 ||
      !Object.hasOwn(current.values, sources[0].id)
    )
      continue;
    values[item.id] = current.values[sources[0].id];
  }
  return values;
}

type CalculatorCourse = {
  title: string;
  code: string;
  calculator: StudyCalculatorState | null;
};

/** Resolve known defaults immediately while preserving every custom formula. */
export function resolveStudyCalculator(
  course: CalculatorCourse,
): StudyCalculatorState | null {
  const profile = matchSyllabusProfile(course.title, course.code);
  const current = course.calculator;
  if (
    !profile ||
    (current &&
      studySyllabusDefinitionMatches(current.definition, profile.definition))
  )
    return current;
  if (
    current &&
    !isGenericGrouped(current.definition) &&
    !studySyllabusDefinitionMatches(
      current.definition,
      DEFAULT_TOTAL_DEFINITION,
    ) &&
    !studySyllabusDefinitionMatches(
      current.definition,
      oldFrontendDefinition(profile),
    ) &&
    !studySyllabusDefinitionMatches(
      current.definition,
      LEGACY_BUILTIN_DEFINITIONS[profile.courseCode],
    )
  )
    return current;
  const next = cloneDefinition(profile.definition);
  return {
    definition: next,
    values: current ? migrateValues(current, next, profile) : {},
    target: current?.target ?? 70,
  };
}

/** An idempotent configuration request, or null when no safe automatic change exists. */
export function studySyllabusAutoApplication(course: CalculatorCourse): {
  definition: StudyCalculatorDefinition;
  target: number;
} | null {
  const resolved = resolveStudyCalculator(course);
  return resolved && resolved !== course.calculator
    ? { definition: resolved.definition, target: resolved.target }
    : null;
}

export function builtinStudySyllabusDefinition(
  courseCode: string,
): StudyCalculatorDefinition | null {
  const profile = syllabusProfiles.find(
    (item) => item.courseCode === courseCode.trim().toUpperCase(),
  );
  return profile ? cloneDefinition(profile.definition) : null;
}

export function builtinStudyCalculatorState(
  courseCode: string,
): StudyCalculatorState | null {
  const value = builtinStudySyllabusDefinition(courseCode);
  return value ? { definition: value, values: {}, target: 70 } : null;
}

export function builtinStudySyllabusCourseCodes(): string[] {
  return syllabusProfiles.map((item) => item.courseCode);
}
