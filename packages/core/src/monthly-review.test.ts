import { describe, expect, it } from "vitest";
import {
  aggregateMonthlyReviewStats,
  buildMonthlyReviewMarkdown,
  redactMonthlyReviewText,
} from "./monthly-review.js";

describe("monthly review aggregation", () => {
  it("handles empty finance and health data", () => {
    const stats = aggregateMonthlyReviewStats({ periodMonth: "2026-06" });

    expect(stats.finance.totalExpense).toBe(0);
    expect(stats.finance.totalIncome).toBe(0);
    expect(stats.health.avgSteps).toBeNull();
    expect(stats.health.missingHealthDays).toHaveLength(30);
    expect(stats.productivity.remindersCreated).toBe(0);
  });

  it("calculates income, expense, and net cashflow", () => {
    const stats = aggregateMonthlyReviewStats({
      periodMonth: "2026-06",
      transactions: [
        {
          amount: 20000,
          transactionType: "income",
          status: "confirmed",
          category: "Доход",
          occurredOn: "2026-06-02",
        },
        {
          amount: 1200,
          transactionType: "expense",
          status: "confirmed",
          category: "Еда",
          description: "шаурма",
          occurredOn: "2026-06-03",
        },
        {
          amount: 3500,
          transactionType: "expense",
          status: "confirmed",
          category: "Транспорт",
          description: "такси",
          occurredOn: "2026-06-03",
        },
        {
          amount: 999,
          transactionType: "expense",
          status: "draft",
          category: "Другое",
          occurredOn: "2026-06-04",
        },
      ],
    });

    expect(stats.finance.totalIncome).toBe(20000);
    expect(stats.finance.totalExpense).toBe(4700);
    expect(stats.finance.netCashflow).toBe(15300);
    expect(stats.finance.draftCount).toBe(1);
    expect(stats.finance.topCategories[0]).toMatchObject({
      category: "Транспорт",
      amount: 3500,
    });
  });

  it("redacts card-like numbers", () => {
    expect(redactMonthlyReviewText("карта 4400 4300 1234 5678 такси")).toBe(
      "карта [REDACTED] такси",
    );
  });

  it("generates deterministic fallback markdown", () => {
    const markdown = buildMonthlyReviewMarkdown(
      aggregateMonthlyReviewStats({
        periodMonth: "2026-06",
        reminders: [
          {
            status: "sent",
            source: "google_tasks",
            createdAt: "2026-06-01T00:00:00.000Z",
            sentAt: "2026-06-01T10:00:00.000Z",
          },
        ],
      }),
    );

    expect(markdown).toContain("# LifeOS Monthly Review — 2026-06");
    expect(markdown).toContain("## 2. Финансы");
    expect(markdown).toContain("Google Tasks reminders: 1");
  });
});
