import type { TmaSessionState, TmaSessionStatus } from "../api/types";
import type { IntegrationDisplayStatus } from "../components/IntegrationStatusCard";

export interface IntegrationCardModel {
  title: string;
  status: IntegrationDisplayStatus;
  description: string;
  action?: "connect_google";
}

export function onboardingContentForState(state: TmaSessionState): {
  title: string;
  body: string;
  detail: string;
} {
  if (state === "unregistered") {
    return {
      title: "Добро пожаловать в LifeOS",
      body: "Нажми /start в Telegram, чтобы создать заявку.",
      detail: "Можно также создать заявку прямо здесь, если Telegram открыл Mini App с валидной сессией.",
    };
  }

  if (state === "pending") {
    return {
      title: "Заявка создана",
      body: "Ожидает подтверждения администратором.",
      detail: "После approve здесь появятся интеграции.",
    };
  }

  if (state === "blocked") {
    return {
      title: "Доступ заблокирован",
      body: "LifeOS сейчас недоступен для этого аккаунта.",
      detail: "Обратитесь к администратору, если это ошибка.",
    };
  }

  return {
    title: "LifeOS активен",
    body: "Аккаунт готов к работе.",
    detail: "Интеграции и следующий шаг показаны ниже.",
  };
}

export function obsidianDisplayStatus(
  obsidian: TmaSessionStatus["integrations"]["obsidian"],
): IntegrationDisplayStatus {
  if (obsidian.status === "error") {
    return "error";
  }

  if (
    obsidian.configured &&
    obsidian.enabled &&
    obsidian.status === "connected"
  ) {
    return "connected";
  }

  if (obsidian.configured && !obsidian.enabled) {
    return "disabled";
  }

  if (obsidian.configured) {
    return "disconnected";
  }

  return "not_configured";
}

export function integrationCardsForSession(
  session: TmaSessionStatus,
): IntegrationCardModel[] {
  const obsidianStatus = obsidianDisplayStatus(session.integrations.obsidian);
  const pendingSyncCount = session.integrations.obsidian.pendingSyncCount ?? 0;
  const google = session.integrations.google;
  const googleStatus: IntegrationDisplayStatus =
    google.status === "connected"
      ? "connected"
      : google.status === "error"
        ? "error"
        : google.status === "expired" || google.status === "revoked"
          ? "disconnected"
          : "not_configured";

  return [
    {
      title: "Telegram",
      status: session.integrations.telegram.connected
        ? "connected"
        : "disconnected",
      description: session.integrations.telegram.connected
        ? "Telegram account is linked to LifeOS."
        : "Open /start in Telegram to create a LifeOS request.",
    },
    {
      title: "Obsidian",
      status: obsidianStatus,
      description:
        obsidianStatus === "connected"
          ? pendingSyncCount
            ? `${pendingSyncCount} notes are waiting for mirror sync.`
            : "Per-user vault routing is connected."
          : obsidianStatus === "disabled"
            ? "Vault is configured, but Obsidian sync is disabled."
            : obsidianStatus === "error"
              ? "Admin should check the local mirror worker."
              : obsidianStatus === "disconnected"
                ? "Vault is configured, but the worker is not connected."
                : "Admin needs to set a vault and enable Obsidian.",
    },
    {
      title: "Google Calendar",
      status: googleStatus,
      description:
        googleStatus === "connected"
          ? google.accountEmail
            ? `Connected as ${google.accountEmail}.`
            : "Google OAuth is connected."
          : googleStatus === "error"
            ? "Google OAuth needs reconnecting."
            : googleStatus === "disconnected"
              ? "Google OAuth is disconnected or expired."
              : "Connect Google Calendar and Tasks for per-user sync.",
      action: googleStatus === "connected" ? undefined : "connect_google",
    },
    {
      title: "Health",
      status: "not_configured",
      description: "Health bridge status will appear after setup.",
    },
  ];
}
