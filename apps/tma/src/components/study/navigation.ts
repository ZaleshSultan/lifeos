export const studyTabIds = [
  "today",
  "courses",
  "assignments",
  "deadlines",
  "schedule",
  "grades",
  "calculator",
  "syllabi",
  "map",
] as const;
export type StudyTabId = (typeof studyTabIds)[number];

export function studyTabFromSearch(search: string, initData = ""): StudyTabId {
  const params = new URLSearchParams(search);
  const start = telegramStartParam(search, initData);
  const requested =
    params.get("studyTab") ??
    (start.startsWith("study_") ? start.slice("study_".length) : "today");
  return studyTabIds.includes(requested as StudyTabId)
    ? (requested as StudyTabId)
    : "today";
}

export function studyNavigationUrl(
  current: string,
  tab: StudyTabId,
  courseId: string | null,
): string {
  const url = new URL(current);
  url.searchParams.set("screen", "study");
  url.searchParams.set("studyTab", tab);
  if (courseId) url.searchParams.set("studyCourse", courseId);
  else url.searchParams.delete("studyCourse");
  return url.href;
}
import { telegramStartParam } from "../../lib/navigation";
