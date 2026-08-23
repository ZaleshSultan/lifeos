import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream, realpathSync, statSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, relative, resolve, sep } from "node:path";
import {
  parseHealthMetricsIngestPayload,
  parseHealthIngestPayload,
  parseLifeMode,
  type LifeMode,
  type CurrencyCode,
} from "@lifeos/core";
import type { LifeOSStore, TelegramUserRecord } from "@lifeos/db";
import type { BotConfig } from "./config.js";
import { handleTelegramUpdate } from "./telegram/commands.js";
import type { TelegramClient, TelegramUpdate } from "./telegram/types.js";
import { triggerFinanceAlerts } from "./telegram/alerts.js";
import {
  provisionSyncthingFolder,
  serverVaultPathForUser,
  syncthingConfigured,
  syncthingFolderIdForUser,
  type SyncthingConfig,
} from "./syncthing.js";
import { pipeline } from "node:stream/promises";

type TmaSessionState = "unregistered" | "pending" | "active" | "blocked";

interface TmaSessionStatus {
  state: TmaSessionState;
  telegramUserId: number;
  displayName?: string | null;
  username?: string | null;
  profile: {
    status: "pending" | "active" | "blocked";
    role: "user" | "admin";
  } | null;
  integrations: {
    telegram: {
      connected: boolean;
    };
    obsidian: {
      connected: boolean;
      enabled: boolean;
      configured: boolean;
      status: "disconnected" | "connected" | "error" | null;
      mode: "local_vault" | "agent" | "syncthing" | null;
      pendingSyncCount?: number;
      syncthing?: {
        serverDeviceId?: string;
        folderId?: string | null;
      };
    };
    google: {
      connected: boolean;
      status: "not_configured" | "connected" | "expired" | "revoked" | "error";
      accountEmail?: string | null;
      updatedAt?: string | null;
    };
    health: {
      connected: false;
      status: "not_configured";
    };
  };
}

export interface BotServerOptions {
  startedAt?: Date;
  version?: string;
  config?: Partial<
    Pick<
      BotConfig,
      | "telegramWebhookPath"
      | "telegramWebhookSecret"
      | "telegramBotToken"
      | "tmaUrl"
      | "tmaStaticDir"
      | "lifeosIngestSecret"
      | "lifeosHealthIngestJwtSecret"
      | "allowLegacyHealthIngestSecret"
      | "lifeosDefaultUserId"
      | "lifeosDefaultTelegramUserId"
      | "lifeosAdminTelegramIds"
      | "lifeosSignupMode"
      | "allowUnsafeTmaDevAuth"
      | "openRouterApiKey"
      | "financeAiModel"
      | "financeAiEnabled"
      | "googleOAuthClientId"
      | "googleOAuthClientSecret"
      | "googleOAuthRedirectUri"
      | "googleOAuthStateSecret"
      | "syncthingApiUrl"
      | "syncthingApiKey"
      | "syncthingServerDeviceId"
    >
  >;
  store?: LifeOSStore;
  telegram?: TelegramClient;
  dependencies?: {
    supabaseConfigured?: boolean;
    telegramConfigured?: boolean;
    healthIngestConfigured?: boolean;
  };
}

interface HealthResponse {
  status: "ok";
  service: "lifeos-bot";
  version: string;
  uptimeSeconds: number;
  dependencies: {
    supabaseConfigured: boolean;
    telegramConfigured: boolean;
    healthIngestConfigured: boolean;
  };
}

interface ResolvedBotServerOptions {
  startedAt: Date;
  version: string;
  dependencies: {
    supabaseConfigured: boolean;
    telegramConfigured: boolean;
    healthIngestConfigured: boolean;
  };
  webhookPath: string;
  webhookSecret?: string;
  telegramBotToken?: string;
  healthIngestJwtSecret?: string;
  syncthing: SyncthingConfig;
  tmaUrl?: string;
  tmaStaticDir?: string;
  defaultUserId?: string;
  defaultTelegramUserId?: number;
  adminTelegramUserIds: number[];
  signupMode: "pending_approval";
  allowUnsafeTmaDevAuth: boolean;
  openRouterApiKey?: string;
  financeAiModel?: string;
  financeAiEnabled: boolean;
  googleOAuthClientId?: string;
  googleOAuthClientSecret?: string;
  googleOAuthRedirectUri?: string;
  googleOAuthStateSecret?: string;
  store?: LifeOSStore;
  telegram?: TelegramClient;
}

type TelegramUpdateType =
  | "message"
  | "edited_message"
  | "callback_query"
  | "my_chat_member"
  | "web_app_data"
  | "unknown";

interface TelegramWebhookLogContext {
  updateId?: number;
  updateType: TelegramUpdateType;
  command?: string;
}

const TMA_MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};
const TMA_INIT_DATA_MAX_AGE_SECONDS = 86_400;
const TMA_INIT_DATA_MAX_FUTURE_SKEW_SECONDS = 300;
const GOOGLE_OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60;
const HEALTH_INGEST_TOKEN_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const GOOGLE_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/tasks.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
] as const;
const GOOGLE_OAUTH_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
const JSON_BODY_MAX_BYTES = 1024 * 1024;
const MEDIA_JSON_BODY_MAX_BYTES = 15 * 1024 * 1024;
const ALLOWED_RECEIPT_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

interface GoogleOAuthStatePayload {
  userId: string;
  telegramUserId: number | null;
  nonce: string;
  issuedAt: number;
}

interface HealthIngestTokenPayload {
  userId: string;
  telegramUserId: number | null;
  scope: "health_ingest";
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}

interface GoogleTokenExchangeResult {
  accessToken: string;
  refreshToken?: string;
  expiresAt: string | null;
  scopes: string[];
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers":
      "authorization,content-type,x-telegram-init-data,x-telegram-bot-api-secret-token",
  });
  response.end(JSON.stringify(body));
}

function writeNoContent(response: ServerResponse): void {
  response.writeHead(204, {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers":
      "authorization,content-type,x-telegram-init-data,x-telegram-bot-api-secret-token",
  });
  response.end();
}

