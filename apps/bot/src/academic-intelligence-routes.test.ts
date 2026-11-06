import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AcademicIntelligenceStoreError, type LifeOSStore } from "@lifeos/db";
import { createBotServer } from "./server.js";
const servers: ReturnType<typeof createBotServer>[] = [];
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((s) => new Promise<void>((resolve) => s.close(() => resolve()))),
  );
});
function headers() {
  const p = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: 40, first_name: "Test" }),
  });
  const secret = createHmac("sha256", "WebAppData")
    .update("intelligence-test-token")
    .digest();
  p.set(
    "hash",
    createHmac("sha256", secret)
      .update(
        [...p]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${k}=${v}`)
          .join("\n"),
      )
      .digest("hex"),
  );
  return {
    "x-telegram-init-data": p.toString(),
    "content-type": "application/json",
  };
}
async function fixture(master = false, history = false) {
  const feed = vi.fn(async () => ({
    events: [],
    eligibleDeadlines: [],
    preferences: {
      revision: 0,
      academicRevision: 0,
      gradeAlertsEnabled: false,
    },
  }));
  const preferences = vi.fn(feed),
    reviewPolicy = vi.fn(feed);
  const store = {
    resolveTelegramUser: async () => ({
      userId: "owner",
      telegramUserId: 40,
      status: "active",
      role: "user",
      timezone: "UTC",
    }),
    academicIntelligence: { feed, preferences, reviewPolicy },
  } as unknown as LifeOSStore;
  const server = createBotServer({
    store,
    config: {
      telegramBotToken: "intelligence-test-token",
      academicNotificationsEnabled: master,
      academicGradeEventsEnabled: history,
    },
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/tma/study`,
    feed,
    preferences,
    reviewPolicy,
  };
}
const preferenceInput = {
  gradeAlertsEnabled: false,
  assignmentAlertsEnabled: false,
  quizAlertsEnabled: false,
  assignmentOffsetsMinutes: [4320, 1440],
  quizOffsetsMinutes: [4320, 1440, 180],
  quietStart: "22:00",
  quietEnd: "07:00",
};
describe("academic intelligence authenticated boundary", () => {
  it("authenticates first, uses the resolved owner and returns no-store history", async () => {
    const f = await fixture();
    expect((await fetch(`${f.url}/grade-events`)).status).toBe(401);
    expect(f.feed).not.toHaveBeenCalled();
    const r = await fetch(`${f.url}/grade-events`, { headers: headers() });
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(f.feed).toHaveBeenCalledWith("owner");
    expect(
      (
        await fetch(`${f.url}/grade-events?userId=other`, {
          headers: headers(),
        })
      ).status,
    ).toBe(400);
  });
  it("reports delivery active only when both deployment controls are enabled", async () => {
    for (const [master, history] of [
      [false, false],
      [true, false],
      [false, true],
      [true, true],
    ]) {
      const f = await fixture(master, history);
      const response = await fetch(`${f.url}/grade-events`, {
        headers: headers(),
      });
      expect((await response.json()).data.deliveryEnabled).toBe(
        master && history,
      );
    }
  });
  it("requires explicit confirmation and both preference revisions", async () => {
    const f = await fixture(),
      body = {
        expectedRevision: 0,
        expectedAcademicRevision: 0,
        preferences: preferenceInput,
      };
    expect(
      (
        await fetch(`${f.url}/academic-preferences`, {
          method: "PUT",
          headers: headers(),
          body: JSON.stringify(body),
        })
      ).status,
    ).toBe(400);
    expect(f.preferences).not.toHaveBeenCalled();
    expect(
      (
        await fetch(`${f.url}/academic-preferences`, {
          method: "PUT",
          headers: headers(),
          body: JSON.stringify({ ...body, confirmed: true }),
        })
      ).status,
    ).toBe(200);
    expect(f.preferences).toHaveBeenCalledWith("owner", body);
    expect(
      (
        await fetch(`${f.url}/academic-preferences`, {
          method: "PUT",
          headers: headers(),
          body: JSON.stringify({ ...body, confirmed: true, userId: "other" }),
        })
      ).status,
    ).toBe(400);
  });
  it("binds policy review to explicit enrollment, rules and exact context", async () => {
    const f = await fixture(),
      id = "f1000000-0000-4000-8000-000000000001";
    const body = {
      expectedRevision: 0,
      definitionKey: "definition",
      bindingsKey: "bindings",
      contextKey: "context",
      sourceRef: "Synthetic syllabus p2",
      confirmed: true,
      supportedRulesConfirmed: true,
    };
    expect(
      (
        await fetch(`${f.url}/grade-policy/${id}`, {
          method: "PUT",
          headers: headers(),
          body: JSON.stringify(body),
        })
      ).status,
    ).toBe(400);
    expect(f.reviewPolicy).not.toHaveBeenCalled();
    expect(
      (
        await fetch(`${f.url}/grade-policy/${id}`, {
          method: "PUT",
          headers: headers(),
          body: JSON.stringify({ ...body, currentEnrollmentConfirmed: true }),
        })
      ).status,
    ).toBe(200);
    expect(f.reviewPolicy).toHaveBeenCalledWith("owner", id, {
      expectedRevision: 0,
      definitionKey: "definition",
      bindingsKey: "bindings",
      contextKey: "context",
      sourceRef: "Synthetic syllabus p2",
    });
  });
  it("reports stale revisions safely without leaking persistence details", async () => {
    const f = await fixture();
    f.preferences.mockRejectedValue(
      new AcademicIntelligenceStoreError("academic_intelligence_conflict"),
    );
    const r = await fetch(`${f.url}/academic-preferences`, {
      method: "PUT",
      headers: headers(),
      body: JSON.stringify({
        expectedRevision: 0,
        expectedAcademicRevision: 0,
        preferences: preferenceInput,
        confirmed: true,
      }),
    });
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "academic_intelligence_conflict" });
  });
});
