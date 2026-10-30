import { createContext, useContext } from "react";

// This is a recovery buffer for unsaved edits in this browser tab. Saved plans
// still come from the API; no authentication material is stored here.
export const DraftOwnerContext = createContext<number | null>(null);

export function draftStorageKey(
  owner: number | null,
  kind: string,
  courseId = "all",
): string | null {
  return owner !== null && Number.isSafeInteger(owner) && owner > 0
    ? `lifeos:draft:v1:${owner}:${kind}:${encodeURIComponent(courseId)}`
    : null;
}

export function useDraftStorageKey(kind: string, courseId?: string) {
  return draftStorageKey(useContext(DraftOwnerContext), kind, courseId);
}

export function readSessionDraft<T>(
  key: string | null,
  validate: (value: unknown) => value is T,
): T | undefined {
  if (!key || typeof window === "undefined") return;
  try {
    const stored = window.sessionStorage.getItem(key);
    if (!stored || stored.length > 250_000) return;
    const value: unknown = JSON.parse(stored);
    return validate(value) ? value : undefined;
  } catch {
    // Storage may be blocked in a WebView or contain an older/corrupt draft.
    return;
  }
}

export function writeSessionDraft(key: string | null, value: unknown) {
  if (!key || typeof window === "undefined") return;
  try {
    if (value === undefined) window.sessionStorage.removeItem(key);
    else {
      const stored = JSON.stringify(value);
      if (stored.length <= 250_000) window.sessionStorage.setItem(key, stored);
    }
  } catch {
    // An unavailable recovery buffer must never block editing or API saves.
  }
}
