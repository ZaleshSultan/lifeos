import { integerEnv, optionalEnv, type EnvSource } from "@lifeos/core";

export interface BotConfig {
  nodeEnv: string;
  host: string;
  port: number;
  telegramBotToken?: string;
  telegramWebhookPath: string;
  telegramWebhookSecret?: string;
  telegramWebAppUrl?: string;
  tmaUrl?: string;
  tmaStaticDir?: string;
  lifeosIngestSecret?: string;
  lifeosDefaultUserId?: string;
  lifeosDefaultTelegramUserId?: number;
  lifeosAdminTelegramIds: number[];
  lifeosSignupMode: "pending_approval";
  allowUnsafeTmaDevAuth: boolean;
  openRouterApiKey?: string;
  financeAiModel?: string;
  financeAiEnabled: boolean;
}

export function telegramIdListEnv(source: EnvSource, name: string): number[] {
  const value = optionalEnv(source, name);

  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const parsed = Number(item);

      if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new Error(`${name} must contain comma-separated Telegram ids`);
      }

      return parsed;
    });
}

function signupModeEnv(source: EnvSource): "pending_approval" {
  const value = optionalEnv(source, "LIFEOS_SIGNUP_MODE", "pending_approval");

  if (value !== "pending_approval") {
    throw new Error("LIFEOS_SIGNUP_MODE must be pending_approval");
  }

  return value;
}

function booleanEnv(
  source: EnvSource,
  name: string,
  fallback = false,
): boolean {
  const value = optionalEnv(source, name);

  if (value === undefined) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export function loadBotConfig(source: EnvSource = process.env): BotConfig {
  const nodeEnv =
    optionalEnv(source, "NODE_ENV", "development") ?? "development";
  const allowUnsafeTmaDevAuth = booleanEnv(
    source,
    "ALLOW_UNSAFE_TMA_DEV_AUTH",
    false,
  );

  if (nodeEnv.toLowerCase() === "production" && allowUnsafeTmaDevAuth) {
    throw new Error(
      "ALLOW_UNSAFE_TMA_DEV_AUTH cannot be enabled when NODE_ENV=production",
    );
  }

  return {
    nodeEnv,
    host: optionalEnv(source, "HOST", "0.0.0.0") ?? "0.0.0.0",
    port: integerEnv(source, "PORT", 3000),
    telegramBotToken: optionalEnv(source, "TELEGRAM_BOT_TOKEN"),
    telegramWebhookPath:
      optionalEnv(source, "TELEGRAM_WEBHOOK_PATH", "/telegram/webhook") ??
      "/telegram/webhook",
    telegramWebhookSecret: optionalEnv(source, "TELEGRAM_WEBHOOK_SECRET"),
    telegramWebAppUrl: optionalEnv(source, "TELEGRAM_WEBAPP_URL"),
    tmaUrl:
      optionalEnv(source, "TMA_URL") ??
      optionalEnv(source, "TMA_APP_URL") ??
      optionalEnv(source, "TELEGRAM_WEBAPP_URL"),
    tmaStaticDir: optionalEnv(source, "TMA_STATIC_DIR"),
    lifeosIngestSecret:
      optionalEnv(source, "LIFEOS_INGEST_SECRET") ??
      optionalEnv(source, "HEALTH_INGEST_SECRET"),
    lifeosDefaultUserId: optionalEnv(source, "LIFEOS_DEFAULT_USER_ID"),
    lifeosDefaultTelegramUserId: optionalEnv(
      source,
      "LIFEOS_DEFAULT_TELEGRAM_USER_ID",
    )
      ? integerEnv(source, "LIFEOS_DEFAULT_TELEGRAM_USER_ID", 0)
      : undefined,
    lifeosAdminTelegramIds: telegramIdListEnv(
      source,
      "LIFEOS_ADMIN_TELEGRAM_IDS",
    ),
    lifeosSignupMode: signupModeEnv(source),
    allowUnsafeTmaDevAuth,
    openRouterApiKey: optionalEnv(source, "OPENROUTER_API_KEY"),
    financeAiModel: optionalEnv(source, "FINANCE_AI_MODEL"),
    financeAiEnabled: booleanEnv(source, "FINANCE_AI_ENABLED", false),
  };
}
