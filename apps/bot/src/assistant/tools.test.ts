import { describe, expect, it, vi } from "vitest";
import { resolveCurrentMode, type AssistantToolCall } from "@lifeos/core";
import type {
  LifeOSStore,
  PlanningSnapshot,
  TelegramUserRecord,
} from "@lifeos/db";
import {
  AssistantToolRegistry,
  type AssistantExecutionContext,
} from "./registry.js";
import {
  assistantMutation,
  executeMemoryOrWriteTool,
  executeProductivityTool,
  mutationSummary,
} from "./tools.js";

const user: TelegramUserRecord = {
  userId: "11111111-1111-4111-8111-111111111111",
  telegramUserId: 123,
  displayName: "Test",
  username: null,
  timezone: "UTC",
  status: "active",
  role: "user",
};
const context: AssistantExecutionContext = {
  user,
  source: "telegram",
  requestId: "update-123",
  now: new Date("2026-10-11T08:00:00Z"),
  origin: "deterministic",
  allowDestructive: false,
};
function snapshot(): PlanningSnapshot {
  return {
    tasks: [],
    events: [
      {
        id: "private-calendar-id",
        title: "Research meeting",
        event_type: "calendar",
        starts_at: "2026-10-11T10:00:00Z",
        ends_at: "2026-10-11T11:00:00Z",
        due_at: null,
      },
    ],
    reminders: [],
    projects: [],
    courses: [
      {
        id: "private-course-id",
        title: "Algorithms",
        starts_on: "2026-09-01",
        ends_on: "2026-12-01",
      },
    ],
    schedules: [
      {
        id: "private-class-id",
        study_course_id: "private-course-id",
        day_of_week: "sunday",
        start_time: "12:00:00",
        end_time: "13:00:00",
      },
    ],
    assessments: [],
    history: [],
    truncated: false,
    historyTruncated: false,
  };
}
function fixture(data: PlanningSnapshot = snapshot()) {
  const getPlanningSnapshot = vi.fn().mockResolvedValue(data);
  const listUpcomingReminders = vi.fn().mockResolvedValue([
    {
      id: "private-reminder-id",
      userId: user.userId,
      message: "Submit report",
      remindAt: "2026-10-11T16:00:00Z",
    },
  ]);
  const assistant = {
    listMemories: vi.fn().mockResolvedValue([]),
    executeMutation: vi.fn().mockResolvedValue({
      actionId: "private-action-id",
      resourceId: "private-resource-id",
      status: "succeeded",
      replayed: false,
    }),
    recordRead: vi.fn(),
    listGradeChanges: vi.fn(),
  };
  const store = {
    getPlanningSnapshot,
    listUpcomingReminders,
    assistant,
    resolveCurrentMode: vi.fn(async () => resolveCurrentMode(user.userId)),
  } as unknown as LifeOSStore;
  return { store, getPlanningSnapshot, listUpcomingReminders, assistant };
}
const call = (
  tool: AssistantToolCall["tool"],
  args: Record<string, unknown> = {},
): AssistantToolCall => ({ tool, args });
describe("assistant productivity tools", () => {
  it("lists scheduled active tasks alongside unscheduled tasks without internal IDs", async () => {
    const data = snapshot();
    data.tasks.push({
      id: "private-scheduled-task",
      title: "Scheduled coursework",
      priority: 2,
      domain: "study",
      scheduled_for: "2026-10-11T15:00:00Z",
      estimatedMinutes: 45,
      due_at: null,
    });
    const f = fixture(data);
    const result = await executeProductivityTool(f.store, context, {
      tool: "productivity.tasks",
      args: {},
    });
    expect(result.text).toContain("Scheduled coursework");
    expect(result.text).toContain("2026-10-11 15:00");
    expect(result.text).not.toContain("private-scheduled-task");
  });

  it("bounds large valid reminder results to the display schema", async () => {
    const f = fixture();
    f.listUpcomingReminders.mockResolvedValue(
      Array.from({ length: 50 }, (_, index) => ({
        id: `private-reminder-${index}`,
        message: `Reminder ${index} ${"x".repeat(400)}`,
        remindAt: "2026-10-11T16:00:00Z",
      })),
    );
    const registry = new AssistantToolRegistry().register(
      "productivity.reminders",
      (ctx, input) => executeProductivityTool(f.store, ctx, input),
    );
    const output = await registry.execute(
      context,
      call("productivity.reminders", { limit: 50 }),
    );
    expect(output.text.length).toBeLessThanOrEqual(14000);
    expect(output.text).toContain("Results are limited");
  });
  it("calendar lists scoped known events and classes without internal identifiers", async () => {
    const f = fixture();
    const result = await executeProductivityTool(
      f.store,
      context,
      call("productivity.calendar", { date: "2026-10-11" }),
    );
    expect(f.getPlanningSnapshot.mock.calls[0][0]).toBe(user.userId);
    expect(result.text).toContain("2026-10-11 10:00");
    expect(result.text).toContain("Research meeting");
    expect(result.text).toContain("Algorithms");
    expect(JSON.stringify(result)).not.toMatch(/private-.*-id|11111111-1111/);
    expect(f.assistant.executeMutation).not.toHaveBeenCalled();
  });
  it("finds windows around known calendar, class and scheduled task commitments", async () => {
    const data = snapshot();
    data.tasks.push({
      id: "private-task-id",
      title: "Scheduled work",
      domain: "work",
      priority: 2,
      due_at: null,
      scheduled_for: "2026-10-11T14:00:00Z",
      estimatedMinutes: 30,
    });
    const f = fixture(data);
    const result = await executeProductivityTool(
      f.store,
      context,
      call("productivity.availability", {
        date: "2026-10-11",
        durationMinutes: 60,
        startTime: "09:00",
        endTime: "16:00",
      }),
    );
    for (const window of [
      "2026-10-11 09:00–2026-10-11 10:00",
      "2026-10-11 11:00–2026-10-11 12:00",
      "2026-10-11 13:00–2026-10-11 14:00",
      "2026-10-11 14:30–2026-10-11 16:00",
    ])
      expect(result.text).toContain(window);
    expect(result.text).not.toContain("09:00–2026-10-11 16:00");
    expect(result.text).not.toContain("private-task-id");
  });
  it("does not offer past time or extend beyond the user's requested window", async () => {
    const f = fixture();
    const result = await executeProductivityTool(
      f.store,
      { ...context, now: new Date("2026-10-11T13:15:00Z") },
      call("productivity.availability", {
        date: "2026-10-11",
        durationMinutes: 30,
        startTime: "09:00",
        endTime: "15:00",
      }),
    );
    expect(result.text).toContain("2026-10-11 13:15–2026-10-11 15:00");
    expect(result.text).not.toContain("2026-10-11 09:00");
    expect(result.text).not.toContain("2026-10-11 21:00");
  });
  it.each([
    "truncated",
    "missing_event_end",
    "invalid_class_time",
    "scheduled_task_unknown_duration",
  ])("offers no verified windows with %s", async (condition) => {
    const data = snapshot();
    if (condition === "truncated") data.truncated = true;
    if (condition === "missing_event_end") data.events[0].ends_at = null;
    if (condition === "invalid_class_time")
      data.schedules[0].end_time = "11:00:00";
    if (condition === "scheduled_task_unknown_duration")
      data.tasks.push({
        id: "private-task-id",
        title: "Known work",
        domain: "work",
        priority: 2,
        due_at: null,
        scheduled_for: "2026-10-11T14:00:00Z",
        estimatedMinutes: null,
      });
    const f = fixture(data);
    const result = await executeProductivityTool(
      f.store,
      context,
      call("productivity.availability", {
        date: "2026-10-11",
        durationMinutes: 30,
      }),
    );
    expect(result.text).toContain("No verified slot");
    expect(result.text).not.toContain("2026-10-11 09:00–");
  });
  it("lists reminders through the user's scoped store and never exposes record IDs", async () => {
    const f = fixture();
    const result = await executeProductivityTool(
      f.store,
      context,
      call("productivity.reminders", { limit: 7 }),
    );
    expect(f.listUpcomingReminders).toHaveBeenCalledWith(user.userId, 7);
    expect(result.text).toContain("Submit report");
    expect(result.text).not.toContain("private-reminder-id");
    expect(result.text).not.toContain(user.userId);
  });
  it("registry rejects invalid duration, window or identity fields before loading data", async () => {
    const f = fixture();
    const registry = new AssistantToolRegistry().register(
      "productivity.availability",
      (ctx, input) => executeProductivityTool(f.store, ctx, input),
    );
    for (const args of [
      { date: "2026-10-11", durationMinutes: 0 },
      { date: "2026-10-11", durationMinutes: 721 },
      { date: "2026-10-11", durationMinutes: 30.5 },
      { date: "2026-10-11", durationMinutes: 30, startTime: "25:00" },
      { date: "2026-10-11", durationMinutes: 30, userId: "other" },
    ])
      await expect(
        registry.execute(context, call("productivity.availability", args)),
      ).rejects.toMatchObject({ code: "assistant_invalid_request" });
    expect(f.getPlanningSnapshot).not.toHaveBeenCalled();
  });
});

