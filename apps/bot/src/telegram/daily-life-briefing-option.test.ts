import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LifeOSStore, TelegramUserRecord } from "@lifeos/db";
import type { TelegramBotRuntime, TelegramMessage } from "./types.js";

const mocks = vi.hoisted(() => ({ summary: vi.fn(), schedule: vi.fn() }));
vi.mock("../daily-life-routes.js", () => ({ dailyLifeSummary: mocks.summary }));
vi.mock("./academic-schedule.js", () => ({
  handleAcademicScheduleCommand: mocks.schedule,
}));
import { handleBriefingCommand } from "./daily-life.js";
import { handleTelegramUpdate } from "./commands.js";

const user: TelegramUserRecord = {
  userId: "00000000-0000-4000-8000-000000000081",
  telegramUserId: 81,
  displayName: "Synthetic briefing owner",
  username: null,
  timezone: "Asia/Almaty",
  role: "user",
  status: "active",
};
const message: TelegramMessage = {
  message_id: 1,
  from: { id: 81 },
  chat: { id: 81, type: "private" },
  text: "/briefing tomorrow",
};
function fixture() {
  const send = vi.fn().mockResolvedValue(undefined);
  const runtime: TelegramBotRuntime = {
    store: {} as LifeOSStore,
    telegram: {
      sendMessage: send,
      answerCallbackQuery: vi.fn(),
      getFileUrl: vi.fn(),
    },
    now: () => new Date("2030-03-05T04:00:00Z"),
  };
  return { runtime, send };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.summary.mockResolvedValue({
    date: "2030-03-05",
    sourceWarnings: [],
    morning: {
      title: "Утренний обзор",
      facts: ["Synthetic existing fact"],
      suggestions: [],
      warnings: [],
      questions: [],
    },
    evening: {
      title: "Вечерний обзор",
      facts: [],
      suggestions: [],
      warnings: [],
      questions: [],
    },
    documentary: { shots: [] },
  });
  mocks.schedule.mockResolvedValue(undefined);
});

describe("explicit next-day section for the on-demand morning briefing", () => {
  it("enables the extension through the actual /briefing tomorrow registry route", async () => {
    const { runtime } = fixture();
    runtime.store = {
      resolveTelegramUser: vi.fn(async () => user),
    } as unknown as LifeOSStore;
    await handleTelegramUpdate({ update_id: 1, message }, runtime);
    expect(mocks.summary).toHaveBeenCalledTimes(1);
    expect(mocks.schedule).toHaveBeenCalledExactlyOnceWith(
      "tomorrow",
      message,
      runtime,
      user,
    );
  });
  it("keeps the default reply identical and performs no schedule read", async () => {
    const { runtime, send } = fixture();
    await handleBriefingCommand("morning", message, runtime, user);
    const original = send.mock.calls[0][0];
    await handleBriefingCommand("morning", message, runtime, user, false);
    expect(send.mock.calls[1][0]).toEqual(original);
    expect(mocks.schedule).not.toHaveBeenCalled();
    expect(mocks.summary).toHaveBeenCalledWith(
      runtime.store,
      user,
      "2030-03-05",
      new Date("2030-03-05T04:00:00Z"),
    );
  });

  it("waits for the normal reply before reading the explicitly requested schedule", async () => {
    const { runtime, send } = fixture();
    let release!: () => void;
    send.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const pending = handleBriefingCommand(
      "morning",
      message,
      runtime,
      user,
      true,
    );
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0][0].text).toContain("Synthetic existing fact");
    expect(mocks.schedule).not.toHaveBeenCalled();
    release();
    await pending;
    expect(mocks.schedule).toHaveBeenCalledExactlyOnceWith(
      "tomorrow",
      message,
      runtime,
      user,
    );
  });

  it("preserves the sent briefing when the secondary reply fails and never retries it", async () => {
    const { runtime, send } = fixture();
    mocks.schedule.mockRejectedValueOnce(new Error("internal diagnostic"));
    await expect(
      handleBriefingCommand("morning", message, runtime, user, true),
    ).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].text).toContain("Synthetic existing fact");
    expect(send.mock.calls[0][0].text).not.toContain("internal diagnostic");
    expect(mocks.schedule).toHaveBeenCalledTimes(1);
  });

  it("does not send a schedule if the original reply was not acknowledged", async () => {
    const { runtime, send } = fixture();
    send.mockRejectedValueOnce(new Error("ambiguous original delivery"));
    await expect(
      handleBriefingCommand("morning", message, runtime, user, true),
    ).rejects.toThrow("ambiguous original delivery");
    expect(send).toHaveBeenCalledTimes(1);
    expect(mocks.schedule).not.toHaveBeenCalled();
  });

  it.each(["evening", "documentary"] as const)(
    "leaves %s independent from the morning option",
    async (kind) => {
      const { runtime, send } = fixture();
      await handleBriefingCommand(kind, message, runtime, user, true);
      expect(send).toHaveBeenCalledTimes(1);
      expect(mocks.schedule).not.toHaveBeenCalled();
    },
  );

  it.each([
    { chat: { id: 81, type: "group" } },
    { from: { id: 82 } },
    { chat: { id: 82, type: "private" }, from: { id: 82 } },
  ])("retains the private-owner boundary before all reads", async (patch) => {
    const { runtime, send } = fixture();
    await handleBriefingCommand(
      "morning",
      { ...message, ...patch },
      runtime,
      user,
      true,
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(mocks.summary).not.toHaveBeenCalled();
    expect(mocks.schedule).not.toHaveBeenCalled();
  });

  it("rejects an inactive profile before reading either briefing", async () => {
    const { runtime } = fixture();
    await handleBriefingCommand(
      "morning",
      message,
      runtime,
      { ...user, status: "blocked" },
      true,
    );
    expect(mocks.summary).not.toHaveBeenCalled();
    expect(mocks.schedule).not.toHaveBeenCalled();
  });

  it("keeps the existing no-store behavior without attempting an extension", async () => {
    const { runtime, send } = fixture();
    runtime.store = undefined;
    await handleBriefingCommand("morning", message, runtime, user, true);
    expect(send).not.toHaveBeenCalled();
    expect(mocks.summary).not.toHaveBeenCalled();
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
});
