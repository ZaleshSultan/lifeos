import type { ScreenId } from "../types";

export type PrimarySection = "home" | "health" | "study" | "settings";
export interface TmaLocation {
  screen: ScreenId;
  section: PrimarySection;
}
export const PRIMARY_SECTIONS = [
  {
    id: "home",
    label: "Главная",
    description: "Твой день и ближайшие действия",
  },
  {
    id: "health",
    label: "Здоровье",
    description: "Самочувствие, движение и питание",
  },
  { id: "study", label: "Учёба", description: "Курсы, оценки и учебные планы" },
  {
    id: "settings",
    label: "Настройки",
    description: "Подключения, уведомления и приватность",
  },
] as const;
export const SECTION_SCREENS: Record<
  PrimarySection,
  Array<{ screen: ScreenId; label: string }>
> = {
  home: [
    { screen: "home", label: "Сегодня" },
    { screen: "capture", label: "Входящие" },
    { screen: "daily-life", label: "День и задачи" },
    { screen: "ai", label: "Помощник" },
    { screen: "focus", label: "Фокус" },
    { screen: "ideal-human", label: "Дневник и съёмка" },
    { screen: "finance", label: "Финансы" },
    { screen: "reminders", label: "Напоминания" },
  ],
  health: [
    { screen: "health", label: "Обзор" },
    { screen: "workout", label: "Тренировки" },
    { screen: "daily-life", label: "Еда и вода" },
    { screen: "ideal-human", label: "Дневник здоровья" },
  ],
  study: [
    { screen: "study", label: "Учебный центр" },
    { screen: "dashboard", label: "Цели и стипендия" },
    { screen: "lms", label: "Подключение LMS" },
  ],
  settings: [
    { screen: "settings", label: "Обзор" },
    { screen: "sources", label: "Интеграции" },
    { screen: "reminders", label: "Уведомления" },
    { screen: "mode", label: "Режим" },
    { screen: "lms", label: "LMS" },
  ],
};
const canonical: Record<ScreenId, PrimarySection> = {
  home: "home",
  capture: "home",
  ai: "home",
  "daily-life": "home",
  "ideal-human": "home",
  focus: "home",
  finance: "home",
  health: "health",
  workout: "health",
  study: "study",
  dashboard: "study",
  lms: "study",
  settings: "settings",
  sources: "settings",
  reminders: "settings",
  mode: "settings",
};
const aliases: Record<string, TmaLocation> = {
  today: { screen: "home", section: "home" },
  planner: { screen: "daily-life", section: "home" },
  calendar: { screen: "home", section: "home" },
  workouts: { screen: "workout", section: "health" },
  nutrition: { screen: "daily-life", section: "health" },
  water: { screen: "daily-life", section: "health" },
  notifications: { screen: "reminders", section: "settings" },
  integrations: { screen: "sources", section: "settings" },
};
export function sectionForScreen(screen: ScreenId): PrimarySection {
  return canonical[screen];
}
export function sectionContains(section: PrimarySection, screen: ScreenId) {
  return SECTION_SCREENS[section].some((item) => item.screen === screen);
}
export function resolveTmaLocation(params: URLSearchParams): TmaLocation {
  const requested =
    params.get("screen") ?? (params.has("workoutId") ? "workout" : "home");
  const base =
    (Object.hasOwn(aliases, requested) ? aliases[requested] : undefined) ??
    (Object.hasOwn(canonical, requested)
      ? {
          screen: requested as ScreenId,
          section: canonical[requested as ScreenId],
        }
      : { screen: "home" as const, section: "home" as const });
  const section = params.get("section") as PrimarySection | null;
  return section &&
    PRIMARY_SECTIONS.some((item) => item.id === section) &&
    sectionContains(section, base.screen)
    ? { screen: base.screen, section }
    : base;
}
/** Preserve resource, course, day and legacy parameters; navigation adds no owner or auth data. */
export function tmaNavigationUrl(current: string, next: TmaLocation): string {
  const url = new URL(current);
  url.searchParams.set("screen", next.screen);
  url.searchParams.set("section", next.section);
  return url.href;
}
