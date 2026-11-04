import { describe, expect, it } from "vitest";
import { captureErrorMessage } from "./errors";
describe("capture safe voice failures", () => {
  it("distinguishes expired audio access from an expired action review", () => {
    expect(captureErrorMessage("voice_reference_expired")).toContain(
      "Срок доступа к аудио истёк",
    );
    expect(captureErrorMessage("voice_reference_expired")).not.toContain(
      "Время просмотра",
    );
    expect(captureErrorMessage("capture_review_expired")).toContain(
      "Время просмотра истекло",
    );
  });
  it("keeps manual fallback and consent explicit without exposing raw diagnostics", () => {
    expect(captureErrorMessage("voice_consent_required")).toContain(
      "отдельное согласие",
    );
    expect(captureErrorMessage("voice_transcription_unavailable")).toContain(
      "вручную",
    );
    expect(captureErrorMessage("voice_quota_exceeded")).toContain(
      "Автоматического повтора нет",
    );
    expect(captureErrorMessage("PRIVATE_PROVIDER_TOKEN_DIAGNOSTIC")).toBeNull();
  });
});
