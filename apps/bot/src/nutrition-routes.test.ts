import { describe, expect, it, vi } from "vitest";
import type { AiBudgetStore } from "@lifeos/core";
import { AiGovernor, readAiGovernorConfig } from "./ai-governor.js";
import {
  createMealVisionService,
  validateMealImage,
} from "./nutrition-routes.js";
const sdk = vi.hoisted(() => ({
  options: vi.fn(),
  generate: vi.fn(),
}));
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: sdk.generate };
    constructor(options: unknown) {
      sdk.options(options);
    }
  },
}));
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6Z5sAAAAASUVORK5CYII=";
const body = {
  mimeType: "image/png",
  imageBase64: png,
  consentToExternalAnalysis: true,
  requestId: "meal-fixture-001",
};
function fixture() {
  const reserve = vi.fn<AiBudgetStore["reserve"]>(async () => "reserved");
  const finish = vi.fn<AiBudgetStore["finish"]>(async () => undefined);
  const governor = new AiGovernor({
    store: { reserve, finish },
    config: readAiGovernorConfig({}),
  });
  const analyze = vi.fn(async () => ({
    text: JSON.stringify({
      items: [
        {
          label: "Uncertain visible meal",
          portion: null,
          caloriesKcal: null,
          proteinG: 12.3,
          fatG: null,
          carbsG: null,
        },
      ],
      uncertainty: ["Portion cannot be determined"],
    }),
  }));
  const service = createMealVisionService({
    source: { LIFEOS_MEAL_VISION_ENABLED: "true" },
    governor,
    client: { analyze },
  });
  return { reserve, finish, analyze, governor, service };
}
describe("private review-only meal estimates", () => {
  it("disables SDK retries so one budget reservation cannot fund repeated provider calls", async () => {
    const f = fixture();
    sdk.generate.mockResolvedValueOnce({
      text: JSON.stringify({
        items: [
          {
            label: "Meal",
            portion: null,
            caloriesKcal: null,
            proteinG: null,
            fatG: null,
            carbsG: null,
          },
        ],
        uncertainty: ["Unverified portion"],
      }),
    });
    const service = createMealVisionService({
      governor: f.governor,
      source: {
        LIFEOS_MEAL_VISION_ENABLED: "true",
        GEMINI_API_KEY: "test-only",
        LIFEOS_AI_TEXT_MODEL: "fixture-model",
      },
    });
    await service.analyze("owner", body);
    expect(sdk.options).toHaveBeenLastCalledWith(
      expect.objectContaining({
        httpOptions: { timeout: 20000, retryOptions: { attempts: 1 } },
      }),
    );
    expect(sdk.generate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          httpOptions: { retryOptions: { attempts: 1 } },
          abortSignal: expect.any(AbortSignal),
          maxOutputTokens: 2048,
        }),
      }),
    );
    expect(f.reserve).toHaveBeenCalledOnce();
  });
  it("makes zero calls when provider is absent and leaves manual logging available", async () => {
    const service = createMealVisionService({ source: {} });
    expect(service.capability()).toMatchObject({
      available: false,
      requiresConsent: true,
      retainsPhotos: false,
    });
    await expect(service.analyze("owner", body)).rejects.toThrow(
      "meal_vision_unavailable",
    );
  });
  it("requires per-photo consent before any provider call", async () => {
    const f = fixture();
    await expect(
      f.service.analyze("owner", { ...body, consentToExternalAnalysis: false }),
    ).rejects.toThrow();
    expect(f.analyze).not.toHaveBeenCalled();
    expect(f.reserve).not.toHaveBeenCalled();
  });
  it("rejects bad formats, giant dimensions and ownership injection", async () => {
    const f = fixture();
    for (const input of [
      { ...body, mimeType: "image/svg+xml" },
      { ...body, imageBase64: "not an image" },
      { ...body, userId: "foreign" },
      { ...body, imageBase64: "x".repeat(800000) },
    ])
      await expect(f.service.analyze("owner", input)).rejects.toThrow();
    const giant = Buffer.from(png, "base64");
    giant.writeUInt32BE(99999, 16);
    expect(() =>
      validateMealImage("image/png", giant.toString("base64")),
    ).toThrow();
    expect(f.analyze).not.toHaveBeenCalled();
  });
  it("returns a bounded unknown-aware draft without any meal database write", async () => {
    const f = fixture();
    const draft = await f.service.analyze("owner", body);
    expect(draft).toMatchObject({
      estimated: true,
      requiresReview: true,
      source: "gemini",
      items: [
        {
          label: "Uncertain visible meal",
          portion: null,
          caloriesKcal: null,
          proteinG: 12.3,
          fatG: null,
          carbsG: null,
        },
      ],
    });
    expect(f.reserve).toHaveBeenCalledBefore(f.analyze);
    expect(f.finish).toHaveBeenCalledOnce();
    expect(f.service.getDraft("foreign", draft.draftId)).toBeNull();
    expect(f.service.getDraft("owner", draft.draftId)).toEqual(draft);
  });
  it("enforces the decoded 500 KB cap before reserving budget or calling a provider", async () => {
    const f = fixture();
    const bytes = Buffer.alloc(500001);
    Buffer.from(png, "base64").copy(bytes);
    const imageBase64 = bytes.toString("base64");
    expect(imageBase64.length).toBeLessThan(720000);
    await expect(
      f.service.analyze("owner", { ...body, imageBase64 }),
    ).rejects.toThrow("under 500 KB");
    expect(f.reserve).not.toHaveBeenCalled();
    expect(f.analyze).not.toHaveBeenCalled();
  });
  it("deduplicates a retry and prevents the same request ID describing another image", async () => {
    const f = fixture();
    const first = await f.service.analyze("owner", body);
    expect(await f.service.analyze("owner", body)).toEqual(first);
    expect(f.analyze).toHaveBeenCalledOnce();
    await expect(
      f.service.analyze("owner", {
        ...body,
        imageBase64: Buffer.concat([
          Buffer.from(png, "base64"),
          Buffer.from([0]),
        ]).toString("base64"),
      }),
    ).rejects.toThrow();
    expect(f.analyze).toHaveBeenCalledOnce();
  });
  it("handles malformed/empty provider output without saving anything", async () => {
    const f = fixture();
    f.analyze.mockResolvedValueOnce({ text: "not JSON" });
    await expect(f.service.analyze("owner", body)).rejects.toThrow();
    f.analyze.mockResolvedValueOnce({
      text: JSON.stringify({ items: [], uncertainty: [] }),
    });
    await expect(
      f.service.analyze("owner", { ...body, requestId: "meal-fixture-002" }),
    ).rejects.toThrow();
  });
  it("fails closed on budget exhaustion and shutdown", async () => {
    const f = fixture();
    f.reserve.mockResolvedValueOnce("token_budget_exceeded");
    await expect(f.service.analyze("owner", body)).rejects.toThrow(
      "ai_token_budget_exceeded",
    );
    expect(f.analyze).not.toHaveBeenCalled();
    f.governor.shutdown();
    expect(f.service.capability().available).toBe(false);
    await expect(f.service.analyze("owner", body)).rejects.toThrow(
      "meal_vision_unavailable",
    );
  });
  it("expires drafts without retaining a photo", async () => {
    let now = 0;
    const base = fixture();
    const service = createMealVisionService({
      source: { LIFEOS_MEAL_VISION_ENABLED: "true" },
      governor: base.governor,
      client: { analyze: base.analyze },
      now: () => now,
    });
    const draft = await service.analyze("owner", body);
    now = 300001;
    expect(service.getDraft("owner", draft.draftId)).toBeNull();
  });
});
