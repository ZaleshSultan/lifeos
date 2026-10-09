import {
  validateStudyCalculatorDefinition,
  type StudyCalculatorDefinition,
  type StudyCalculatorState,
} from "./study.js";

export interface StudySyllabusSeed {
  key: string;
  courseCodes: string[];
  courseTitles?: string[];
  definition: StudyCalculatorDefinition;
  document: {
    fileName: string;
    sha256: string;
    sourcePages: number[];
    extractionStatus: "verified" | "needs_review";
  };
  notes?: string[];
}

/** Validate imported data; domain code never reads a PDF or chooses weights by course name. */
export function validateStudySyllabusSeed(
  value: unknown,
): value is StudySyllabusSeed {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const seed = value as Record<string, unknown>;
  const document = seed.document as StudySyllabusSeed["document"] | undefined;
  return (
    typeof seed.key === "string" &&
    /^[a-z0-9][a-z0-9-]{0,99}$/.test(seed.key) &&
    Array.isArray(seed.courseCodes) &&
    seed.courseCodes.length > 0 &&
    seed.courseCodes.every(
      (code) => typeof code === "string" && code.trim() && code.length <= 100,
    ) &&
    (seed.courseTitles === undefined ||
      (Array.isArray(seed.courseTitles) &&
        seed.courseTitles.every(
          (title) =>
            typeof title === "string" && title.trim() && title.length <= 300,
        ))) &&
    validateStudyCalculatorDefinition(seed.definition) &&
    !!document &&
    typeof document.fileName === "string" &&
    document.fileName.endsWith(".pdf") &&
    !/[\\/]/.test(document.fileName) &&
    typeof document.sha256 === "string" &&
    /^[a-f0-9]{64}$/.test(document.sha256) &&
    Array.isArray(document.sourcePages) &&
    document.sourcePages.length > 0 &&
    document.sourcePages.every((page) => Number.isInteger(page) && page > 0) &&
    (document.extractionStatus === "verified" ||
      document.extractionStatus === "needs_review") &&
    (seed.notes === undefined ||
      (Array.isArray(seed.notes) &&
        seed.notes.every(
          (note) => typeof note === "string" && note.length <= 2000,
        )))
  );
}

/** @deprecated Schemes are persisted per course. This compatibility shim invents no fallback. */
export function builtinStudySyllabusDefinition(
  _courseCode: string,
): StudyCalculatorDefinition | null {
  return null;
}
/** @deprecated Read the user's persisted grading scheme instead. */
export function builtinStudyCalculatorState(
  _courseCode: string,
): StudyCalculatorState | null {
  return null;
}
/** @deprecated The initial catalog is data in docs/syllabi/grading-seeds.json, not domain constants. */
export function builtinStudySyllabusCourseCodes(): string[] {
  return [];
}
