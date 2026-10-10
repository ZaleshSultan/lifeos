import { useQuery } from "@tanstack/react-query";
import { ApiError, request } from "./client";

export type LmsConnectionState =
  | "not_configured"
  | "legacy_configuration"
  | "connected"
  | "session_expired"
  | "reauthentication_required"
  | "syncing"
  | "error";

export interface LmsConnection {
  configured: boolean;
  state: LmsConnectionState;
  lastSyncSuccessAt: string | null;
  lastSyncAttemptAt: string | null;
  lastErrorCategory: string | null;
  sessionExpiresAt: string | null;
  syncRequestedAt: string | null;
  unsupportedFeatures: string[];
}

export interface LmsValidationReceipt {
  validationToken: string;
  expiresAt: string;
}

export type LmsWorkCategory =
  | "upcoming"
  | "overdue"
  | "submitted_ungraded"
  | "graded"
  | "exams"
  | "unknown";

export interface LmsWorkItem {
  category: LmsWorkCategory;
  title: string;
  courseTitle: string | null;
  kind: "assignment" | "quiz" | "exam" | "midterm" | "unknown";
  submissionStatus: "not_submitted" | "submitted" | "graded" | "unknown";
  dueAt: string | null;
  startsAt: string | null;
  endsAt: string | null;
  score: number | null;
  maxScore: number | null;
  percentage: number | null;
  source: "moodle" | "manual" | "unknown";
}

export interface LmsWorkSummary {
  timezone: string;
  lastSyncSuccessAt: string | null;
  lastSyncAttemptAt: string | null;
  stale: boolean;
  truncated: boolean;
  warnings: string[];
  unsupportedFeatures: string[];
  items: LmsWorkItem[];
}

export const lmsConnectionQueryKey = ["lms", "connection"] as const;
export const lmsWorkQueryKey = ["lms", "work"] as const;
export const LMS_COOKIE_MAX_LENGTH = 16_384;

export interface ManualLmsWorkInput {
  title: string;
  courseTitle?: string;
  kind: "assignment" | "quiz" | "exam" | "midterm";
  dueAt?: string | null;
  submissionStatus: "not_submitted" | "submitted" | "unknown";
}

const lmsErrorMessages: Record<string, string> = {
  encryption_unavailable:
    "Сервер не может безопасно сохранить или прочитать сессию. Проверь настройку ключа шифрования.",
  decryption_failed: "Сохранённую сессию нельзя прочитать. Подключись заново.",
  session_expired:
    "Сессия истекла. Войди в AITU LMS в браузере и проверь новое значение cookie.",
  reauthentication_required:
    "Microsoft требует повторного входа. Войди в браузере и замени сессию.",
  interactive_login_required:
    "Microsoft требует интерактивного входа, MFA или подтверждения в браузере. Одной cookie недостаточно. Для подключения нужен официальный способ, согласованный с AITU: Moodle Web Services или зарегистрированное OIDC-приложение.",
  connection_failed:
    "Не удалось проверить подключение к AITU LMS. Попробуй позже.",
  unsupported_auth_flow:
    "Этот этап SSO пока не поддерживается. Проверь безопасную локальную диагностику; учебные данные можно добавить вручную.",
  partial_sync:
    "Синхронизация неполная. Ранее загруженные оценки и дедлайны сохранены.",
  unsupported_page:
    "Часть страниц LMS недоступна или не распознана. Используй ручной ввод для недостающих данных.",
  sync_failed:
    "Не удалось завершить синхронизацию. Ранее загруженные данные сохранены.",
  lms_sync_in_progress:
    "Сейчас идёт синхронизация. Дождись завершения и обнови состояние.",
  lms_validation_expired:
    "Проверка истекла. Вставь cookie и проверь сессию заново.",
  lms_validation_invalid:
    "Проверка больше недействительна. Проверь сессию заново.",
  lms_validation_required:
    "Проверка отсутствует или истекла. Вставь cookie и проверь сессию заново.",
  lms_session_required:
    "Для синхронизации нужна действующая сессия. Подключись заново.",
  lms_invalid_session:
    "Вставь только значение ESTSAUTHPERSISTENT, без имени cookie, кавычек и заголовка Cookie.",
  lms_invalid_manual_work:
    "Проверь название, статус и срок задания. Дату можно оставить неизвестной.",
};

export function lmsErrorCategoryMessage(category: string): string {
  return Object.prototype.hasOwnProperty.call(lmsErrorMessages, category)
    ? lmsErrorMessages[category]
    : "Не удалось обновить подключение. Проверь сессию и попробуй снова.";
}

const lmsAuthStageLabels = {
  cookie_validation: "проверка cookie",
  http_redirect: "HTTP-переход",
  microsoft_login_page: "страница входа Microsoft",
  javascript_continuation: "JavaScript-продолжение",
  oidc_form_post: "OIDC form_post",
  moodle_callback: "callback Moodle",
  authenticated_moodle_session: "проверка сессии Moodle",
} as const;
const lmsAuthReasons = new Set([
  "started", "accepted", "rejected", "request", "followed", "target_rejected",
  "redirect_limit", "transition_limit", "deadline_exceeded", "network_error",
  "http_rejected", "response_too_large", "page_received", "interactive_required",
  "callback_missing", "callback_invalid", "callback_ambiguous", "callback_error",
  "session_expired", "identity_missing", "identity_verified", "continuation_missing",
  "continuation_invalid", "continuation_loop",
]);

