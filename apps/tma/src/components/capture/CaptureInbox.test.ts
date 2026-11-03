import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  CAPTURE_ACTION_KINDS,
  type CaptureCapabilities,
  type CaptureView,
} from "../../../../../packages/core/src/universal-capture.js";
import { CaptureInbox } from "./CaptureInbox";
import { CaptureDetail } from "./CaptureDetail";
import type { CaptureTransport } from "./transport";

const capabilities: CaptureCapabilities = {
  enabled: true,
  text: true,
  telegramVoice: true,
  transcription: "unavailable",
  transcriptionRequiresConsent: true,
  aiExtraction: false,
  maxTextLength: 8000,
  maxVoiceBytes: 5 * 1024 * 1024,
  maxVoiceSeconds: 120,
  memoryDeleteEnabled: false,
  actionKinds: [...CAPTURE_ACTION_KINDS],
};
function record(): CaptureView {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    inputType: "voice",
    source: "telegram",
    sourceLabel: "Telegram",
    text: "<script>untrusted original</script>",
    transcript: null,
    state: "awaiting_transcript",
    revision: 1,
    createdAt: "2026-11-03T10:00:00Z",
    updatedAt: "2026-11-03T10:00:00Z",
    archivedAt: null,
    expiresAt: null,
    reviewExpiresAt: "2099-11-03T10:10:00Z",
    errorCode: "transcription_unavailable",
    actions: [],
  };
}
const none = () => undefined;
describe("private capture review rendering", () => {
  it("renders real server history without sending, storing browser data or requesting a microphone during SSR", () => {
    const call = vi.fn();
    const transport = new Proxy({}, { get: () => call }) as CaptureTransport;
    const html = renderToStaticMarkup(
      createElement(CaptureInbox, {
        transport,
        initialCapabilities: capabilities,
        initialHistory: { captures: [record()], nextCursor: null },
        errorMessage: () => "safe error",
      }),
    );
    expect(html).toContain("Голос в Telegram");
    expect(html).toContain("&lt;script&gt;untrusted original&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain(record().id);
    expect(html).toContain(
      "Поддерживаемые команды разбираются правилами LifeOS",
    );
    expect(call).not.toHaveBeenCalled();
    expect(html).toContain("disabled");
  });
  it("labels missing transcription honestly and provides manual review without audio playback or raw errors", () => {
    const html = renderToStaticMarkup(
      createElement(CaptureDetail, {
        capture: record(),
        capabilities,
        tasks: [],
        tasksUnavailable: false,
        busy: false,
        onReload: none,
        onEdit: async () => undefined,
        onLifecycle: none,
        onConfirm: none,
        onDelete: none,
        onDirtyChange: none,
      }),
    );
    expect(html).toContain("Ручная расшифровка");
    expect(html).toContain("LifeOS не заявляет, что речь распознана");
    expect(html).not.toContain("<audio");
    expect(html).not.toContain("transcription_unavailable");
    expect(html).toContain(
      "Уже подтверждённые задачи и записи LifeOS не отменяются",
    );
  });
  it("keeps all proposed actions unchecked and blocks missing inputs while separating receipts", () => {
    const capture = record();
    capture.inputType = "text";
    capture.state = "needs_review";
    capture.errorCode = null;
    capture.actions = [
      {
        id: "action-1",
        kind: "water.log",
        args: { amountMl: 250 },
        origin: "deterministic",
        summary: "250 ml",
        missingFields: [],
        status: "pending",
        resultSummary: null,
        completedAt: null,
      },
      {
        id: "action-2",
        kind: "reminder.create",
        args: { title: "Finish DBMS", remindAt: null },
        origin: "model",
        summary: "Finish DBMS",
        missingFields: ["remindAt"],
        status: "needs_input",
        resultSummary: null,
        completedAt: null,
      },
      {
        id: "action-3",
        kind: "note.save",
        args: { title: "Saved", content: "existing" },
        origin: "edited",
        summary: "Saved note",
        missingFields: [],
        status: "succeeded",
        resultSummary: "Saved exactly once",
        completedAt: "2026-11-03T10:01:00Z",
      },
    ];
    const html = renderToStaticMarkup(
      createElement(CaptureDetail, {
        capture,
        capabilities,
        tasks: [],
        tasksUnavailable: false,
        busy: false,
        onReload: none,
        onEdit: async () => undefined,
        onLifecycle: none,
        onConfirm: none,
        onDelete: none,
        onDirtyChange: none,
      }),
    );
    expect(html).not.toContain('checked=""');
    expect(html).toContain("Выбрано действий: 0");
    expect(html).toContain("время напоминания");
    expect(html).toContain("Предложение AI — проверь детали");
    expect(html).toContain("Saved exactly once");
  });
});
