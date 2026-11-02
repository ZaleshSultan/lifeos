/** Public institutional endpoints, never a proxy for Microsoft credentials. */
export const AITU_BROWSER_SIGN_IN_URL =
  "https://lms.astanait.edu.kz/auth/oidc/?source=loginpage";
export const AITU_AUTH_VERIFIED_AT = "2026-11-02T19:22:19Z";
export const AITU_AUTH_BLOCKERS = [
  "institution_api_grant_required",
  "mobile_service_unavailable",
] as const;
export interface AituAuthorizationGuidance {
  version: 1;
  automaticConnection: "blocked";
  browserSignInUrl: typeof AITU_BROWSER_SIGN_IN_URL;
  browserSignInTransfersAccess: false;
  reconnectRequired: boolean;
  syncFreshness: "never_synced" | "recent" | "stale" | "unknown";
  verifiedAt: string;
  verification: "public_unauthenticated_probe";
  blockers: Array<(typeof AITU_AUTH_BLOCKERS)[number]>;
}

export function aituAuthorizationGuidance(
  connection: {
    configured: boolean;
    state: string;
    lastSyncSuccessAt: string | null;
    lastErrorCategory: string | null;
  },
  nowMs: number,
): AituAuthorizationGuidance {
  const success =
    connection.lastSyncSuccessAt === null
      ? null
      : Date.parse(connection.lastSyncSuccessAt);
  const stale =
    !connection.configured ||
    connection.lastErrorCategory !== null ||
    (success !== null && nowMs - success > 6 * 3600000);
  return {
    version: 1,
    automaticConnection: "blocked",
    browserSignInUrl: AITU_BROWSER_SIGN_IN_URL,
    browserSignInTransfersAccess: false,
    reconnectRequired:
      !connection.configured ||
      [
        "session_expired",
        "reauthentication_required",
        "not_configured",
      ].includes(connection.state),
    syncFreshness:
      success === null
        ? "never_synced"
        : !Number.isFinite(success) ||
            !Number.isFinite(nowMs) ||
            success > nowMs + 300000
          ? "unknown"
          : stale
            ? "stale"
            : "recent",
    verifiedAt: AITU_AUTH_VERIFIED_AT,
    verification: "public_unauthenticated_probe",
    blockers: [...AITU_AUTH_BLOCKERS],
  };
}

/** Defensive browser projection: no arbitrary URLs, secret fields or future claims. */
export function parseAituAuthorizationGuidance(
  value: unknown,
): AituAuthorizationGuidance | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const v = value as Record<string, unknown>;
  if (
    v.version !== 1 ||
    v.automaticConnection !== "blocked" ||
    v.browserSignInTransfersAccess !== false ||
    v.browserSignInUrl !== AITU_BROWSER_SIGN_IN_URL ||
    typeof v.reconnectRequired !== "boolean" ||
    !["never_synced", "recent", "stale", "unknown"].includes(
      String(v.syncFreshness),
    ) ||
    v.verification !== "public_unauthenticated_probe" ||
    v.verifiedAt !== AITU_AUTH_VERIFIED_AT ||
    !Array.isArray(v.blockers) ||
    v.blockers.length > AITU_AUTH_BLOCKERS.length ||
    v.blockers.some((b) => !AITU_AUTH_BLOCKERS.includes(b))
  )
    return;
  return {
    version: 1,
    automaticConnection: "blocked",
    browserSignInUrl: AITU_BROWSER_SIGN_IN_URL,
    browserSignInTransfersAccess: false,
    reconnectRequired: v.reconnectRequired,
    syncFreshness:
      v.syncFreshness as AituAuthorizationGuidance["syncFreshness"],
    verifiedAt: AITU_AUTH_VERIFIED_AT,
    verification: "public_unauthenticated_probe",
    blockers: [...new Set(v.blockers)] as AituAuthorizationGuidance["blockers"],
  };
}
