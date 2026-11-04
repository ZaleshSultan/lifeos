import { afterEach, describe, expect, it, vi } from "vitest";
import type { CaptureActionView } from "../../../../../packages/core/src/universal-capture.js";
import {
  canApproveCaptureAction,
  emptyCaptureAction,
  instantFromInput,
  localInstantInput,
  operationIdentity,
  reviewExpired,
  captureProposalTitle,
  captureProvenanceLabel,
  captureStatusLabel,
  captureCalendarDate,
} from "./model";

afterEach(() => vi.unstubAllGlobals());
describe("capture review identity and local time", () => {
  it("round-trips Almaty local times without using the browser's timezone", () => {
    const instant = "2026-11-03T04:30:00.000Z";
    expect(localInstantInput(instant, "Asia/Almaty")).toBe("2026-11-03T09:30");
    expect(instantFromInput("2026-11-03T09:30", "Asia/Almaty")).toBe(instant);
    expect(instantFromInput("", "Asia/Almaty")).toBeNull();
    expect(() =>
      instantFromInput("2026-03-08T02:30", "America/New_York"),
    ).toThrow();
  });
  it("retains one request ID for identical ambiguous retries but changes it for edited approval", () => {
    const randomUUID = vi
      .fn()
      .mockReturnValueOnce("request-one")
      .mockReturnValueOnce("request-two");
    vi.stubGlobal("crypto", { randomUUID });
    const first = operationIdentity(null, {
      revision: 1,
      actions: ["action-1"],
    });
    expect(
      operationIdentity(first, { revision: 1, actions: ["action-1"] }),
    ).toBe(first);
    expect(
      operationIdentity(first, { revision: 2, actions: ["action-1"] })
        .requestId,
    ).toBe("request-two");
    expect(randomUUID).toHaveBeenCalledTimes(2);
  });
  it("blocks unresolved, completed, conflicting and cancelled actions and expired reviews", () => {
    const action: CaptureActionView = {
      id: "action-1",
      kind: "water.log",
      args: { amountMl: 250 },
      origin: "deterministic",
      summary: "250 ml",
      missingFields: [],
      status: "pending",
      resultSummary: null,
      completedAt: null,
    };
    expect(canApproveCaptureAction(action)).toBe(true);
    expect(
      canApproveCaptureAction({ ...action, missingFields: ["amountMl"] }),
    ).toBe(false);
    for (const status of [
      "needs_input",
      "succeeded",
      "conflict",
      "cancelled",
    ] as const)
      expect(canApproveCaptureAction({ ...action, status })).toBe(false);
    expect(
      reviewExpired("2026-11-03T10:00:00Z", Date.parse("2026-11-03T10:00:00Z")),
    ).toBe(true);
    expect(reviewExpired("invalid")).toBe(true);
    expect(reviewExpired(null)).toBe(true);
  });
  it("preserves existing task notes and due dates until the owner edits those fields", () => {
    const action = emptyCaptureAction("task.update", "2026-11-03");
    expect(action.args).not.toHaveProperty("notes");
    expect(action.args).not.toHaveProperty("dueAt");
  });
});
describe("capture review presentation", () => {
  it("shows literal independent titles and keeps legacy titles usable without client-side intent guessing", () => {
    const action: CaptureActionView = {
      id: "action-1",
      kind: "task.create",
      args: { title: "Закончить DBMS", notes: "", dueAt: null },
      origin: "deterministic",
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
        relation: null,
        language: "ru",
        evidence: "user_statement",
        warnings: [],
        timezone: "Asia/Almaty",
        dateBasis: "profile",
      },
    };
    expect(captureProposalTitle(action)).toBe("Закончить DBMS");
    expect(captureProposalTitle({ ...action, presentation: undefined })).toBe(
      "Закончить DBMS",
    );
    expect(captureCalendarDate("2026-11-04")).toContain("4 ноября 2026");
  });
  it("labels real processing stages and retains AI provenance after a user edit", () => {
    const base = { state: "processing" } as Parameters<
      typeof captureStatusLabel
    >[0];
    expect(captureStatusLabel(base)).toBe("Обрабатывается");
    expect(
      captureStatusLabel({ ...base, processingStage: "transcribing" }),
    ).toBe("Расшифровываем голос");
    expect(captureStatusLabel({ ...base, processingStage: "extracting" })).toBe(
      "Готовим предложения",
    );
    expect(
      captureProvenanceLabel({
        origin: "edited",
        extractionOrigin: "model",
      } as CaptureActionView),
    ).toContain("Первичный разбор: AI");
    expect(
      captureProvenanceLabel({ origin: "edited" } as CaptureActionView),
    ).toContain("неизвестен");
  });
});
