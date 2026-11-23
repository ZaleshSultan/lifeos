import type {
  DraftChange,
  PersonalTemplate,
} from "@lifeos/core/personal-workout";
import { request } from "./client";
import type { WorkoutSession } from "./workout";
import { useQuery } from "@tanstack/react-query";

const base = "/api/tma/workout/personal";
export const personalKey = ["workout", "personal-template"] as const;
export function usePersonalTemplateQuery(account?: number) {
  return useQuery({
    queryKey: [...personalKey, account],
    queryFn: personalApi.template,
    enabled: account !== undefined,
  });
}
export const personalApi = {
  template: () =>
    request<PersonalTemplate | null>(base + "/template", { method: "POST" }),
  save: (template: PersonalTemplate) =>
    request<PersonalTemplate>(base + "/template", {
      method: "PUT",
      body: JSON.stringify(template),
    }),
  start: (requestId: string) =>
    request<WorkoutSession>(base + "/start", {
      method: "POST",
      body: JSON.stringify({ requestId }),
    }),
  change: (
    workout: string,
    command: DraftChange & { revision: number; requestId: string },
  ) =>
    request<WorkoutSession>(base + "/" + encodeURIComponent(workout), {
      method: "PATCH",
      body: JSON.stringify(command),
    }),
};

export function readDraft<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}
export function writeDraft(key: string, value: unknown): boolean {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
