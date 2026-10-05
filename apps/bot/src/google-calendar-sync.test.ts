import type { LifeOSStore, ReminderRecord, UserOAuthConnection } from "@lifeos/db";
import { describe, expect, it, vi } from "vitest";
import { syncReminderToGoogleCalendar } from "./google-calendar-sync.js";

const reminder: ReminderRecord = {
  id: "reminder-1",
  userId: "user-1",
  lifeEntityId: null,
  sourceEventId: null,
  channel: "telegram",
  remindAt: "2026-10-06T14:00:00.000Z",
  status: "pending",
  message: "Пойти в кино",
  metadataJson: {},
  sentAt: null,
  createdAt: "2026-10-05T10:00:00.000Z",
  updatedAt: "2026-10-05T10:00:00.000Z",
};

const connection: UserOAuthConnection = {
  id: "oauth-1",
  userId: "user-1",
  provider: "google",
  providerAccountEmail: "person@example.com",
  accessToken: "access-token",
  refreshToken: "refresh-token",
  expiresAt: "2099-01-01T00:00:00.000Z",
  scopes: ["https://www.googleapis.com/auth/calendar.events"],
  status: "connected",
  metadata: {},
  createdAt: "2026-10-05T10:00:00.000Z",
  updatedAt: "2026-10-05T10:00:00.000Z",
};

describe("Google Calendar reminder sync", () => {
  it("creates a primary-calendar event and saves its id", async () => {
    const updateReminderMetadata = vi.fn(async (
      _userId: string,
      _id: string,
      metadataJson: ReminderRecord["metadataJson"],
    ) => ({
      ...reminder,
      metadataJson,
    }));
    const store = {
      getUserOAuthConnection: vi.fn(async () => connection),
      updateReminderMetadata,
    } as unknown as LifeOSStore;
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({ id: "event-1", htmlLink: "https://calendar.google.com/event" }),
        { status: 200 },
      ),
    );

    const result = await syncReminderToGoogleCalendar({
      store,
      userId: "user-1",
      reminder,
      timezone: "Asia/Almaty",
      config: {},
      fetcher: fetcher as typeof fetch,
    });

    expect(result).toMatchObject({ status: "synced", eventId: "event-1" });
    expect(fetcher).toHaveBeenCalledWith(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
      expect.objectContaining({ method: "POST" }),
    );
    expect(updateReminderMetadata).toHaveBeenCalledWith(
      "user-1",
      "reminder-1",
      expect.objectContaining({
        google_calendar: expect.objectContaining({ event_id: "event-1" }),
      }),
    );
  });

  it("asks old read-only connections to reconnect without calling Google", async () => {
    const store = {
      getUserOAuthConnection: vi.fn(async () => ({
        ...connection,
        scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
      })),
    } as unknown as LifeOSStore;
    const fetcher = vi.fn();

    await expect(
      syncReminderToGoogleCalendar({
        store,
        userId: "user-1",
        reminder,
        timezone: "Asia/Almaty",
        config: {},
        fetcher: fetcher as unknown as typeof fetch,
      }),
    ).resolves.toEqual({ status: "skipped", reason: "write_scope_missing" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
