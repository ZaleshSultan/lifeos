import { describe, expect, it, vi } from "vitest";
import { ApiError, apiErrorMessage } from "./client";

vi.mock("../telegram", () => ({ telegram: { initData: "" } }));

describe("TMA access error messages", () => {
  it("explains how to recover Telegram authentication without displaying backend metadata", () => {
    const message = apiErrorMessage(
      new ApiError(
        '{"error":"invalid_init_data","message":"private debug payload"}',
        401,
      ),
    );
    expect(message).toContain("Telegram");
    expect(message).not.toContain("private");
    expect(
      apiErrorMessage(
        new ApiError('{"error":"telegram_user_not_linked"}', 403),
      ),
    ).toContain("/start");
    expect(
      apiErrorMessage(new ApiError('{"error":"telegram_user_pending"}', 403)),
    ).toContain("одобрения");
    expect(
      apiErrorMessage(new ApiError('{"error":"telegram_user_blocked"}', 403)),
    ).toContain("заблокирован");
  });

  it("keeps proxy HTML, database details, and unexpected errors out of the UI", () => {
    for (const error of [
      new ApiError("<html>private proxy diagnostics</html>", 502),
      new ApiError(
        '{"error":"database_not_configured","message":"private database details"}',
        503,
      ),
      new Error("private network diagnostics"),
    ]) {
      expect(apiErrorMessage(error)).not.toContain("private");
      expect(apiErrorMessage(error)).not.toContain("<html>");
    }
    expect(apiErrorMessage(new ApiError("", 429))).toContain("запросов");
  });
});
