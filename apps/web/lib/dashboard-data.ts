import { lifeosApi } from "./lifeos-api";
/** Module outages stay local to that panel; session validation remains fail closed. */
export async function dashboardData<T>(path: string): Promise<T | null> {
  try {
    return await lifeosApi<T>(path);
  } catch {
    return null;
  }
}
export function localDate() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Almaty",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
export function dateTime(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Нет данных";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Almaty",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
