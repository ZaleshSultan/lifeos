import type {
  LifeOSStore,
  ReminderRecord,
  UserOAuthConnection,
} from "@lifeos/db";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_BASE_URL = "https://www.googleapis.com/calendar/v3";
const WRITE_SCOPES = new Set([
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
]);

export interface GoogleCalendarSyncConfig {
  clientId?: string;
  clientSecret?: string;
}

export type GoogleCalendarSyncResult =
  | { status: "synced"; eventId: string; htmlLink?: string | null }
  | {
      status: "skipped";
      reason:
        | "not_connected"
        | "write_scope_missing"
        | "oauth_not_configured"
        | "missing_token";
    }
  | { status: "failed"; reason: string };

function jsonObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function googleMetadata(reminder: ReminderRecord): Record<string, unknown> {
  return jsonObject(jsonObject(reminder.metadataJson).google_calendar);
}

function hasWriteScope(connection: UserOAuthConnection): boolean {
  return connection.scopes.some((scope) => WRITE_SCOPES.has(scope));
}

function oauthConfigured(config: GoogleCalendarSyncConfig): boolean {
  return Boolean(config.clientId && config.clientSecret);
}

async function refreshConnection(
  store: LifeOSStore,
  connection: UserOAuthConnection,
  config: GoogleCalendarSyncConfig,
  fetcher: typeof fetch,
): Promise<UserOAuthConnection> {
  const expiresAt = connection.expiresAt
    ? new Date(connection.expiresAt).getTime()
    : Number.POSITIVE_INFINITY;
  if (
    connection.accessToken &&
    Number.isFinite(expiresAt) &&
    expiresAt > Date.now() + 60_000
  ) {
    return connection;
  }
  if (!connection.refreshToken || !oauthConfigured(config)) return connection;

  const response = await fetcher(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId!,
      client_secret: config.clientSecret!,
      refresh_token: connection.refreshToken,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    await store.upsertUserOAuthConnection(connection.userId, {
      provider: "google",
      status: response.status === 400 ? "expired" : "error",
      metadata: {
        ...jsonObject(connection.metadata),
        calendar_write_error: `token_refresh_${response.status}`,
      },
    });
    throw new Error(`google_token_refresh_${response.status}`);
  }
  const body = (await response.json()) as Record<string, unknown>;
  const accessToken =
    typeof body.access_token === "string" ? body.access_token : null;
  if (!accessToken) throw new Error("google_token_refresh_missing_access_token");
  const expiresIn =
    typeof body.expires_in === "number" ? body.expires_in : 3600;

  return store.upsertUserOAuthConnection(connection.userId, {
    provider: "google",
    accessToken,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    scopes:
      typeof body.scope === "string"
        ? body.scope.split(/\s+/).filter(Boolean)
        : connection.scopes,
    status: "connected",
    metadata: connection.metadata,
  });
}

async function usableConnection(
  store: LifeOSStore,
  userId: string,
  config: GoogleCalendarSyncConfig,
  fetcher: typeof fetch,
): Promise<
  | { ok: true; connection: UserOAuthConnection }
  | { ok: false; result: GoogleCalendarSyncResult }
> {
  const connection = await store.getUserOAuthConnection(userId, "google");
  if (!connection || connection.status !== "connected") {
    return { ok: false, result: { status: "skipped", reason: "not_connected" } };
  }
  if (!hasWriteScope(connection)) {
    return {
      ok: false,
      result: { status: "skipped", reason: "write_scope_missing" },
    };
  }
  if (!oauthConfigured(config) && !connection.accessToken) {
    return {
      ok: false,
      result: { status: "skipped", reason: "oauth_not_configured" },
    };
  }
  try {
    const refreshed = await refreshConnection(store, connection, config, fetcher);
    if (!refreshed.accessToken) {
      return {
        ok: false,
        result: { status: "skipped", reason: "missing_token" },
      };
    }
    return { ok: true, connection: refreshed };
  } catch (error) {
    return {
      ok: false,
      result: {
        status: "failed",
        reason: error instanceof Error ? error.message : "token_refresh_failed",
      },
    };
  }
}

