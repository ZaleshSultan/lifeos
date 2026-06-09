import { describe, expect, it, vi } from "vitest";
import {
  detectFinanceAnomalies,
  fetchDailyExchangeRates,
  forecastMonthEndExpense,
  interpretFinanceQuestion,
  normalizeFinanceBaseCurrency,
  parseFinanceRules,
  parseFinanceText,
  parseReceiptText,
  redactFinanceText,
  validateReceiptParse,
} from "./finance.js";

describe("finance parser", () => {
  it("extracts amount and Russian category", () => {
    expect(parseFinanceRules("потратил 3500 на такси")).toMatchObject({
      amount: 3500,
      currency: "KZT",
      transactionType: "expense",
      category: "Transport",
    });
  });

  it("falls back to rules without an OpenRouter key", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await parseFinanceText("1200 шаурма", {
      aiEnabled: true,
      fetchImpl,
    });

    expect(result).toMatchObject({
      amount: 1200,
      category: "Food",
      parser: "rules",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("never accepts an AI-invented amount", async () => {
    const result = await parseFinanceText("такси 3500", {
      aiEnabled: true,
      openRouterApiKey: "test-key",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content:
                    '{"amount":9999,"transactionType":"expense","category":"Transport","description":"такси","confidence":1}',
                },
              },
            ],
          }),
          { status: 200 },
        ),
    });

    expect(result.amount).toBe(3500);
    expect(result.parser).toBe("rules");
  });

  it("redacts long card and account-like numbers", () => {
    expect(redactFinanceText("оплата 1200 карта 4400 4300 1234 5678")).toBe(
      "оплата 1200 карта [REDACTED]",
    );
  });

  it("prefers amount adjacent to currency over incidental numbers", () => {
    const result = parseFinanceRules("обед на 2 человек за 4500 KZT");

    expect(result).toMatchObject({
      amount: 4500,
      currency: "KZT",
      transactionType: "expense",
      category: "Food",
    });
  });

  it("handles currency before amount", () => {
    const result = parseFinanceRules("KZT 3000 за такси");

    expect(result).toMatchObject({
      amount: 3000,
      transactionType: "expense",
      category: "Transport",
    });
  });

  it("still takes first amount when no currency token is adjacent", () => {
    const result = parseFinanceRules("1200 шаурма");

    expect(result).toMatchObject({
      amount: 1200,
      category: "Food",
    });
  });
});

describe("receipt parser", () => {
  it("parses receipt OCR text with rules when AI is disabled", async () => {
    const result = await parseReceiptText(
      "Magnum 4500 KZT 2026-06-01 продукты",
      { aiEnabled: false },
    );

    expect(result).toMatchObject({
      amount: 4500,
      currency: "KZT",
      category: "Food",
    });
  });

  it("marks incomplete receipt data as partial", () => {
    const validation = validateReceiptParse({
      merchant: "Unknown merchant",
      amount: 1200,
      currency: "KZT",
      date: "2026-06-01",
      category: "Other",
      items: [],
      confidence: 0.5,
    });

    expect(validation.status).toBe("partial");
    expect(validation.missingFields).toContain("merchant");
  });

  it("requires amount for needs_review status", () => {
    const validation = validateReceiptParse(null);

    expect(validation.status).toBe("needs_review");
    expect(validation.missingFields).toContain("amount");
  });
});

describe("finance anomalies", () => {
  it("detects unusually large category expenses", () => {
    const result = detectFinanceAnomalies({
      currency: "KZT",
      transactions: [
        {
          amount: 500,
          currency: "KZT",
          categoryName: "Food",
          transactionType: "expense",
          occurredOn: "2026-06-01",
        },
        {
          amount: 600,
          currency: "KZT",
          categoryName: "Food",
          transactionType: "expense",
          occurredOn: "2026-06-02",
        },
        {
          amount: 5000,
          currency: "KZT",
          categoryName: "Food",
          transactionType: "expense",
          occurredOn: "2026-06-03",
        },
      ],
    });

    expect(result.anomalies.length).toBeGreaterThan(0);
    expect(result.anomalies[0]?.type).toBe("large_expense");
  });
});

describe("finance assistant", () => {
  const context = {
    report: {
      period: "monthly" as const,
      startDate: "2026-06-01",
      endDate: "2026-06-30",
      currency: "KZT",
      totalIncome: 100000,
      totalExpense: 45000,
      netFlow: 55000,
      categoryBreakdown: [
        {
          category: "Food",
          amount: 18000,
          count: 12,
          percentOfTotal: 40,
        },
      ],
      dailyTrend: [],
      topMerchants: [],
      periodComparison: null,
      overspentBudgets: [],
      recommendations: [],
    },
    budgets: [
      {
        budgetId: "b1",
        name: "Food",
        period: "monthly" as const,
        periodStart: "2026-06-01",
        periodEnd: "2026-06-30",
        currency: "KZT",
        planned: 15000,
        spent: 18000,
        remaining: -3000,
        overspent: 3000,
        totalLimit: 15000,
        totalSpent: 18000,
        totalRemaining: -3000,
        totalPercentUsed: 120,
        isOverspent: true,
        categories: [],
      },
    ],
    today: "2026-06-09",
  };

  it("answers monthly spending question deterministically", () => {
    const answer = interpretFinanceQuestion(
      "На что ушли деньги в этом месяце?",
      context,
    );

    expect(answer?.answer).toContain("Food");
    expect(answer?.usedAi).toBe(false);
  });

  it("forecasts month-end spending", () => {
    const forecast = forecastMonthEndExpense({
      totalExpense: 9000,
      startDate: "2026-06-01",
      endDate: "2026-06-30",
      today: "2026-06-10",
      currency: "KZT",
    });

    expect(forecast.projected).toBeGreaterThan(9000);
  });
});

describe("exchange rates", () => {
  it("builds cross currency quotes from provider payload", async () => {
    const quotes = await fetchDailyExchangeRates(async () =>
      Response.json({
        result: "success",
        time_last_update_utc: "2026-06-09 00:00:00",
        rates: { KZT: 450, EUR: 0.92, RUB: 90 },
      }),
    );

    expect(quotes.some((quote) => quote.fromCurrency === "USD")).toBe(true);
    expect(quotes.some((quote) => quote.toCurrency === "KZT")).toBe(true);
  });
});

describe("base currency settings", () => {
  it("normalizes supported base currencies", () => {
    expect(normalizeFinanceBaseCurrency("usd")).toBe("USD");
    expect(normalizeFinanceBaseCurrency("invalid")).toBe("KZT");
  });
});