function writeHtml(
  response: ServerResponse,
  statusCode: number,
  title: string,
  body: string,
): void {
  response.writeHead(statusCode, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1><p>${body}</p></body></html>`,
  );
}

function writeRedirect(response: ServerResponse, location: string): void {
  response.writeHead(302, {
    location,
    "cache-control": "no-store",
  });
  response.end();
}

function resolveStaticDirectory(
  directory: string | undefined,
): string | undefined {
  if (!directory) {
    return undefined;
  }

  try {
    const resolved = realpathSync(directory);
    return statSync(resolved).isDirectory() ? resolved : undefined;
  } catch {
    return undefined;
  }
}

function pathIsWithin(directory: string, filePath: string): boolean {
  const relativePath = relative(directory, filePath);
  return (
    relativePath === "" ||
    (!isAbsolute(relativePath) &&
      relativePath !== ".." &&
      !relativePath.startsWith(`..${sep}`))
  );
}

function hasTmaPathTraversal(requestUrl: string | undefined): boolean {
  const rawPath = (requestUrl ?? "/").split(/[?#]/, 1)[0] ?? "/";
  let decodedPath = rawPath;

  try {
    for (let count = 0; count < 3; count += 1) {
      const decoded = decodeURIComponent(decodedPath);

      if (decoded === decodedPath) {
        break;
      }

      decodedPath = decoded;
    }
  } catch {
    return rawPath.startsWith("/tma");
  }

  const isTmaPath =
    decodedPath === "/tma" ||
    decodedPath.startsWith("/tma/") ||
    decodedPath.startsWith("/tma\\");

  return (
    isTmaPath &&
    (decodedPath.includes("\0") || decodedPath.split(/[\\/]+/).includes(".."))
  );
}

async function resolveTmaStaticFile(
  staticDirectory: string,
  relativePath: string,
): Promise<string | undefined> {
  const candidate = resolve(staticDirectory, relativePath);

  if (!pathIsWithin(staticDirectory, candidate)) {
    return undefined;
  }

  try {
    const realPath = await realpath(candidate);

    if (!pathIsWithin(staticDirectory, realPath)) {
      return undefined;
    }

    return (await stat(realPath)).isFile() ? realPath : undefined;
  } catch {
    return undefined;
  }
}

async function writeStaticFile(
  request: IncomingMessage,
  response: ServerResponse,
  filePath: string,
  immutable: boolean,
): Promise<void> {
  const fileStats = await stat(filePath);
  const extension = extname(filePath).toLowerCase();
  const headers: Record<string, string | number> = {
    "content-type": TMA_MIME_TYPES[extension] ?? "application/octet-stream",
    "content-length": fileStats.size,
  };

  if (extension === ".html") {
    headers["cache-control"] = "no-cache";
  } else if (immutable) {
    headers["cache-control"] = "public, max-age=31536000, immutable";
  }

  response.writeHead(200, headers);

  if (request.method === "HEAD") {
    response.end();
    return;
  }

  await pipeline(createReadStream(filePath), response);
}

async function handleTmaStaticRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  options: ResolvedBotServerOptions,
): Promise<boolean> {
  if (
    !options.tmaStaticDir ||
    (request.method !== "GET" && request.method !== "HEAD")
  ) {
    return false;
  }

  if (requestUrl.pathname === "/tma") {
    response.writeHead(308, {
      location: `/tma/${requestUrl.search}`,
      "cache-control": "no-cache",
    });
    response.end();
    return true;
  }

  if (!requestUrl.pathname.startsWith("/tma/")) {
    return false;
  }

  let relativePath: string;

  try {
    relativePath = decodeURIComponent(
      requestUrl.pathname.slice("/tma/".length),
    );
  } catch {
    writeJson(response, 400, {
      error: "invalid_tma_path",
    });
    return true;
  }

  const requestedPath = relativePath || "index.html";

  if (
    !pathIsWithin(
      options.tmaStaticDir,
      resolve(options.tmaStaticDir, requestedPath),
    )
  ) {
    writeJson(response, 400, {
      error: "invalid_tma_path",
    });
    return true;
  }

  const requestedFile = await resolveTmaStaticFile(
    options.tmaStaticDir,
    requestedPath,
  );
  const filePath =
    requestedFile ??
    (await resolveTmaStaticFile(options.tmaStaticDir, "index.html"));

  if (!filePath) {
    return false;
  }

  await writeStaticFile(
    request,
    response,
    filePath,
    Boolean(requestedFile) && requestUrl.pathname.startsWith("/tma/assets/"),
  );
  return true;
}

function healthResponse(options: ResolvedBotServerOptions): HealthResponse {
  return {
    status: "ok",
    service: "lifeos-bot",
    version: options.version,
    uptimeSeconds: Math.max(
      0,
      Math.floor((Date.now() - options.startedAt.getTime()) / 1000),
    ),
    dependencies: {
      supabaseConfigured: options.dependencies.supabaseConfigured,
      telegramConfigured: options.dependencies.telegramConfigured,
      healthIngestConfigured: options.dependencies.healthIngestConfigured,
    },
  };
}

function secureCompare(value: string, expected: string): boolean {
  const valueBuffer = Buffer.from(value, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  const valueDigest = createHash("sha256")
    .update(String(valueBuffer.length))
    .update(":")
    .update(valueBuffer)
    .digest();
  const expectedDigest = createHash("sha256")
    .update(String(expectedBuffer.length))
    .update(":")
    .update(expectedBuffer)
    .digest();
  const digestMatches = timingSafeEqual(valueDigest, expectedDigest);
  const lengthMatches = valueBuffer.length === expectedBuffer.length;

  return digestMatches && lengthMatches;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function tmaData<T>(data: T): { data: T } {
  return { data };
}

function validateTelegramInitData(
  initData: string,
  botToken: string,
): {
  telegramUserId: number;
  displayName: string | null;
  username: string | null;
} | null {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  const authDateValue = params.get("auth_date");

  if (!hash || !authDateValue) {
    return null;
  }

  const authDate = Number(authDateValue);
  const now = Math.floor(Date.now() / 1000);

  if (
    !Number.isSafeInteger(authDate) ||
    now - authDate > TMA_INIT_DATA_MAX_AGE_SECONDS ||
    authDate - now > TMA_INIT_DATA_MAX_FUTURE_SKEW_SECONDS
  ) {
    return null;
  }

  const dataCheckString = [...params.entries()]
    .filter(([key]) => key !== "hash")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expectedHash = createHmac("sha256", secret)
    .update(dataCheckString)
    .digest("hex");

  if (!secureCompare(hash, expectedHash)) {
    return null;
  }

  const rawUser = params.get("user");

  if (!rawUser) {
    return null;
  }

  try {
    const user = JSON.parse(rawUser) as {
      id?: unknown;
      first_name?: unknown;
      username?: unknown;
    };

    if (typeof user.id !== "number") {
      return null;
    }

    return {
      telegramUserId: user.id,
      displayName:
        typeof user.first_name === "string"
          ? user.first_name
          : typeof user.username === "string"
            ? user.username
            : null,
      username: typeof user.username === "string" ? user.username : null,
    };
  } catch {
    return null;
  }
}

function googleOAuthConfigured(options: ResolvedBotServerOptions): boolean {
  return Boolean(
    options.googleOAuthClientId &&
      options.googleOAuthClientSecret &&
      options.googleOAuthRedirectUri &&
      options.googleOAuthStateSecret,
  );
}

function createGoogleOAuthState(
  user: TelegramUserRecord,
  secret: string,
): { state: string; payload: GoogleOAuthStatePayload } {
  const payload: GoogleOAuthStatePayload = {
    userId: user.userId,
    telegramUserId: user.telegramUserId,
    nonce: randomBytes(16).toString("hex"),
    issuedAt: Math.floor(Date.now() / 1000),
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const signature = createHmac("sha256", secret)
    .update(encoded)
    .digest("base64url");
  return { state: `${encoded}.${signature}`, payload };
}

function signGoogleOAuthState(
  user: TelegramUserRecord,
  secret: string,
): string {
  return createGoogleOAuthState(user, secret).state;
}

function verifyGoogleOAuthState(
  state: string | null,
  secret: string | undefined,
): GoogleOAuthStatePayload | null {
  if (!state || !secret) {
    return null;
  }

  const parts = state.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return null;
  }

  const expectedSignature = createHmac("sha256", secret)
    .update(parts[0])
    .digest("base64url");

  if (!secureCompare(parts[1], expectedSignature)) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(parts[0], "base64url").toString("utf8"),
    ) as Partial<GoogleOAuthStatePayload>;
    const now = Math.floor(Date.now() / 1000);

    if (
      typeof payload.userId !== "string" ||
      !payload.userId ||
      (typeof payload.telegramUserId !== "number" &&
        payload.telegramUserId !== null) ||
      typeof payload.nonce !== "string" ||
      !payload.nonce ||
      typeof payload.issuedAt !== "number" ||
      now - payload.issuedAt > GOOGLE_OAUTH_STATE_MAX_AGE_SECONDS ||
      payload.issuedAt - now > TMA_INIT_DATA_MAX_FUTURE_SKEW_SECONDS
    ) {
      return null;
    }

    return {
      userId: payload.userId,
      telegramUserId: payload.telegramUserId,
      nonce: payload.nonce,
      issuedAt: payload.issuedAt,
    };
  } catch {
    return null;
  }
}

function signHealthIngestToken(
  user: TelegramUserRecord,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  const payload: HealthIngestTokenPayload = {
    userId: user.userId,
    telegramUserId: user.telegramUserId,
    scope: "health_ingest",
    nonce: randomBytes(16).toString("hex"),
    issuedAt: nowSeconds,
    expiresAt: nowSeconds + HEALTH_INGEST_TOKEN_MAX_AGE_SECONDS,
  };
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
    "utf8",
  ).toString("base64url");
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const signingInput = `${header}.${encoded}`;
  const signature = createHmac("sha256", secret)
    .update(signingInput)
    .digest("base64url");

  return `${signingInput}.${signature}`;
}

function verifyHealthIngestToken(
  token: string | undefined,
  secret: string | undefined,
): HealthIngestTokenPayload | null {
  if (!token || !secret) {
    return null;
  }

  const parts = token.split(".");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    return null;
  }

  const signingInput = `${parts[0]}.${parts[1]}`;
  const expectedSignature = createHmac("sha256", secret)
    .update(signingInput)
    .digest("base64url");

  if (!secureCompare(parts[2], expectedSignature)) {
    return null;
  }

  try {
    const header = JSON.parse(
      Buffer.from(parts[0], "base64url").toString("utf8"),
    ) as { alg?: unknown; typ?: unknown };
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    ) as Partial<HealthIngestTokenPayload>;
    if (header.alg !== "HS256" || header.typ !== "JWT") {
      return null;
    }
    const now = Math.floor(Date.now() / 1000);

    if (
      typeof payload.userId !== "string" ||
      !payload.userId ||
      (typeof payload.telegramUserId !== "number" &&
        payload.telegramUserId !== null) ||
      payload.scope !== "health_ingest" ||
      typeof payload.nonce !== "string" ||
      !payload.nonce ||
      typeof payload.issuedAt !== "number" ||
      typeof payload.expiresAt !== "number" ||
      payload.expiresAt < now ||
      payload.issuedAt - now > TMA_INIT_DATA_MAX_FUTURE_SKEW_SECONDS ||
      payload.expiresAt - payload.issuedAt > HEALTH_INGEST_TOKEN_MAX_AGE_SECONDS
    ) {
      return null;
    }

    return {
      userId: payload.userId,
      telegramUserId: payload.telegramUserId,
      scope: "health_ingest",
      nonce: payload.nonce,
      issuedAt: payload.issuedAt,
      expiresAt: payload.expiresAt,
    };
  } catch {
    return null;
  }
}

function bearerToken(request: IncomingMessage): string | undefined {
  const value = headerValue(request.headers.authorization);
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || undefined;
}

function payloadUserId(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return undefined;
  }

  const record = input as Record<string, unknown>;
  const value = record.user_id ?? record.userId;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function scopeBodyToAuthenticatedUser(input: unknown, userId: string): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return input;
  }

  // IDOR hardening: health ingest authorization is bound only to the
  // authenticated TMA/JWT identity. Any user_id/userId sent by Android or a
  // malicious client is ignored and overwritten here before parsing.
  return {
    ...(input as Record<string, unknown>),
    user_id: userId,
    userId,
  };
}

function buildGoogleOAuthUrl(
  user: TelegramUserRecord,
  options: ResolvedBotServerOptions,
  state?: string,
): string | null {
  if (
    !options.googleOAuthClientId ||
    !options.googleOAuthRedirectUri ||
    !options.googleOAuthStateSecret
  ) {
    return null;
  }

  const url = new URL(GOOGLE_OAUTH_AUTH_URL);
  url.searchParams.set("client_id", options.googleOAuthClientId);
  url.searchParams.set("redirect_uri", options.googleOAuthRedirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_OAUTH_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set(
    "state",
    state ?? signGoogleOAuthState(user, options.googleOAuthStateSecret),
  );
  return url.toString();
}

function parseGoogleScopes(value: unknown): string[] {
  const scopeText =
    typeof value === "string" ? value : GOOGLE_OAUTH_SCOPES.join(" ");
  return scopeText.split(/[,\s]+/).filter(Boolean);
}

async function exchangeGoogleOAuthCode(
  code: string,
  options: ResolvedBotServerOptions,
): Promise<GoogleTokenExchangeResult> {
  if (
    !options.googleOAuthClientId ||
    !options.googleOAuthClientSecret ||
    !options.googleOAuthRedirectUri
  ) {
    throw new Error("Google OAuth is not configured");
  }

  const tokenResponse = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code,
      client_id: options.googleOAuthClientId,
      client_secret: options.googleOAuthClientSecret,
      redirect_uri: options.googleOAuthRedirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenResponse.ok) {
    throw new Error("Google OAuth token exchange failed");
  }

  const body = (await tokenResponse.json()) as Record<string, unknown>;
  const accessToken = body.access_token;

  if (typeof accessToken !== "string" || !accessToken) {
    throw new Error("Google OAuth token exchange returned no access token");
  }

  const rawExpiresIn = body.expires_in;
  const expiresIn =
    typeof rawExpiresIn === "number"
      ? rawExpiresIn
      : typeof rawExpiresIn === "string"
        ? Number(rawExpiresIn)
        : null;

  return {
    accessToken,
    refreshToken:
      typeof body.refresh_token === "string" && body.refresh_token
        ? body.refresh_token
        : undefined,
    expiresAt:
      expiresIn && Number.isFinite(expiresIn) && expiresIn > 0
        ? new Date(Date.now() + expiresIn * 1000).toISOString()
        : null,
    scopes: parseGoogleScopes(body.scope),
  };
}

async function fetchGoogleAccountEmail(
  accessToken: string,
): Promise<string | null> {
  try {
    const response = await fetch(GOOGLE_USERINFO_URL, {
      headers: {
        authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      return null;
    }

    const body = (await response.json()) as Record<string, unknown>;
    return typeof body.email === "string" && body.email ? body.email : null;
  } catch {
    return null;
  }
}

function googleOAuthTmaRedirect(
  options: ResolvedBotServerOptions,
  status: "connected" | "error",
): string {
  const base = options.tmaUrl ?? "/tma/";
  const isRelative = base.startsWith("/");
  const url = new URL(base, "http://lifeos.local");
  url.searchParams.set("google", status);
  return isRelative ? `${url.pathname}${url.search}` : url.toString();
}

function unsafeTmaDevAuthAllowed(
  options: ResolvedBotServerOptions,
): options is ResolvedBotServerOptions & { defaultUserId: string } {
  return Boolean(
    options.allowUnsafeTmaDevAuth &&
      options.defaultUserId !== undefined &&
      process.env.NODE_ENV !== "production",
  );
}

async function resolveTmaSessionIdentity(
  request: IncomingMessage,
  options: ResolvedBotServerOptions,
): Promise<
  | {
      ok: true;
      telegramUserId: number;
      displayName: string | null;
      username: string | null;
      devUser?: TelegramUserRecord;
    }
  | { ok: false; statusCode: number; error: string }
> {
  const initData = headerValue(request.headers["x-telegram-init-data"]);

  if (initData && options.telegramBotToken) {
    const validated = validateTelegramInitData(
      initData,
      options.telegramBotToken,
    );

    if (validated) {
      return { ok: true, ...validated };
    }
  }

  if (unsafeTmaDevAuthAllowed(options)) {
    const devUser: TelegramUserRecord = {
      userId: options.defaultUserId,
      telegramUserId: options.defaultTelegramUserId ?? null,
      displayName: "Dev user",
      username: null,
      timezone: "Asia/Qyzylorda",
      status: "active",
      role: "admin",
    };

    return {
      ok: true,
      telegramUserId: options.defaultTelegramUserId ?? 0,
      displayName: devUser.displayName,
      username: null,
      devUser,
    };
  }

  if (initData && !options.telegramBotToken) {
    return {
      ok: false,
      statusCode: 503,
      error: "tma_auth_not_configured",
    };
  }

  return {
    ok: false,
    statusCode: 401,
    error: "invalid_telegram_init_data",
  };
}

function emptyIntegrations(): TmaSessionStatus["integrations"] {
  return {
    telegram: {
      connected: false,
    },
    obsidian: {
      connected: false,
      enabled: false,
      configured: false,
      status: null,
      mode: null,
    },
    google: {
      connected: false,
      status: "not_configured",
    },
    health: {
      connected: false,
      status: "not_configured",
    },
  };
}

async function buildTmaSessionStatus(
  input: {
    telegramUserId: number;
    displayName: string | null;
    username: string | null;
    user: TelegramUserRecord | null;
  },
  store: LifeOSStore,
): Promise<TmaSessionStatus> {
  if (!input.user) {
    return {
      state: "unregistered",
      telegramUserId: input.telegramUserId,
      displayName: input.displayName,
      username: input.username,
      profile: null,
      integrations: emptyIntegrations(),
    };
  }

  const state: TmaSessionState =
    input.user.status === "active"
      ? "active"
      : input.user.status === "blocked"
        ? "blocked"
        : "pending";
  const integrations = emptyIntegrations();
  integrations.telegram.connected = true;

  if (state === "active") {
    const [obsidianSettings, obsidianSyncStatus, googleConnection] =
      await Promise.all([
        store.getUserObsidianSettings(input.user.userId),
        store.getObsidianSyncStatus(input.user.userId),
        store.getSafeUserOAuthConnection(input.user.userId, "google"),
      ]);
    const configured = Boolean(obsidianSettings?.vaultPath?.trim());
    const enabled = Boolean(obsidianSettings?.enabled);
    const status = obsidianSettings?.status ?? null;
    const mode = obsidianSettings?.mode ?? null;

    integrations.obsidian = {
      connected:
        configured &&
        enabled &&
        status === "connected" &&
        (mode === "local_vault" || mode === "syncthing"),
      enabled,
      configured,
      status,
      mode,
      pendingSyncCount: obsidianSyncStatus.counts.pending ?? 0,
      syncthing: obsidianSettings?.syncthingFolderId
        ? { folderId: obsidianSettings.syncthingFolderId }
        : undefined,
    };

    if (googleConnection) {
      integrations.google = {
        connected: googleConnection.status === "connected",
        status: googleConnection.status,
        accountEmail: googleConnection.providerAccountEmail,
        updatedAt: googleConnection.updatedAt,
      };
    }
  }

  return {
    state,
    telegramUserId: input.user.telegramUserId ?? input.telegramUserId,
    displayName: input.user.displayName ?? input.displayName,
    username: input.user.username ?? input.username,
    profile: {
      status: input.user.status,
      role: input.user.role,
    },
    integrations,
  };
}

async function resolveTmaSessionStatus(
  request: IncomingMessage,
  options: ResolvedBotServerOptions,
): Promise<
  | { ok: true; session: TmaSessionStatus }
  | { ok: false; statusCode: number; error: string }
> {
  if (!options.store) {
    return {
      ok: false,
      statusCode: 503,
      error: "database_not_configured",
    };
  }

  const identity = await resolveTmaSessionIdentity(request, options);

  if (!identity.ok) {
    return identity;
  }

  if (identity.devUser) {
    return {
      ok: true,
      session: await buildTmaSessionStatus(
        {
          telegramUserId: identity.telegramUserId,
          displayName: identity.displayName,
          username: identity.username,
          user: identity.devUser,
        },
        options.store,
      ),
    };
  }

  const user = await options.store.resolveTelegramUser(identity.telegramUserId);

  return {
    ok: true,
    session: await buildTmaSessionStatus(
      {
        telegramUserId: identity.telegramUserId,
        displayName: identity.displayName,
        username: identity.username,
        user,
      },
      options.store,
    ),
  };
}

async function resolveTmaUser(
  request: IncomingMessage,
  options: ResolvedBotServerOptions,
): Promise<
  | { ok: true; user: TelegramUserRecord }
  | { ok: false; statusCode: number; error: string }
> {
  if (!options.store) {
    return {
      ok: false,
      statusCode: 503,
      error: "database_not_configured",
    };
  }

  const initData = headerValue(request.headers["x-telegram-init-data"]);

  if (initData && options.telegramBotToken) {
    const validated = validateTelegramInitData(
      initData,
      options.telegramBotToken,
    );

    if (validated) {
      const user = await options.store.resolveTelegramUser(
        validated.telegramUserId,
      );

      if (user) {
        if (user.status !== "active") {
          return {
            ok: false,
            statusCode: 403,
            error:
              user.status === "pending"
                ? "telegram_user_pending"
                : "telegram_user_blocked",
          };
        }

        return { ok: true, user };
      }

      return {
        ok: false,
        statusCode: 403,
        error: "telegram_user_not_linked",
      };
    }
  }

  if (unsafeTmaDevAuthAllowed(options)) {
    return {
      ok: true,
      user: {
        userId: options.defaultUserId,
        telegramUserId: options.defaultTelegramUserId ?? null,
        displayName: "Dev user",
        username: null,
        timezone: "Asia/Qyzylorda",
        status: "active",
        role: "admin",
      },
    };
  }

  if (initData && !options.telegramBotToken) {
    return {
      ok: false,
      statusCode: 503,
      error: "tma_auth_not_configured",
    };
  }

  return {
    ok: false,
    statusCode: 401,
    error: "invalid_telegram_init_data",
  };
}

class RequestBodyError extends Error {
  constructor(
    readonly statusCode: number,
    readonly errorCode: string,
    message: string,
  ) {
    super(message);
    this.name = "RequestBodyError";
  }
}

function parseIsoDateOnly(value: string): string | null {
  const trimmed = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return trimmed;
}

function isoDateIsBefore(left: string, right: string): boolean {
  return left < right;
}

async function readJsonBody(
  request: IncomingMessage,
  maxBytes = JSON_BODY_MAX_BYTES,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;

    if (totalBytes > maxBytes) {
      throw new RequestBodyError(413, "request_body_too_large", "Request body is too large");
    }

    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString("utf8");

  if (!raw.trim()) {
    return {};
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new RequestBodyError(400, "invalid_json", "Request body must be valid JSON");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordField(
  value: unknown,
  key: string,
): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const field = value[key];
  return isRecord(field) ? field : undefined;
}

function telegramMessageRecord(
  update: unknown,
): Record<string, unknown> | undefined {
  return recordField(update, "message");
}

function detectTelegramUpdateType(update: unknown): TelegramUpdateType {
  if (!isRecord(update)) {
    return "unknown";
  }

  const message = recordField(update, "message");

  if (message?.web_app_data !== undefined) {
    return "web_app_data";
  }

  if (message) {
    return "message";
  }

  if (recordField(update, "edited_message")) {
    return "edited_message";
  }

  if (recordField(update, "callback_query")) {
    return "callback_query";
  }

  if (recordField(update, "my_chat_member")) {
    return "my_chat_member";
  }

  return "unknown";
}

function telegramUpdateId(update: unknown): number | undefined {
  if (!isRecord(update)) {
    return undefined;
  }

  return typeof update.update_id === "number" ? update.update_id : undefined;
}

function telegramMessageText(update: unknown): string | undefined {
  const message = telegramMessageRecord(update);
  return typeof message?.text === "string" && message.text.trim()
    ? message.text
    : undefined;
}

function telegramMessageChatId(update: unknown): number | undefined {
  const chat = recordField(telegramMessageRecord(update), "chat");
  return typeof chat?.id === "number" ? chat.id : undefined;
}

function telegramCommand(update: unknown): string | undefined {
  const text = telegramMessageText(update);

  if (!text) {
    return undefined;
  }

  const head = text.trim().split(/\s+/)[0];

  if (!head?.startsWith("/")) {
    return undefined;
  }

  const command = head.slice(1).split("@")[0]?.toLowerCase();
  return command ? `/${command}` : undefined;
}

function sensitiveLogValues(options: ResolvedBotServerOptions): string[] {
  return [
    options.telegramBotToken,
    options.webhookSecret,
    options.googleOAuthClientSecret,
    options.googleOAuthStateSecret,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.SUPABASE_SERVICE_KEY,
  ].filter((value): value is string => Boolean(value));
}

function publicErrorMessage(code: string): string {
  switch (code) {
    case "lms_connection_failed":
      return "Could not connect to LMS. Check credentials and try again.";
    case "request_body_too_large":
      return "Request body is too large.";
    default:
      return "Request failed.";
  }
}

function sanitizeErrorMessage(
  error: unknown,
  options: ResolvedBotServerOptions,
): string {
  let message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Unknown error";

  for (const value of sensitiveLogValues(options)) {
    if (value.length >= 4) {
      message = message.replaceAll(value, "[redacted]");
    }
  }

  return message.split(/\r?\n/)[0]?.slice(0, 240) || "Unknown error";
}

function logTelegramWebhookError(
  error: unknown,
  options: ResolvedBotServerOptions,
  context: TelegramWebhookLogContext,
): void {
  console.error("telegram_webhook_error", {
    update_id: context.updateId ?? null,
    update_type: context.updateType,
    command: context.command ?? null,
    error: sanitizeErrorMessage(error, options),
  });
}

function telegramOk(response: ServerResponse): void {
  writeJson(response, 200, {
    ok: true,
  });
}

async function sendTelegramCommandError(
  update: unknown,
  options: ResolvedBotServerOptions,
  text: string,
): Promise<void> {
  const chatId = telegramMessageChatId(update);

  if (!chatId || !options.telegram) {
    return;
  }

  await options.telegram.sendMessage({
    chatId,
    text,
  });
}

async function handleTelegramWebhook(
  request: IncomingMessage,
  response: ServerResponse,
  options: ResolvedBotServerOptions,
): Promise<void> {
  const telegram = options.telegram;

  if (!telegram) {
    writeJson(response, 503, {
      error: "telegram_not_configured",
    });
    return;
  }

  let update: unknown;
  const context: TelegramWebhookLogContext = {
    updateType: "unknown",
  };

  try {
    update = await readJsonBody(request);
    context.updateId = telegramUpdateId(update);
    context.updateType = detectTelegramUpdateType(update);
    context.command = telegramCommand(update);

    if (!telegramMessageText(update)) {
      telegramOk(response);
      return;
    }

    if (context.updateType !== "message") {
      telegramOk(response);
      return;
    }

    if (!telegramMessageChatId(update)) {
      telegramOk(response);
      return;
    }

    await handleTelegramUpdate(update as TelegramUpdate, {
      telegram,
      store: options.store,
      tmaUrl: options.tmaUrl,
      defaultUserId: options.defaultUserId,
      defaultTelegramUserId: options.defaultTelegramUserId,
      adminTelegramUserIds: options.adminTelegramUserIds,
      signupMode: options.signupMode,
      financeAi: {
        enabled: options.financeAiEnabled,
        openRouterApiKey: options.openRouterApiKey,
        model: options.financeAiModel,
      },
    });

    telegramOk(response);
  } catch (error) {
    logTelegramWebhookError(error, options, context);

    try {
      await sendTelegramCommandError(
        update,
        options,
        context.command === "/log"
          ? "❌ Не смог добавить в Inbox."
          : "❌ Ошибка обработки команды.",
      );
    } catch (sendError) {
      logTelegramWebhookError(sendError, options, context);
    }

    telegramOk(response);
  }
}

function tmaModeActiveUntil(
  body: Record<string, unknown>,
  now = new Date(),
): string | null {
  if (typeof body.activeUntil === "string") {
    return body.activeUntil;
  }

  const duration = body.duration;

  if (duration === "permanent" || duration === undefined) {
    return null;
  }

  if (duration === "today") {
    const tomorrow = new Date(now);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 0, 0, 0);
    return tomorrow.toISOString();
  }

  if (duration === "7_days") {
    return new Date(now.getTime() + 7 * 86_400_000).toISOString();
  }

  if (duration === "until_date" && typeof body.untilDate === "string") {
    return `${body.untilDate}T00:00:00.000Z`;
  }

  throw new Error("invalid_mode_duration");
}

function parseTmaModeBody(
  body: unknown,
):
  | { ok: true; mode: LifeMode | "auto"; activeUntil: string | null }
  | { ok: false; error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "invalid_mode_payload" };
  }

  const record = body as Record<string, unknown>;
  const rawMode = typeof record.mode === "string" ? record.mode : "";

  if (rawMode === "auto") {
    return { ok: true, mode: "auto", activeUntil: null };
  }

  const mode = parseLifeMode(rawMode);

  if (!mode) {
    return { ok: false, error: "invalid_mode" };
  }

  try {
    return {
      ok: true,
      mode,
      activeUntil: tmaModeActiveUntil(record),
    };
  } catch {
    return { ok: false, error: "invalid_mode_duration" };
  }
}

function parseTmaCourseProgressBody(
  body: unknown,
): { ok: true; progressPercent: number } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "invalid_course_progress_payload" };
  }

  const record = body as Record<string, unknown>;
  const rawProgress = record.progressPercent;
  const progressPercent =
    typeof rawProgress === "number"
      ? rawProgress
      : typeof rawProgress === "string"
        ? Number(rawProgress)
        : Number.NaN;

  if (
    !Number.isFinite(progressPercent) ||
    progressPercent < 0 ||
    progressPercent > 100
  ) {
    return { ok: false, error: "invalid_course_progress" };
  }

  return { ok: true, progressPercent };
}

function parseTmaReminderBody(body: unknown):
  | {
      ok: true;
      message: string;
      remindAt: string;
    }
  | { ok: false; error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "invalid_reminder_payload" };
  }

  const record = body as Record<string, unknown>;
  const message =
    typeof record.message === "string"
      ? record.message.trim()
      : typeof record.title === "string"
        ? record.title.trim()
        : "";
  const remindAt =
    typeof record.remindAt === "string"
      ? record.remindAt
      : typeof record.reminderAt === "string"
        ? record.reminderAt
        : "";

  if (!message) {
    return { ok: false, error: "invalid_reminder_message" };
  }

  if (!remindAt || Number.isNaN(new Date(remindAt).getTime())) {
    return { ok: false, error: "invalid_remind_at" };
  }

  return {
    ok: true,
    message,
    remindAt,
  };
}

function parseTmaFinanceTransactionBody(body: unknown):
  | {
      ok: true;
      amount: number;
      category: string;
      description?: string | null;
      tags?: string[];
      merchant?: string | null;
      transactionType: "expense" | "income";
    }
  | { ok: false; error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "invalid_finance_transaction_payload" };
  }

  const record = body as Record<string, unknown>;
  const amount =
    typeof record.amount === "number"
      ? record.amount
      : typeof record.amount === "string"
        ? Number(record.amount)
        : Number.NaN;
  const category =
    typeof record.category === "string" ? record.category.trim() : "";
  const description =
    typeof record.description === "string" ? record.description.trim() : null;
  const merchant =
    typeof record.merchant === "string" ? record.merchant.trim() : null;
  const transactionType =
    record.transactionType === "income" ? "income" : "expense";
  const tags = Array.isArray(record.tags)
    ? record.tags.filter((tag): tag is string => typeof tag === "string")
    : undefined;

  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "invalid_finance_amount" };
  }

  if (!category) {
    return { ok: false, error: "invalid_finance_category" };
  }

  return {
    ok: true,
    amount,
    category,
    description,
    tags,
    merchant,
    transactionType,
  };
}

function parseTmaReceiptReviewBody(body: unknown):
  | {
      ok: true;
      amount: number;
      currency: string;
      merchant: string;
      date: string;
      category: string;
    }
  | { ok: false; error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "invalid_receipt_review_payload" };
  }

  const record = body as Record<string, unknown>;
  const amount =
    typeof record.amount === "number"
      ? record.amount
      : typeof record.amount === "string"
        ? Number(record.amount)
        : Number.NaN;
  const currency =
    typeof record.currency === "string"
      ? record.currency.trim().toUpperCase()
      : "";
  const merchant =
    typeof record.merchant === "string" ? record.merchant.trim() : "";
  const date = typeof record.date === "string" ? record.date.trim() : "";
  const category =
    typeof record.category === "string" ? record.category.trim() : "";

  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "invalid_amount" };
  }
  if (!["KZT", "USD", "EUR", "RUB"].includes(currency)) {
    return { ok: false, error: "invalid_currency" };
  }
  if (!merchant) {
    return { ok: false, error: "invalid_merchant" };
  }
  if (!date || Number.isNaN(new Date(date).getTime())) {
    return { ok: false, error: "invalid_date" };
  }
  if (!category) {
    return { ok: false, error: "invalid_category" };
  }

  return {
    ok: true,
    amount,
    currency,
    merchant,
    date,
    category,
  };
}

function parseTmaBudgetBody(body: unknown):
  | {
      ok: true;
      name?: string | null;
      amount: number;
      period: "weekly" | "monthly" | "quarterly" | "yearly" | "custom";
      periodStart: string;
      periodEnd?: string | null;
      categoryId?: string | null;
      categoryLimits?: Array<{ categoryId: string; limit: number }>;
    }
  | { ok: false; error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "invalid_budget_payload" };
  }

  const record = body as Record<string, unknown>;
  const amount =
    typeof record.amount === "number"
      ? record.amount
      : typeof record.amount === "string"
        ? Number(record.amount)
        : Number.NaN;
  const periodStart =
    typeof record.periodStart === "string" ? record.periodStart.trim() : "";
  const periodEnd =
    typeof record.periodEnd === "string" ? record.periodEnd.trim() : null;
  const name = typeof record.name === "string" ? record.name.trim() : null;
  const categoryId =
    typeof record.categoryId === "string" ? record.categoryId.trim() : null;
  const period =
    record.period === "weekly" ||
    record.period === "monthly" ||
    record.period === "quarterly" ||
    record.period === "yearly" ||
    record.period === "custom"
      ? record.period
      : "monthly";
  const categoryLimits = Array.isArray(record.categoryLimits)
    ? record.categoryLimits
        .map((item) => {
          if (
            typeof item !== "object" ||
            item === null ||
            Array.isArray(item)
          ) {
            return null;
          }

          const limitRecord = item as Record<string, unknown>;
          const categoryLimitId =
            typeof limitRecord.categoryId === "string"
              ? limitRecord.categoryId.trim()
              : "";
          const limit =
            typeof limitRecord.limit === "number"
              ? limitRecord.limit
              : typeof limitRecord.limit === "string"
                ? Number(limitRecord.limit)
                : Number.NaN;

          if (!categoryLimitId || !Number.isFinite(limit) || limit < 0) {
            return null;
          }

          return { categoryId: categoryLimitId, limit };
        })
        .filter(
          (item): item is { categoryId: string; limit: number } =>
            item !== null,
        )
    : undefined;

  if (!Number.isFinite(amount) || amount < 0) {
    return { ok: false, error: "invalid_budget_amount" };
  }

  const normalizedPeriodStart = periodStart ? parseIsoDateOnly(periodStart) : null;
  const normalizedPeriodEnd = periodEnd ? parseIsoDateOnly(periodEnd) : null;

  if (!normalizedPeriodStart) {
    return { ok: false, error: "invalid_budget_period_start" };
  }

  if (periodEnd && !normalizedPeriodEnd) {
    return { ok: false, error: "invalid_budget_period_end" };
  }

  if (normalizedPeriodEnd && isoDateIsBefore(normalizedPeriodEnd, normalizedPeriodStart)) {
    return { ok: false, error: "invalid_budget_period_range" };
  }

  return {
    ok: true,
    name,
    amount,
    period,
    periodStart: normalizedPeriodStart,
    periodEnd: normalizedPeriodEnd,
    categoryId,
    categoryLimits,
  };
}

function parseTmaBudgetUpdateBody(body: unknown):
  | {
      ok: true;
      name?: string | null;
      amount?: number;
      periodEnd?: string | null;
      categoryLimits?: Array<{ categoryId: string; limit: number }>;
    }
  | { ok: false; error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "invalid_budget_payload" };
  }

  const record = body as Record<string, unknown>;
  const amount =
    record.amount === undefined
      ? undefined
      : typeof record.amount === "number"
        ? record.amount
        : typeof record.amount === "string"
          ? Number(record.amount)
          : Number.NaN;
  const name =
    record.name === undefined
      ? undefined
      : typeof record.name === "string"
        ? record.name.trim()
        : null;
  const periodEnd =
    record.periodEnd === undefined
      ? undefined
      : typeof record.periodEnd === "string"
        ? record.periodEnd.trim()
        : null;
  const categoryLimits = Array.isArray(record.categoryLimits)
    ? record.categoryLimits
        .map((item) => {
          if (
            typeof item !== "object" ||
            item === null ||
            Array.isArray(item)
          ) {
            return null;
          }

          const limitRecord = item as Record<string, unknown>;
          const categoryLimitId =
            typeof limitRecord.categoryId === "string"
              ? limitRecord.categoryId.trim()
              : "";
          const limit =
            typeof limitRecord.limit === "number"
              ? limitRecord.limit
              : typeof limitRecord.limit === "string"
                ? Number(limitRecord.limit)
                : Number.NaN;

          if (!categoryLimitId || !Number.isFinite(limit) || limit < 0) {
            return null;
          }

          return { categoryId: categoryLimitId, limit };
        })
        .filter(
          (item): item is { categoryId: string; limit: number } =>
            item !== null,
        )
    : undefined;

  if (amount !== undefined && (!Number.isFinite(amount) || amount < 0)) {
    return { ok: false, error: "invalid_budget_amount" };
  }

  const normalizedPeriodEnd =
    periodEnd === undefined
      ? undefined
      : periodEnd === null || periodEnd === ""
        ? null
        : parseIsoDateOnly(periodEnd);

  if (periodEnd !== undefined && periodEnd !== null && periodEnd !== "" && !normalizedPeriodEnd) {
    return { ok: false, error: "invalid_budget_period_end" };
  }

  return {
    ok: true,
    name,
    amount,
    periodEnd: normalizedPeriodEnd,
    categoryLimits,
  };
}

function normalizeReceiptMimeType(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";

  if (normalized === "image/jpg") {
    return "image/jpeg";
  }

  return ALLOWED_RECEIPT_MIME_TYPES.has(normalized) ? normalized : null;
}

function mimeExtension(mimeType: string): string {
  switch (mimeType) {
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    default:
      return ".jpg";
  }
}

function dataUrlParts(value: unknown): { mimeType: string | null; imageBase64: string } | null {
  if (typeof value !== "string") {
    return null;
  }

  const match = value.match(/^data:([^;,]+);base64,(.*)$/is);

  if (!match) {
    return null;
  }

  return {
    mimeType: normalizeReceiptMimeType(match[1]),
    imageBase64: match[2]?.trim() ?? "",
  };
}

function sanitizeReceiptFileName(value: unknown, mimeType: string): string {
  const raw = typeof value === "string" ? value.trim() : "";
  const base = basename(raw.replace(/\\/g, "/"));
  const cleaned = base
    .normalize("NFKC")
    .replace(/[\x00-\x1f<>:"/\\|?*]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[.\s-]+|[.\s-]+$/g, "")
    .slice(0, 120)
    .trim();
  const fallback = `receipt${mimeExtension(mimeType)}`;
  const fileName = cleaned || fallback;

  if (/\.(jpe?g|png|webp)$/iu.test(fileName)) {
    return fileName;
  }

  return `${fileName}${mimeExtension(mimeType)}`;
}

function receiptDownloadContentType(value: string): string {
  return normalizeReceiptMimeType(value) ?? "application/octet-stream";
}

function sniffReceiptImageMime(bytes: Buffer): string | null {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }

  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }

  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }

  return null;
}

function parseTmaReceiptUploadBody(body: unknown):
  | {
      ok: true;
      fileName: string;
      mimeType: string;
      imageBase64: string;
    }
  | { ok: false; error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "invalid_receipt_payload" };
  }

  const record = body as Record<string, unknown>;
  const dataUrl = dataUrlParts(record.dataUrl);
  const explicitMimeType = normalizeReceiptMimeType(record.mimeType);
  const mimeType = explicitMimeType ?? dataUrl?.mimeType ?? "image/jpeg";

  if (
    (typeof record.mimeType === "string" && !explicitMimeType) ||
    (typeof record.dataUrl === "string" && dataUrl?.mimeType === null)
  ) {
    return { ok: false, error: "unsupported_receipt_image_type" };
  }

  const imageBase64 =
    typeof record.imageBase64 === "string"
      ? record.imageBase64.trim()
      : dataUrl?.imageBase64 ?? "";

  if (!imageBase64) {
    return { ok: false, error: "invalid_receipt_image" };
  }

  return {
    ok: true,
    fileName: sanitizeReceiptFileName(record.fileName, mimeType),
    mimeType,
    imageBase64,
  };
}

function parseTmaFinanceSettingsBody(
  body: unknown,
): { ok: true; baseCurrency: string } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "invalid_finance_settings_payload" };
  }

  const record = body as Record<string, unknown>;
  const baseCurrency =
    typeof record.baseCurrency === "string"
      ? record.baseCurrency.trim().toUpperCase()
      : "";

  if (!["KZT", "USD", "EUR", "RUB"].includes(baseCurrency)) {
    return { ok: false, error: "invalid_base_currency" };
  }

  return { ok: true, baseCurrency };
}

function financeAiOptions(options: ResolvedBotServerOptions) {
  return {
    aiEnabled: options.financeAiEnabled,
    openRouterApiKey: options.openRouterApiKey,
    model: options.financeAiModel,
  };
}

async function tmaFinanceSummary(store: LifeOSStore, user: TelegramUserRecord) {
  return store.getTmaFinanceSummary({
    userId: user.userId,
    today: todayForTimezone(user.timezone),
  });
}

function todayForTimezone(timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const values = Object.fromEntries(
      parts
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value]),
    );

    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function previousMonthForTimezone(timezone: string): string {
  const today = todayForTimezone(timezone);
  const current = new Date(`${today}T00:00:00.000Z`);
  current.setUTCDate(1);
  current.setUTCDate(0);
  return current.toISOString().slice(0, 7);
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: ResolvedBotServerOptions,
): Promise<void> {
  if (hasTmaPathTraversal(request.url)) {
    writeJson(response, 400, {
      error: "invalid_tma_path",
    });
    return;
  }

  const requestUrl = new URL(
    request.url ?? "/",
    `http://${request.headers.host ?? "localhost"}`,
  );

  if (request.method === "GET" && requestUrl.pathname === "/healthz") {
    writeJson(response, 200, healthResponse(options));
    return;
  }

  if (request.method === "OPTIONS" && requestUrl.pathname.startsWith("/api/")) {
    writeNoContent(response);
    return;
  }

  if (await handleTmaStaticRequest(request, response, requestUrl, options)) {
    return;
  }

  if (requestUrl.pathname === "/api/oauth/google/callback") {
    if (request.method !== "GET") {
      writeJson(response, 404, {
        error: "not_found",
      });
      return;
    }

    if (!options.store) {
      writeHtml(
        response,
        503,
        "Google OAuth unavailable",
        "LifeOS database access is not configured.",
      );
      return;
    }

    if (!googleOAuthConfigured(options)) {
      writeHtml(
        response,
        503,
        "Google OAuth unavailable",
        "Google OAuth is not configured.",
      );
      return;
    }

    const state = verifyGoogleOAuthState(
      requestUrl.searchParams.get("state"),
      options.googleOAuthStateSecret,
    );

    if (!state) {
      writeHtml(
        response,
        400,
        "Google OAuth failed",
        "The OAuth state was invalid or expired.",
      );
      return;
    }

    const stateNonceConsumed = await options.store.consumeGoogleOAuthStateNonce({
      nonce: state.nonce,
      userId: state.userId,
    });

    if (!stateNonceConsumed) {
      writeHtml(
        response,
        400,
        "Google OAuth failed",
        "The OAuth state was already used or expired.",
      );
      return;
    }

    if (requestUrl.searchParams.get("error")) {
      writeRedirect(response, googleOAuthTmaRedirect(options, "error"));
      return;
    }

    const code = requestUrl.searchParams.get("code");

    if (!code) {
      writeHtml(
        response,
        400,
        "Google OAuth failed",
        "Google did not return an authorization code.",
      );
      return;
    }

    try {
      const token = await exchangeGoogleOAuthCode(code, options);
      const accountEmail = await fetchGoogleAccountEmail(token.accessToken);
      await options.store.upsertUserOAuthConnection(state.userId, {
        provider: "google",
        providerAccountEmail: accountEmail,
        accessToken: token.accessToken,
        ...(token.refreshToken ? { refreshToken: token.refreshToken } : {}),
        expiresAt: token.expiresAt,
        scopes: token.scopes,
        status: "connected",
        metadata: {
          source: "tma_google_oauth",
          telegram_user_id: state.telegramUserId,
          connected_at: new Date().toISOString(),
        },
      });
      writeRedirect(response, googleOAuthTmaRedirect(options, "connected"));
      return;
    } catch {
      writeRedirect(response, googleOAuthTmaRedirect(options, "error"));
      return;
    }
  }

  if (requestUrl.pathname === "/api/tma/session") {
    if (request.method !== "GET") {
      writeJson(response, 404, {
        error: "not_found",
      });
      return;
    }

    const session = await resolveTmaSessionStatus(request, options);

    if (!session.ok) {
      writeJson(response, session.statusCode, {
        error: session.error,
      });
      return;
    }

    writeJson(response, 200, tmaData(session.session));
    return;
  }

  if (requestUrl.pathname === "/api/tma/register") {
    if (request.method !== "POST") {
      writeJson(response, 404, {
        error: "not_found",
      });
      return;
    }

    if (!options.store) {
      writeJson(response, 503, {
        error: "database_not_configured",
      });
      return;
    }

    const identity = await resolveTmaSessionIdentity(request, options);

    if (!identity.ok) {
      writeJson(response, identity.statusCode, {
        error: identity.error,
      });
      return;
    }

    if (identity.devUser) {
      writeJson(
        response,
        200,
        tmaData(
          await buildTmaSessionStatus(
            {
              telegramUserId: identity.telegramUserId,
              displayName: identity.displayName,
              username: identity.username,
              user: identity.devUser,
            },
            options.store,
          ),
        ),
      );
      return;
    }

    const existing = await options.store.resolveTelegramUser(
      identity.telegramUserId,
    );
    const user =
      existing ??
      (await options.store.createPendingTelegramUser({
        telegramUserId: identity.telegramUserId,
        displayName: identity.displayName,
        username: identity.username,
      }));

    writeJson(
      response,
      200,
      tmaData(
        await buildTmaSessionStatus(
          {
            telegramUserId: identity.telegramUserId,
            displayName: identity.displayName,
            username: identity.username,
            user,
          },
          options.store,
        ),
      ),
    );
    return;
  }

  if (requestUrl.pathname.startsWith("/api/tma/")) {
    const auth = await resolveTmaUser(request, options);

    if (!auth.ok) {
      writeJson(response, auth.statusCode, {
        error: auth.error,
      });
      return;
    }

    const store = options.store;

    if (!store) {
      writeJson(response, 503, {
        error: "database_not_configured",
      });
      return;
    }

    if (
      request.method === "POST" &&
      requestUrl.pathname === "/api/tma/health/ingest-token"
    ) {
      if (!options.healthIngestJwtSecret) {
        writeJson(response, 503, {
          error: "health_ingest_token_not_configured",
        });
        return;
      }

      writeJson(
        response,
        200,
        tmaData({
          token: signHealthIngestToken(auth.user, options.healthIngestJwtSecret),
          tokenType: "Bearer",
          expiresInSeconds: HEALTH_INGEST_TOKEN_MAX_AGE_SECONDS,
        }),
      );
      return;
    }

    if (
      request.method === "POST" &&
      requestUrl.pathname === "/api/tma/obsidian/syncthing"
    ) {
      if (!syncthingConfigured(options.syncthing)) {
        writeJson(response, 503, {
          error: "syncthing_not_configured",
          message:
            "Set SYNCTHING_API_URL, SYNCTHING_API_KEY and SYNCTHING_SERVER_DEVICE_ID on the backend.",
        });
        return;
      }

      let body: unknown;

      try {
        body = await readJsonBody(request);
      } catch (error) {
        writeJson(response, 400, {
          error: "invalid_syncthing_payload",
          message: sanitizeErrorMessage(error, options),
        });
        return;
      }

      if (!isRecord(body) || typeof body.deviceId !== "string") {
        writeJson(response, 400, {
          error: "invalid_syncthing_device_id",
          message: "Request body must contain a Syncthing deviceId string.",
        });
        return;
      }

      try {
        const provisioned = await provisionSyncthingFolder(options.syncthing, {
          userId: auth.user.userId,
          userDeviceId: body.deviceId,
          deviceName:
            typeof body.deviceName === "string" ? body.deviceName : null,
        });

        const settings = await store.upsertUserObsidianSettings(
          auth.user.userId,
          {
            enabled: true,
            mode: "syncthing",
            vaultPath: provisioned.vaultPath,
            syncthingFolderId: provisioned.folderId,
            isActive: true,
            status: "connected",
            metadata: {
              syncthing: {
                userDeviceId: provisioned.userDeviceId,
                serverDeviceId: provisioned.serverDeviceId,
                provisionedAt: new Date().toISOString(),
              },
            },
          },
        );

        writeJson(
          response,
          200,
          tmaData({
            settings,
            instructions: {
              serverDeviceId: provisioned.serverDeviceId,
              folderId: provisioned.folderId,
              folderLabel: `LifeOS ${auth.user.userId.slice(0, 8)}`,
              localPathHint: "Choose an empty local Obsidian vault folder on your device.",
            },
          }),
        );
        return;
      } catch (error) {
        writeJson(response, 400, {
          error: "syncthing_provisioning_failed",
          message: publicErrorMessage("request_failed"),
        });
        return;
      }
    }

    if (
      request.method === "GET" &&
      requestUrl.pathname === "/api/tma/obsidian/syncthing"
    ) {
      const folderId = syncthingFolderIdForUser(auth.user.userId);
      const vaultPath = serverVaultPathForUser(auth.user.userId);
      const settings = await store.getUserObsidianSettings(auth.user.userId);

      writeJson(
        response,
        200,
        tmaData({
          configured: syncthingConfigured(options.syncthing),
          serverDeviceId: options.syncthing.serverDeviceId ?? null,
          folderId: settings?.syncthingFolderId ?? folderId,
          vaultPath,
          status: settings?.status ?? "disconnected",
        }),
      );
      return;
    }

    if (
      request.method === "GET" &&
      requestUrl.pathname === "/api/tma/integrations/google/start"
    ) {
      if (!googleOAuthConfigured(options)) {
        writeJson(response, 503, {
          error: "google_oauth_not_configured",
        });
        return;
      }

      if (!options.googleOAuthStateSecret) {
        writeJson(response, 503, {
          error: "google_oauth_not_configured",
        });
        return;
      }

      const oauthState = createGoogleOAuthState(
        auth.user,
        options.googleOAuthStateSecret,
      );
      await store.storeGoogleOAuthStateNonce({
        nonce: oauthState.payload.nonce,
        userId: oauthState.payload.userId,
        telegramUserId: oauthState.payload.telegramUserId,
        issuedAt: new Date(oauthState.payload.issuedAt * 1000).toISOString(),
        expiresAt: new Date(
          (oauthState.payload.issuedAt + GOOGLE_OAUTH_STATE_MAX_AGE_SECONDS) *
            1000,
        ).toISOString(),
      });
      const url = buildGoogleOAuthUrl(auth.user, options, oauthState.state);

      if (!url) {
        writeJson(response, 503, {
          error: "google_oauth_not_configured",
        });
        return;
      }

      writeJson(response, 200, tmaData({ url }));
      return;
    }

    if (
      request.method === "POST" &&
      requestUrl.pathname === "/api/tma/integrations/google/disconnect"
    ) {
      await store.deleteUserOAuthConnection(auth.user.userId, "google");
      writeJson(
        response,
        200,
        tmaData(
          await buildTmaSessionStatus(
            {
              telegramUserId: auth.user.telegramUserId ?? 0,
              displayName: auth.user.displayName,
              username: auth.user.username,
              user: auth.user,
            },
            store,
          ),
        ),
      );
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/tma/mode") {
      writeJson(
        response,
        200,
        tmaData(await store.resolveCurrentMode(auth.user.userId)),
      );
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/tma/mode") {
      const body = parseTmaModeBody(await readJsonBody(request));

      if (!body.ok) {
        writeJson(response, 400, {
          error: body.error,
        });
        return;
      }

      const mode =
        body.mode === "auto"
          ? await store.clearManualLifeMode(auth.user.userId)
          : await store.setManualLifeMode({
              userId: auth.user.userId,
              mode: body.mode,
              activeUntil: body.activeUntil,
              reason: body.activeUntil
                ? `TMA override until ${body.activeUntil}`
                : "TMA override until cleared.",
            });

      writeJson(response, 200, tmaData(mode));
      return;
    }

    if (
      request.method === "DELETE" &&
      requestUrl.pathname === "/api/tma/mode"
    ) {
      writeJson(
        response,
        200,
        tmaData(await store.clearManualLifeMode(auth.user.userId)),
      );
      return;
    }

    if (
      request.method === "GET" &&
      (requestUrl.pathname === "/api/tma/course/active" ||
        requestUrl.pathname === "/api/tma/course/discrete-math-summer-term")
    ) {
      const today = todayForTimezone(auth.user.timezone);

      writeJson(
        response,
        200,
        tmaData(await store.getActiveStudyCourse(auth.user.userId, today)),
      );
      return;
    }

    if (
      request.method === "POST" &&
      (requestUrl.pathname === "/api/tma/course/active/progress" ||
        requestUrl.pathname ===
          "/api/tma/course/discrete-math-summer-term/progress")
    ) {
      const body = parseTmaCourseProgressBody(await readJsonBody(request));

      if (!body.ok) {
        writeJson(response, 400, {
          error: body.error,
        });
        return;
      }

      const today = todayForTimezone(auth.user.timezone);
      const course = await store.getActiveStudyCourse(auth.user.userId, today);

      if (!course) {
        writeJson(response, 404, {
          error: "course_not_found",
        });
        return;
      }

      writeJson(
        response,
        200,
        tmaData(
          await store.updateStudyCourseProgress({
            userId: auth.user.userId,
            courseId: course.id,
            progressPercent: body.progressPercent,
            lastStudiedOn: today,
          }),
        ),
      );
      return;
    }

    if (
      request.method === "GET" &&
      requestUrl.pathname === "/api/tma/sources"
    ) {
      writeJson(
        response,
        200,
        tmaData(await store.getTmaSourcesSummary(auth.user.userId)),
      );
      return;
    }

    if (
      request.method === "GET" &&
      requestUrl.pathname === "/api/tma/reminders"
    ) {
      const reminders = await store.listUpcomingReminders(auth.user.userId, 10);

      writeJson(response, 200, tmaData({ reminders }));
      return;
    }

    if (
      request.method === "POST" &&
      requestUrl.pathname === "/api/tma/reminders"
    ) {
      const body = parseTmaReminderBody(await readJsonBody(request));

      if (!body.ok) {
        writeJson(response, 400, {
          error: body.error,
        });
        return;
      }

      if (new Date(body.remindAt).getTime() <= Date.now()) {
        writeJson(response, 400, {
          error: "reminder_time_in_past",
        });
        return;
      }

      await store.createReminder({
        userId: auth.user.userId,
        message: body.message,
        remindAt: body.remindAt,
        channel: "telegram",
        metadataJson: {
          source: "tma",
        },
      });

      writeJson(
        response,
        200,
        tmaData(await store.getTmaSourcesSummary(auth.user.userId)),
      );
      return;
    }

    const reminderRoute = requestUrl.pathname.match(
      /^\/api\/tma\/reminders\/([^/]+)$/,
    );

    if (request.method === "DELETE" && reminderRoute?.[1]) {
      const reminderId = decodeURIComponent(reminderRoute[1]);
      const reminder = await store.cancelReminder(auth.user.userId, reminderId);

      writeJson(response, 200, tmaData(reminder));
      return;
    }

    if (
      request.method === "GET" &&
      requestUrl.pathname === "/api/tma/academic"
    ) {
      writeJson(
        response,
        200,
        tmaData(await store.getTmaAcademicSummary(auth.user.userId)),
      );
      return;
    }

    if (
      request.method === "GET" &&
      requestUrl.pathname === "/api/tma/finance"
    ) {
      writeJson(
        response,
        200,
        tmaData(await tmaFinanceSummary(store, auth.user)),
      );
      return;
    }

    if (
      request.method === "GET" &&
      requestUrl.pathname === "/api/tma/finance/categories"
    ) {
      writeJson(
        response,
        200,
        tmaData(await store.listFinanceCategories(auth.user.userId)),
      );
      return;
    }

    if (
      request.method === "GET" &&
      requestUrl.pathname === "/api/tma/finance/settings"
    ) {
      writeJson(
        response,
        200,
        tmaData({
          baseCurrency: await store.getFinanceBaseCurrency(auth.user.userId),
        }),
      );
      return;
    }

    if (
      request.method === "POST" &&
      requestUrl.pathname === "/api/tma/finance/settings"
    ) {
      const body = parseTmaFinanceSettingsBody(await readJsonBody(request));

      if (!body.ok) {
        writeJson(response, 400, { error: body.error });
        return;
      }

      await store.setFinanceBaseCurrency(auth.user.userId, body.baseCurrency);
      await store.backfillFinanceBaseAmounts({ userId: auth.user.userId });

      const today = todayForTimezone(auth.user.timezone);
      void triggerFinanceAlerts(
        store,
        options.telegram,
        auth.user.userId,
        today,
      ).catch(console.error);

      writeJson(
        response,
        200,
        tmaData(await tmaFinanceSummary(store, auth.user)),
      );
      return;
    }

    if (
      request.method === "GET" &&
      requestUrl.pathname === "/api/tma/finance/receipts"
    ) {
      const receipts = await store.listReceipts(auth.user.userId);
      writeJson(
        response,
        200,
        tmaData({
          receipts: receipts.slice(0, 10).map((receipt) => ({
            id: receipt.id,
            status: receipt.status,
            displayStatus:
              receipt.status === "linked" || receipt.status === "parsed"
                ? "completed"
                : receipt.status === "partial"
                  ? "partial"
                  : receipt.status === "needs_review"
                    ? "needs_review"
                    : receipt.status === "failed"
                      ? "failed"
                      : "processing",
            fileName: receipt.fileName,
            transactionId: receipt.transactionId,
            errorMessage: receipt.errorMessage,
            createdAt: receipt.createdAt,
            processedAt: receipt.processedAt,
          })),
        }),
      );
      return;
    }

    const receiptDetailRoute = requestUrl.pathname.match(
      /^\/api\/tma\/finance\/receipts\/([^/]+)$/,
    );

    if (request.method === "GET" && receiptDetailRoute?.[1]) {
      const receiptId = decodeURIComponent(receiptDetailRoute[1]);
      const receipt = await store.getReceipt(auth.user.userId, receiptId);
      if (!receipt) {
        writeJson(response, 404, { error: "receipt_not_found" });
        return;
      }
      writeJson(response, 200, tmaData(receipt));
      return;
    }

    const receiptImageRoute = requestUrl.pathname.match(
      /^\/api\/tma\/finance\/receipts\/([^/]+)\/image$/,
    );

    if (request.method === "GET" && receiptImageRoute?.[1]) {
      const receiptId = decodeURIComponent(receiptImageRoute[1]);
      try {
        const { bytes, mimeType } = await store.downloadReceiptImage(
          auth.user.userId,
          receiptId,
        );
        const contentType = receiptDownloadContentType(mimeType);
        response.writeHead(200, {
          "content-type": contentType,
          "content-disposition": `inline; filename=\"receipt${mimeExtension(contentType)}\"`,
          "content-security-policy": "default-src 'none'; sandbox",
          "x-content-type-options": "nosniff",
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
          "access-control-allow-headers":
            "authorization,content-type,x-telegram-init-data,x-telegram-bot-api-secret-token",
        });
        response.end(bytes);
      } catch (error) {
        writeJson(response, 404, { error: "image_not_found" });
      }
      return;
    }

    const receiptReviewRoute = requestUrl.pathname.match(
      /^\/api\/tma\/finance\/receipts\/([^/]+)\/review$/,
    );

    if (request.method === "POST" && receiptReviewRoute?.[1]) {
      const receiptId = decodeURIComponent(receiptReviewRoute[1]);
      const body = parseTmaReceiptReviewBody(await readJsonBody(request));

      if (!body.ok) {
        writeJson(response, 400, { error: body.error });
        return;
      }

      const receipt = await store.reviewFinanceReceipt({
        userId: auth.user.userId,
        receiptId,
        amount: body.amount,
        currency: body.currency as CurrencyCode,
        merchant: body.merchant,
        date: body.date,
        category: body.category,
      });

      const today = todayForTimezone(auth.user.timezone);
      void triggerFinanceAlerts(
        store,
        options.telegram,
        auth.user.userId,
        today,
      ).catch(console.error);

      writeJson(response, 200, tmaData(receipt));
      return;
    }

    if (
      request.method === "POST" &&
      requestUrl.pathname === "/api/tma/finance/receipts"
    ) {
      const body = parseTmaReceiptUploadBody(
        await readJsonBody(request, MEDIA_JSON_BODY_MAX_BYTES),
      );

      if (!body.ok) {
        writeJson(response, 400, { error: body.error });
        return;
      }

      const bytes = Buffer.from(body.imageBase64, "base64");
      const actualMimeType = sniffReceiptImageMime(bytes);

      if (!actualMimeType || actualMimeType !== body.mimeType) {
        writeJson(response, 400, { error: "unsupported_receipt_image_type" });
        return;
      }

      const receipt = await store.processReceiptImage({
        userId: auth.user.userId,
        fileName: body.fileName,
        mimeType: body.mimeType,
        bytes,
        ai: financeAiOptions(options),
      });

      if (receipt.status === "linked") {
        const today = todayForTimezone(auth.user.timezone);
        void triggerFinanceAlerts(
          store,
          options.telegram,
          auth.user.userId,
          today,
        ).catch(console.error);
      }

      writeJson(
        response,
        200,
        tmaData(await tmaFinanceSummary(store, auth.user)),
      );
      return;
    }

    if (
      request.method === "POST" &&
      requestUrl.pathname === "/api/tma/finance/transactions"
    ) {
      const body = parseTmaFinanceTransactionBody(await readJsonBody(request));

      if (!body.ok) {
        writeJson(response, 400, { error: body.error });
        return;
      }

      await store.createFinanceTransaction({
        userId: auth.user.userId,
        transactionType: body.transactionType,
        amount: body.amount,
        category: body.category,
        description: body.description,
        merchant: body.merchant,
        tags: body.tags,
        occurredOn: todayForTimezone(auth.user.timezone),
        source: "manual",
      });

      const today = todayForTimezone(auth.user.timezone);
      void triggerFinanceAlerts(
        store,
        options.telegram,
        auth.user.userId,
        today,
      ).catch(console.error);

      writeJson(
        response,
        200,
        tmaData(await tmaFinanceSummary(store, auth.user)),
      );
      return;
    }

    if (
      request.method === "POST" &&
      requestUrl.pathname === "/api/tma/finance/backfill"
    ) {
      const updatedCount = await store.backfillFinanceBaseAmounts({
        userId: auth.user.userId,
      });
      writeJson(response, 200, tmaData({ updatedCount }));
      return;
    }

    if (
      request.method === "POST" &&
      requestUrl.pathname === "/api/tma/finance/budgets"
    ) {
      const body = parseTmaBudgetBody(await readJsonBody(request));

      if (!body.ok) {
        writeJson(response, 400, { error: body.error });
        return;
      }

      await store.createBudget({
        userId: auth.user.userId,
        name: body.name,
        amount: body.amount,
        period: body.period,
        periodStart: body.periodStart,
        periodEnd: body.periodEnd,
        categoryId: body.categoryId,
        categoryLimits: body.categoryLimits,
      });

      writeJson(
        response,
        200,
        tmaData(await tmaFinanceSummary(store, auth.user)),
      );
      return;
    }

    const budgetRoute = requestUrl.pathname.match(
      /^\/api\/tma\/finance\/budgets\/([^/]+)(?:\/(archive))?$/,
    );

    if (request.method === "PATCH" && budgetRoute?.[1] && !budgetRoute[2]) {
      const budgetId = decodeURIComponent(budgetRoute[1]);
      const body = parseTmaBudgetUpdateBody(await readJsonBody(request));

      if (!body.ok) {
        writeJson(response, 400, { error: body.error });
        return;
      }

      try {
        await store.updateBudget({
          userId: auth.user.userId,
          budgetId,
          name: body.name,
          amount: body.amount,
          periodEnd: body.periodEnd,
          categoryLimits: body.categoryLimits,
        });
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "Budget period end must be on or after period start"
        ) {
          writeJson(response, 400, { error: "invalid_budget_period_range" });
          return;
        }
        throw error;
      }

      writeJson(
        response,
        200,
        tmaData(await tmaFinanceSummary(store, auth.user)),
      );
      return;
    }

    if (
      request.method === "POST" &&
      budgetRoute?.[1] &&
      budgetRoute[2] === "archive"
    ) {
      const budgetId = decodeURIComponent(budgetRoute[1]);
      await store.archiveBudget(auth.user.userId, budgetId);
      writeJson(
        response,
        200,
        tmaData(await tmaFinanceSummary(store, auth.user)),
      );
      return;
    }

    if (
      request.method === "GET" &&
      requestUrl.pathname === "/api/tma/monthly-review"
    ) {
      writeJson(
        response,
        200,
        tmaData(await store.getTmaMonthlyReviewSummary(auth.user.userId)),
      );
      return;
    }

    if (
      request.method === "POST" &&
      requestUrl.pathname === "/api/tma/monthly-review"
    ) {
      await store.generateMonthlyReview({
        userId: auth.user.userId,
        periodMonth: previousMonthForTimezone(auth.user.timezone),
      });

      writeJson(
        response,
        200,
        tmaData(await store.getTmaMonthlyReviewSummary(auth.user.userId)),
      );
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/tma/home") {
      writeJson(
        response,
        200,
        tmaData(await store.getTmaHomeSummary(auth.user)),
      );
      return;
    }

    if (
      request.method === "GET" &&
      requestUrl.pathname === "/api/tma/workout/current"
    ) {
      const workout = await store.getCurrentWorkout({
        userId: auth.user.userId,
      });

      writeJson(response, 200, tmaData(workout));
      return;
    }

    if (
      request.method === "POST" &&
      requestUrl.pathname === "/api/tma/workout/start"
    ) {
      const mode = await store.resolveCurrentMode(auth.user.userId);
      await store.getOrCreateCurrentWorkout({
        userId: auth.user.userId,
        now: new Date().toISOString(),
        lifeMode: mode.mode,
      });
      const workout = await store.getCurrentWorkout({
        userId: auth.user.userId,
      });

      if (!workout) {
        writeJson(response, 500, {
          error: "workout_start_failed",
        });
        return;
      }

      writeJson(response, 200, tmaData(workout));
      return;
    }

    const completeSetMatch = requestUrl.pathname.match(
      /^\/api\/tma\/workout\/sets\/([^/]+)\/complete$/,
    );

    if (request.method === "POST" && completeSetMatch?.[1]) {
      const workout = await store.completeWorkoutSet({
        userId: auth.user.userId,
        setId: decodeURIComponent(completeSetMatch[1]),
        completedAt: new Date().toISOString(),
      });
      writeJson(response, 200, tmaData(workout));
      return;
    }

    const undoSetMatch = requestUrl.pathname.match(
      /^\/api\/tma\/workout\/sets\/([^/]+)\/undo$/,
    );

    if (request.method === "POST" && undoSetMatch?.[1]) {
      const workout = await store.undoWorkoutSet({
        userId: auth.user.userId,
        setId: decodeURIComponent(undoSetMatch[1]),
      });
      writeJson(response, 200, tmaData(workout));
      return;
    }

    const completeWorkoutMatch = requestUrl.pathname.match(
      /^\/api\/tma\/workout\/([^/]+)\/complete$/,
    );

    if (request.method === "POST" && completeWorkoutMatch?.[1]) {
      const workout = await store.completeWorkout({
        userId: auth.user.userId,
        workoutId: decodeURIComponent(completeWorkoutMatch[1]),
        completedAt: new Date().toISOString(),
      });
      writeJson(response, 200, tmaData(workout));
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/tma/health") {
      writeJson(
        response,
        200,
        tmaData(await store.getTmaHealthSummary(auth.user.userId)),
      );
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/tma/focus") {
      writeJson(
        response,
        200,
        tmaData(await store.getTmaFocusSummary(auth.user.userId)),
      );
      return;
    }

    writeJson(response, 404, {
      error: "not_found",
    });
    return;
  }

  if (
    request.method === "POST" &&
    (requestUrl.pathname === "/health/ingest" ||
      requestUrl.pathname === "/api/health/ingest")
  ) {
    if (!options.store) {
      writeJson(response, 503, {
        error: "database_not_configured",
      });
      return;
    }

    let authenticatedUserId: string | undefined;
    const tokenPayload = verifyHealthIngestToken(
      bearerToken(request),
      options.healthIngestJwtSecret,
    );

    if (tokenPayload) {
      authenticatedUserId = tokenPayload.userId;
    } else if (headerValue(request.headers["x-telegram-init-data"])) {
      const auth = await resolveTmaUser(request, options);

      if (!auth.ok) {
        writeJson(response, auth.statusCode, {
          error: auth.error,
        });
        return;
      }

      authenticatedUserId = auth.user.userId;
    } else {
      writeJson(response, 401, {
        error: "invalid_health_ingest_token",
      });
      return;
    }

    let body;

    try {
      body = await readJsonBody(request);
    } catch (error) {
      writeJson(response, 400, {
        error: "invalid_health_ingest_payload",
        message: publicErrorMessage("request_failed"),
      });
      return;
    }

    const healthUserId = authenticatedUserId;

    if (!healthUserId) {
      writeJson(response, 401, {
        error: "invalid_health_ingest_token",
      });
      return;
    }

    const bodyUserId = payloadUserId(body);

    if (bodyUserId && bodyUserId !== healthUserId) {
      writeJson(response, 403, {
        error: "health_ingest_user_mismatch",
      });
      return;
    }

    const scopedBody = scopeBodyToAuthenticatedUser(body, healthUserId);

    if (
      typeof scopedBody === "object" &&
      scopedBody !== null &&
      !Array.isArray(scopedBody) &&
      Array.isArray((scopedBody as Record<string, unknown>).metrics)
    ) {
      let payload;

      try {
        payload = parseHealthMetricsIngestPayload(
          scopedBody,
          healthUserId,
        );
      } catch (error) {
        writeJson(response, 400, {
          error: "invalid_health_metrics_payload",
          message: publicErrorMessage("request_failed"),
        });
        return;
      }

      const result = await options.store.upsertHealthMetrics(payload);

      writeJson(response, 200, {
        ok: true,
        result,
      });
      return;
    }

    let payload;

    try {
      payload = parseHealthIngestPayload(scopedBody);
    } catch (error) {
      writeJson(response, 400, {
        error: "invalid_health_ingest_payload",
        message: publicErrorMessage("request_failed"),
      });
      return;
    }

    const result = await options.store.ingestHealthPayload(payload);

    writeJson(response, 200, {
      ok: true,
      result,
    });

    return;
  }

  if (
    request.method === "POST" &&
    requestUrl.pathname === options.webhookPath
  ) {
    if (options.webhookSecret) {
      const providedSecret = request.headers["x-telegram-bot-api-secret-token"];

      if (
        !secureCompare(headerValue(providedSecret) ?? "", options.webhookSecret)
      ) {
        writeJson(response, 401, {
          error: "invalid_webhook_secret",
        });
        return;
      }
    }

    if (!options.telegram) {
      writeJson(response, 503, {
        error: "telegram_not_configured",
      });
      return;
    }

    await handleTelegramWebhook(request, response, options);
    return;
  }

  writeJson(response, 404, {
    error: "not_found",
  });
}

