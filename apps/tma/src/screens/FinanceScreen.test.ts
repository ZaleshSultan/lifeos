import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { queryKeys } from "../api/hooks";
import type { FinanceSummary } from "../api/types";
import { FinanceScreen } from "./FinanceScreen";

// The web runtime supplies its own Telegram adapter; no browser SDK is needed for SSR.
vi.mock("../telegram", () => ({ telegram: { hapticImpact: vi.fn() } }));

function renderFinance(platform?: "web" | "telegram") {
  const query = new QueryClient();
  const summary = {
    currency: "KZT",
    baseCurrency: "KZT",
    today: { count: 1, amount: 1250 },
    week: { count: 1, amount: 1250 },
    month: { count: 1, amount: 1250 },
    monthlySummary: { income: 0, expense: 1250, net: -1250 },
    topCategories: [{ category: "Транспорт", amount: 1250, count: 1 }],
    budgets: [],
    recentTransactions: [],
    recentExpenses: [],
    recentIncome: [],
    drafts: [],
    recommendations: [],
    anomalies: [],
    recentReceipts: [
      {
        id: "receipt-1",
        status: "completed",
        displayStatus: "needs_review",
        fileName: "Городской билет",
        amount: 1250,
        currency: "KZT",
        merchant: "Transit",
        transactionId: null,
        errorMessage: null,
        createdAt: "2026-10-02",
        processedAt: null,
      },
    ],
  } satisfies FinanceSummary;
  query.setQueryData(queryKeys.finance, summary);
  query.setQueryData(queryKeys.financeCategories, []);
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: query },
      createElement<{ platform?: "web" | "telegram" }>(FinanceScreen, {
        platform,
      }),
    ),
  );
}

describe("host-specific finance controls", () => {
  it("renders the stored receipt, categories, budgets and expense actions without Telegram-only operations on web", () => {
    const html = renderFinance("web");
    expect(html).toContain("Городской билет");
    expect(html).toContain("Транспорт");
    expect(html).toContain("Добавить расход");
    expect(html).toContain("Новый бюджет");
    expect(html).not.toContain('type="file"');
    expect(html).not.toContain("Пересчитать старые суммы");
  });
  it("retains receipt uploads and recalculation in the Telegram app", () => {
    const html = renderFinance();
    expect(html).toContain('type="file"');
    expect(html).toContain("Загрузить фото");
    expect(html).toContain("Пересчитать старые суммы");
  });
});
