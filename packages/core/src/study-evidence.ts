import { matchSyllabusProfile } from "./study-syllabi.js";
import type { StudyCalculatorField } from "./study.js";

/** Minimal saved-grade projection. Credentials and raw LMS sessions are never needed. */
export interface StudyGradeEvidence {
  id: string;
  courseTitle: string;
  title: string;
  score: number | null;
  maxScore: number | null;
  updatedAt: string;
  dueAt?: string | null;
  rawJson?: unknown;
  sourceEventId?: string | null;
}
export function normalizeStudyTitle(value: string): string {
  return value
    .toLocaleLowerCase("ru-RU")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
export function studyEvidenceBelongsToCourse(
  record: Pick<StudyGradeEvidence, "courseTitle">,
  course: { title: string; code: string },
): boolean {
  const a = normalizeStudyTitle(record.courseTitle);
  const b = normalizeStudyTitle(course.title);
  if (!a || !b) return false;
  if (a === b) return true;
  const split = (value: string) => value.split(/\s*(?:\||[–—]|\s-\s)\s*/u);
  const left = split(record.courseTitle);
  const right = split(course.title);
  if (
    left.length > 1 &&
    right.length > 1 &&
    normalizeStudyTitle(left.slice(1).join(" ")) !==
      normalizeStudyTitle(right.slice(1).join(" "))
  )
    return false;
  if (normalizeStudyTitle(left[0]) === normalizeStudyTitle(right[0]))
    return true;
  const profile = matchSyllabusProfile(course.title, course.code);
  return (
    profile !== null &&
    matchSyllabusProfile(record.courseTitle)?.id === profile.id
  );
}
export function studyEvidenceIsMocked(record: StudyGradeEvidence): boolean {
  return Boolean(
    record.rawJson &&
    typeof record.rawJson === "object" &&
    "_is_mocked" in record.rawJson &&
    record.rawJson._is_mocked === true,
  );
}
export function studyEvidencePercent(
  record: StudyGradeEvidence,
): number | null {
  if (
    studyEvidenceIsMocked(record) ||
    record.score === null ||
    record.maxScore === null ||
    !Number.isFinite(record.score) ||
    !Number.isFinite(record.maxScore) ||
    record.maxScore <= 0 ||
    record.score < 0 ||
    record.score > record.maxScore
  )
    return null;
  return (record.score / record.maxScore) * 100;
}
export function studyEvidenceIsAggregate(record: StudyGradeEvidence): boolean {
  const raw = record.rawJson;
  const itemtype =
    raw && typeof raw === "object" && "itemtype" in raw ? raw.itemtype : null;
  return (
    itemtype === "category" ||
    itemtype === "course" ||
    /calculated|register|аттестац|итог семестр|total|aggregate|average|средн/.test(
      normalizeStudyTitle(record.title),
    )
  );
}
/** Only explicit period totals, never an assignment mentioning an attestation. */
export function studyEvidencePeriodTotal(
  record: StudyGradeEvidence,
): "att1" | "att2" | null {
  const title = normalizeStudyTitle(record.title);
  const match =
    /^(?:att|attestation|аттестация)\s*([12])(?:\s+(?:total|итог|calculated grade))?$/.exec(
      title,
    );
  return match ? (match[1] === "1" ? "att1" : "att2") : null;
}
export function studyAssessmentIsAmbiguous(title: string): boolean {
  const identities = [
    ...normalizeStudyTitle(title).matchAll(
      /(?:^| )(?:assignment\s*\d+|асаймент\s*\d+|задание\s*\d+|lecture async\s*\d+|midterm|endterm|final exam|final test|итоговый экзамен|cisco (?:course )?certificate|quiz)(?= |$)/g,
    ),
  ];
  return (
    identities.length > 1 ||
    /(?:assignment|асаймент|задание)\s*\d+\s*(?:[-–—/,&+]|\band\b|\bto\b|\bthrough\b|и|до)\s*\d+/iu.test(
      title,
    )
  );
}
/** Exact DBMS external-platform totals, including Moodle's assignment prefix. */
export function studyEvidenceExternalAsyncField(
  record: Pick<StudyGradeEvidence, "title">,
  course: { title: string; code: string },
): "quiz_1" | "quiz_2" | null {
  if (matchSyllabusProfile(course.title, course.code)?.id !== "dbms")
    return null;
  const match = /^(?:assignment )?lecture async ([12])$/.exec(
    normalizeStudyTitle(record.title),
  );
  return match ? (match[1] === "1" ? "quiz_1" : "quiz_2") : null;
}
/** Moodle HTML includes the activity type inside the display name (e.g. "Quiz Assignment 6"). */
function assessmentTitle(record: StudyGradeEvidence): string | null {
  const raw = record.rawJson;
  if (!raw || typeof raw !== "object") return record.title;
  const module =
    "moodle_module" in raw
      ? raw.moodle_module
      : "itemmodule" in raw
        ? raw.itemmodule
        : null;
  if (module !== "assign" && module !== "quiz") return record.title;
  const source =
    "item_name" in raw
      ? raw.item_name
      : "itemname" in raw
        ? raw.itemname
        : null;
  if (typeof source !== "string" || !source.trim()) return record.title;
  const prefix = module === "assign" ? /^assignment\s+/iu : /^quiz\s+/iu;
  const stripped = record.title.trim().replace(prefix, "");
  const name = normalizeStudyTitle(source);
  if (
    name !== normalizeStudyTitle(record.title) &&
    name !== normalizeStudyTitle(stripped)
  )
    return null;
  // A plain "Assignment 1" already starts with the assessment's own name.
  return /^\d/u.test(stripped) ? record.title : stripped;
}

/** Conservative matching, with the user-confirmed DBMS component totals as explicit exceptions. */
export function studyEvidenceMatchesField(
  field: Pick<StudyCalculatorField, "id">,
  record: StudyGradeEvidence,
  course?: { title: string; code: string },
  allowAmbiguous = false,
): boolean {
  const name = assessmentTitle(record);
  if (!name) return false;
  const title = normalizeStudyTitle(name);
  if (
    /(?:^| )(?:fx|resit|re sit|retake|re take|makeup|make up|reexam|re exam|retry|пересдач[а-яё]*)(?: |$)/u.test(
      title,
    ) ||
    /(?:^| )(?:practice|mock|bonus) (?:midterm|endterm|final|assignment|quiz)(?: |$)|(?:^| )(?:midterm|endterm|final exam|final test) (?:practice|mock|bonus)(?: |$)/u.test(
      title,
    ) ||
    /(?:^| )(?:second|repeat) attempt(?: |$)|(?:^| )(?:attempt|попытка) [2-9](?: |$)/u.test(
      title,
    )
  )
    return false;
  // Confirmed DBMS rubric: Async is the external platform's published total,
  // and "Quiz Midterm" is one assessment, not two overlapping components.
  if (
    course &&
    matchSyllabusProfile(course.title, course.code)?.id === "dbms"
  ) {
    const asyncField = studyEvidenceExternalAsyncField(record, course);
    if (asyncField) return field.id === asyncField;
    if (title === "quiz midterm") return field.id === "midterm";
  }
  if (studyEvidenceIsAggregate(record)) return false;
  if (!allowAmbiguous && studyAssessmentIsAmbiguous(name)) return false;
  if (
    course &&
    matchSyllabusProfile(course.title, course.code)?.id === "russian"
  ) {
    const item = /^(задание|рк|рубежный контроль) ([12])$/.exec(title);
    if (item)
      return (
        field.id ===
        "att" + item[2] + (item[1] === "задание" ? "_work" : "_control")
      );
  }
  const assignment = /^assignment_(\d+)$/.exec(field.id);
  if (assignment)
    return [
      ...title.matchAll(
        /(?:^| )(?:assignment|асаймент|задание)\s*(\d+)(?= |$)/g,
      ),
    ].some((match) => match[1] === assignment[1]);
  if (field.id === "quiz_1" || field.id === "quiz_2") return false;
  if (
    /^(?:midterm|endterm|final exam|final test) (?:test )?[2-9](?: |$)/u.test(
      title,
    )
  )
    return false;
  if (field.id === "midterm")
    return /(?:^| )midterm(?: |$)/.test(title) && !/assignment/.test(title);
  if (field.id === "endterm")
    return /(?:^| )endterm(?: |$)/.test(title) && !/assignment/.test(title);
  if (field.id === "final_exam")
    return /(?:^| )(?:final exam|final test|итоговый экзамен)(?: |$)/.test(
      title,
    );
  if (field.id === "cisco")
    return /(?:^| )cisco (?:course )?certificate(?: |$)/.test(title);
  return false;
}

export function studyEvidenceOfficialPeriod(
  record: StudyGradeEvidence,
  course: { title: string; code: string },
): "att1" | "att2" | null {
  if (
    matchSyllabusProfile(course.title, course.code)?.id === "dbms" &&
    /^(?:calculated(?: grade)? )?register midterm$/.test(
      normalizeStudyTitle(record.title),
    )
  )
    return "att1";
  return studyEvidencePeriodTotal(record);
}
