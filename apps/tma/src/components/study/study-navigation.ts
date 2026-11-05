export const STUDY_NAVIGATION_TABS = [
  { id: "schedule", label: "Расписание" },
  { id: "work", label: "Работы LMS" },
  { id: "concierge", label: "Экзамены" },
  { id: "calculator", label: "Калькулятор" },
  { id: "grades", label: "Оценки" },
  { id: "syllabi", label: "Силабус" },
  { id: "map", label: "Карта" },
] as const;
export type StudyTabId = (typeof STUDY_NAVIGATION_TABS)[number]["id"];
export function studyTabFromRequest(
  value: string | null,
): StudyTabId | undefined {
  const requested = value === "academic" ? "concierge" : value;
  return STUDY_NAVIGATION_TABS.some((tab) => tab.id === requested)
    ? (requested as StudyTabId)
    : undefined;
}
