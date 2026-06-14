import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
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
      | "lifeosDefaultUserId"
      | "lifeosDefaultTelegramUserId"
      | "lifeosAdminTelegramIds"
      | "lifeosSignupMode"
      | "allowUnsafeTmaDevAuth"
      | "openRouterApiKey"
      | "financeAiModel"
      | "financeAiEnabled"
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
  tmaStaticDir?: string;
  defaultUserId?: string;
  defaultTelegramUserId?: number;
  adminTelegramUserIds: number[];
  signupMode: "pending_approval";
  allowUnsafeTmaDevAuth: boolean;
  openRouterApiKey?: string;
  financeAiModel?: string;
  financeAiEnabled: boolean;
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
      "content-type,x-telegram-init-data,x-lifeos-health-secret,x-lifeos-ingest-secret,x-telegram-bot-api-secret-token",
  });
  response.end(JSON.stringify(body));
}

function writeNoContent(response: ServerResponse): void {
  response.writeHead(204, {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers":
      "content-type,x-telegram-init-data,x-lifeos-health-secret,x-lifeos-ingest-secret,x-telegram-bot-api-secret-token",
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
  const body = await readFile(filePath);
  const extension = extname(filePath).toLowerCase();
  const headers: Record<string, string | number> = {
    "content-type": TMA_MIME_TYPES[extension] ?? "application/octet-stream",
    "content-length": body.byteLength,
  };

  if (extension === ".html") {
    headers["cache-control"] = "no-cache";
  } else if (immutable) {
    headers["cache-control"] = "public, max-age=31536000, immutable";
  }

  response.writeHead(200, headers);
  response.end(request.method === "HEAD" ? undefined : body);
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

  if (options.allowUnsafeTmaDevAuth && options.defaultUserId) {
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
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.SUPABASE_SERVICE_KEY,
  ].filter((value): value is string => Boolean(value));
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

  if (
    !periodStart ||
    Number.isNaN(new Date(`${periodStart}T00:00:00.000Z`).getTime())
  ) {
    return { ok: false, error: "invalid_budget_period_start" };
  }

  return {
    ok: true,
    name,
    amount,
    period,
    periodStart,
    periodEnd,
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

  return {
    ok: true,
    name,
    amount,
    periodEnd,
    categoryLimits,
  };
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
  const fileName =
    typeof record.fileName === "string"
      ? record.fileName.trim()
      : "receipt.jpg";
  const mimeType =
    typeof record.mimeType === "string" ? record.mimeType.trim() : "image/jpeg";
  const imageBase64 =
    typeof record.imageBase64 === "string"
      ? record.imageBase64.trim()
      : typeof record.dataUrl === "string"
        ? record.dataUrl.replace(/^data:[^;]+;base64,/, "").trim()
        : "";

  if (!imageBase64) {
    return { ok: false, error: "invalid_receipt_image" };
  }

  return { ok: true, fileName, mimeType, imageBase64 };
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
        response.writeHead(200, {
          "content-type": mimeType,
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
          "access-control-allow-headers":
            "content-type,x-telegram-init-data,x-lifeos-health-secret,x-lifeos-ingest-secret,x-telegram-bot-api-secret-token",
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
      const body = parseTmaReceiptUploadBody(await readJsonBody(request));

      if (!body.ok) {
        writeJson(response, 400, { error: body.error });
        return;
      }

      const receipt = await store.processReceiptImage({
        userId: auth.user.userId,
        fileName: body.fileName,
        mimeType: body.mimeType,
        bytes: Buffer.from(body.imageBase64, "base64"),
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

      await store.updateBudget({
        userId: auth.user.userId,
        budgetId,
        name: body.name,
        amount: body.amount,
        periodEnd: body.periodEnd,
        categoryLimits: body.categoryLimits,
      });

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
    if (!options.ingestSecret) {
      writeJson(response, 503, {
        error: "health_ingest_not_configured",
      });
      return;
    }

    const providedSecretValue =
      headerValue(request.headers["x-lifeos-health-secret"]) ??
      headerValue(request.headers["x-lifeos-ingest-secret"]);

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

    let body;

    try {
      body = await readJsonBody(request);
    } catch (error) {
      writeJson(response, 400, {
        error: "invalid_health_ingest_payload",
        message: error instanceof Error ? error.message : "Unknown error",
      });
      return;
    }

    if (
      typeof body === "object" &&
      body !== null &&
      !Array.isArray(body) &&
      Array.isArray((body as Record<string, unknown>).metrics)
    ) {
      let payload;

      try {
        payload = parseHealthMetricsIngestPayload(body, options.defaultUserId);
      } catch (error) {
        writeJson(response, 400, {
          error: "invalid_health_metrics_payload",
          message: error instanceof Error ? error.message : "Unknown error",
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
      payload = parseHealthIngestPayload(body);
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
      healthIngestConfigured: Boolean(options.config?.lifeosIngestSecret),
    },
    webhookPath: options.config?.telegramWebhookPath ?? "/telegram/webhook",
    webhookSecret: options.config?.telegramWebhookSecret,
    telegramBotToken: options.config?.telegramBotToken,
    ingestSecret: options.config?.lifeosIngestSecret,
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