function reminderEventBody(reminder: ReminderRecord, timezone: string) {
  const start = new Date(reminder.remindAt);
  const end = new Date(start.getTime() + 60 * 60_000);
  return {
    summary: reminder.message,
    description: "Создано LifeOS из напоминания Telegram.",
    start: { dateTime: start.toISOString(), timeZone: timezone },
    end: { dateTime: end.toISOString(), timeZone: timezone },
    extendedProperties: {
      private: {
        lifeos_reminder_id: reminder.id,
        lifeos_source: "reminder",
      },
    },
  };
}

async function writeCalendarEvent(
  connection: UserOAuthConnection,
  reminder: ReminderRecord,
  timezone: string,
  fetcher: typeof fetch,
): Promise<{ eventId: string; htmlLink?: string | null }> {
  const previous = googleMetadata(reminder);
  const previousEventId =
    typeof previous.event_id === "string" && previous.event_id
      ? previous.event_id
      : null;
  const endpoint = previousEventId
    ? `${CALENDAR_BASE_URL}/calendars/primary/events/${encodeURIComponent(previousEventId)}`
    : `${CALENDAR_BASE_URL}/calendars/primary/events`;
  const response = await fetcher(endpoint, {
    method: previousEventId ? "PATCH" : "POST",
    headers: {
      authorization: `Bearer ${connection.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(reminderEventBody(reminder, timezone)),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`google_calendar_event_${response.status}`);
  }
  const body = (await response.json()) as Record<string, unknown>;
  const eventId =
    typeof body.id === "string" && body.id ? body.id : previousEventId;
  if (!eventId) throw new Error("google_calendar_event_missing_id");
  return {
    eventId,
    htmlLink: typeof body.htmlLink === "string" ? body.htmlLink : null,
  };
}

export async function syncReminderToGoogleCalendar(input: {
  store: LifeOSStore;
  userId: string;
  reminder: ReminderRecord;
  timezone: string;
  config: GoogleCalendarSyncConfig;
  fetcher?: typeof fetch;
}): Promise<GoogleCalendarSyncResult> {
  const fetcher = input.fetcher ?? fetch;

  try {
    const usable = await usableConnection(
      input.store,
      input.userId,
      input.config,
      fetcher,
    );
    if (!usable.ok) return usable.result;

    const event = await writeCalendarEvent(
      usable.connection,
      input.reminder,
      input.timezone,
      fetcher,
    );
    const metadata = {
      ...jsonObject(input.reminder.metadataJson),
      google_calendar: {
        event_id: event.eventId,
        html_link: event.htmlLink ?? null,
        sync_status: "synced",
        synced_at: new Date().toISOString(),
      },
    };
    await input.store.updateReminderMetadata(
      input.userId,
      input.reminder.id,
      metadata,
    );
    return {
      status: "synced",
      eventId: event.eventId,
      htmlLink: event.htmlLink,
    };
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "calendar_sync_failed";

    // Calendar sync must stay best-effort: a provider or metadata failure must
    // never undo the LifeOS reminder that was already created.
    try {
      await input.store.updateReminderMetadata(input.userId, input.reminder.id, {
        ...jsonObject(input.reminder.metadataJson),
        google_calendar: {
          ...googleMetadata(input.reminder),
          sync_status: "failed",
          error: reason,
          synced_at: new Date().toISOString(),
        },
      });
    } catch {
      // Keep the original reminder usable even if provider status cannot be recorded.
    }

    return { status: "failed", reason };
  }
}

export async function cancelReminderGoogleCalendarEvent(input: {
  store: LifeOSStore;
  userId: string;
  reminder: ReminderRecord;
  config: GoogleCalendarSyncConfig;
  fetcher?: typeof fetch;
}): Promise<void> {
  const eventId = googleMetadata(input.reminder).event_id;
  if (typeof eventId !== "string" || !eventId) return;
  const fetcher = input.fetcher ?? fetch;
  const usable = await usableConnection(
    input.store,
    input.userId,
    input.config,
    fetcher,
  );
  if (!usable.ok) return;

  const response = await fetcher(
    `${CALENDAR_BASE_URL}/calendars/primary/events/${encodeURIComponent(eventId)}`,
    {
      method: "DELETE",
      headers: { authorization: `Bearer ${usable.connection.accessToken}` },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok && response.status !== 404 && response.status !== 410) {
    throw new Error(`google_calendar_delete_${response.status}`);
  }
}
