import { describe, expect, it } from "vitest";
import type { TmaSessionStatus } from "../api/types";
import {
  integrationCardsForSession,
  onboardingContentForState,
  obsidianDisplayStatus,
} from "../lib/session-status";

function activeSession(
  obsidian: Partial<TmaSessionStatus["integrations"]["obsidian"]> = {},
): TmaSessionStatus {
  return {
    state: "active",
    telegramUserId: 123,
    displayName: "Test",
    username: "test",
    profile: {
      status: "active",
      role: "user",
    },
    integrations: {
      telegram: {
        connected: true,
      },
      obsidian: {
        connected: false,
        enabled: false,
        configured: false,
        status: null,
        mode: null,
        ...obsidian,
      },
      google: {
        connected: false,
        status: "not_configured",
      },
      health: {
        connected: false,
        status: "not_configured",
      },
    },
  };
}

describe("TMA onboarding status content", () => {
  it("describes the pending state", () => {
    expect(onboardingContentForState("pending")).toMatchObject({
      title: "Заявка создана",
      body: "Ожидает подтверждения администратором.",
    });
  });

  it("describes the blocked state without technical detail", () => {
    const content = onboardingContentForState("blocked");

    expect(content.title).toBe("Доступ заблокирован");
    expect(content.body).not.toContain("Supabase");
    expect(content.body).not.toContain("profile");
  });

  it("builds active integration cards", () => {
    const cards = integrationCardsForSession(
      activeSession({
        enabled: true,
        configured: true,
        status: "connected",
        mode: "local_vault",
      }),
    );

    expect(cards.map((card) => card.title)).toEqual([
      "Telegram",
      "Obsidian",
      "Google Calendar",
      "Health",
    ]);
    expect(cards.find((card) => card.title === "Obsidian")?.status).toBe(
      "connected",
    );
    expect(cards.find((card) => card.title === "Google Calendar")).toMatchObject(
      {
        status: "not_configured",
        action: "connect_google",
      },
    );
  });

  it("shows connected Google account email without a connect action", () => {
    const cards = integrationCardsForSession({
      ...activeSession(),
      integrations: {
        ...activeSession().integrations,
        google: {
          connected: true,
          status: "connected",
          accountEmail: "person@example.com",
          updatedAt: "2026-06-15T10:10:00.000Z",
        },
      },
    });

    const google = cards.find((card) => card.title === "Google Calendar");

    expect(google).toMatchObject({
      status: "connected",
      description: "Connected as person@example.com.",
    });
    expect(google?.action).toBeUndefined();
  });

  it("maps Obsidian states for integration cards", () => {
    expect(
      obsidianDisplayStatus({
        connected: false,
        enabled: true,
        configured: true,
        status: "connected",
        mode: "local_vault",
      }),
    ).toBe("connected");

    expect(
      obsidianDisplayStatus({
        connected: false,
        enabled: false,
        configured: true,
        status: "disconnected",
        mode: "local_vault",
      }),
    ).toBe("disabled");

    expect(
      obsidianDisplayStatus({
        connected: false,
        enabled: true,
        configured: true,
        status: "error",
        mode: "local_vault",
      }),
    ).toBe("error");

    expect(
      obsidianDisplayStatus({
        connected: false,
        enabled: false,
        configured: false,
        status: null,
        mode: null,
      }),
    ).toBe("not_configured");
  });
});
