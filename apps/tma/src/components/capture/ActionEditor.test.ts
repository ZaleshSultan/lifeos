import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TaskWorkspaceItem } from "../../../../../packages/core/src/daily-life.js";
import {
  CAPTURE_ACTION_KINDS,
  type CaptureActionPayload,
  type CaptureActionView,
} from "../../../../../packages/core/src/universal-capture.js";
import { CaptureActionEditor } from "./ActionEditor";

const task: TaskWorkspaceItem = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "Owned current task",
  notes: "Keep the existing notes",
  dueAt: "2026-11-04T10:00:00Z",
  status: "next",
  updatedAt: "2026-11-03T10:00:00.123456Z",
  completedAt: null,
};
function editor(action: CaptureActionPayload) {
  return renderToStaticMarkup(
    createElement(CaptureActionEditor, {
      action: {
        ...action,
        id: "action-1",
        origin: "deterministic",
        summary: "Review me",
        missingFields: [],
        status: "pending",
        resultSummary: null,
        completedAt: null,
      } as CaptureActionView,
      date: "2026-11-03",
      timezone: "Asia/Almaty",
      tasks: [task],
      kinds: [...CAPTURE_ACTION_KINDS],
      busy: false,
      onSave: async () => {},
      onCancel: () => {},
      onDirtyChange: () => {},
    }),
  );
}
describe("capture typed action forms", () => {
  it("keeps unknown nutrition values blank and identifies estimates", () => {
    const html = editor({
      kind: "meal.record",
      args: {
        date: "2026-11-03",
        label: "Rice",
        caloriesKcal: null,
        proteinG: null,
        fatG: null,
        carbsG: null,
        mealTime: null,
        portion: "",
        estimated: true,
      },
    });
    expect((html.match(/type="number"/g) ?? []).length).toBe(4);
    expect(html).not.toContain('value="0"');
    expect(html).toContain("Значения являются оценкой");
    expect(html).toContain("Неизвестные значения остаются пустыми");
    expect(html).not.toContain("JSON");
  });
  it("shows the owned task picker and existing optional data instead of an opaque-ID text form", () => {
    const html = editor({
      kind: "task.update",
      args: {
        title: "Reviewed new title",
        taskId: task.id,
        expectedUpdatedAt: task.updatedAt,
      },
    });
    expect(html).toContain("Существующая задача");
    expect(html).toContain("Owned current task");
    expect(html).toContain("Keep the existing notes");
    expect(html).toContain('value="2026-11-04T15:00"');
    expect(html).not.toContain('input value="' + task.id + '"');
    expect(html).not.toContain("expectedUpdatedAt");
  });
  it("offers read-only data sources for a question without provider or arbitrary tool entry", () => {
    const html = editor({
      kind: "question.read",
      args: { text: "My next class?", tool: null },
    });
    expect(html).toContain("Выбери источник");
    expect(html).toContain('value="classes.next"');
    expect(html).not.toContain('value="memory.upsert"');
    expect(html).not.toContain('value="tasks.create"');
    expect(html).not.toContain("API key");
  });
});
