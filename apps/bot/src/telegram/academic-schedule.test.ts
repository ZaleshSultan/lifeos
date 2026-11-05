import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ACADEMIC_PREFERENCES,
  type AcademicOverview,
} from "@lifeos/core";
import type {
  LifeOSStore,
  PlanningSnapshot,
  TelegramUserRecord,
} from "@lifeos/db";
import { handleTelegramUpdate } from "./commands.js";
import type {
  SendMessageInput,
  TelegramBotRuntime,
  TelegramUpdate,
} from "./types.js";

const owner: TelegramUserRecord = {
  userId: "00000000-0000-4000-8000-000000000091",
  telegramUserId: 91,
  displayName: "Synthetic owner",
  username: null,
  timezone: "America/New_York",
  role: "user",
  status: "active",
};
const assignmentId = "00000000-0000-4000-8000-000000000092";
// Schema-58 fixture key for this quoted UUID, fixed independently of the command.
const assignmentKey = "assignment:ef48a4fad2d6f58346c85afc7bf1fc6dabb38d78c36429ff7d2cdc83346e9cf6";
function overview(): AcademicOverview {
  return {
    timezone: "America/New_York",
    sources: [],
    preferences: { ...DEFAULT_ACADEMIC_PREFERENCES },
    scheduleVerification: {
      revision: 1,
      validFrom: "2030-03-01",
      validThrough: "2030-03-10",
      sourceLabel: "Synthetic timetable",
      verifiedAt: "2030-03-01T00:00:00Z",
      current: true,
      changed: false,
    },
    lms: {
      configured: true,
      stale: false,
      lastSuccessfulSyncAt: "2030-03-04T18:00:00Z",
      state: "connected",
    },
    events: [
      {
        id: "teaching",
        key: "teaching",
        sourceKey: "calendar",
        kind: "calendar_period",
        title: "Synthetic teaching",
        startsOn: "2030-03-01",
        endsOn: "2030-03-10",
        startsAt: null,
        endsAt: null,
        timezone: "Asia/Almaty",
        location: null,
        courseCode: null,
        sourceTypeCode: null,
        trimester: 1,
        periodType: "teaching",
        status: "confirmed",
        revision: 1,
        manuallyEdited: false,
        updatedAt: "2030-03-01T00:00:00Z",
      },
    ],
    classes: [
      {
        key: "class:a",
        title: "Synthetic today",
        startsAt: "2030-03-05T04:00:00Z",
        endsAt: "2030-03-05T05:00:00Z",
        location: null,
        courseCode: "SYN",
      },
      {
        key: "class:b",
        title: "Synthetic tomorrow <safe>",
        startsAt: "2030-03-06T05:00:00Z",
        endsAt: "2030-03-06T06:00:00Z",
        location: "Synthetic room",
        courseCode: "SYN",
      },
    ],
    assignments: [
      {
        key: assignmentKey,
        title: "Synthetic verified deadline",
        courseTitle: "Synthetic course",
        dueAt: "2030-03-06T05:00:00Z",
        sourceUrl: null,
        submissionState: "not_submitted",
        verified: true,
        stale: false,
      },
    ],
    warnings: [],
    truncated: false,
  };
}
function snapshot(): PlanningSnapshot {
  return {
    tasks: [],
    events: [],
    reminders: [],
    projects: [],
    courses: [],
    schedules: [],
    assessments: [],
    history: [],
    truncated: false,
    historyTruncated: false,
  };
}
function message(
  text: string,
  id = 91,
  chatId = id,
  type = "private",
): TelegramUpdate {
  return {
    update_id: 1,
    message: { message_id: 1, from: { id }, chat: { id: chatId, type }, text },
  };
}
function callback(
  data: string,
  id = 91,
  chatId = id,
  type = "private",
): TelegramUpdate {
  return {
    update_id: 2,
    callback_query: {
      id: "synthetic",
      from: { id },
      message: {
        message_id: 1,
        from: { id: 999, is_bot: true },
        chat: { id: chatId, type },
      },
      data,
    },
  };
}
function fixture() {
  const data = overview();
  const calendar = snapshot();
  const read = vi.fn(async () => data);
  const planning = vi.fn(async () => calendar);
  const deadlines = vi.fn(async () => ({
    upcoming: [
      {
        id: assignmentId,
        externalId: null,
        title: "Synthetic verified deadline",
        courseTitle: "Synthetic course",
        dueAt: "2030-03-06T05:00:00Z",
        status: "active",
        score: null as number | null,
        maxScore: null,
        percentage: null as number | null,
      },
    ],
    overdue: [],
  }));
  const resolve = vi.fn(async () => owner as TelegramUserRecord | null);
  const sent: SendMessageInput[] = [];
  const runtime: TelegramBotRuntime = {
    store: {
      resolveTelegramUser: resolve,
      academicConcierge: { overview: read },
      getPlanningSnapshot: planning,
      listUpcomingAssignmentDeadlines: deadlines,
    } as unknown as LifeOSStore,
    telegram: {
      sendMessage: vi.fn(async (input) => {
        sent.push(input);
      }),
      answerCallbackQuery: vi.fn(),
      getFileUrl: vi.fn(),
    },
    now: () => new Date("2030-03-04T19:30:00Z"),
  };
  return {
    data,
    calendar,
    read,
    planning,
    deadlines,
    resolve,
    sent,
    runtime,
    text: () => sent.map((item) => item.text).join("\n"),
  };
}
beforeEach(() =>
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Network prohibited in synthetic Telegram checks");
    }),
  ),
);
afterEach(() => vi.unstubAllGlobals());

