import { afterEach, describe, expect, it, vi } from "vitest";
import type { CaptureActionView } from "../../../../../packages/core/src/universal-capture.js";
import {
  canApproveCaptureAction,
  emptyCaptureAction,
  instantFromInput,
  localInstantInput,
  operationIdentity,
  reviewExpired,
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
