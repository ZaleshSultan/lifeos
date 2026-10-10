import type { StudyCalculatorDefinition, StudyCalculatorField } from "../../../../../packages/core/src/study.js";

export interface SyllabusProfile {
  id: string;
  title: string;
  aliases: string[];
  source: string;
  sourcePage: number;
  definition: StudyCalculatorDefinition;
}

function field(id: string, label: string, period: StudyCalculatorField["period"], weightPercent: number): StudyCalculatorField {
  return { id, label, period, weightPercent };
}
function assignments(start: number, count: number, period: "att1" | "att2", weight: number): StudyCalculatorField[] {
  return Array.from({ length: count }, (_, i) =>
    field(`assignment_${start + i}`, `Assignment ${start + i}`, period, weight));
}
function definition(sourceName: string, attestationThreshold: number, fields: StudyCalculatorField[]): StudyCalculatorDefinition {
  return {
    version: 1,
    sourceName,
    attestationThreshold,
    fields: [...fields, field("final_exam", "Итоговый экзамен", "exam", 100)],
  };
}

/**
 * Values and assessment weights transcribed from the user's 2026–27 syllabi.
 * 0 as a threshold means that this syllabus did not specify a fail threshold;
 * it is NOT a claim that the university has no other admission requirements.
 */
export const syllabusProfiles: SyllabusProfile[] = [
  {
    id: "dbms", title: "Database Management Systems",
    aliases: ["database management systems", "database management", "dbms"],
    source: "Database management systems.pdf", sourcePage: 2,
    definition: definition("DBMS · Syllabus 2026–27, p. 2", 25, [
      ...assignments(1, 3, "att1", 20),
      field("quiz_1", "Learn quizzes · аттестация 1", "att1", 10),
      field("midterm", "Midterm", "att1", 30),
      ...assignments(4, 3, "att2", 20),
      field("quiz_2", "Learn quizzes · аттестация 2", "att2", 10),
      field("endterm", "Endterm", "att2", 30),
    ]),
  },
  {
    id: "dld", title: "Digital Logic Design",
    aliases: ["digital logic design", "digital logic", "dld"],
    source: "Digital Logic Design (CS)-1.pdf", sourcePage: 4,
    definition: definition("DLD · Syllabus 2026–27, p. 4", 25, [
      ...assignments(1, 3, "att1", 20),
      field("midterm", "Midterm", "att1", 40),
      ...assignments(4, 3, "att2", 20),
      field("endterm", "Endterm", "att2", 40),
    ]),
  },
  {
    id: "networks", title: "Computer Networks",
    aliases: ["computer networks", "computer network", "networking"],
    source: "Computer Networks (CS).pdf", sourcePage: 8,
    definition: definition("Computer Networks · Syllabus 2026–27, p. 8", 0, [
      ...assignments(1, 4, "att1", 20),
      field("midterm", "Midterm", "att1", 20),
      ...assignments(5, 4, "att2", 15),
      field("cisco", "Cisco certificate", "att2", 10),
      field("endterm", "Endterm", "att2", 30),
    ]),
  },
  {
    id: "os", title: "Operating Systems",
    aliases: ["operating systems", "operating system"],
    source: "Syllabus Operating Systems CS.pdf", sourcePage: 8,
    definition: definition("Operating Systems · Syllabus 2026–27, p. 8", 0, [
      ...assignments(1, 4, "att1", 20),
      field("midterm", "Midterm", "att1", 20),
      ...assignments(5, 4, "att2", 20),
      field("endterm", "Endterm", "att2", 20),
    ]),
  },
  {
    id: "russian", title: "Русский язык C1",
    aliases: ["русский язык", "russian language", "russian c1"],
    source: "Русский Язык, С1_4, 2026-2027.pdf", sourcePage: 7,
    definition: definition("Русский язык C1 · Syllabus 2026–27, pp. 7–8", 0, [
      field("att1_work", "Задание 1 · 4 неделя", "att1", 60),
      field("att1_control", "Рубежный контроль · 5 неделя", "att1", 40),
      field("att2_work", "Задание 2 · 8–9 недели", "att2", 60),
      field("att2_control", "Рубежный контроль · 10 неделя", "att2", 40),
    ]),
  },
];

function normalize(value: string): string {
  return value.toLocaleLowerCase("ru-RU").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function matchSyllabusProfile(title: string, code?: string): SyllabusProfile | null {
  const haystack = normalize(`${title} ${code ?? ""}`);
  const matches = syllabusProfiles.filter((profile) =>
    profile.aliases.some((alias) => {
      const key = normalize(alias);
      return haystack === key || haystack.startsWith(key + " ") || haystack.endsWith(" " + key) || haystack.includes(" " + key + " ");
    }));
  return matches.length === 1 ? matches[0] : null;
}
