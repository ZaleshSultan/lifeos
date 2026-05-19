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
  lifeosIngestSecret?: string;
  lifeosDefaultUserId?: string;
  lifeosDefaultTelegramUserId?: number;
  allowUnsafeTmaDevAuth: boolean;
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
  return {
    nodeEnv: optionalEnv(source, "NODE_ENV", "development") ?? "development",
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
    lifeosIngestSecret: optionalEnv(source, "LIFEOS_INGEST_SECRET"),
    lifeosDefaultUserId: optionalEnv(source, "LIFEOS_DEFAULT_USER_ID"),
    lifeosDefaultTelegramUserId: optionalEnv(
      source,
      "LIFEOS_DEFAULT_TELEGRAM_USER_ID",
    )
      ? integerEnv(source, "LIFEOS_DEFAULT_TELEGRAM_USER_ID", 0)
      : undefined,
    allowUnsafeTmaDevAuth: booleanEnv(
      source,
      "ALLOW_UNSAFE_TMA_DEV_AUTH",
      false,
    ),
  };
}
