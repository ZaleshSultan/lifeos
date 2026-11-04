import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
  CaptureActionView,
  CaptureCapabilities,
  CaptureView,
} from "../../../../../packages/core/src/universal-capture.js";
import { CaptureDetail } from "./CaptureDetail";
import { CaptureExternalControls } from "./ExternalControls";

const capabilities: CaptureCapabilities = {
  enabled: true,
  text: true,
  telegramVoice: true,
  transcription: "unavailable",
  transcriptionRequiresConsent: true,
  aiExtraction: false,
  externalModel: "unavailable",
  maxTextLength: 8000,
  maxVoiceBytes: 5 * 1024 * 1024,
  maxVoiceSeconds: 120,
  memoryDeleteEnabled: false,
  actionKinds: ["task.create", "planning.suggest", "filming.idea"],
};
function capture(): CaptureView {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    inputType: "text",
    source: "web",
    sourceLabel: "Web",
    text: "Завтра после университета нужно потренироваться, закончить DBMS и снять пару кадров для Ideal Human.",
    transcript: null,
    state: "needs_review",
    revision: 1,
    createdAt: "2026-11-03T10:00:00Z",
    updatedAt: "2026-11-03T10:00:00Z",
    archivedAt: null,
    expiresAt: null,
    reviewExpiresAt: "2099-11-03T10:00:00Z",
    errorCode: null,
    actions: [],
  };
}
function render(record: CaptureView) {
  return renderToStaticMarkup(
    createElement(CaptureDetail, {
      capture: record,
      capabilities,
      tasks: [],
      tasksUnavailable: false,
      busy: false,
      onReload: () => {},
      onEdit: async () => {},
      onLifecycle: () => {},
      onConfirm: () => {},
      onDelete: () => {},
      onDirtyChange: () => {},
      onCorrect: async () => {},
      onReject: () => {},
    }),
  );
}
describe("independent capture review and honest external status", () => {
  it("renders an isolated title, suggested calendar date and literal relation without inventing a deadline", () => {
    const record = capture();
    record.actions = [
      {
        id: "action-1",
        kind: "task.create",
        args: { title: "Закончить DBMS", notes: "", dueAt: null },
        origin: "deterministic",
        extractionOrigin: "deterministic",
        summary: "task.create: Закончить DBMS",
        missingFields: [],
        status: "pending",
        resultSummary: null,
        completedAt: null,
        presentation: {
          title: "Закончить DBMS",
          description: null,
          suggestedDate: "2026-11-04",
          timeHint: null,
          relation: "после университета",
          language: "ru",
          evidence: "user_statement",
          warnings: ["Расписание неизвестно; время не назначено."],
          timezone: "Asia/Almaty",
          dateBasis: "profile",
        },
      } satisfies CaptureActionView,
    ];
    const html = render(record);
    expect(html).toContain("Закончить DBMS");
    expect(html).not.toContain("task.create:");
    expect(html).toContain("Предложенная дата");
    expect(html).toContain("4 ноября 2026");
    expect(html).toContain("Asia/Almaty");
    expect(html).toContain("после университета");
    expect(html).toContain("Точное время не назначено");
    expect(html).not.toContain("Срок:");
    expect(html).not.toContain('checked=""');
    expect(html).toContain("Выбрано действий: 0");
    expect(html).toContain("Отклонить предложение 1");
    expect(html).toContain('aria-label="Уточнение предложений"');
  });
  it("never calls a provider or grants consent while rendering configured-unverified speech controls", () => {
    const record = capture();
    record.inputType = "voice";
    record.state = "awaiting_transcript";
    const run = vi.fn();
    const html = renderToStaticMarkup(
      createElement(CaptureExternalControls, {
        capture: record,
        capabilities: {
          ...capabilities,
          transcription: "configured_unverified",
        },
        disabled: false,
        onRun: run,
        onDirtyChange: () => {},
      }),
    );
    expect(run).not.toHaveBeenCalled();
    expect(html).toContain("ещё не проверена");
    expect(html).toContain("Разрешаю передать аудио");
    expect(html).not.toContain('checked=""');
    expect(html).toContain("disabled");
    expect(html).not.toContain("API key");
  });
  it("shows transcription progress only from the actual processing stage", () => {
    const record = capture();
    record.inputType = "voice";
    record.state = "processing";
    expect(render(record)).not.toContain("Расшифровываем голос");
    record.processingStage = "transcribing";
    expect(render(record)).toContain("Расшифровываем голос");
    record.processingStage = "extracting";
    expect(render(record)).toContain("Готовим предложения");
    expect(render(record)).not.toContain("Расшифровываем голос");
  });
});
