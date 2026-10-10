import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  encryptSecret,
  loadEncryptionKeyFromEnv,
  parseEncryptionKey,
  type LmsSessionStore,
} from "@lifeos/db";

const LMS_AUTH_STAGES = [
  "cookie_validation",
  "http_redirect",
  "microsoft_login_page",
  "javascript_continuation",
  "oidc_form_post",
  "moodle_callback",
  "authenticated_moodle_session",
] as const;
const LMS_AUTH_REASONS = [
  "started",
  "accepted",
  "rejected",
  "request",
  "followed",
  "target_rejected",
  "redirect_limit",
  "transition_limit",
  "deadline_exceeded",
  "network_error",
  "http_rejected",
  "response_too_large",
  "page_received",
  "interactive_required",
  "callback_missing",
  "callback_invalid",
  "callback_ambiguous",
  "callback_error",
  "session_expired",
  "identity_missing",
  "identity_verified",
  "continuation_missing",
  "continuation_invalid",
  "continuation_loop",
] as const;

type AuthEvent = {
  stage: (typeof LMS_AUTH_STAGES)[number];
  reason: (typeof LMS_AUTH_REASONS)[number];
};
export type LmsAuthDiagnostics = AuthEvent & { events: AuthEvent[] };

/** Reconstruct enum-only diagnostics; never forward arbitrary bridge fields. */
export function safeLmsAuthDiagnostics(value: unknown): LmsAuthDiagnostics | undefined {
  const event = (candidate: unknown): AuthEvent | undefined => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
      return;
    const data = candidate as Record<string, unknown>;
    if (
      typeof data.stage !== "string" ||
      typeof data.reason !== "string" ||
      !LMS_AUTH_STAGES.some((stage) => stage === data.stage) ||
      !LMS_AUTH_REASONS.some((reason) => reason === data.reason)
    )
      return;
    return { stage: data.stage as AuthEvent["stage"], reason: data.reason as AuthEvent["reason"] };
  };
  const current = event(value);
  if (!current) return;
  const events = (value as Record<string, unknown>).events;
  if (!Array.isArray(events) || !events.length || events.length > 32) return;
  const projected = events.map(event);
  if (projected.some((item) => !item)) return;
  return { ...current, events: projected as AuthEvent[] };
}

export class LmsSessionError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode = 422,
    public readonly diagnostics?: LmsAuthDiagnostics,
  ) {
    super(code);
  }
}
export function validLmsCookie(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 16384 &&
    /^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]+$/.test(value) &&
    !value.startsWith("ESTSAUTHPERSISTENT=")
  );
}
type ValidationResult = (
  | { ok: true }
  | {
      ok: false;
      errorCategory:
        | "session_expired"
        | "interactive_login_required"
        | "connection_failed"
        | "unsupported_auth_flow";
    }
) & { diagnostics?: LmsAuthDiagnostics };
export type LmsValidator = (cookie: string) => Promise<ValidationResult>;

export function parseLmsValidationResult(value: unknown): ValidationResult | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const result = value as Record<string, unknown>;
  const diagnostics = safeLmsAuthDiagnostics(result.diagnostics);
  const metadata = diagnostics ? { diagnostics } : {};
  if (result.ok === true) return { ok: true, ...metadata };
  if (result.ok === false) {
    const errorCategory = result.errorCategory;
    if (errorCategory === "session_expired" || errorCategory === "interactive_login_required" ||
        errorCategory === "connection_failed" || errorCategory === "unsupported_auth_flow")
      return { ok: false, errorCategory, ...metadata };
  }
}

/** Secrets travel on stdin, never argv, URLs, environment, stderr or diagnostics. */
export const validateMoodleSession: LmsValidator = async (cookie) =>
  new Promise((resolve) => {
    const helper = fileURLToPath(
      new URL(
        "../../../workers/university-sync/aitu-parser/lms_session_bridge.py",
        import.meta.url,
      ),
    );
    const child = spawn(process.env.LIFEOS_LMS_PYTHON || "python3", [helper], {
      shell: false,
      stdio: ["pipe", "pipe", "ignore"],
      env: {
        PATH: process.env.PATH,
        LANG: "C.UTF-8",
        PYTHONIOENCODING: "utf-8",
        PYTHONDONTWRITEBYTECODE: "1",
      },
    });
    let output = "";
    let settled = false;
    const finish = (result: ValidationResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ ok: false, errorCategory: "connection_failed" });
    }, 60000);
    child.on("error", () =>
      finish({ ok: false, errorCategory: "connection_failed" }),
    );
    child.stdin.on("error", () => {
      child.kill("SIGKILL");
      finish({ ok: false, errorCategory: "connection_failed" });
    });
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (Buffer.byteLength(output) > 4096) {
        child.kill("SIGKILL");
        finish({ ok: false, errorCategory: "connection_failed" });
      }
    });
    child.on("close", (code) => {
      try {
        const result = parseLmsValidationResult(JSON.parse(output));
        if (code === 0 && result) return finish(result);
      } catch {
        /* The bridge's raw output is intentionally never logged. */
      }
      finish({ ok: false, errorCategory: "connection_failed" });
    });
    child.stdin.end(JSON.stringify({ cookie }));
  });

