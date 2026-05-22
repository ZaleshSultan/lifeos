import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  parseHealthIngestPayload,
  parseLifeMode,
  type LifeMode,
} from "@lifeos/core";
import type { LifeOSStore, TelegramUserRecord } from "@lifeos/db";
import type { BotConfig } from "./config.js";
import { handleTelegramUpdate } from "./telegram/commands.js";
import type { TelegramClient, TelegramUpdate } from "./telegram/types.js";

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
      | "lifeosIngestSecret"
      | "lifeosDefaultUserId"
      | "lifeosDefaultTelegramUserId"
      | "allowUnsafeTmaDevAuth"
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
  ingestSecret?: string;
  tmaUrl?: string;
  defaultUserId?: string;
  defaultTelegramUserId?: number;
  allowUnsafeTmaDevAuth: boolean;
  store?: LifeOSStore;
  telegram?: TelegramClient;
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
      "content-type,x-telegram-init-data,x-lifeos-ingest-secret,x-telegram-bot-api-secret-token",
  });
  response.end(JSON.stringify(body));
}

function writeNoContent(response: ServerResponse): void {
  response.writeHead(204, {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers":
      "content-type,x-telegram-init-data,x-lifeos-ingest-secret,x-telegram-bot-api-secret-token",
  });
  response.end();
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
  const valueBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);

  if (valueBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(valueBuffer, expectedBuffer);
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
): { telegramUserId: number; displayName: string | null } | null {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");

  if (!hash) {
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
    };
  } catch {
    return null;
  }
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
        return { ok: true, user };
      }

      return {
        ok: false,
        statusCode: 403,
        error: "telegram_user_not_linked",
      };
    }
  }

  if (options.allowUnsafeTmaDevAuth && options.defaultUserId) {
    return {
      ok: true,
      user: {
        userId: options.defaultUserId,
        displayName: "Dev user",
        timezone: "UTC",
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

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  const maxBytes = 1024 * 1024;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;

    if (totalBytes > maxBytes) {
      throw new Error("Request body is too large");
    }

    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
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

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: ResolvedBotServerOptions,
): Promise<void> {
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
        writeJson(response, 404, {
          error: "workout_not_found",
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

  if (request.method === "POST" && requestUrl.pathname === "/health/ingest") {
    if (!options.ingestSecret) {
      writeJson(response, 503, {
        error: "health_ingest_not_configured",
      });
      return;
    }

    const providedSecretValue = headerValue(
      request.headers["x-lifeos-ingest-secret"],
    );

    if (
      !providedSecretValue ||
      !secureCompare(providedSecretValue, options.ingestSecret)
    ) {
      writeJson(response, 401, {
        error: "invalid_ingest_secret",
      });
      return;
    }

    if (!options.store) {
      writeJson(response, 503, {
        error: "database_not_configured",
      });
      return;
    }

    let payload;

    try {
      payload = parseHealthIngestPayload(await readJsonBody(request));
    } catch (error) {
      writeJson(response, 400, {
        error: "invalid_health_ingest_payload",
        message: error instanceof Error ? error.message : "Unknown error",
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

      if (providedSecret !== options.webhookSecret) {
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

    const update = (await readJsonBody(request)) as TelegramUpdate;

    await handleTelegramUpdate(update, {
      telegram: options.telegram,
      store: options.store,
      tmaUrl: options.tmaUrl,
      defaultUserId: options.defaultUserId,
      defaultTelegramUserId: options.defaultTelegramUserId,
    });

    writeJson(response, 200, {
      ok: true,
    });
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
      healthIngestConfigured: Boolean(options.config?.lifeosIngestSecret),
    },
    webhookPath: options.config?.telegramWebhookPath ?? "/telegram/webhook",
    webhookSecret: options.config?.telegramWebhookSecret,
    telegramBotToken: options.config?.telegramBotToken,
    ingestSecret: options.config?.lifeosIngestSecret,
    tmaUrl: options.config?.tmaUrl,
    defaultUserId: options.config?.lifeosDefaultUserId,
    defaultTelegramUserId: options.config?.lifeosDefaultTelegramUserId,
    allowUnsafeTmaDevAuth: options.config?.allowUnsafeTmaDevAuth ?? false,
    store: options.store,
    telegram: options.telegram,
  };

  return createServer((request: IncomingMessage, response: ServerResponse) => {
    void handleRequest(request, response, resolvedOptions).catch((error) => {
      writeJson(response, 500, {
        error: "internal_error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    });
  });
}
