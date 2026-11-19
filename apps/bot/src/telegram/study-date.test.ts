import { describe, expect, it, vi } from "vitest";
import type { LifeOSStore, TelegramUserRecord } from "@lifeos/db";
import { handleTelegramUpdate } from "./commands.js";
import type { TelegramBotRuntime } from "./types.js";

const user: TelegramUserRecord = {
  userId: "owner-study",
  telegramUserId: 42,
  displayName: null,
  username: null,
  timezone: "Asia/Almaty",
  status: "active",
  role: "user",
};

function fixture() {
  const getTmaStudySummary = vi.fn().mockResolvedValue({
    courses: [
      {
        title: "DBMS & security",
        schedules: [
          {
            dayOfWeek: "friday",
            startTime: "09:00:00",
            endTime: "10:00:00",
            sessionType: "lecture",
            room: "A-1",
          },
          {
            dayOfWeek: "thursday",
            startTime: "11:00:00",
            endTime: "12:00:00",
            sessionType: "lab",
            room: "B-2",
          },
        ],
      },
    ],
  });
  const sendMessage = vi.fn().mockResolvedValue(undefined);
  const runtime: TelegramBotRuntime = {
    telegram: {
      sendMessage,
      answerCallbackQuery: vi.fn(),
      getFileUrl: vi.fn(),
    },
    store: {
      resolveTelegramUser: vi.fn().mockResolvedValue(user),
      getTmaStudySummary,
    } as unknown as LifeOSStore,
    now: () => new Date("2026-11-12T12:00:00Z"),
  };
  const update = (text: string) => ({
    update_id: 1,
    message: {
      message_id: 2,
      from: { id: 42 },
      chat: { id: 42, type: "private" },
      text,
    },
  });
  return { runtime, update, sendMessage, getTmaStudySummary };
}

describe("dated Telegram study schedule", () => {
  it("returns existing owner-scoped timetable entries for the requested weekday", async () => {
    const f = fixture();
    await handleTelegramUpdate(
      f.update("/study schedule 2026-11-13"),
      f.runtime,
    );
    expect(f.getTmaStudySummary).toHaveBeenCalledExactlyOnceWith(
      "owner-study",
      "Asia/Almaty",
    );
    const reply = f.sendMessage.mock.calls[0]?.[0];
    expect(reply.text).toContain("13.11.2026");
    expect(reply.text).toContain("09:00–10:00");
    expect(reply.text).toContain("DBMS &amp; security");
    expect(reply.text).toContain("A-1");
    expect(reply.text).not.toContain("B-2");
  });

  it("rejects invalid dates before a timetable query", async () => {
    const f = fixture();
    await handleTelegramUpdate(
      f.update("/study schedule 2026-02-30"),
      f.runtime,
    );
    expect(f.getTmaStudySummary).not.toHaveBeenCalled();
    expect(f.sendMessage.mock.calls[0]?.[0].text).toContain("корректную дату");
  });

  it("keeps the active profile requirement", async () => {
    const f = fixture();
    vi.mocked(f.runtime.store!.resolveTelegramUser).mockResolvedValue({
      ...user,
      status: "blocked",
    });
    await handleTelegramUpdate(
      f.update("/study schedule 2026-11-13"),
      f.runtime,
    );
    expect(f.getTmaStudySummary).not.toHaveBeenCalled();
    expect(f.sendMessage.mock.calls[0]?.[0].text).toContain("blocked");
  });

  it("sends schedule rows in the native table and preserves the map button", async () => {
    const f = fixture();
    const sendTable = vi.fn().mockResolvedValue(undefined);
    f.runtime.telegram.sendTable = sendTable;
    await handleTelegramUpdate(
      f.update("/study schedule 2026-11-13"),
      f.runtime,
    );
    expect(sendTable).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining("требует подтверждения"),
        rows: [["09:00–10:00", "DBMS & security", "лекция", "A-1"]],
        replyMarkup: {
          inline_keyboard: [
            [expect.objectContaining({ url: expect.any(String) })],
          ],
        },
      }),
    );
  });

  it("serves saved grades only to the owner in private and keeps the grades link", async () => {
    const f = fixture();
    f.runtime.tmaUrl = "https://example.org/tma";
    const sendTable = vi.fn().mockResolvedValue(undefined);
    f.runtime.telegram.sendTable = sendTable;
    const row = {
      userId: user.userId,
      courseTitle: "Networks",
      title: "Lab",
      score: 0,
      maxScore: 10,
      percentage: null,
    };
    const list = vi
      .fn()
      .mockResolvedValue([
        row,
        { ...row, userId: "foreign" },
        { ...row, rawJson: { _is_mocked: true } },
        { ...row, rawJson: { _grade_visibility_unknown: true } },
        {
          ...row,
          rawJson: {
            assessment_id: 1,
            course_id: 1,
            score: null,
            max_score: null,
          },
        },
      ]);
    f.runtime.store!.listAcademicRecords = list;
    const group = f.update("/study grades");
    group.message.chat = { id: -1000, type: "group" };
    await handleTelegramUpdate(group, f.runtime);
    expect(list).not.toHaveBeenCalled();
    await handleTelegramUpdate(f.update("/study grades"), f.runtime);
    expect(list).toHaveBeenCalledWith(user.userId);
    expect(sendTable).toHaveBeenCalledWith(
      expect.objectContaining({
        rows: [["Networks", "Lab", "0/10"]],
        replyMarkup: {
          inline_keyboard: [
            [
              expect.objectContaining({
                web_app: {
                  url: "https://example.org/tma?screen=study&studyTab=grades",
                },
              }),
            ],
          ],
        },
      }),
    );
  });

  it("routes existing deadlines to an inline table", async () => {
    const f = fixture();
    const sendTable = vi.fn().mockResolvedValue(undefined);
    f.runtime.telegram.sendTable = sendTable;
    f.runtime.store!.listUpcomingAssignmentDeadlines = vi
      .fn()
      .mockResolvedValue({
        upcoming: [
          {
            courseTitle: "Networks",
            title: "Lab",
            dueAt: "2026-11-13T05:00:00Z",
            score: null,
          },
        ],
        overdue: [],
      });
    await handleTelegramUpdate(f.update("/deadlines"), f.runtime);
    expect(sendTable.mock.calls[0]?.[0].rows[0]).toEqual([
      "Networks",
      "Lab",
      "13.11.2026 10:00",
      expect.any(String),
      "ещё не оценено",
    ]);
  });
});
