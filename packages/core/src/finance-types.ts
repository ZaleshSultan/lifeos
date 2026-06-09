/**
 * Finance domain types shared across LifeOS surfaces.
 */

export type CurrencyCode = "KZT" | "USD" | "EUR" | "RUB";

export type RecurringCadence = "daily" | "weekly" | "monthly" | "yearly";

export type FinanceTransactionSource =
  | "manual"
  | "import"
  | "telegram"
  | "receipt_import"
  | "recurring"
  | "rules"
  | "openrouter";

export type FinanceBudgetPeriod =
  | "weekly"
  | "monthly"
  | "quarterly"
  | "yearly"
  | "custom";

export type FinanceReimbursementStatus =
  | "pending"
  | "partial"
  | "completed"
  | "cancelled";

export type FinanceReceiptStatus =
  | "uploaded"
  | "processing"
  | "parsed"
  | "linked"
  | "partial"
  | "needs_review"
  | "failed";

export type FinanceExportFormat = "csv" | "xlsx" | "pdf";

export type FinanceReportPeriod =
  | "daily"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "yearly";

export interface CurrencyInfo {
  code: CurrencyCode;
  name: string;
  symbol: string;
  decimalPlaces: number;
}

export const SUPPORTED_CURRENCIES: readonly CurrencyInfo[] = [
  { code: "KZT", name: "Kazakhstani tenge", symbol: "KZT", decimalPlaces: 2 },
  { code: "USD", name: "US dollar", symbol: "$", decimalPlaces: 2 },
  { code: "EUR", name: "Euro", symbol: "EUR", decimalPlaces: 2 },
  { code: "RUB", name: "Russian ruble", symbol: "RUB", decimalPlaces: 2 },
] as const;

export const DEFAULT_TAGS = ["work", "family", "study", "travel"] as const;
export type DefaultTag = (typeof DEFAULT_TAGS)[number];

export interface ExchangeRate {
  fromCurrency: CurrencyCode;
  toCurrency: CurrencyCode;
  rate: number;
  rateDate: string;
}

export interface BudgetCategorySummary {
  categoryId: string;
  categoryName: string;
  limit: number;
  spent: number;
  remaining: number;
  percentUsed: number;
  isOverspent: boolean;
}

export interface BudgetSummary {
  budgetId: string;
  name: string | null;
  period: FinanceBudgetPeriod;
  periodStart: string;
  periodEnd: string;
  currency: string;
  planned: number;
  spent: number;
  remaining: number;
  overspent: number;
  totalLimit: number;
  totalSpent: number;
  totalRemaining: number;
  totalPercentUsed: number;
  isOverspent: boolean;
  categories: BudgetCategorySummary[];
}

export interface FinanceReportData {
  period: FinanceReportPeriod;
  startDate: string;
  endDate: string;
  currency: string;
  totalIncome: number;
  totalExpense: number;
  netFlow: number;
  categoryBreakdown: Array<{
    category: string;
    amount: number;
    count: number;
    percentOfTotal: number;
  }>;
  dailyTrend: Array<{
    date: string;
    income: number;
    expense: number;
  }>;
  topMerchants: Array<{
    merchant: string;
    amount: number;
    count: number;
  }>;
  periodComparison: {
    previousPeriodExpense: number;
    changePercent: number;
    changeDirection: "up" | "down" | "flat";
  } | null;
  overspentBudgets: Array<{
    budgetId: string;
    name: string | null;
    overspent: number;
    currency: string;
  }>;
  recommendations: string[];
}

export type ReceiptValidationStatus = "complete" | "partial" | "needs_review";

export interface ReceiptParseValidation {
  status: ReceiptValidationStatus;
  result: ReceiptParseResult | null;
  missingFields: string[];
}

export type FinanceAnomalyType =
  | "large_expense"
  | "category_spike"
  | "daily_spike";

export type FinanceAnomalySeverity = "low" | "medium" | "high";

export interface FinanceAnomaly {
  transactionId: string | null;
  categoryName: string | null;
  merchant: string | null;
  amount: number;
  currency: string;
  occurredOn: string;
  type: FinanceAnomalyType;
  severity: FinanceAnomalySeverity;
  reason: string;
}

export interface FinanceAnomalyDetectionResult {
  anomalies: FinanceAnomaly[];
  summary: string;
}

export interface ExchangeRateQuote {
  fromCurrency: CurrencyCode;
  toCurrency: CurrencyCode;
  rate: number;
  rateDate: string;
  source: string;
}

export type TmaReceiptDisplayStatus =
  | "processing"
  | "partial"
  | "needs_review"
  | "completed"
  | "failed";

export interface ReceiptParseResult {
  merchant: string;
  amount: number;
  currency: CurrencyCode;
  date: string;
  category: string;
  items: Array<{
    name: string;
    quantity: number;
    price: number;
  }>;
  confidence: number;
}

/** Compute next due date for a recurring cadence. */
export function advanceNextDueDate(
  currentDue: string,
  cadence: RecurringCadence,
): string {
  const date = new Date(`${currentDue}T00:00:00.000Z`);

  switch (cadence) {
    case "daily":
      date.setUTCDate(date.getUTCDate() + 1);
      break;
    case "weekly":
      date.setUTCDate(date.getUTCDate() + 7);
      break;
    case "monthly":
      date.setUTCMonth(date.getUTCMonth() + 1);
      break;
    case "yearly":
      date.setUTCFullYear(date.getUTCFullYear() + 1);
      break;
  }

  return date.toISOString().slice(0, 10);
}

/** Convert amount between currencies using a rate. */
export function convertCurrency(amount: number, rate: number): number {
  return Math.round(amount * rate * 100) / 100;
}
