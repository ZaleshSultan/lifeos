import { request } from "./client";

export interface HealthSessionToken {
  token: string;
  tokenType: "Bearer";
  expiresInSeconds: number;
  expiresAt: string;
}

/** Match request()'s API base, resolving relative self-host paths for Android. */
export function healthBridgeApiBaseUrl(
  configuredBase = import.meta.env.VITE_API_BASE_URL ?? "",
  pageUrl = window.location.href,
): string {
  const base = configuredBase.replace(/\/$/, "");
  return new URL(base || "/", pageUrl).href.replace(/\/$/, "");
}

export async function issueHealthSessionToken(): Promise<HealthSessionToken> {
  const issued = await request<Omit<HealthSessionToken, "expiresAt">>(
    "/api/tma/health/ingest-token",
    { method: "POST" },
  );
  if (
    typeof issued.token !== "string" ||
    !issued.token ||
    issued.tokenType !== "Bearer" ||
    !Number.isFinite(issued.expiresInSeconds) ||
    issued.expiresInSeconds <= 0
  ) {
    throw new Error("Invalid health connection response");
  }
  return {
    ...issued,
    expiresAt: new Date(
      Date.now() + issued.expiresInSeconds * 1000,
    ).toISOString(),
  };
}

/** Clipboard permissions differ between Telegram WebViews; allow manual copy. */
export async function copyHealthConnectionValue(
  value: string,
  clipboard: Pick<Clipboard, "writeText"> | undefined = globalThis.navigator
    ?.clipboard,
): Promise<boolean> {
  if (!clipboard) return false;
  try {
    await clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}