export function createBotServer(options: BotServerOptions = {}): Server {
  const resolvedOptions: ResolvedBotServerOptions = {
    startedAt: options.startedAt ?? new Date(),
    version: options.version ?? "0.0.0",
    dependencies: {
      supabaseConfigured: options.dependencies?.supabaseConfigured ?? false,
      telegramConfigured: options.dependencies?.telegramConfigured ?? false,
      healthIngestConfigured: Boolean(options.config?.lifeosHealthIngestJwtSecret),
    },
    webhookPath: options.config?.telegramWebhookPath ?? "/telegram/webhook",
    webhookSecret: options.config?.telegramWebhookSecret,
    telegramBotToken: options.config?.telegramBotToken,
    healthIngestJwtSecret: options.config?.lifeosHealthIngestJwtSecret,
    syncthing: {
      apiUrl: options.config?.syncthingApiUrl,
      apiKey: options.config?.syncthingApiKey,
      serverDeviceId: options.config?.syncthingServerDeviceId,
    },
    tmaUrl: options.config?.tmaUrl,
    tmaStaticDir: resolveStaticDirectory(options.config?.tmaStaticDir),
    defaultUserId: options.config?.lifeosDefaultUserId,
    defaultTelegramUserId: options.config?.lifeosDefaultTelegramUserId,
    adminTelegramUserIds: options.config?.lifeosAdminTelegramIds ?? [],
    signupMode: options.config?.lifeosSignupMode ?? "pending_approval",
    allowUnsafeTmaDevAuth: options.config?.allowUnsafeTmaDevAuth ?? false,
    openRouterApiKey: options.config?.openRouterApiKey,
    financeAiModel: options.config?.financeAiModel,
    financeAiEnabled: options.config?.financeAiEnabled ?? false,
    googleOAuthClientId: options.config?.googleOAuthClientId,
    googleOAuthClientSecret: options.config?.googleOAuthClientSecret,
    googleOAuthRedirectUri: options.config?.googleOAuthRedirectUri,
    googleOAuthStateSecret: options.config?.googleOAuthStateSecret,
    store: options.store,
    telegram: options.telegram,
  };

  return createServer((request: IncomingMessage, response: ServerResponse) => {
    void handleRequest(request, response, resolvedOptions).catch((error) => {
      if (error instanceof RequestBodyError) {
        writeJson(response, error.statusCode, {
          error: error.errorCode,
          message: error.message,
        });
        return;
      }

      writeJson(response, 500, {
        error: "internal_error",
        message: publicErrorMessage("request_failed"),
      });
    });
  });
}