describe("assistant memory tool boundary", () => {
  it("supports reviewing archived memories with visible archive status", async () => {
    const f = fixture();
    f.assistant.listMemories.mockResolvedValue([
      {
        id: "private-memory-id",
        userId: user.userId,
        key: "old.preference",
        category: "preference",
        content: "Older preference",
        createdAt: "2026-10-10T08:00:00Z",
        updatedAt: "2026-10-10T09:00:00Z",
        archivedAt: "2026-10-11T09:00:00Z",
      },
    ]);
    const output = await executeMemoryOrWriteTool(
      f.store,
      context,
      call("memory.list", { includeArchived: true }),
    );
    expect(f.assistant.listMemories).toHaveBeenCalledWith(user.userId, {
      limit: 20,
      includeArchived: true,
    });
    expect(output.text).toContain("archived / архив");
    expect(output.text).not.toContain("private-memory-id");
  });
  it("scopes memory list and search to the authenticated owner and strips storage identifiers", async () => {
    const f = fixture();
    f.assistant.listMemories.mockResolvedValue([
      {
        id: "private-memory-id",
        userId: user.userId,
        key: "reply.style",
        category: "preference",
        content: "Use short answers",
        createdAt: "2026-10-10T08:00:00Z",
        updatedAt: "2026-10-10T09:00:00Z",
        archivedAt: null,
      },
    ]);
    const result = await executeMemoryOrWriteTool(
      f.store,
      context,
      call("memory.search", { query: "short", limit: 5 }),
    );
    expect(f.assistant.listMemories).toHaveBeenCalledWith(user.userId, {
      query: "short",
      limit: 5,
    });
    expect(result.text).toContain(
      "[reply.style] (preference) Use short answers",
    );
    expect(JSON.stringify(result)).not.toContain("private-memory-id");
    expect(JSON.stringify(result)).not.toContain(user.userId);
    expect(result.sources[0].updatedAt).toBe("2026-10-10T09:00:00.000Z");
  });
  it("fails closed if a memory adapter accidentally returns another user's row", async () => {
    const f = fixture();
    f.assistant.listMemories.mockResolvedValue([
      {
        id: "private-other-id",
        userId: "other-user",
        key: "private",
        category: "fact",
        content: "Other user's memory",
        createdAt: "2026-10-10T08:00:00Z",
        updatedAt: "2026-10-10T08:00:00Z",
        archivedAt: null,
      },
    ]);
    await expect(
      executeMemoryOrWriteTool(f.store, context, call("memory.list")),
    ).rejects.toMatchObject({ code: "assistant_permission_denied" });
  });
  it("mutation summaries contain only validated action fields and timestamps", () => {
    const memory = call("memory.remember", {
      category: "preference",
      key: "reply.style",
      content: "Use short answers",
    });
    const reminder = call("reminders.create", {
      title: "Submit report",
      remindAt: "2026-10-12T10:00:00.000Z",
    });
    expect(mutationSummary(memory, user.timezone)).toContain(
      "[reply.style]: Use short answers",
    );
    expect(mutationSummary(reminder, user.timezone)).toContain(
      "2026-10-12 10:00 (UTC) — Submit report",
    );
    expect(
      mutationSummary(
        call("memory.delete", { key: "reply.style" }),
        user.timezone,
      ),
    ).toContain("Permanently delete");
    expect(assistantMutation(memory)).toEqual({
      type: "memory.remember",
      memoryKey: "reply.style",
      category: "preference",
      content: "Use short answers",
    });
    expect(
      JSON.stringify([
        mutationSummary(memory, user.timezone),
        mutationSummary(reminder, user.timezone),
      ]),
    ).not.toContain(user.userId);
  });
  it("passes persistent idempotency keys and omits action/resource identifiers from responses", async () => {
    const f = fixture();
    const memory = call("memory.archive", { key: "reply.style" });
    const result = await executeMemoryOrWriteTool(f.store, context, memory);
    expect(f.assistant.executeMutation).toHaveBeenCalledWith({
      userId: user.userId,
      source: "telegram",
      idempotencyKey: "telegram:update-123",
      action: { type: "memory.archive", memoryKey: "reply.style" },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /private-(?:action|resource)-id|11111111-1111/,
    );
  });
  it("returns an explicit replay acknowledgement from the persistent receipt", async () => {
    const f = fixture();
    f.assistant.executeMutation.mockResolvedValueOnce({
      actionId: "private-action-id",
      resourceId: "private-resource-id",
      status: "succeeded",
      replayed: true,
    });
    const result = await executeMemoryOrWriteTool(
      f.store,
      context,
      call("memory.remember", {
        key: "reply.style",
        category: "preference",
        content: "Use short answers",
      }),
    );
    expect(result.text).toContain("already completed");
    expect(result.text).not.toContain("private-resource-id");
  });
  it("rejects unavailable memory persistence", async () => {
    const f = fixture();
    await expect(
      executeMemoryOrWriteTool(
        { ...f.store, assistant: undefined },
        context,
        call("memory.list"),
      ),
    ).rejects.toMatchObject({ code: "assistant_unavailable" });
  });
});