interface LmsAuthDiagnostic {
  stage: keyof typeof lmsAuthStageLabels;
  reason: string;
}

function safeCurrentAuthDiagnostic(value: unknown): LmsAuthDiagnostic | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const data = value as Record<string, unknown>;
  if (
    typeof data.stage === "string" &&
    Object.prototype.hasOwnProperty.call(lmsAuthStageLabels, data.stage) &&
    typeof data.reason === "string" &&
    lmsAuthReasons.has(data.reason)
  )
    return { stage: data.stage as LmsAuthDiagnostic["stage"], reason: data.reason };
}

export class LmsError extends Error {
  constructor(
    message: string,
    readonly status: number = 0,
    readonly diagnostics?: LmsAuthDiagnostic,
  ) {
    super(message);
    this.name = "LmsError";
  }
}

function sanitizedLmsError(error: unknown): LmsError {
  if (error instanceof ApiError) {
    let code: unknown;
    let diagnostics: LmsAuthDiagnostic | undefined;
    try {
      const body: unknown = JSON.parse(error.message);
      if (body && typeof body === "object" && "error" in body) {
        code = body.error;
        if ("diagnostics" in body)
          diagnostics = safeCurrentAuthDiagnostic(body.diagnostics);
      }
    } catch {
      // Never retain or display the original response to a credential request.
    }
    if (typeof code === "string" && Object.prototype.hasOwnProperty.call(lmsErrorMessages, code))
      return new LmsError(
        lmsErrorMessages[code] + (diagnostics
          ? ` Этап SSO: ${lmsAuthStageLabels[diagnostics.stage]} (${diagnostics.stage}); код: ${diagnostics.reason}.`
          : ""),
        error.status,
        diagnostics,
      );
    if (error.status === 401 || error.status === 403)
      return new LmsError(
        "Открой LifeOS заново из Telegram, чтобы подтвердить доступ.",
        error.status,
      );
    if (error.status === 409)
      return new LmsError(lmsErrorMessages.lms_sync_in_progress, error.status);
    if (error.status === 429)
      return new LmsError(
        "Слишком много запросов. Подожди немного и попробуй снова.",
        error.status,
      );
    if (error.status === 400 || error.status === 413)
      return new LmsError(
        "Проверь заполненные поля и размер запроса.",
        error.status,
      );
    if (error.status === 504)
      return new LmsError(
        "AITU LMS не ответил вовремя. Попробуй позже.",
        error.status,
      );
  }
  return new LmsError(
    "Запрос не выполнен. Проверь подключение и попробуй снова.",
  );
}

async function lmsRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  try {
    return await request<T>(path, { ...options, cache: "no-store" });
  } catch (error) {
    throw sanitizedLmsError(error);
  }
}

function connectionMetadata(value: LmsConnection): LmsConnection {
  return {
    configured: value.configured,
    state: value.state,
    lastSyncSuccessAt: value.lastSyncSuccessAt,
    lastSyncAttemptAt: value.lastSyncAttemptAt,
    lastErrorCategory: value.lastErrorCategory,
    sessionExpiresAt: value.sessionExpiresAt,
    syncRequestedAt: value.syncRequestedAt,
    unsupportedFeatures: value.unsupportedFeatures,
  };
}

export async function getLmsConnection(signal?: AbortSignal) {
  return connectionMetadata(
    await lmsRequest<LmsConnection>("/api/tma/lms/connection", { signal }),
  );
}

export function getLmsWork(signal?: AbortSignal) {
  return lmsRequest<LmsWorkSummary>("/api/tma/lms/work", { signal });
}

// Credential operations intentionally bypass TanStack mutations: their variables
// would retain the raw cookie or validation receipt in the shared mutation cache.
export async function validateLmsSession(cookie: string, signal?: AbortSignal) {
  const result = await lmsRequest<LmsValidationReceipt>(
    "/api/tma/lms/session/validate",
    {
      method: "POST",
      body: JSON.stringify({ cookie }),
      signal,
    },
  );
  return {
    validationToken: result.validationToken,
    expiresAt: result.expiresAt,
  };
}

export async function saveLmsSession(
  validationToken: string,
  signal?: AbortSignal,
) {
  return connectionMetadata(
    await lmsRequest<LmsConnection>("/api/tma/lms/session/save", {
      method: "POST",
      body: JSON.stringify({ validationToken }),
      signal,
    }),
  );
}

export function requestLmsSync(signal?: AbortSignal) {
  return lmsRequest<{ requested: true }>("/api/tma/lms/sync", {
    method: "POST",
    body: JSON.stringify({}),
    signal,
  });
}

export async function deleteLmsSession(signal?: AbortSignal) {
  return connectionMetadata(
    await lmsRequest<LmsConnection>("/api/tma/lms/session", {
      method: "DELETE",
      signal,
    }),
  );
}

export function createManualLmsWork(
  input: ManualLmsWorkInput,
  signal?: AbortSignal,
) {
  return lmsRequest<{ created: true }>("/api/tma/lms/work/manual", {
    method: "POST",
    body: JSON.stringify(input),
    signal,
  });
}

export function useLmsConnectionQuery() {
  return useQuery({
    queryKey: lmsConnectionQueryKey,
    queryFn: ({ signal }) => getLmsConnection(signal),
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });
}

export function useLmsWorkQuery() {
  return useQuery({
    queryKey: lmsWorkQueryKey,
    queryFn: ({ signal }) => getLmsWork(signal),
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });
}