interface Receipt {
  userId: string;
  encryptedCookie: string;
  expiresAt: number;
  sessionExpiresAt: string;
}
export class LmsSessionService {
  private readonly receipts = new Map<string, Receipt>();
  private readonly limits = new Map<
    string,
    { startsAt: number; count: number }
  >();
  private validating = 0;
  private readonly cleanup: ReturnType<typeof setInterval>;
  constructor(
    private readonly options: {
      validator?: LmsValidator;
      key?: Buffer;
      now?: () => number;
      retentionHours?: number;
    } = {},
  ) {
    this.cleanup = setInterval(() => this.sweep(), 30000);
    this.cleanup.unref();
  }
  close() {
    clearInterval(this.cleanup);
    this.receipts.clear();
    this.limits.clear();
  }
  private now() {
    return this.options.now?.() ?? Date.now();
  }
  private sweep() {
    const now = this.now();
    for (const [key, r] of this.receipts)
      if (r.expiresAt <= now) this.receipts.delete(key);
    for (const [key, r] of this.limits)
      if (r.startsAt + 60000 <= now) this.limits.delete(key);
  }
  checkRate(userId: string, action: string, limit: number) {
    this.sweep();
    const key = `${userId}:${action}`;
    let bucket = this.limits.get(key);
    if (!bucket) {
      if (this.limits.size >= 10000)
        throw new LmsSessionError("lms_rate_limited", 429);
      bucket = { startsAt: this.now(), count: 0 };
      this.limits.set(key, bucket);
    }
    if (++bucket.count > limit)
      throw new LmsSessionError("lms_rate_limited", 429);
  }
  private encryptionKey(): Buffer {
    try {
      return this.options.key
        ? parseEncryptionKey(this.options.key)
        : loadEncryptionKeyFromEnv();
    } catch {
      throw new LmsSessionError("encryption_unavailable", 503);
    }
  }
  async validate(userId: string, cookie: unknown) {
    if (!validLmsCookie(cookie))
      throw new LmsSessionError("lms_invalid_session", 400);
    const key = this.encryptionKey();
    this.sweep();
    if (this.validating >= 2 || this.receipts.size >= 100)
      throw new LmsSessionError("lms_rate_limited", 429);
    this.validating++;
    let result: ValidationResult;
    try {
      result = await (this.options.validator ?? validateMoodleSession)(cookie);
    } catch {
      throw new LmsSessionError("connection_failed", 503);
    } finally {
      this.validating--;
    }
    if (!result.ok)
      throw new LmsSessionError(
        result.errorCategory,
        result.errorCategory === "connection_failed" ? 503 : 422,
        safeLmsAuthDiagnostics(result.diagnostics),
      );
    const retentionHours =
      this.options.retentionHours ??
      Number(process.env.LIFEOS_LMS_SESSION_TTL_HOURS || 24);
    if (
      !Number.isFinite(retentionHours) ||
      retentionHours < 1 ||
      retentionHours > 168
    )
      throw new LmsSessionError("encryption_unavailable", 503);
    const expiresAt = this.now() + 300000;
    const token = randomBytes(32).toString("base64url");
    const encryptedCookie = encryptSecret(
      JSON.stringify({ version: 1, userId, platform: "aitu_moodle", cookie }),
      key,
    )!;
    // A user's previous unsaved credential is discarded immediately.
    this.discard(userId);
    this.receipts.set(token, {
      userId,
      encryptedCookie,
      expiresAt,
      sessionExpiresAt: new Date(
        this.now() + retentionHours * 3600000,
      ).toISOString(),
    });
    return {
      validationToken: token,
      expiresAt: new Date(expiresAt).toISOString(),
      ...(result.diagnostics ? { diagnostics: safeLmsAuthDiagnostics(result.diagnostics) } : {}),
    };
  }
  discard(userId: string) {
    for (const [token, r] of this.receipts)
      if (r.userId === userId) this.receipts.delete(token);
  }
  async save(userId: string, validationToken: unknown, store: LmsSessionStore) {
    this.encryptionKey();
    this.sweep();
    if (
      typeof validationToken !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(validationToken)
    )
      throw new LmsSessionError("lms_validation_required", 400);
    const receipt = this.receipts.get(validationToken);
    if (
      !receipt ||
      receipt.userId !== userId ||
      receipt.expiresAt <= this.now()
    )
      throw new LmsSessionError("lms_validation_required", 400);
    // Consume before awaiting storage: concurrent/replayed saves cannot race.
    this.receipts.delete(validationToken);
    return store.saveLmsSession({
      userId,
      encryptedCookie: receipt.encryptedCookie,
      expiresAt: receipt.sessionExpiresAt,
    });
  }
}
