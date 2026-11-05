import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { defaultAiRouterSettings } from "../../../../packages/core/src/ai-model-router.js";
import type { AiRouterSettingsSnapshot } from "../../../../packages/core/src/ai-router-settings-view.js";
import { AiRouterSettings } from "./AiRouterSettings.js";
function fixture(
  status: NonNullable<
    AiRouterSettingsSnapshot["providers"][number]["freeRouting"]
  >["status"] = "prepared",
) {
  const snapshot: AiRouterSettingsSnapshot = {
    settings: defaultAiRouterSettings(),
    revision: 0,
    providers: [
      {
        id: "gemini",
        status: "configured_unverified",
        credentialLabels: ["project-key-a", "project-key-b"],
        verified: false,
        freeRouting: {
          status,
          localRequestsToday: null,
          localDailyLimit: 1,
          providerRemaining: null,
          retryAt: status === "cooldown" ? "2026-11-04T08:02:00Z" : null,
        },
      },
    ],
    models: [
      {
        id: "candidate",
        model: "fixture/free:free",
        label: "Prepared free candidate",
        provider: "openrouter",
        tiers: ["balanced"],
        capabilities: ["text", "json"],
        billing: "free",
        inputCostMicrosPer1k: 0,
        outputCostMicrosPer1k: 0,
        configured: false,
        authorized: false,
        metadataVerified: false,
        privacy: "external",
        status: "disabled",
      },
    ],
    operatorLimits: {
      routerEnabled: false,
      freeProfileEnabled: true,
      freeOnly: true,
      maxRequestCostMicros: 0,
      maxDailyCostMicros: 0,
      paidRequestsEnabled: false,
      maxOutputTokens: 2048,
    },
    chatgptPlan: {
      status: "prepared",
      identityConnected: false,
      planUsageAuthorized: false,
      usesApiCredits: false,
      manageUsageUrl: "https://chatgpt.com/settings/usage",
    },
  };
  const reload = vi.fn(async () => snapshot),
    save = vi.fn(async () => snapshot);
  return {
    snapshot,
    reload,
    save,
    render: () =>
      renderToStaticMarkup(
        createElement(AiRouterSettings, {
          snapshot,
          onReload: reload,
          onSave: save,
          errorMessage: () => "Unavailable",
        }),
      ),
  };
}
describe("honest shared free-route settings", () => {
  it("shows prepared access, unknown account capacity, pooled keys and private-Gemini restriction without a network probe", () => {
    const f = fixture();
    const html = f.render();
    expect(html).toContain("подготовлен, реальный запрос не проверен");
    expect(html).toContain("не остаток общего аккаунта");
    expect(html).toContain("America/Los_Angeles");
    expect(html).toContain("Личные данные не отправляются в бесплатный Gemini");
    expect(html).toContain("Без сетевой проверки");
    expect(html).toContain("Отключить провайдеров маршрутизатора");
    expect(f.reload).not.toHaveBeenCalled();
    expect(f.save).not.toHaveBeenCalled();
  });
  it("keeps cooldown and review states separate from a connected provider claim", () => {
    expect(fixture("cooldown").render()).toContain(
      "Повтор доступен не раньше (UTC)",
    );
    expect(fixture("review_required").render()).toContain(
      "приостановлен до проверки владельцем",
    );
    expect(fixture("quota_unavailable").render()).toContain(
      "учёт квоты недоступен",
    );
  });
});
