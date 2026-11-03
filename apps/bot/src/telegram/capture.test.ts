import { describe, expect, it, vi } from "vitest";
import { CaptureInputError } from "@lifeos/core";
import type { LifeOSStore } from "@lifeos/db";
import {
  CaptureTelegramIngestError,
  CaptureTelegramRequestError,
  handleCaptureTelegramUpdate,
  type CaptureTelegramPort,
  type CaptureTelegramResult,
} from "./capture.js";
import type {
  SendMessageInput,
  TelegramBotRuntime,
  TelegramMessage,
  TelegramUpdate,
} from "./types.js";

const captureId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const now = new Date("2026-11-03T18:00:00Z");
function fixture() {
  const result: CaptureTelegramResult = {
    id: captureId,
    state: "needs_review",
    duplicate: false,
  };
  const port: CaptureTelegramPort = {
    ingestText: vi.fn(async () => result),
    ingestVoice: vi.fn(async () => ({
      ...result,
      state: "awaiting_transcript" as const,
    })),
    setTranscript: vi.fn(async () => result),
  };
  const sendMessage = vi.fn(async (_input: SendMessageInput) => {});
  const resolveTelegramUser = vi.fn(async () => ({
    userId: "resolved-owner",
    telegramUserId: 30,
    status: "active",
  }));
  const runtime: TelegramBotRuntime = {
    capture: port,
    now: () => now,
    tmaUrl: "https://lifeos.example.invalid/tma/",
    store: { resolveTelegramUser } as unknown as LifeOSStore,
    telegram: {
      sendMessage,
      answerCallbackQuery: vi.fn(async () => {}),
      getFileUrl: vi.fn(async () => "never"),
      downloadVoice: vi.fn(async () => {
        throw new Error("must not download");
      }),
    },
  };
  const message: TelegramMessage = {
    message_id: 10,
    date: now.getTime() / 1000,
    chat: { id: 30, type: "private" },
    from: { id: 30, first_name: "Synthetic" },
    text: "Finish the DBMS assignment",
  };
  const update: TelegramUpdate = { update_id: 100, message };
  return {
    port,
    sendMessage,
    resolveTelegramUser,
    runtime,
    message,
    update,
    result,
  };
}

