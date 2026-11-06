export type WebSection = "home" | "health" | "study" | "settings";
export const WEB_SECTIONS = [
  {
    id: "home",
    href: "/today",
    label: "Главная",
    description: "День, задачи и ближайшие действия",
  },
  {
    id: "health",
    href: "/health",
    label: "Здоровье",
    description: "Измерения, движение и питание",
  },
  {
    id: "study",
    href: "/study",
    label: "Учёба",
    description: "Курсы, оценки и учебные планы",
  },
  {
    id: "settings",
    href: "/settings",
    label: "Настройки",
    description: "Подключения, уведомления и приватность",
  },
] as const;
export const WEB_MODULES: Record<
  WebSection,
  Array<{ href: string; label: string }>
> = {
  home: [
    { href: "/today", label: "Сегодня" },
    { href: "/planner", label: "Задачи и план" },
    { href: "/calendar", label: "Календарь" },
    { href: "/capture", label: "Входящие" },
    { href: "/ai", label: "Помощник" },
    { href: "/ideal-human", label: "Дневник и съёмка" },
    { href: "/creator", label: "Creator" },
    { href: "/finance", label: "Финансы" },
  ],
  health: [
    { href: "/health", label: "Обзор" },
    { href: "/workouts", label: "Тренировки" },
    { href: "/nutrition", label: "Еда и вода" },
    { href: "/ideal-human", label: "Дневник здоровья" },
  ],
  study: [
    { href: "/study", label: "Учебный центр" },
    { href: "/settings#integrations", label: "Подключение LMS" },
  ],
  settings: [
    { href: "/settings", label: "Обзор" },
    { href: "/notifications", label: "Уведомления" },
  ],
};
export function webPathname(path: string) {
  return path.replace(/^\/web(?=\/|$)/, "").replace(/\/$/, "") || "/today";
}
export function webSection(
  path: string,
  requested?: string | null,
): WebSection {
  const pathname = webPathname(path);
  if (
    requested &&
    WEB_SECTIONS.some(({ id }) => id === requested) &&
    WEB_MODULES[requested as WebSection].some(
      ({ href }) => href.split("#")[0] === pathname,
    )
  )
    return requested as WebSection;
  if (
    ["/health", "/workouts", "/nutrition"].some(
      (route) => pathname === route || pathname.startsWith(route + "/"),
    )
  )
    return "health";
  if (pathname === "/study" || pathname.startsWith("/study/")) return "study";
  if (
    ["/settings", "/notifications"].some(
      (route) => pathname === route || pathname.startsWith(route + "/"),
    )
  )
    return "settings";
  return "home";
}
/** Move between modules without dropping course/day/resource context. Never copy credentials. */
export function webNavigationHref(
  href: string,
  search: string,
  section: WebSection,
): string {
  const url = new URL(href, "https://local.invalid");
  const source = new URLSearchParams(search);
  for (const key of [
    "courseId",
    "studyTab",
    "academicTab",
    "date",
    "day",
    "workoutId",
    "captureId",
    "assignmentId",
  ]) {
    const value = source.get(key);
    if (value !== null && !url.searchParams.has(key))
      url.searchParams.set(key, value);
  }
  url.searchParams.set("section", section);
  return `${url.pathname}${url.search}${url.hash}`;
}
export function webContextDate(value: unknown, fallback: string): string {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
    ? value
    : fallback;
}
