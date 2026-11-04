import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ACADEMIC_PREFERENCES,
  type AcademicEventInput,
  type AcademicOverview,
  type AcademicSourceInput,
} from "@lifeos/core";
import { AcademicStoreError, type LifeOSStore } from "@lifeos/db";
import { createBotServer } from "./server.js";
import {
  academicImportPreview,
  parseAcademicImportConfirmation,
} from "./academic-concierge-routes.js";

const OWNER = "11111111-1111-4111-8111-111111111111";
const EVENT = "22222222-2222-4222-8222-222222222222";
const TOKEN = "academic-test-token";
const servers: ReturnType<typeof createBotServer>[] = [];
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
});
function headers() {
  const values = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: 301, first_name: "Synthetic academic owner" }),
  });
  const check = [...values]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(TOKEN).digest();
  values.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return {
    "content-type": "application/json",
    "x-telegram-init-data": values.toString(),
  };
}
function source(
  key: string,
  kind: AcademicSourceInput["kind"],
): AcademicSourceInput {
  return {
    key,
    kind,
    label: "Invented fixture document",
    sha256: "a".repeat(64),
    sourceUrl: null,
    page: 1,
    academicYear: "2026-2027",
    groupCode: "TEST-1",
    verifiedAt: "2026-11-04T00:00:00Z",
  };
}
function event(key: string, personal = false): AcademicEventInput {
  return {
    key,
    sourceKey: personal ? "personal-fixture" : "official-fixture",
    kind: personal ? "personal_exam" : "university_exam",
    title: personal
      ? "Invented personal examination"
      : "Invented algorithms examination",
    startsAt: "2026-11-10T09:00:00+05:00",
    endsAt: personal ? null : "2026-11-10T10:00:00+05:00",
    startsOn: null,
    endsOn: null,
    timezone: "Asia/Almaty",
    location: "Тестовая, 8",
    courseCode: null,
    sourceTypeCode: personal ? null : "exam",
    trimester: 1,
    periodType: null,
    status: personal ? "proposed" : "confirmed",
  };
}
function bundle() {
  return {
    sources: [
      source("official-fixture", "official_timetable"),
      source("personal-fixture", "owner_provided"),
    ],
    events: [event("academic-event"), event("personal-event", true)],
  };
}
function overview(): AcademicOverview {
  return {
    timezone: "Asia/Almaty",
    sources: [],
    events: [],
    classes: [],
    assignments: [],
    preferences: { ...DEFAULT_ACADEMIC_PREFERENCES },
    scheduleVerification: {
      revision: 0,
      validFrom: null,
      validThrough: null,
      sourceLabel: null,
      verifiedAt: null,
      current: false,
      changed: false,
    },
    lms: {
      configured: false,
      stale: true,
      lastSuccessfulSyncAt: null,
      state: "not_configured",
    },
    warnings: [],
    truncated: false,
  };
}
async function fixture(deliveryEnabled = false) {
  const academic = {
    overview: vi.fn(async () => overview()),
    importRecords: vi.fn(async () => ({
      created: 1,
      unchanged: 0,
      conflicts: [],
      overview: overview(),
    })),
    preferences: vi.fn(async () => overview()),
    reviseEvent: vi.fn(async () => overview()),
    verifySchedule: vi.fn(async () => overview()),
  };
  const resolveTelegramUser = vi.fn(async () => ({
    userId: OWNER,
    telegramUserId: 301,
    status: "active",
    role: "user",
    timezone: "Asia/Almaty",
  }));
  const store = {
    resolveTelegramUser,
    academicConcierge: academic,
  } as unknown as LifeOSStore;
  const server = createBotServer({
    store,
    config: {
      telegramBotToken: TOKEN,
      academicNotificationsEnabled: deliveryEnabled,
    },
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/tma/study/concierge`;
  const send = (
    path: string,
    method: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ) =>
    fetch(base + path, {
      method,
      headers: { ...headers(), ...extraHeaders },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { academic, base, send, resolveTelegramUser };
}

describe("academic concierge authenticated HTTP boundary", () => {
  it("authenticates before overview and returns no-store on rejected requests", async () => {
    const f = await fixture();
    const denied = await fetch(f.base);
    expect(denied.status).toBe(401);
    expect(denied.headers.get("cache-control")).toContain("no-store");
    expect(f.academic.overview).not.toHaveBeenCalled();
    const accepted = await f.send("", "GET");
    expect(accepted.status).toBe(200);
    expect(f.academic.overview).toHaveBeenCalledWith(OWNER);
    const data = (await accepted.json()).data;
    expect(data.deliveryEnabled).toBe(false);
    for (const key of [
      "classAlertsEnabled",
      "assignmentAlertsEnabled",
      "examAlertsEnabled",
      "personalAlertsEnabled",
      "staleWarningEnabled",
    ])
      expect(data.preferences[key]).toBe(false);
    expect(JSON.stringify(data)).not.toContain(OWNER);
  });
  it("reports scheduling capability independently of owner consent", async () => {
    const f = await fixture(true);
    const data = (await (await f.send("", "GET")).json()).data;
    expect(data.deliveryEnabled).toBe(true);
    expect(data.preferences.examAlertsEnabled).toBe(false);
    expect(f.academic.preferences).not.toHaveBeenCalled();
  });
  it("explicit invalid web credentials cannot fall back to otherwise valid Telegram auth", async () => {
    const f = await fixture();
    expect(
      (
        await f.send("", "GET", undefined, {
          authorization: "Bearer invalid-web-token",
        })
      ).status,
    ).toBe(401);
    expect(f.academic.overview).not.toHaveBeenCalled();
  });
  it("preview validates and canonicalizes without any persistence or delivery mutation", async () => {
    const f = await fixture();
    const response = await f.send("/import/preview", "POST", bundle());
    expect(response.status).toBe(200);
    const data = (await response.json()).data;
    expect(data.previewHash).toMatch(/^[a-f0-9]{64}$/);
    expect(
      data.events.find((e: AcademicEventInput) => e.kind === "personal_exam")
        .endsAt,
    ).toBeNull();
    expect(
      data.events.find((e: AcademicEventInput) => e.kind === "personal_exam")
        .status,
    ).toBe("proposed");
    expect(data.warnings).toContain(
      "academic_import_does_not_enable_notifications",
    );
    expect(f.academic.importRecords).not.toHaveBeenCalled();
    expect(f.academic.preferences).not.toHaveBeenCalled();
  });
  it("confirms exactly the selected keys and sources under the authenticated owner", async () => {
    const f = await fixture();
    const input = bundle(),
      p = academicImportPreview(input);
    const response = await f.send("/import/confirm", "POST", {
      ...input,
      selectedKeys: ["academic-event"],
      previewHash: p.previewHash,
      confirmed: true,
      requestId: "fixture-import-stable-1",
    });
    expect(response.status).toBe(200);
    const [owner, imported] = f.academic.importRecords.mock
      .calls[0] as unknown as [
      string,
      {
        requestId: string;
        sources: AcademicSourceInput[];
        events: AcademicEventInput[];
      },
    ];
    expect(owner).toBe(OWNER);
    expect(imported.requestId).toBe("fixture-import-stable-1");
    expect(imported.events.map((e) => e.key)).toEqual(["academic-event"]);
    expect(imported.sources.map((s) => s.key)).toEqual(["official-fixture"]);
    expect(f.academic.preferences).not.toHaveBeenCalled();
  });
  it.each([
    { confirmed: false },
    { selectedKeys: [] },
    { selectedKeys: ["missing-event"] },
    { selectedKeys: ["academic-event", "academic-event"] },
    { previewHash: "f".repeat(64) },
    { userId: "another-owner" },
    { requestId: "unsafe/path" },
  ])(
    "rejects malformed or unapproved import confirmation %# before persistence",
    async (override) => {
      const f = await fixture();
      const input = bundle(),
        p = academicImportPreview(input);
      const response = await f.send("/import/confirm", "POST", {
        ...input,
        selectedKeys: ["academic-event"],
        previewHash: p.previewHash,
        confirmed: true,
        requestId: "fixture-import-2",
        ...override,
      });
      expect(response.status).toBe(400);
      expect(f.academic.importRecords).not.toHaveBeenCalled();
    },
  );
  it("rejects edited preview data and nested ownership/notification instructions", () => {
    const input = bundle(),
      p = academicImportPreview(input);
    const confirm = {
      ...input,
      selectedKeys: ["academic-event"],
      previewHash: p.previewHash,
      confirmed: true,
      requestId: "fixture-import-3",
    };
    expect(() =>
      parseAcademicImportConfirmation({
        ...confirm,
        events: [
          { ...input.events[0], location: "Other room" },
          input.events[1],
        ],
      }),
    ).toThrow();
    expect(() =>
      academicImportPreview({
        ...input,
        events: [{ ...input.events[0], user_id: OWNER }],
      }),
    ).toThrow();
    expect(() =>
      academicImportPreview({
        ...input,
        sources: [{ ...input.sources[0], enableNotifications: true }],
      }),
    ).toThrow();
  });
  it("file status cannot implicitly confirm a personal examination", async () => {
    const f = await fixture(),
      input = bundle();
    input.events[1].status = "confirmed";
    expect((await f.send("/import/preview", "POST", input)).status).toBe(400);
    expect(f.academic.importRecords).not.toHaveBeenCalled();
  });
  it("requires separate explicit preference consent and compares the current revision", async () => {
    const f = await fixture();
    const input = {
      expectedRevision: 0,
      preferences: { ...DEFAULT_ACADEMIC_PREFERENCES, examAlertsEnabled: true },
      confirmed: false,
    };
    expect((await f.send("/preferences", "PUT", input)).status).toBe(400);
    expect(f.academic.preferences).not.toHaveBeenCalled();
    expect(
      (await f.send("/preferences", "PUT", { ...input, confirmed: true }))
        .status,
    ).toBe(200);
    expect(f.academic.preferences).toHaveBeenCalledWith(OWNER, {
      expectedRevision: 0,
      preferences: input.preferences,
    });
    f.academic.preferences.mockRejectedValueOnce(
      new AcademicStoreError("academic_conflict"),
    );
    expect(
      (await f.send("/preferences", "PUT", { ...input, confirmed: true }))
        .status,
    ).toBe(409);
  });
  it("separates event confirmation/cancellation from import and preference activation", async () => {
    const f = await fixture();
    expect(
      (
        await f.send(`/events/${EVENT}/confirm`, "POST", {
          expectedRevision: 2,
          confirmed: true,
        })
      ).status,
    ).toBe(200);
    expect(f.academic.reviseEvent).toHaveBeenCalledWith(OWNER, EVENT, {
      expectedRevision: 2,
      patch: { status: "confirmed" },
      confirmed: true,
    });
    expect(
      (
        await f.send(`/events/${EVENT}/cancel`, "POST", {
          expectedRevision: 3,
          confirmed: false,
        })
      ).status,
    ).toBe(400);
    expect(f.academic.preferences).not.toHaveBeenCalled();
    f.academic.reviseEvent.mockRejectedValueOnce(
      new AcademicStoreError("academic_not_found"),
    );
    const response = await f.send(`/events/${EVENT}`, "PATCH", {
      expectedRevision: 2,
      patch: { location: "Another fixture room" },
      confirmed: true,
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "academic_not_found" });
  });
  it("requires bounded, explicit verification for a weekly timetable", async () => {
    const f = await fixture();
    const input = {
      expectedRevision: 0,
      validFrom: "2026-11-01",
      validThrough: "2026-11-14",
      sourceLabel: "Owner reviewed fixture",
      confirmed: true,
    };
    expect((await f.send("/schedule/verify", "POST", input)).status).toBe(200);
    expect(f.academic.verifySchedule).toHaveBeenCalledWith(OWNER, input);
    expect(
      (
        await f.send("/schedule/verify", "POST", {
          ...input,
          validThrough: "2028-01-01",
        })
      ).status,
    ).toBe(400);
  });
  it("rejects queries, wrong methods and oversized imports without mutating", async () => {
    const f = await fixture();
    expect((await f.send("?user_id=other", "GET")).status).toBe(400);
    const method = await f.send("/import/preview", "GET");
    expect(method.status).toBe(405);
    expect(method.headers.get("allow")).toBe("POST");
    expect(
      (await f.send("/import/preview", "POST", { text: "x".repeat(262145) }))
        .status,
    ).toBe(413);
    expect(f.academic.importRecords).not.toHaveBeenCalled();
  });
  it("does not expose raw storage diagnostics", async () => {
    const f = await fixture();
    f.academic.overview.mockRejectedValueOnce(
      new Error("private storage credential and transcript"),
    );
    const response = await f.send("", "GET");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "academic_unavailable" });
  });
});