describe("Telegram capture trust boundary", () => {
  it("persists natural text before sending an owner-only review link", async () => {
    const f = fixture();
    expect(await handleCaptureTelegramUpdate(f.update, f.runtime)).toBe(true);
    expect(f.port.ingestText).toHaveBeenCalledWith({
      userId: "resolved-owner",
      requestId: "tg-capture:30:10",
      text: f.message.text,
      sourceReference: {
        chatId: 30,
        messageId: 10,
        updateId: 100,
        occurredAt: now.toISOString(),
      },
    });
    expect(f.port.ingestText).toHaveBeenCalledBefore(f.sendMessage);
    const sent = f.sendMessage.mock.calls[0]?.[0];
    expect(sent).toMatchObject({ chatId: 30 });
    const url = new URL(
      String(
        (
          sent?.replyMarkup as {
            inline_keyboard: Array<Array<{ web_app: { url: string } }>>;
          }
        ).inline_keyboard[0][0].web_app.url,
      ),
    );
    expect(url.searchParams.get("screen")).toBe("capture");
    expect(url.searchParams.get("captureId")).toBe(captureId);
    expect(url.href).not.toContain("DBMS");
    expect(f.sendMessage.mock.calls[0]?.[0]?.text).not.toContain(
      f.message.text,
    );
  });
  it("reuses the same durable ingress key on retries without extra replies", async () => {
    const f = fixture();
    vi.mocked(f.port.ingestText)
      .mockResolvedValueOnce(f.result)
      .mockResolvedValueOnce({ ...f.result, duplicate: true });
    await handleCaptureTelegramUpdate(f.update, f.runtime);
    await handleCaptureTelegramUpdate(f.update, f.runtime);
    expect(vi.mocked(f.port.ingestText).mock.calls[0]).toEqual(
      vi.mocked(f.port.ingestText).mock.calls[1],
    );
    expect(f.sendMessage).toHaveBeenCalledOnce();
  });
  it("keeps short voice metadata durable while speech is unavailable, with no download/provider call", async () => {
    const f = fixture();
    delete f.message.text;
    f.message.voice = {
      file_id: "private-reference",
      file_unique_id: "stable-reference",
      duration: 12,
      file_size: 1000,
      mime_type: "audio/ogg",
    };
    await handleCaptureTelegramUpdate(f.update, f.runtime);
    expect(f.port.ingestVoice).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "resolved-owner",
        requestId: "tg-capture:30:10",
        voice: expect.objectContaining({
          fileId: "private-reference",
          referenceExpiresAt: "2026-11-04T17:55:00.000Z",
        }),
      }),
    );
    expect(f.runtime.telegram.getFileUrl).not.toHaveBeenCalled();
    expect(f.runtime.telegram.downloadVoice).not.toHaveBeenCalled();
    expect(f.sendMessage.mock.calls[0]?.[0]?.text).toContain("не скачано");
    expect(JSON.stringify(f.sendMessage.mock.calls)).not.toContain(
      "private-reference",
    );
  });
  it.each([
    { chat: { id: -100, type: "group" } },
    { chat: { id: 31, type: "private" } },
    { from: { id: 30, is_bot: true } },
    { from: undefined },
    { message_id: -1 },
  ])(
    "refuses nonprivate/foreign/bot/malformed senders without any lookup or write",
    async (change) => {
      const f = fixture();
      Object.assign(f.message, change);
      expect(await handleCaptureTelegramUpdate(f.update, f.runtime)).toBe(true);
      expect(f.resolveTelegramUser).not.toHaveBeenCalled();
      expect(f.port.ingestText).not.toHaveBeenCalled();
      expect(f.sendMessage).not.toHaveBeenCalled();
    },
  );
  it("rejects blocked and mismatched resolved owners", async () => {
    for (const user of [
      { userId: "owner", telegramUserId: 30, status: "blocked" },
      { userId: "owner", telegramUserId: 99, status: "active" },
    ]) {
      const f = fixture();
      f.resolveTelegramUser.mockResolvedValue(user);
      await handleCaptureTelegramUpdate(f.update, f.runtime);
      expect(f.port.ingestText).not.toHaveBeenCalled();
    }
  });
  it.each(["/cap idea", "/capture@Lifeos_bot idea"])(
    "intercepts only dedicated capture commands",
    async (text) => {
      const f = fixture();
      f.message.text = text;
      await handleCaptureTelegramUpdate(f.update, f.runtime);
      expect(f.port.ingestText).toHaveBeenCalledWith(
        expect.objectContaining({ text: "idea" }),
      );
    },
  );
  it.each(["/water 300", "/task existing direct command", "/start", "/help"])(
    "preserves explicit legacy slash commands",
    async (text) => {
      const f = fixture();
      f.message.text = text;
      expect(await handleCaptureTelegramUpdate(f.update, f.runtime)).toBe(
        false,
      );
      expect(f.port.ingestText).not.toHaveBeenCalled();
    },
  );
  it("does not intercept existing behavior without an injected capture service", async () => {
    const f = fixture();
    delete f.runtime.capture;
    expect(await handleCaptureTelegramUpdate(f.update, f.runtime)).toBe(false);
    expect(f.resolveTelegramUser).not.toHaveBeenCalled();
  });
  it.each(["/inbox", "/cap", "/capture"])(
    "opens instructions/inbox without an implicit domain write",
    async (text) => {
      const f = fixture();
      f.message.text = text;
      await handleCaptureTelegramUpdate(f.update, f.runtime);
      expect(f.port.ingestText).not.toHaveBeenCalled();
      expect(f.port.ingestVoice).not.toHaveBeenCalled();
      expect(f.sendMessage).toHaveBeenCalledOnce();
    },
  );
  it("accepts a manual transcript with an owner-scoped stable request key", async () => {
    const f = fixture();
    f.message.text = `/transcript ${captureId} water 300`;
    await handleCaptureTelegramUpdate(f.update, f.runtime);
    expect(f.port.setTranscript).toHaveBeenCalledWith({
      userId: "resolved-owner",
      captureId,
      text: "water 300",
      requestId: "tg-transcript:30:10",
    });
  });
  it("rejects unsupported voice metadata before any ingest or download", async () => {
    const f = fixture();
    delete f.message.text;
    f.message.voice = {
      file_id: "file",
      file_unique_id: "stable",
      duration: 121,
      mime_type: "audio/ogg",
    };
    await handleCaptureTelegramUpdate(f.update, f.runtime);
    expect(f.port.ingestVoice).not.toHaveBeenCalled();
    expect(f.runtime.telegram.getFileUrl).not.toHaveBeenCalled();
  });
  it("uses typed503-eligible failures only before durable persistence", async () => {
    const f = fixture();
    vi.mocked(f.port.ingestText).mockRejectedValue(
      new Error("private database diagnostic"),
    );
    await expect(
      handleCaptureTelegramUpdate(f.update, f.runtime),
    ).rejects.toMatchObject({
      code: "capture_ingest_unavailable",
      durablePersisted: false,
    });
    expect(f.sendMessage).not.toHaveBeenCalled();
    f.resolveTelegramUser.mockRejectedValue(
      new Error("private lookup diagnostic"),
    );
    await expect(
      handleCaptureTelegramUpdate(f.update, f.runtime),
    ).rejects.toBeInstanceOf(CaptureTelegramIngestError);
  });
  it("permanently rejects invalid/foreign transcript input without retrying or leaking errors", async () => {
    for (const error of [
      new CaptureTelegramRequestError("unavailable"),
      new CaptureInputError("private diagnostic"),
    ]) {
      const f = fixture();
      f.message.text = `/transcript ${captureId} text`;
      vi.mocked(f.port.setTranscript).mockRejectedValue(error);
      await expect(
        handleCaptureTelegramUpdate(f.update, f.runtime),
      ).resolves.toBe(true);
      expect(JSON.stringify(f.sendMessage.mock.calls)).not.toContain(
        "private diagnostic",
      );
    }
  });
  it("ACKs successful persistence even when reply delivery is unknown", async () => {
    const f = fixture();
    f.sendMessage.mockRejectedValue(
      new Error("https://api.telegram.org/botSECRET/ private note"),
    );
    await expect(
      handleCaptureTelegramUpdate(f.update, f.runtime),
    ).resolves.toBe(true);
    expect(f.port.ingestText).toHaveBeenCalledOnce();
  });
});
