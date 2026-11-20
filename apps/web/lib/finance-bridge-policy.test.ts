import { describe, expect, it } from "vitest";
import {
  bridgeMutationBodyError,
  bridgeResourceAllowed,
} from "./bridge-policy";

const id = "22c1ee70-a16a-41ec-87e4-a5b09eddca4d";
const budget = "finance/budgets/" + id;

describe("same-origin personal finance forms", () => {
  it("admits only their exact routes and methods", () => {
    for (const [path, method] of [
      ["finance", "GET"],
      ["finance/categories", "GET"],
      ["finance/settings", "POST"],
      ["finance/transactions", "POST"],
      ["finance/budgets", "POST"],
      [budget, "PATCH"],
      [budget + "/archive", "POST"],
    ])
      expect(bridgeResourceAllowed(path, method)).toBe(true);
    for (const [path, method] of [
      ["finance/backfill", "POST"],
      ["finance/receipts", "POST"],
      ["finance/receipts", "GET"],
      ["finance/receipts/" + id + "/image", "GET"],
      ["finance/receipts/" + id + "/review", "POST"],
      ["finance/transactions", "GET"],
      ["finance/categories", "POST"],
      ["finance/budgets/not-an-id", "PATCH"],
      [budget, "DELETE"],
      [budget + "/archive", "GET"],
    ])
      expect(bridgeResourceAllowed(path, method)).toBe(false);
  });
  it("accepts the expense, currency, monthly budget and archive payloads emitted by the shared forms", () => {
    const expense = {
      amount: 750,
      category: "Lunch",
      description: null,
      merchant: "Cafe",
      tags: ["lunch"],
      transactionType: "expense",
    };
    const monthly = {
      name: null,
      amount: 0,
      period: "monthly",
      periodStart: "2026-11-01",
    };
    for (const [path, body] of [
      ["finance/transactions", expense],
      ["finance/settings", { baseCurrency: "KZT" }],
      ["finance/budgets", monthly],
      [budget, { name: "Monthly living", amount: 1000 }],
      [budget + "/archive", {}],
    ] as const)
      expect(bridgeMutationBodyError(path, body)).toBeNull();
    for (const [path, body] of [
      ["finance/transactions", { ...expense, amount: 0 }],
      ["finance/transactions", { ...expense, tags: [{}] }],
      ["finance/transactions", { ...expense, userId: "other" }],
      ["finance/settings", { baseCurrency: "ABC" }],
      ["finance/settings", { baseCurrency: "KZT", payer: "other" }],
      ["finance/budgets", { ...monthly, periodStart: "2026-02-30" }],
      ["finance/budgets", { ...monthly, amount: -1 }],
      [budget, { name: "Test", amount: -1 }],
      [budget + "/archive", { owner: "other" }],
    ] as const)
      expect(bridgeMutationBodyError(path, body)).not.toBeNull();
  });
});
