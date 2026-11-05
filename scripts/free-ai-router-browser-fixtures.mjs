// Synthetic browser-only preparation state. No provider credentials or requests.
import assert from "node:assert/strict";

export const freeRouterBrowserKeys = {
  gemini: ["fixture-gemini-a", "fixture-gemini-b"],
  openrouter: [
    "fixture-openrouter-a",
    "fixture-openrouter-b",
    "fixture-openrouter-c",
  ],
};
export const freeRouterBrowserRetryAt = "2026-11-06T00:00:00Z";

export function freeRouterBrowserSnapshot(
  snapshot,
  { status = "cooldown", ownerConfigured = true } = {},
) {
  const next = structuredClone(snapshot);
  Object.assign(next.operatorLimits, {
    routerEnabled: false,
    paidRequestsEnabled: false,
    freeProfileEnabled: true,
    freeOnly: true,
    maxRequestCostMicros: 0,
    maxDailyCostMicros: 0,
  });
  next.models = next.models.map((model) => ({
    ...model,
    billing: "free",
    inputCostMicrosPer1k: 0,
    outputCostMicrosPer1k: 0,
    configured: false,
    authorized: false,
    metadataVerified: false,
    status: "disabled",
  }));
  next.providers = next.providers.map((provider) => {
    if (!Object.hasOwn(freeRouterBrowserKeys, provider.id)) return provider;
    const gemini = provider.id === "gemini";
    return {
      ...provider,
      status: "disabled",
      verified: false,
      credentialLabels: ownerConfigured
        ? freeRouterBrowserKeys[provider.id]
        : [],
      freeRouting: {
        status: !ownerConfigured
          ? "not_configured"
          : gemini
            ? "metadata_required"
            : status,
        localRequestsToday: ownerConfigured ? (gemini ? 1 : 2) : null,
        localDailyLimit: ownerConfigured ? (gemini ? 4 : 6) : null,
        providerRemaining: null,
        retryAt:
          ownerConfigured && !gemini && status === "cooldown"
            ? freeRouterBrowserRetryAt
            : null,
      },
    };
  });
  return next;
}

export async function assertFreeRouterBrowserPanel(panel, status = "cooldown") {
  await panel
    .getByText(/Бесплатный профиль: только проверенные нулевые цены/)
    .waitFor();
  const text = await panel.innerText();
  assert.match(text, /Маршрутизатор выключен.*без перехода на платный путь/s);
  assert.match(text, /Ключи одного проекта или аккаунта делят лимит/);
  assert.match(text, /Личные данные не отправляются в бесплатный Gemini/);
  assert.match(text, /Платные запросы сейчас отключены на сервере/);
  for (const provider of ["gemini", "openrouter"]) {
    const card = panel
      .getByText(
        "Профили ключей: " + freeRouterBrowserKeys[provider].join(", "),
        { exact: true },
      )
      .locator("..");
    const content = await card.innerText();
    assert.match(content, /Без сетевой проверки/);
    assert.match(content, /Это лимит приложения, не остаток общего аккаунта/);
    if (provider === "gemini") {
      assert.match(content, /America\/Los_Angeles/);
      assert.match(content, /1\s*\/\s*4\./);
      assert.match(content, /нужно подтвердить тариф и условия/);
    } else {
      assert.match(content, /UTC/);
      assert.match(content, /2\s*\/\s*6\./);
      assert.match(
        content,
        status === "cooldown"
          ? /ожидание после ограничения/
          : /приостановлен до проверки владельцем/,
      );
      if (status === "cooldown")
        assert.ok(content.includes(freeRouterBrowserRetryAt));
      else assert.doesNotMatch(content, /Повтор доступен не раньше/);
    }
  }
  assert.equal(
    await panel
      .getByRole("checkbox", { name: /Я разрешаю платные запросы/ })
      .isChecked(),
    false,
  );
  assert.equal(
    await panel
      .getByRole("checkbox", {
        name: "Разрешить ограниченные запасные попытки",
        exact: true,
      })
      .isChecked(),
    false,
  );
  const prices = panel.getByText("Возможности и оценочные цены", {
    exact: true,
  });
  if (!(await prices.evaluate((node) => node.parentElement.open)))
    await prices.click();
  assert.equal(
    await panel
      .getByText("Бесплатный тариф · требуется проверка доступа", {
        exact: true,
      })
      .count(),
    2,
  );
  assert.equal(
    await panel
      .getByText("Метаданные не подтверждены; выполнение ограничено", {
        exact: true,
      })
      .count(),
    2,
  );
  const priceText = await prices.locator("..").innerText();
  assert.match(priceText, /вход \$0, выход \$0/);
}