describe("read-only Telegram academic shortcuts", () => {
  it("routes tomorrow by campus date despite the owner's different timezone and escapes source text", async () => {
    const f = fixture();
    await handleTelegramUpdate(message("/tomorrow"), f.runtime);
    expect(f.read).toHaveBeenCalledExactlyOnceWith(owner.userId);
    expect(f.text()).toContain("2030-03-06 · Asia/Almaty");
    expect(f.text()).toContain("10:00–11:00 — Synthetic tomorrow &lt;safe&gt;");
    expect(f.text()).not.toContain("Synthetic today");
    expect(f.planning).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("returns the next confirmed class without resynthesizing a weekly timetable", async () => {
    const f = fixture();
    await handleTelegramUpdate(message("/nextclass"), f.runtime);
    expect(f.text()).toContain("05.03 09:00–10:00 — Synthetic today");
    expect(f.text()).toContain("до 14 дней");
  });
  it("withholds unverified next classes and never falls back to legacy schedules", async () => {
    const f = fixture();
    f.data.scheduleVerification.changed = true;
    await handleTelegramUpdate(message("/nextclass"), f.runtime);
    expect(f.text()).toContain("не подтверждено или изменилось");
    expect(f.text()).not.toContain("Synthetic today");
  });
  it("subtracts saved calendar commitments and scheduled tasks after the final class using existing planner", async () => {
    const f = fixture();
    f.calendar.events.push({
      id: "meeting",
      title: "Private meeting",
      event_type: "calendar_event",
      starts_at: "2030-03-05T07:00:00Z",
      ends_at: "2030-03-05T08:00:00Z",
      due_at: null,
    });
    f.calendar.tasks.push({
      id: "task",
      title: "Private task",
      priority: 2,
      due_at: null,
      scheduled_for: "2030-03-05T09:00:00Z",
      domain: "personal",
      estimatedMinutes: 60,
    });
    await handleTelegramUpdate(message("/afterclasses"), f.runtime);
    expect(f.planning.mock.calls[0]).toEqual([
      owner.userId,
      expect.objectContaining({
        startsAt: "2030-03-04T19:00:00.000Z",
        endsAt: "2030-03-05T19:00:00.000Z",
      }),
    ]);
    expect(f.text()).toContain("10:00–12:00");
    expect(f.text()).toContain("13:00–14:00");
    expect(f.text()).toContain("15:00–21:00");
    expect(f.text()).not.toContain("Private meeting");
    expect(f.text()).toContain("не гарантия свободного времени");
  });
  it("supports an explicit tomorrow window without changing default day", async () => {
    const f = fixture();
    await handleTelegramUpdate(message("/afterclasses tomorrow"), f.runtime);
    expect(f.text()).toContain("2030-03-06");
    expect(f.text()).toContain("11:00–21:00");
  });
  it.each([
    "truncated_academic",
    "truncated_calendar",
    "unknown_task",
    "unknown_calendar_end",
    "unknown_exam_end",
  ])("does not promise free time for %s", async (reason) => {
    const f = fixture();
    if (reason === "truncated_academic") f.data.truncated = true;
    if (reason === "truncated_calendar") f.calendar.truncated = true;
    if (reason === "unknown_task")
      f.calendar.tasks.push({
        id: "task",
        title: "Unknown duration",
        priority: 2,
        due_at: null,
        scheduled_for: "2030-03-05T09:00:00Z",
        domain: "personal",
        estimatedMinutes: null,
      });
    if (reason === "unknown_calendar_end")
      f.calendar.events.push({
        id: "unknown",
        title: "Unknown end",
        event_type: "calendar_event",
        starts_at: "2030-03-05T07:00:00Z",
        ends_at: null,
        due_at: null,
      });
    if (reason === "unknown_exam_end")
      f.data.events.push({
        ...f.data.events[0]!,
        key: "personal",
        kind: "personal_exam",
        startsAt: "2030-03-05T07:00:00Z",
        endsAt: null,
      });
    await handleTelegramUpdate(message("/afterclasses"), f.runtime);
    expect(f.text()).toMatch(/не вычислен/);
    expect(f.text()).not.toContain("10:00–21:00");
  });
  it("does not turn missing verified classes into a whole free day", async () => {
    const f = fixture();
    f.data.classes = [];
    await handleTelegramUpdate(message("/afterclasses"), f.runtime);
    expect(f.text()).toContain("окна после пар не вычислены");
    expect(f.planning).not.toHaveBeenCalled();
  });
  it("provides verified deadlines as an option on the existing command", async () => {
    const f = fixture();
    f.data.assignments.push({
      ...f.data.assignments[0]!,
      key: "submitted",
      title: "Already submitted",
      submissionState: "submitted",
    });
    await handleTelegramUpdate(message("/deadlines verified"), f.runtime);
    expect(f.text()).toContain("Synthetic verified deadline");
    expect(f.text()).not.toContain("Already submitted");
    expect(f.text()).toContain("Последняя успешная синхронизация");
  });
  it("shows LMS staleness rather than claiming there are no deadlines", async () => {
    const f = fixture();
    f.data.lms.stale = true;
    await handleTelegramUpdate(message("/deadlines verified"), f.runtime);
    expect(f.text()).toContain("это не означает, что заданий нет");
    expect(f.text()).not.toContain("Synthetic verified deadline");
  });
  it.each(["inactive", "changed_due", "graded", "percentage_only"])(
    "withholds a fresh Concierge assignment when the active reader says %s",
    async (reason) => {
      const f = fixture();
      const current = await f.deadlines();
      if (reason === "inactive") current.upcoming = [];
      if (reason === "changed_due")
        current.upcoming[0]!.dueAt = "2030-03-07T05:00:00Z";
      if (reason === "graded") current.upcoming[0]!.score = 0;
      if (reason === "percentage_only") current.upcoming[0]!.percentage = 80;
      f.deadlines.mockResolvedValue(current);
      await handleTelegramUpdate(message("/deadlines verified"), f.runtime);
      expect(f.text()).not.toContain("Synthetic verified deadline");
      expect(f.text()).toContain("В текущей выборке нет");
    },
  );
  it.each([
    "academic:tomorrow",
    "academic:nextclass",
    "academic:afterclasses",
    "academic:deadlines",
  ])("routes owner button %s and acknowledges its callback", async (data) => {
    const f = fixture();
    await handleTelegramUpdate(callback(data), f.runtime);
    expect(f.resolve).toHaveBeenCalledExactlyOnceWith(91);
    expect(f.read).toHaveBeenCalledExactlyOnceWith(owner.userId);
    expect(f.runtime.telegram.answerCallbackQuery).toHaveBeenCalled();
  });
  it.each([
    message("/tomorrow", 91, -1, "group"),
    message("/tomorrow", 91, 92),
    callback("academic:tomorrow", 92, 91),
    callback("academic:tomorrow", 91, -1, "group"),
  ])(
    "does not read private academic data in a foreign or group chat",
    async (update) => {
      const f = fixture();
      await handleTelegramUpdate(update, f.runtime);
      expect(f.read).not.toHaveBeenCalled();
    },
  );
  it.each(["pending", "blocked"] as const)(
    "does not read records for a %s owner",
    async (status) => {
      const f = fixture();
      f.resolve.mockResolvedValue({ ...owner, status });
      await handleTelegramUpdate(message("/tomorrow"), f.runtime);
      expect(f.read).not.toHaveBeenCalled();
    },
  );
  it("does not return raw storage errors or create a misleading empty timetable", async () => {
    const f = fixture();
    f.read.mockRejectedValue(new Error("private database credential"));
    await handleTelegramUpdate(message("/tomorrow"), f.runtime);
    expect(f.text()).toContain("временно недоступны");
    expect(f.text()).not.toContain("private database credential");
  });
  it("bounds escaped output and retains incompleteness warning for long source titles", async () => {
    const f = fixture();
    f.data.truncated = true;
    f.data.classes = Array.from({ length: 25 }, (_, i) => ({
      ...f.data.classes[1]!,
      key: `class:${i}`,
      title: "<&😀".repeat(500),
    }));
    await handleTelegramUpdate(message("/tomorrow"), f.runtime);
    expect(f.text().length).toBeLessThan(4096);
    expect(f.text()).toContain("Выборка ограничена");
    expect(f.text()).not.toMatch(/<[^b/]/);
  });
});
