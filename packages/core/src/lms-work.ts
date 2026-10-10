export type StudyWorkCategory =
  | "upcoming"
  | "overdue"
  | "submitted_ungraded"
  | "graded"
  | "exams"
  | "unknown";
export type StudyWorkKind =
  | "assignment"
  | "quiz"
  | "exam"
  | "midterm"
  | "unknown";
export type StudySubmissionStatus =
  | "not_submitted"
  | "submitted"
  | "graded"
  | "unknown";
export interface StudyWorkItem {
  category: StudyWorkCategory;
  title: string;
  courseTitle: string | null;
  kind: StudyWorkKind;
  submissionStatus: StudySubmissionStatus;
  dueAt: string | null;
  startsAt: string | null;
  endsAt: string | null;
  score: number | null;
  maxScore: number | null;
  percentage: number | null;
  source: "moodle" | "manual" | "unknown";
}

/** A missing grade never proves that a student has not submitted their work. */
export function classifyStudyWork(
  item: Omit<StudyWorkItem, "category">,
  now: string,
): StudyWorkItem {
  let category: StudyWorkCategory = "unknown";
  if (item.submissionStatus === "graded" || item.score !== null)
    category = "graded";
  else if (item.submissionStatus === "submitted")
    category = "submitted_ungraded";
  else if (item.kind === "exam" || item.kind === "midterm") category = "exams";
  else if (item.dueAt && Date.parse(item.dueAt) >= Date.parse(now))
    category = "upcoming";
  else if (
    item.dueAt &&
    Date.parse(item.dueAt) < Date.parse(now) &&
    item.submissionStatus === "not_submitted"
  )
    category = "overdue";
  return {
    ...item,
    submissionStatus: item.score !== null ? "graded" : item.submissionStatus,
    category,
  };
}
