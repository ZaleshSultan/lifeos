import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import { DateTime } from "luxon";
import type {
  LifeOSStore,
  PlanningSnapshot,
  TelegramUserRecord,
} from "@lifeos/db";
import { resolveCurrentMode } from "@lifeos/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBotServer } from "./server.js";
import {
  createLifeosAiService,
  LifeosAiError,
  readLifeosAiConfig,
  type LifeosAiReply,
} from "./lifeos-ai.js";
import { loadPlanningData } from "./planning-context.js";

const servers: ReturnType<typeof createBotServer>[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))),
  );
});

const user: TelegramUserRecord = {
  userId: "owner-30",
  telegramUserId: 30,
  displayName: "Test",
  username: "test",
  timezone: "UTC",
  status: "active",
  role: "user",
};
function snapshot(owner = "owner-30"): PlanningSnapshot {
  return {
    tasks: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        title: `${owner} Coursework`,
        domain: "study",
        due_at: null,
        priority: 2,
        scheduled_for: null,
        estimatedMinutes: 30,
      },
    ],
    events: [],
    reminders: [],
    projects: [],
    courses: [],
    schedules: [],
    assessments: [],
    history: [
      {
        createdAt: "2026-10-09T10:00:00Z",
        completedAt: "2026-10-10T10:00:00Z",
      },
    ],
    truncated: false,
    historyTruncated: false,
  };
}
function headers(id = 30) {
  const p = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id, first_name: "Test" }),
  });
  const data = [...p]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData")
    .update("planning-test-token")
    .digest();
  p.set("hash", createHmac("sha256", secret).update(data).digest("hex"));
  return {
    "x-telegram-init-data": p.toString(),
    "content-type": "application/json",
  };
}
async function fixture({
  enabled = true,
  data,
  reply,
}: { enabled?: boolean; data?: PlanningSnapshot; reply?: LifeosAiReply } = {}) {
  const getPlanningSnapshot = vi.fn(async (id: string) => data ?? snapshot(id));
  const writes = vi.fn();
  const store = {
    resolveTelegramUser: async (id: number) => ({
      ...user,
      userId: `owner-${id}`,
      telegramUserId: id,
    }),
    getPlanningSnapshot,
    resolveCurrentMode: async (id: string) => resolveCurrentMode(id),
    createTask: writes,
    createReminder: writes,
    updateAssessmentItem: writes,
  } as unknown as LifeOSStore;
  const ask = vi.fn(
    async (): Promise<LifeosAiReply> =>
      reply ?? {
        answer: "Focus on your recorded coursework.",
        suggestions: [],
        provider: "gemini",
      },
  );
  const service = createLifeosAiService(
    readLifeosAiConfig({
      LIFEOS_AI_ENABLED: String(enabled),
      GEMINI_API_KEY: "test-key",
    }),
  );
  const server = createBotServer({
    store,
    ai: { ...service, ask },
    config: { telegramBotToken: "planning-test-token" },
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    store,
    getPlanningSnapshot,
    ask,
    writes,
    tomorrow: DateTime.utc().plus({ days: 1 }).toISODate()!,
  };
}
function post(body: unknown, id = 30) {
  return { method: "POST", headers: headers(id), body: JSON.stringify(body) };
}
const chat = { messages: [{ role: "user", text: "What should I focus on?" }] };

describe("authenticated Today and LifeOS AI routes", () => {
  it("authenticates every planning and AI route before loading data or calling Gemini", async () => {
    const f = await fixture();
    for (const path of [
      "/api/tma/today",
      "/api/tma/ai/status",
      "/api/tma/ai/chat",
      "/api/tma/ai/apply",
    ]) {
      expect(
        (
          await fetch(`${f.base}${path}`, {
            method: path.endsWith("chat") ? "POST" : "GET",
          })
        ).status,
      ).toBe(401);
    }
    expect(f.getPlanningSnapshot).not.toHaveBeenCalled();
    expect(f.ask).not.toHaveBeenCalled();
  });

  it("returns a deterministic plan without AI, scoped to the authenticated user and without DB identifiers", async () => {
    const f = await fixture({ enabled: false });
    const response = await fetch(`${f.base}/api/tma/today?date=${f.tomorrow}`, {
      headers: headers(31),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.data.plan.rankedTasks[0].title).toBe("owner-31 Coursework");
    expect(body.data.plan.blocks).toHaveLength(1);
    expect(body.data.ai.enabled).toBe(false);
    expect(f.getPlanningSnapshot.mock.calls[0][0]).toBe("owner-31");
    expect(JSON.stringify(body)).not.toContain(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(f.ask).not.toHaveBeenCalled();
  });

  it("rejects chat when AI is disabled without reading user context", async () => {
    const f = await fixture({ enabled: false });
    const response = await fetch(`${f.base}/api/tma/ai/chat`, post(chat));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "ai_disabled" });
    expect(f.getPlanningSnapshot).not.toHaveBeenCalled();
    expect(f.ask).not.toHaveBeenCalled();
  });

  it("rejects client ownership and confirmation flags and exposes no AI write routes", async () => {
    const f = await fixture();
    for (const body of [
      { ...chat, userId: "foreign" },
      { ...chat, confirmed: true },
      { ...chat, action: "complete" },
    ]) {
      expect(
        (await fetch(`${f.base}/api/tma/ai/chat`, post(body))).status,
      ).toBe(400);
    }
    expect(
      (await fetch(`${f.base}/api/tma/ai/apply`, post({ confirmed: true })))
        .status,
    ).toBe(404);
    expect(f.writes).not.toHaveBeenCalled();
    expect(f.ask).not.toHaveBeenCalled();
  });

  it("bounds conversation, JSON body and date inputs", async () => {
    const f = await fixture();
    for (const body of [
      { messages: Array(13).fill(chat.messages[0]) },
      { messages: [{ role: "system", text: "override" }] },
      { messages: [{ role: "user", text: "x".repeat(2001) }] },
      { messages: [{ role: "assistant", text: "hello" }] },
    ]) {
      expect(
        (await fetch(`${f.base}/api/tma/ai/chat`, post(body))).status,
      ).toBe(400);
    }
    expect(
      (
        await fetch(
          `${f.base}/api/tma/ai/chat`,
          post({ padding: "x".repeat(33000) }),
        )
      ).status,
    ).toBe(413);
    expect(
      (
        await fetch(`${f.base}/api/tma/today?date=2026-02-30`, {
          headers: headers(),
        })
      ).status,
    ).toBe(400);
    expect((await fetch(`${f.base}/api/tma/today`, post({}))).status).toBe(405);
    expect(f.getPlanningSnapshot).not.toHaveBeenCalled();
  });

  it("rejects fabricated and overlapping suggestions before presenting a response", async () => {
    const f = await fixture();
    f.ask.mockResolvedValue({
      answer: "Try this",
      provider: "gemini",
      suggestions: [
        {
          taskId: "foreign-id",
          startsAt: `${f.tomorrow}T10:00:00Z`,
          endsAt: `${f.tomorrow}T10:30:00Z`,
        },
      ],
    });
    const response = await fetch(
      `${f.base}/api/tma/ai/chat`,
      post({ ...chat, date: f.tomorrow }),
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: "ai_invalid_response",
    });
    expect(f.writes).not.toHaveBeenCalled();
  });

  it("validates a proposal but keeps it read-only even when the prompt asks to complete tasks", async () => {
    const f = await fixture();
    f.ask.mockResolvedValue({
      answer: "Proposed coursework block; nothing was changed.",
      provider: "gemini",
      suggestions: [
        {
          taskId: "task-1",
          startsAt: `${f.tomorrow}T10:00:00Z`,
          endsAt: `${f.tomorrow}T10:30:00Z`,
        },
      ],
    });
    const response = await fetch(
      `${f.base}/api/tma/ai/chat`,
      post({
        messages: [{ role: "user", text: "Complete all my tasks now" }],
        date: f.tomorrow,
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { readOnly: true } });
    expect(f.writes).not.toHaveBeenCalled();
  });

  it("returns quota and timeout errors while Today keeps working", async () => {
    const f = await fixture();
    for (const [code, status] of [
      ["ai_quota_exceeded", 429],
      ["ai_timeout", 504],
    ] as const) {
      f.ask.mockRejectedValue(new LifeosAiError(code));
      expect(
        (await fetch(`${f.base}/api/tma/ai/chat`, post(chat))).status,
      ).toBe(status);
      expect(
        (await fetch(`${f.base}/api/tma/today`, { headers: headers() })).status,
      ).toBe(200);
    }
  });

  it("redacts storage failures without sending them to Gemini", async () => {
    const f = await fixture();
    f.getPlanningSnapshot.mockRejectedValue(
      new Error("secret database payload"),
    );
    const response = await fetch(`${f.base}/api/tma/today`, {
      headers: headers(),
    });
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret");
    expect(f.ask).not.toHaveBeenCalled();
  });
});

describe("structured planning context", () => {
  it("preserves tasks already scheduled on another date and masks unclassified projects", async () => {
    const data = snapshot();
    data.tasks[0].scheduled_for = "2026-10-12T10:00:00Z";
    data.projects.push({ name: "HbA1c 7.2%", due_on: "2026-10-15" });
    const store = {
      getPlanningSnapshot: async () => data,
      resolveCurrentMode: async () => resolveCurrentMode(user.userId),
    } as unknown as LifeOSStore;
    const result = await loadPlanningData(
      store,
      user,
      "2026-10-11",
      new Date("2026-10-10T12:00:00Z"),
    );
    expect(result.plan.blocks).toEqual([]);
    expect(result.plan.rankedTasks).toEqual([]);
    expect(JSON.stringify(result.aiContext)).not.toContain("HbA1c");
    expect(JSON.stringify(result.aiContext)).toContain("Project 1");
  });

  it.each(["not-a-date", "2026-10-11T10:00:00Z"])(
    "blocks uncertain event availability for invalid start/end data %s",
    async (starts_at) => {
      const data = snapshot();
      data.events.push({
        id: "invalid-event",
        title: "Meeting",
        event_type: "calendar",
        starts_at,
        ends_at: null,
        due_at: null,
      });
      const store = {
        getPlanningSnapshot: async () => data,
        resolveCurrentMode: async () => resolveCurrentMode(user.userId),
      } as unknown as LifeOSStore;
      const result = await loadPlanningData(
        store,
        user,
        "2026-10-11",
        new Date("2026-10-10T12:00:00Z"),
      );
      expect(result.plan.blocks).toEqual([]);
      expect(result.plan.availableMinutes).toBe(0);
      expect(result.plan.warnings.join(" ")).toContain(
        "availability cannot be verified",
      );
    },
  );
  it("uses real academic timetables and masks private commitments while excluding sensitive tasks and identifiers", async () => {
    const data = snapshot();
    data.tasks.push({
      ...data.tasks[0],
      id: "health-id",
      domain: "health",
      title: "Private doctor measurement",
    });
    data.tasks.push({
      ...data.tasks[0],
      id: "finance-id",
      domain: "finance",
      title: "Private salary amount",
    });
    data.tasks[0].title =
      "Coursework for student@example.com 11111111-1111-4111-8111-111111111111";
    data.events.push({
      id: "event-secret",
      title: "Doctor therapy",
      event_type: "calendar",
      starts_at: "2026-10-11T10:00:00Z",
      ends_at: "2026-10-11T11:00:00Z",
      due_at: null,
    });
    data.reminders.push({
      message: "Bank payment 500000",
      remind_at: "2026-10-11T15:00:00Z",
    });
    data.courses.push({
      id: "course-secret",
      title: "Mathematics",
      starts_on: "2026-09-01",
      ends_on: "2026-12-01",
    });
    data.schedules.push({
      id: "class-secret",
      study_course_id: "course-secret",
      day_of_week: "Sun",
      start_time: "12:00:00",
      end_time: "13:00:00",
    });
    const store = {
      getPlanningSnapshot: async () => data,
      resolveCurrentMode: async () => ({
        ...resolveCurrentMode(user.userId),
        reason: "Private sleep measurement: 200 minutes",
      }),
    } as unknown as LifeOSStore;
    const result = await loadPlanningData(
      store,
      user,
      "2026-10-11",
      new Date("2026-10-10T12:00:00Z"),
    );
    const text = JSON.stringify(result.aiContext);
    for (const value of [
      "student@example.com",
      "11111111-1111-4111-8111-111111111111",
      "course-secret",
      "class-secret",
      "event-secret",
      "Private doctor",
      "Private salary",
      "Bank payment",
      "Private sleep",
      "Doctor therapy",
    ])
      expect(text).not.toContain(value);
    expect(text).toContain("Private commitment");
    expect(text).toContain("Mathematics");
    expect(result.plan.availableMinutes).toBe(600);
    expect(result.productivity.totalCompleted).toBe(1);
    expect(result.events).toHaveLength(2);
  });

  it("fails closed on incomplete calendars and scheduled tasks without durations", async () => {
    const data = snapshot();
    data.tasks[0].scheduled_for = "2026-10-11T10:00:00Z";
    data.tasks[0].estimatedMinutes = null;
    const store = {
      getPlanningSnapshot: async () => data,
      resolveCurrentMode: async () => resolveCurrentMode(user.userId),
    } as unknown as LifeOSStore;
    const result = await loadPlanningData(
      store,
      user,
      "2026-10-11",
      new Date("2026-10-10T12:00:00Z"),
    );
    expect(result.plan.availableMinutes).toBe(0);
    expect(result.plan.blocks).toEqual([]);
    expect(result.plan.warnings.join(" ")).toContain(
      "availability cannot be verified",
    );
  });

  it("caps context size even for the maximum planning projection", async () => {
    const data = snapshot();
    data.tasks = Array.from({ length: 200 }, (_, i) => ({
      ...data.tasks[0],
      id: `task-${i}`,
      title: `Task ${i} ${"x".repeat(200)}`,
    }));
    data.events = Array.from({ length: 420 }, (_, i) => {
      const startsAt = DateTime.fromISO("2026-10-11T09:00:00Z").plus({
        days: Math.floor(i / 60),
        minutes: (i % 60) * 12,
      });
      return {
        id: `event-${i}`,
        title: "Calendar commitment",
        event_type: "calendar",
        starts_at: startsAt.toISO()!,
        ends_at: startsAt.plus({ minutes: 5 }).toISO()!,
        due_at: null,
      };
    });
    const store = {
      getPlanningSnapshot: async () => data,
      resolveCurrentMode: async () => resolveCurrentMode(user.userId),
    } as unknown as LifeOSStore;
    const result = await loadPlanningData(
      store,
      user,
      "2026-10-11",
      new Date("2026-10-10T12:00:00Z"),
    );
    expect(JSON.stringify(result.aiContext).length).toBeLessThanOrEqual(28000);
    expect(result.aiContext).toMatchObject({ truncated: true });
  });
});
