import type { IncomingMessage } from "node:http";

export function isProduction(nodeEnv?: string): boolean {
  return [nodeEnv, process.env.NODE_ENV].some(
    (value) => value?.trim().toLowerCase() === "production",
  );
}

// Telegram's setWebhook secret_token contract; never normalize a credential.
export function validWebhookSecret(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,256}$/.test(value);
}

export function validateBotSecurity(config: {
  nodeEnv?: string;
  telegramWebhookSecret?: string;
  allowUnsafeTmaDevAuth?: boolean;
}): void {
  const production = isProduction(config.nodeEnv);
  if (production && config.allowUnsafeTmaDevAuth) {
    throw new Error(
      "ALLOW_UNSAFE_TMA_DEV_AUTH cannot be enabled in production",
    );
  }
  if (
    config.telegramWebhookSecret !== undefined &&
    !validWebhookSecret(config.telegramWebhookSecret)
  ) {
    throw new Error(
      "TELEGRAM_WEBHOOK_SECRET must use 1-256 letters, digits, hyphens or underscores",
    );
  }
  if (production && !config.telegramWebhookSecret) {
    throw new Error("TELEGRAM_WEBHOOK_SECRET is required in production");
  }
}

export function webhookSecretHeader(
  request: IncomingMessage,
): string | undefined {
  const name = "x-telegram-bot-api-secret-token";
  // Reject duplicate headers even if Node or an intermediary joined their values.
  let count = 0;
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index].toLowerCase() === name) count++;
  }
  const value = request.headers[name];
  return count === 1 && validWebhookSecret(value) ? value : undefined;
}
