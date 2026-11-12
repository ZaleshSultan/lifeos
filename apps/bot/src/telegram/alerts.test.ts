import { describe, expect, it, vi } from "vitest";
import { triggerFinanceAlerts } from "./alerts.js";
import type { TelegramClient } from "./types.js";
import type { LifeOSStore } from "@lifeos/db";

describe("Telegram push alerts integration", () => {
  it("does not log speech text or token-bearing diagnostics from downstream errors", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const store = { processFinanceAlerts: vi.fn().mockRejectedValue(new Error("PRIVATE VOICE https://api.telegram.org/botsecret-token")) } as unknown as LifeOSStore;
      await triggerFinanceAlerts(store, {} as TelegramClient, "owner", "2026-11-12");
      expect(logged).toHaveBeenCalledWith("[finance] failed to process push alerts", { errorType: "Error" });
      expect(JSON.stringify(logged.mock.calls)).not.toContain("PRIVATE VOICE");
      expect(JSON.stringify(logged.mock.calls)).not.toContain("secret-token");
    } finally { logged.mockRestore(); }
  });
  it("should send telegram message for each alert when telegram user ID is found", async () => {
    const sentMessages: any[] = [];
    const mockTelegram: TelegramClient = {
      sendMessage: async (input) => {
        sentMessages.push(input);
      },
      answerCallbackQuery: async () => {},
      getFileUrl: async () => "https://api.telegram.org/file/bot/test",
    };

    const mockStore = {
      processFinanceAlerts: vi
        .fn()
        .mockResolvedValue([
          "⚠️ Budget monthly budget is overspent by 500.00 KZT!",
          "⚠️ Category Food limit (1,000.00 KZT) exceeded. Spent: 1,200.00 KZT.",
        ]),
      getTelegramUserId: vi.fn().mockResolvedValue(123456789),
    } as unknown as LifeOSStore;

    await triggerFinanceAlerts(mockStore, mockTelegram, "user-1", "2026-06-09");

    expect(mockStore.processFinanceAlerts).toHaveBeenCalledWith(
      "user-1",
      "2026-06-09",
    );
    expect(mockStore.getTelegramUserId).toHaveBeenCalledWith("user-1");
    expect(sentMessages).toHaveLength(2);
    expect(sentMessages[0]).toEqual({
      chatId: 123456789,
      text: "⚠️ Budget monthly budget is overspent by 500.00 KZT!",
    });
    expect(sentMessages[1]).toEqual({
      chatId: 123456789,
      text: "⚠️ Category Food limit (1,000.00 KZT) exceeded. Spent: 1,200.00 KZT.",
    });
  });

  it("should not send telegram message if processFinanceAlerts returns no alerts", async () => {
    const sentMessages: any[] = [];
    const mockTelegram: TelegramClient = {
      sendMessage: async (input) => {
        sentMessages.push(input);
      },
      answerCallbackQuery: async () => {},
      getFileUrl: async () => "https://api.telegram.org/file/bot/test",
    };

    const mockStore = {
      processFinanceAlerts: vi.fn().mockResolvedValue([]),
      getTelegramUserId: vi.fn().mockResolvedValue(123456789),
    } as unknown as LifeOSStore;

    await triggerFinanceAlerts(mockStore, mockTelegram, "user-1", "2026-06-09");

    expect(mockStore.processFinanceAlerts).toHaveBeenCalledWith(
      "user-1",
      "2026-06-09",
    );
    expect(mockStore.getTelegramUserId).not.toHaveBeenCalled();
    expect(sentMessages).toHaveLength(0);
  });

  it("should not send telegram message if telegram user ID is not found", async () => {
    const sentMessages: any[] = [];
    const mockTelegram: TelegramClient = {
      sendMessage: async (input) => {
        sentMessages.push(input);
      },
      answerCallbackQuery: async () => {},
      getFileUrl: async () => "https://api.telegram.org/file/bot/test",
    };

    const mockStore = {
      processFinanceAlerts: vi.fn().mockResolvedValue(["⚠️ Budget overspent!"]),
      getTelegramUserId: vi.fn().mockResolvedValue(null),
    } as unknown as LifeOSStore;

    await triggerFinanceAlerts(mockStore, mockTelegram, "user-1", "2026-06-09");

    expect(mockStore.processFinanceAlerts).toHaveBeenCalledWith(
      "user-1",
      "2026-06-09",
    );
    expect(mockStore.getTelegramUserId).toHaveBeenCalledWith("user-1");
    expect(sentMessages).toHaveLength(0);
  });
});
