import type { ScreenId } from "../types";

const screenIds: readonly ScreenId[] = [
  "home",
  "study",
  "workout",
  "health",
  "focus",
  "finance",
  "sources",
  "reminders",
  "mode",
];

/** Launch metadata selects UI only; API identity always comes from initData. */
export function telegramStartParam(search: string, initData = ""): string {
  return (
    new URLSearchParams(search).get("tgWebAppStartParam") ??
    new URLSearchParams(initData).get("start_param") ??
    ""
  );
}

export function screenFromSearch(search: string, initData = ""): ScreenId {
  const params = new URLSearchParams(search);
  const requested = params.get("screen");
  if (screenIds.includes(requested as ScreenId)) return requested as ScreenId;
  const start = telegramStartParam(search, initData);
  if (screenIds.includes(start as ScreenId)) return start as ScreenId;
  if (start.startsWith("study_")) return "study";
  return params.has("workoutId") ? "workout" : "home";
}
