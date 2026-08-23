import type {
  BudgetSummary,
  CurrencyCode,
  FinanceAnomaly,
  FinanceAnomalyDetectionResult,
  FinanceReportData,
  FinanceReportPeriod,
  ExchangeRateQuote,
  ReceiptParseResult,
  ReceiptParseValidation,
  ReceiptValidationStatus,
} from "./finance-types.js";

export const DEFAULT_FINANCE_CURRENCY = "KZT";
export const BASE_FINANCE_CURRENCY = "KZT";

export const DEFAULT_EXPENSE_CATEGORIES = [
  "Food",
  "Transport",
  "Housing",
  "Education",
  "Entertainment",
  "Health",
  "Shopping",
  "Other",
] as const;

export const DEFAULT_FINANCE_CATEGORIES = [
  ...DEFAULT_EXPENSE_CATEGORIES,
  "Income",
] as const;

export type FinanceCategoryName = (typeof DEFAULT_FINANCE_CATEGORIES)[number];
export type FinanceEntryType = "expense" | "income";
export type FinanceParserSource = "rules" | "openrouter";

export interface FinanceParseResult {
  amount: number | null;
  currency: CurrencyCode;
  transactionType: FinanceEntryType;
  category: FinanceCategoryName | null;
  description: string;
  merchant: string | null;
  tags: string[];
  confidence: number;
  parser: FinanceParserSource;
  redactedText: string;
}

export interface FinanceParseOptions {
  transactionType?: FinanceEntryType;
  aiEnabled?: boolean;
  openRouterApiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

export type FinanceAiAnalysisRequestType =
  | "categorization"
  | "budget_analysis"
  | "anomaly_detection"
  | "forecast"
  | "recommendation"
  | "habit_analysis"
  | "assistant_query"
  | "receipt_parse";

export interface FinanceAssistantTransaction {
  amount: number;
  currency: string;
  categoryName: string | null;
  transactionType: "income" | "expense" | "transfer" | "adjustment";
  occurredOn: string;
  merchant?: string | null;
  description?: string | null;
}

export interface FinanceAssistantContext {
  report: FinanceReportData;
  budgets?: BudgetSummary[];
  recentTransactions?: FinanceAssistantTransaction[];
}

export interface FinanceAssistantResult {
  answer: string;
  recommendations: string[];
  risks: string[];
  model: string | null;
  usedAi: boolean;
}

export interface FinanceAssistantOptions {
  aiEnabled?: boolean;
  openRouterApiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

const CARD_OR_ACCOUNT_PATTERN = /(?<!\d)(?:\d[\s-]?){12,19}(?!\d)/g;
const AMOUNT_PATTERN =
  /(?<!\d)-?(\d{1,3}(?:[ \u00a0]\d{3})+|\d+)(?:[.,](\d{1,2}))?(?!\d)/g;
const CURRENCY_PATTERN =
  /\b(?:KZT|USD|EUR|RUB|тенге|тг|доллар(?:ов|а)?|евро|руб(?:лей|ля)?|рубль)\b|[$€??]/giu;
const TAG_PATTERN = /#([\p{L}\p{N}_-]{1,40})/gu;
const FINANCE_VERB_PATTERN =
  /(?:потратил(?:а)?|купил(?:а)?|оплатил(?:а)?|заплатил(?:а)?|расход|трата|получил(?:а)?|пришл[аои]|доход|зарплата|вернул(?:и|а)?|spent|paid|bought|income|salary)/iu;

const CATEGORY_RULES: Array<{
  category: FinanceCategoryName;
  pattern: RegExp;
}> = [
  {
    category: "Food",
    pattern:
      /(?:еда|обед|ужин|завтрак|кофе|кафе|ресторан|продукт\w*|магнум|small|шаурм\w*|донер|grocery|food|coffee|restaurant)/iu,
  },
  {
    category: "Transport",
    pattern:
      /(?:такси|indriver|яндекс\s*go|автобус|метро|транспорт|бензин|топливо|проезд|taxi|transport|fuel)/iu,
  },
  {
    category: "Housing",
    pattern:
      /(?:аренд\w*|квартир\w*|жиль[её]|коммунал\w*|интернет|свет|вода|газ|rent|housing|utilities)/iu,
  },
  {
    category: "Education",
    pattern:
      /(?:уч[её]б\w*|курс\w*|книг\w*|универ\w*|обучен\w*|education|study|course|book)/iu,
  },
  {
    category: "Entertainment",
    pattern:
      /(?:развлечен\w*|кино|игр\w*|концерт\w*|бар|клуб|театр|netflix|spotify|youtube|entertainment)/iu,
  },
  {
    category: "Health",
    pattern:
      /(?:здоровь\w*|аптек\w*|врач\w*|лекарств\w*|анализ\w*|стоматолог\w*|health|pharmacy|doctor)/iu,
  },
  {
    category: "Shopping",
    pattern:
      /(?:одежд\w*|обув\w*|техник\w*|ноутбук\w*|телефон\w*|наушник\w*|маркет|shopping|shop|clothes|electronics)/iu,
  },
  {
    category: "Income",
    pattern:
      /(?:доход\w*|зарплат\w*|получил\w*|пришл[аои]|вернул\w*|преми\w*|income|salary|refund)/iu,
  },
];

const CATEGORY_ALIASES: Record<string, FinanceCategoryName> = {
  еда: "Food",
  food: "Food",
  транспорт: "Transport",
  transport: "Transport",
  жилье: "Housing",
  жильё: "Housing",
  housing: "Housing",
  учеба: "Education",
  учёба: "Education",
  education: "Education",
  развлечения: "Entertainment",
  entertainment: "Entertainment",
  здоровье: "Health",
  health: "Health",
  покупки: "Shopping",
  shopping: "Shopping",
  другое: "Other",
  other: "Other",
  доход: "Income",
  income: "Income",
};

const INCOME_PATTERN =
  /(?:доход\w*|получил\w*|пришл[аои]|заработал\w*|зарплат\w*|вернул\w*|оплатили|income|salary|refund)/iu;
export function redactFinanceText(rawText: string): string {
  return rawText
    .replace(CARD_OR_ACCOUNT_PATTERN, " [REDACTED] ")
    .replace(/\s+/g, " ")
    .trim();
}

function amountFromMatch(match: RegExpMatchArray): number {
  const integer = (match[1] ?? "").replace(/[ \u00a0]/g, "");
  const decimal = match[2] ? `.${match[2]}` : "";
  return Number(`${integer}${decimal}`);
}

function amountsInText(rawText: string): number[] {
  return [...redactFinanceText(rawText).matchAll(AMOUNT_PATTERN)]
    .map(amountFromMatch)
    .filter((amount) => Number.isFinite(amount) && amount > 0);
}

const CURRENCY_ADJACENT_AMOUNT_PATTERN =
  /(?:(?:-?\d{1,3}(?:[ \u00a0]\d{3})+|-?\d+)(?:[.,]\d{1,2})?\s*(?:KZT|в‚ё|С‚РµРЅРіРµ|С‚Рі|USD|EUR|RUB|[$в‚¬в‚Ѕ]))|(?:(?:KZT|в‚ё|С‚РµРЅРіРµ|С‚Рі|USD|EUR|RUB|[$в‚¬в‚Ѕ])\s*(?:-?\d{1,3}(?:[ \u00a0]\d{3})+|-?\d+)(?:[.,]\d{1,2})?)/iu;

function selectBestAmount(rawText: string): number | null {
  const all = amountsInText(rawText);

  if (all.length <= 1) {
    return all[0] ?? null;
  }

  const adjacentMatch = redactFinanceText(rawText).match(
    CURRENCY_ADJACENT_AMOUNT_PATTERN,
  );

  if (adjacentMatch) {
    const adjacentAmounts = amountsInText(adjacentMatch[0]);

    if (adjacentAmounts.length > 0 && adjacentAmounts[0] !== undefined) {
      return adjacentAmounts[0];
    }
  }

  return all[0] ?? null;
}

export function normalizeFinanceCategory(
  value: unknown,
): FinanceCategoryName | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLocaleLowerCase("ru");
  const direct = DEFAULT_FINANCE_CATEGORIES.find(
    (item) => item.toLocaleLowerCase("en") === normalized,
  );

  return direct ?? CATEGORY_ALIASES[normalized] ?? null;
}

function inferCategory(text: string): FinanceCategoryName | null {
  return (
    CATEGORY_RULES.find((rule) => rule.pattern.test(text))?.category ?? null
  );
}

function inferTransactionType(
  text: string,
  forcedType?: FinanceEntryType,
): FinanceEntryType {
  return forcedType ?? (INCOME_PATTERN.test(text) ? "income" : "expense");
}

function descriptionWithoutAmount(text: string, amount: number | null): string {
  const withoutTags = text.replace(TAG_PATTERN, " ");
  const withoutAmount =
    amount === null ? withoutTags : withoutTags.replace(AMOUNT_PATTERN, " ");

  return withoutAmount
    .replace(CURRENCY_PATTERN, " ")
    .replace(
      /\b(?:РЅР°|Р·Р°|РїРѕС‚СЂР°С‚РёР»(?:Р°)?|РєСѓРїРёР»(?:Р°)?|РѕРїР»Р°С‚РёР»(?:Р°)?|РїРѕР»СѓС‡РёР»(?:Р°)?)\b/giu,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function extractTags(text: string): string[] {
  return [...text.matchAll(TAG_PATTERN)]
    .map((match) => match[1]?.toLocaleLowerCase("en"))
    .filter((value): value is string => Boolean(value));
}

function inferMerchant(description: string): string | null {
  const cleaned = description
    .replace(
      /\b(?:РєРѕС„Рµ|РїСЂРѕРґСѓРєС‚С‹|РµРґР°|С‚Р°РєСЃРё|СЂР°СЃС…РѕРґ|РґРѕС…РѕРґ)\b/giu,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
  const firstWord = cleaned.split(/\s+/)[0]?.trim();

  return firstWord && firstWord.length >= 2 ? firstWord : null;
}

export function detectCurrencyFromText(text: string): CurrencyCode {
  const normalized = text.toLocaleLowerCase("ru");

  if (/(?:usd|\$|РґРѕР»Р»Р°СЂ)/iu.test(normalized)) return "USD";
  if (/(?:eur|в‚¬|РµРІСЂРѕ)/iu.test(normalized)) return "EUR";
  if (/(?:rub|в‚Ѕ|СЂСѓР±)/iu.test(normalized)) return "RUB";

  return "KZT";
}

export function parseFinanceRules(
  rawText: string,
  transactionType?: FinanceEntryType,
): FinanceParseResult {
  const redactedText = redactFinanceText(rawText);
  const amount = selectBestAmount(rawText);
  const inferredType = inferTransactionType(redactedText, transactionType);
  const category =
    inferredType === "income"
      ? "Income"
      : (inferCategory(redactedText) ?? "Other");
  const description = descriptionWithoutAmount(redactedText, amount);
  const confidence = Math.min(
    1,
    (amount === null ? 0 : 0.55) +
      (category === null || category === "Other" ? 0.1 : 0.3) +
      (transactionType || INCOME_PATTERN.test(redactedText) ? 0.15 : 0.05),
  );

  return {
    amount,
    currency: detectCurrencyFromText(redactedText),
    transactionType: inferredType,
    category,
    description,
    merchant: inferMerchant(description),
    tags: extractTags(redactedText),
    confidence,
    parser: "rules",
    redactedText,
  };
}

function openRouterContent(body: unknown): string | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }

  const choices = (body as Record<string, unknown>).choices;

  if (
    !Array.isArray(choices) ||
    !choices[0] ||
    typeof choices[0] !== "object"
  ) {
    return null;
  }

  const message = (choices[0] as Record<string, unknown>).message;

  if (
    typeof message !== "object" ||
    message === null ||
    Array.isArray(message)
  ) {
    return null;
  }

  const content = (message as Record<string, unknown>).content;
  return typeof content === "string" ? content : null;
}

function parseOpenRouterJson(content: string): Record<string, unknown> | null {
  const match = content.match(/\{[\s\S]*\}/);

  if (!match) {
    return null;
  }

  try {
    const parsed = JSON.parse(match[0]);
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function boundedConfidence(value: unknown, fallback: number): number {
  return typeof value === "number" ? Math.max(0, Math.min(1, value)) : fallback;
}

export async function parseFinanceText(
  rawText: string,
  options: FinanceParseOptions = {},
): Promise<FinanceParseResult> {
  const fallback = parseFinanceRules(rawText, options.transactionType);

  if (
    !options.aiEnabled ||
    !options.openRouterApiKey ||
    fallback.amount === null
  ) {
    return fallback;
  }

  const fetchImpl = options.fetchImpl ?? fetch;

  try {
    const response = await fetchImpl(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.openRouterApiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: options.model ?? "openai/gpt-4o-mini",
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "Parse a personal finance entry in Russian or English. Return JSON with amount, currency (KZT|USD|EUR|RUB), transactionType (expense|income), category, merchant, description, tags, confidence. Never invent an amount; use only a number present in the text. Categories: " +
                DEFAULT_FINANCE_CATEGORIES.join(", "),
            },
            {
              role: "user",
              content: fallback.redactedText,
            },
          ],
        }),
      },
    );

    if (!response.ok) {
      return fallback;
    }

    const parsed = parseOpenRouterJson(
      openRouterContent(await response.json()) ?? "",
    );
    const aiAmount = typeof parsed?.amount === "number" ? parsed.amount : null;
    const presentAmounts = amountsInText(rawText);

    if (
      aiAmount === null ||
      !presentAmounts.some((amount) => Math.abs(amount - aiAmount) < 0.001)
    ) {
      return fallback;
    }

    const requestedType =
      parsed?.transactionType === "income" ||
      parsed?.transactionType === "expense"
        ? parsed.transactionType
        : fallback.transactionType;
    const resolvedType = options.transactionType ?? requestedType;
    const category =
      resolvedType === "income"
        ? "Income"
        : (normalizeFinanceCategory(parsed?.category) ?? fallback.category);
    const description =
      typeof parsed?.description === "string" && parsed.description.trim()
        ? redactFinanceText(parsed.description)
        : fallback.description;
    const merchant =
      typeof parsed?.merchant === "string" && parsed.merchant.trim()
        ? redactFinanceText(parsed.merchant)
        : fallback.merchant;
    const tags = Array.isArray(parsed?.tags)
      ? parsed.tags
          .filter((tag): tag is string => typeof tag === "string")
          .map((tag) => tag.replace(/^#/, "").toLocaleLowerCase("en"))
      : fallback.tags;
    const currency = normalizeCurrency(parsed?.currency) ?? fallback.currency;

    return {
      amount: aiAmount,
      currency,
      transactionType: resolvedType,
      category,
      description,
      merchant,
      tags,
      confidence: boundedConfidence(parsed?.confidence, fallback.confidence),
      parser: "openrouter",
      redactedText: fallback.redactedText,
    };
  } catch {
    return fallback;
  }
}

function normalizeCurrency(value: unknown): CurrencyCode | null {
  return value === "KZT" ||
    value === "USD" ||
    value === "EUR" ||
    value === "RUB"
    ? value
    : null;
}

function normalizeReceiptDate(value: unknown, fallback?: string): string {
  if (typeof value !== "string" || !value.trim()) {
    return fallback ?? new Date().toISOString().slice(0, 10);
  }

  const trimmed = value.trim();
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (isoMatch) {
    return trimmed;
  }

  const dotted = trimmed.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/);

  if (dotted) {
    const day = dotted[1]!.padStart(2, "0");
    const month = dotted[2]!.padStart(2, "0");
    const year =
      dotted[3]!.length === 2 ? `20${dotted[3]}` : dotted[3]!.padStart(4, "0");

    return `${year}-${month}-${day}`;
  }

  return fallback ?? new Date().toISOString().slice(0, 10);
}

function receiptFromFinanceRules(ocrText: string): ReceiptParseResult | null {
  const parsed = parseFinanceRules(ocrText, "expense");

  if (parsed.amount === null || parsed.amount <= 0) {
    return null;
  }

  const dateMatch = ocrText.match(
    /\b(\d{4}-\d{2}-\d{2}|\d{1,2}[./]\d{1,2}[./]\d{2,4})\b/,
  );
  const merchant =
    parsed.merchant?.trim() || parsed.description.trim() || "Unknown merchant";

  return {
    merchant,
    amount: parsed.amount,
    currency: parsed.currency,
    date: normalizeReceiptDate(dateMatch?.[1]),
    category: parsed.category ?? "Other",
    items: [],
    confidence: boundedConfidence(parsed.confidence * 0.85, 0.55),
  };
}

export function validateReceiptParse(
  result: ReceiptParseResult | null,
): ReceiptParseValidation {
  if (!result || !Number.isFinite(result.amount) || result.amount <= 0) {
    return {
      status: "needs_review",
      result,
      missingFields: ["amount"],
    };
  }

  if (!result.currency) {
    return {
      status: "needs_review",
      result,
      missingFields: ["currency"],
    };
  }

  const missingFields: string[] = [];

  if (!result.merchant?.trim() || result.merchant === "Unknown merchant") {
    missingFields.push("merchant");
  }

  if (!result.date?.trim()) {
    missingFields.push("date");
  }

  if (!normalizeFinanceCategory(result.category)) {
    missingFields.push("category");
  }

  const status: ReceiptValidationStatus =
    missingFields.length > 0 ? "partial" : "complete";

  return {
    status,
    result: {
      ...result,
      category: normalizeFinanceCategory(result.category) ?? "Other",
      merchant: result.merchant?.trim() || "Unknown merchant",
      date: normalizeReceiptDate(result.date),
    },
    missingFields,
  };
}

async function parseReceiptTextWithAi(
  ocrText: string,
  options: FinanceParseOptions,
): Promise<ReceiptParseResult | null> {
  const redactedText = redactFinanceText(ocrText);

  if (!options.aiEnabled || !options.openRouterApiKey || !redactedText) {
    return null;
  }

  const fetchImpl = options.fetchImpl ?? fetch;

  try {
    const response = await fetchImpl(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.openRouterApiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: options.model ?? "openai/gpt-4o-mini",
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "Extract a receipt into strict JSON: merchant, amount, currency, date, category, items, confidence. Currency must be KZT, USD, EUR, or RUB. Category must be one of: " +
                DEFAULT_EXPENSE_CATEGORIES.join(", "),
            },
            { role: "user", content: redactedText },
          ],
        }),
      },
    );

    if (!response.ok) {
      return null;
    }

    const parsed = parseOpenRouterJson(
      openRouterContent(await response.json()) ?? "",
    );
    const amount = typeof parsed?.amount === "number" ? parsed.amount : null;
    const merchant =
      typeof parsed?.merchant === "string" ? parsed.merchant.trim() : "";
    const currency = normalizeCurrency(parsed?.currency) ?? "KZT";
    const category = normalizeFinanceCategory(parsed?.category) ?? "Other";
    const date = normalizeReceiptDate(parsed?.date);

    if (amount === null || amount <= 0) {
      return null;
    }

    return {
      merchant: merchant || "Unknown merchant",
      amount,
      currency,
      date,
      category,
      items: normalizeReceiptItems(parsed?.items),
      confidence: boundedConfidence(parsed?.confidence, 0.75),
    };
  } catch {
    return null;
  }
}

export async function extractReceiptOcrText(
  imageBase64: string,
  mimeType: string,
  options: FinanceParseOptions = {},
): Promise<string | null> {
  if (!options.aiEnabled || !options.openRouterApiKey || !imageBase64.trim()) {
    return null;
  }

  const fetchImpl = options.fetchImpl ?? fetch;

  try {
    const response = await fetchImpl(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.openRouterApiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: options.model ?? "openai/gpt-4o-mini",
          temperature: 0,
          messages: [
            {
              role: "system",
              content:
                "Extract all visible text from this receipt image. Return plain text only, preserving line breaks.",
            },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Extract receipt text.",
                },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:${mimeType};base64,${imageBase64}`,
                  },
                },
              ],
            },
          ],
        }),
      },
    );

    if (!response.ok) {
      return null;
    }

    const content = openRouterContent(await response.json());

    return content?.trim() ? redactFinanceText(content) : null;
  } catch {
    return null;
  }
}

export function financeReportPeriodBounds(
  period: FinanceReportPeriod,
  anchorDate: string,
): { startDate: string; endDate: string } {
  const anchor = new Date(`${anchorDate}T00:00:00.000Z`);

  if (Number.isNaN(anchor.getTime())) {
    throw new Error("Finance report requires a valid anchor date");
  }

  if (period === "daily") {
    return { startDate: anchorDate, endDate: anchorDate };
  }

  if (period === "weekly") {
    const start = new Date(anchor);
    const weekday = start.getUTCDay() || 7;
    start.setUTCDate(start.getUTCDate() - weekday + 1);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 6);
    return {
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
    };
  }

  if (period === "monthly") {
    const start = new Date(anchor);
    start.setUTCDate(1);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);
    end.setUTCDate(0);
    return {
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
    };
  }

  if (period === "quarterly") {
    const start = new Date(anchor);
    const quarter = Math.floor(start.getUTCMonth() / 3);
    start.setUTCMonth(quarter * 3);
    start.setUTCDate(1);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 3);
    end.setUTCDate(0);
    return {
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
    };
  }

  const start = new Date(anchor);
  start.setUTCMonth(0);
  start.setUTCDate(1);
  const end = new Date(start);
  end.setUTCMonth(12);
  end.setUTCDate(0);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

export function previousFinanceReportPeriodBounds(input: {
  period: FinanceReportPeriod;
  startDate: string;
  endDate: string;
}): { startDate: string; endDate: string } {
  const start = new Date(`${input.startDate}T00:00:00.000Z`);
  const end = new Date(`${input.endDate}T00:00:00.000Z`);
  const dayCount =
    Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const previousEnd = new Date(start);
  previousEnd.setUTCDate(previousEnd.getUTCDate() - 1);
  const previousStart = new Date(previousEnd);
  previousStart.setUTCDate(previousStart.getUTCDate() - dayCount + 1);

  return {
    startDate: previousStart.toISOString().slice(0, 10),
    endDate: previousEnd.toISOString().slice(0, 10),
  };
}

export function buildFinanceReportRecommendations(input: {
  report: Pick<
    FinanceReportData,
    "totalExpense" | "categoryBreakdown" | "periodComparison"
  >;
  budgets?: BudgetSummary[];
}): {
  recommendations: string[];
  overspentBudgets: FinanceReportData["overspentBudgets"];
} {
  const recommendations: string[] = [];
  const topCategory = input.report.categoryBreakdown[0];
  const overspentBudgets = (input.budgets ?? [])
    .filter((budget) => budget.isOverspent)
    .map((budget) => ({
      budgetId: budget.budgetId,
      name: budget.name,
      overspent: budget.overspent,
      currency: budget.currency,
    }));

  if (topCategory) {
    recommendations.push(
      `Review ${topCategory.category}: it accounts for ${topCategory.percentOfTotal}% of expenses.`,
    );
  }

  if (input.report.periodComparison) {
    const { changeDirection, changePercent } = input.report.periodComparison;

    if (changeDirection === "up" && changePercent >= 10) {
      recommendations.push(
        `Expenses rose ${changePercent}% versus the previous period.`,
      );
    } else if (changeDirection === "down" && changePercent >= 10) {
      recommendations.push(
        `Expenses fell ${changePercent}% versus the previous period.`,
      );
    }
  }

  for (const budget of overspentBudgets.slice(0, 3)) {
    recommendations.push(
      `${budget.name ?? "Budget"} is overspent by ${budget.overspent} ${budget.currency}.`,
    );
  }

  if (!recommendations.length) {
    recommendations.push(
      "Keep categorizing transactions to improve analytics.",
    );
  }

  return { recommendations, overspentBudgets };
}

function normalizeReceiptItems(value: unknown): ReceiptParseResult["items"] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) {
        return null;
      }

      const record = item as Record<string, unknown>;
      const name = typeof record.name === "string" ? record.name.trim() : "";
      const quantity =
        typeof record.quantity === "number" && record.quantity > 0
          ? record.quantity
          : 1;
      const price =
        typeof record.price === "number"
          ? record.price
          : typeof record.total === "number"
            ? record.total
            : 0;

      if (!name) {
        return null;
      }

      return {
        name,
        quantity,
        price,
      };
    })
    .filter((item): item is ReceiptParseResult["items"][number] =>
      Boolean(item),
    );
}

export async function parseReceiptText(
  ocrText: string,
  options: FinanceParseOptions = {},
): Promise<ReceiptParseResult | null> {
  const redactedText = redactFinanceText(ocrText);

  if (!redactedText.trim()) {
    return null;
  }

  const aiResult = await parseReceiptTextWithAi(redactedText, options);
  const rulesResult = receiptFromFinanceRules(redactedText);

  if (aiResult && rulesResult) {
    const aiAmountMatchesRules =
      Math.abs(aiResult.amount - rulesResult.amount) < 0.01;

    if (aiAmountMatchesRules) {
      return {
        ...aiResult,
        merchant: aiResult.merchant || rulesResult.merchant,
        category: aiResult.category || rulesResult.category,
        date: aiResult.date || rulesResult.date,
        confidence: Math.max(aiResult.confidence, rulesResult.confidence),
      };
    }

    return rulesResult;
  }

  return aiResult ?? rulesResult;
}

function deterministicFinanceAnswer(
  question: string,
  context: FinanceAssistantContext,
): FinanceAssistantResult {
  const topCategory = context.report.categoryBreakdown[0];
  const overspent = (context.budgets ?? []).filter(
    (budget) => budget.isOverspent,
  );
  const recommendations = [
    topCategory
      ? `Check ${topCategory.category}: it is the largest expense category in this period.`
      : "Keep categorizing transactions so reports stay useful.",
    overspent.length
      ? `Review ${overspent.length} overspent budget envelope(s).`
      : "No overspent budget envelopes in the current summary.",
  ];

  return {
    answer: [
      `Period expense is ${context.report.totalExpense} ${context.report.currency}.`,
      topCategory
        ? `Top category is ${topCategory.category} (${topCategory.amount} ${context.report.currency}).`
        : "There is not enough category data yet.",
      question ? `Question: ${question}` : "",
    ]
      .filter(Boolean)
      .join(" "),
    recommendations,
    risks: overspent.map(
      (budget) =>
        `${budget.name ?? budget.period}: overspent by ${Math.abs(
          budget.totalRemaining,
        )} ${budget.currency}.`,
    ),
    model: null,
    usedAi: false,
  };
}

export async function analyzeFinanceQuestion(
  question: string,
  context: FinanceAssistantContext,
  options: FinanceAssistantOptions = {},
): Promise<FinanceAssistantResult> {
  const fallback = deterministicFinanceAnswer(question, context);

  if (!options.aiEnabled || !options.openRouterApiKey) {
    return fallback;
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const model = options.model ?? "openai/gpt-4o-mini";

  try {
    const response = await fetchImpl(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.openRouterApiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "You are a personal finance assistant. Use only the supplied LifeOS finance JSON. Return JSON with answer, recommendations array, risks array. Do not ask for secrets or bank credentials.",
            },
            {
              role: "user",
              content: JSON.stringify({
                question,
                context,
              }),
            },
          ],
        }),
      },
    );

    if (!response.ok) {
      return fallback;
    }

    const parsed = parseOpenRouterJson(
      openRouterContent(await response.json()) ?? "",
    );

    if (!parsed || typeof parsed.answer !== "string") {
      return fallback;
    }

    return {
      answer: parsed.answer,
      recommendations: Array.isArray(parsed.recommendations)
        ? parsed.recommendations.filter(
            (item): item is string => typeof item === "string",
          )
        : fallback.recommendations,
      risks: Array.isArray(parsed.risks)
        ? parsed.risks.filter(
            (item): item is string => typeof item === "string",
          )
        : fallback.risks,
      model,
      usedAi: true,
    };
  } catch {
    return fallback;
  }
}

export function looksLikeQuickFinanceInput(text: string): boolean {
  const parsed = parseFinanceRules(text, "expense");

  if (parsed.amount === null) {
    return false;
  }

  return (
    /^-\s*\d/.test(text.trim()) ||
    FINANCE_VERB_PATTERN.test(text) ||
    parsed.category !== "Other" ||
    CURRENCY_ADJACENT_AMOUNT_PATTERN.test(text)
  );
}

export function looksLikeFinanceQuestion(text: string): boolean {
  const normalized = text.trim().toLocaleLowerCase("ru");

  return (
    /(?:на что|куда|почему|прогноз|анomal|нетипич|бюджет|категор|расход|доход|потратил|forecast|budget|spending)/iu.test(
      normalized,
    ) && normalized.length >= 8
  );
}

function median(values: number[]): number {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

export function detectFinanceAnomalies(input: {
  transactions: FinanceAssistantTransaction[];
  currency: string;
}): FinanceAnomalyDetectionResult {
  const expenses = input.transactions.filter(
    (item) => item.transactionType === "expense",
  );
  const anomalies: FinanceAnomaly[] = [];

  if (!expenses.length) {
    return {
      anomalies,
      summary: "Not enough expense history to detect anomalies yet.",
    };
  }

  const amounts = expenses.map((item) => item.amount);
  const overallMedian = median(amounts);
  const overallAverage =
    amounts.reduce((total, amount) => total + amount, 0) / amounts.length;
  const byCategory = new Map<string, number[]>();

  for (const expense of expenses) {
    const category = expense.categoryName ?? "Other";
    const current = byCategory.get(category) ?? [];
    current.push(expense.amount);
    byCategory.set(category, current);
  }

  for (const expense of expenses.slice(0, 60)) {
    const category = expense.categoryName ?? "Other";
    const categoryAmounts = byCategory.get(category) ?? [];
    const categoryMedian = median(categoryAmounts);
    const categoryAverage =
      categoryAmounts.reduce((total, amount) => total + amount, 0) /
      Math.max(categoryAmounts.length, 1);

    if (
      categoryMedian > 0 &&
      expense.amount >= categoryMedian * 2.5 &&
      expense.amount >= categoryAverage * 2
    ) {
      anomalies.push({
        transactionId: null,
        categoryName: category,
        merchant: expense.merchant ?? null,
        amount: expense.amount,
        currency: expense.currency,
        occurredOn: expense.occurredOn,
        type: "large_expense",
        severity: expense.amount >= categoryMedian * 4 ? "high" : "medium",
        reason: `${category} expense ${expense.amount} ${expense.currency} is much higher than your usual ${Math.round(categoryMedian)} ${input.currency}.`,
      });
      continue;
    }

    if (overallAverage > 0 && expense.amount >= overallAverage * 3) {
      anomalies.push({
        transactionId: null,
        categoryName: category,
        merchant: expense.merchant ?? null,
        amount: expense.amount,
        currency: expense.currency,
        occurredOn: expense.occurredOn,
        type: "daily_spike",
        severity: expense.amount >= overallAverage * 5 ? "high" : "medium",
        reason: `${expense.amount} ${expense.currency} is unusually high versus your average expense of ${Math.round(overallAverage)} ${input.currency}.`,
      });
    }
  }

  const weekAgo = new Date();
  weekAgo.setUTCDate(weekAgo.getUTCDate() - 7);
  const weekStart = weekAgo.toISOString().slice(0, 10);
  const monthAgo = new Date();
  monthAgo.setUTCDate(monthAgo.getUTCDate() - 28);
  const monthStart = monthAgo.toISOString().slice(0, 10);

  for (const [category, categoryAmounts] of byCategory.entries()) {
    const thisWeek = expenses
      .filter(
        (item) =>
          (item.categoryName ?? "Other") === category &&
          item.occurredOn >= weekStart,
      )
      .reduce((total, item) => total + item.amount, 0);
    const previousWeeks = expenses
      .filter(
        (item) =>
          (item.categoryName ?? "Other") === category &&
          item.occurredOn >= monthStart &&
          item.occurredOn < weekStart,
      )
      .reduce((total, item) => total + item.amount, 0);
    const weeklyBaseline = previousWeeks / 3;

    if (weeklyBaseline > 0 && thisWeek >= weeklyBaseline * 2) {
      anomalies.push({
        transactionId: null,
        categoryName: category,
        merchant: null,
        amount: thisWeek,
        currency: input.currency,
        occurredOn: weekStart,
        type: "category_spike",
        severity: thisWeek >= weeklyBaseline * 3 ? "high" : "medium",
        reason: `${category} spending this week (${thisWeek} ${input.currency}) is well above your recent weekly norm (${Math.round(weeklyBaseline)} ${input.currency}).`,
      });
    }

    if (categoryAmounts.length < 2) {
      continue;
    }
  }

  const deduped = anomalies.filter(
    (item, index, list) =>
      list.findIndex(
        (candidate) =>
          candidate.type === item.type &&
          candidate.categoryName === item.categoryName &&
          candidate.occurredOn === item.occurredOn &&
          candidate.amount === item.amount,
      ) === index,
  );

  return {
    anomalies: deduped.slice(0, 8),
    summary: deduped.length
      ? `Detected ${deduped.length} unusual spending pattern(s).`
      : "No unusual spending patterns detected.",
  };
}

export function forecastMonthEndExpense(input: {
  totalExpense: number;
  startDate: string;
  endDate: string;
  today: string;
  currency: string;
}): { projected: number; remainingDays: number; dailyAverage: number } {
  const start = new Date(`${input.startDate}T00:00:00.000Z`);
  const end = new Date(`${input.endDate}T00:00:00.000Z`);
  const today = new Date(`${input.today}T00:00:00.000Z`);
  const elapsedDays =
    Math.max(
      1,
      Math.round((today.getTime() - start.getTime()) / 86_400_000) + 1,
    ) || 1;
  const remainingDays = Math.max(
    0,
    Math.round((end.getTime() - today.getTime()) / 86_400_000),
  );
  const dailyAverage = input.totalExpense / elapsedDays;
  const projected =
    Math.round((input.totalExpense + dailyAverage * remainingDays) * 100) / 100;

  return { projected, remainingDays, dailyAverage };
}

export function interpretFinanceQuestion(
  question: string,
  context: FinanceAssistantContext & {
    anomalies?: FinanceAnomaly[];
    today?: string;
  },
): FinanceAssistantResult | null {
  const normalized = question.trim().toLocaleLowerCase("ru");
  const topCategory = context.report.categoryBreakdown[0];
  const overspent = (context.budgets ?? []).filter(
    (budget) => budget.isOverspent,
  );
  const forecast =
    context.today && context.report.period === "monthly"
      ? forecastMonthEndExpense({
          totalExpense: context.report.totalExpense,
          startDate: context.report.startDate,
          endDate: context.report.endDate,
          today: context.today,
          currency: context.report.currency,
        })
      : null;

  if (
    /(?:на что|куда).*(?:ушл|трат|потрат)/iu.test(normalized) ||
    /where did.*go/iu.test(normalized)
  ) {
    return {
      answer: topCategory
        ? `This month the largest expense category is ${topCategory.category}: ${topCategory.amount} ${context.report.currency} (${topCategory.percentOfTotal}%).`
        : `Total expenses this period are ${context.report.totalExpense} ${context.report.currency}.`,
      recommendations: context.report.categoryBreakdown
        .slice(0, 3)
        .map(
          (item) =>
            `${item.category}: ${item.amount} ${context.report.currency}`,
        ),
      risks: overspent.map(
        (budget) =>
          `${budget.name ?? budget.period} overspent by ${budget.overspent} ${budget.currency}.`,
      ),
      model: null,
      usedAi: false,
    };
  }

  if (/(?:самые дорог|top categor|категор.*дорог)/iu.test(normalized)) {
    return {
      answer: context.report.categoryBreakdown.length
        ? `Top categories: ${context.report.categoryBreakdown
            .slice(0, 5)
            .map(
              (item) =>
                `${item.category} (${item.amount} ${context.report.currency})`,
            )
            .join(", ")}.`
        : "There is not enough category data yet.",
      recommendations: [],
      risks: [],
      model: null,
      usedAi: false,
    };
  }

  if (/(?:превысил|overspent|почему.*бюджет)/iu.test(normalized)) {
    return {
      answer: overspent.length
        ? `You exceeded ${overspent.length} budget envelope(s). Biggest overspend: ${overspent[0]!.name ?? overspent[0]!.period} by ${overspent[0]!.overspent} ${overspent[0]!.currency}.`
        : "No overspent budgets in the current summary.",
      recommendations: overspent.map(
        (budget) =>
          `Review ${budget.name ?? budget.period}: spent ${budget.spent} of ${budget.planned} ${budget.currency}.`,
      ),
      risks: [],
      model: null,
      usedAi: false,
    };
  }

  if (/(?:прогноз|forecast|до конца месяца)/iu.test(normalized) && forecast) {
    return {
      answer: `At the current pace (${Math.round(forecast.dailyAverage)} ${context.report.currency}/day), projected month-end spending is about ${forecast.projected} ${context.report.currency}.`,
      recommendations: [
        `You have ${forecast.remainingDays} day(s) left in the period.`,
      ],
      risks:
        forecast.projected > context.report.totalExpense * 1.25
          ? ["Projected spending is trending above the current total."]
          : [],
      model: null,
      usedAi: false,
    };
  }

  if (/(?:анomal|нетипич|странн.*трат)/iu.test(normalized)) {
    const anomalies = context.anomalies ?? [];

    return {
      answer: anomalies.length
        ? anomalies
            .slice(0, 3)
            .map((item) => item.reason)
            .join(" ")
        : "No anomalous spending detected in the current period.",
      recommendations: anomalies
        .slice(0, 3)
        .map(
          (item) =>
            `Review ${item.categoryName ?? "expense"} on ${item.occurredOn}.`,
        ),
      risks: anomalies
        .filter((item) => item.severity === "high")
        .map((item) => item.reason),
      model: null,
      usedAi: false,
    };
  }

  return null;
}

export async function fetchDailyExchangeRates(
  fetchImpl: typeof fetch = fetch,
): Promise<ExchangeRateQuote[]> {
  const response = await fetchImpl("https://open.er-api.com/v6/latest/USD");

  if (!response.ok) {
    throw new Error("Failed to fetch exchange rates");
  }

  const body = (await response.json()) as {
    result?: string;
    time_last_update_utc?: string;
    rates?: Record<string, number>;
  };

  if (body.result !== "success" || !body.rates) {
    throw new Error("Exchange rate payload was invalid");
  }

  const supported: CurrencyCode[] = ["KZT", "USD", "EUR", "RUB"];
  const usdRates: Record<CurrencyCode, number> = {
    USD: 1,
    KZT: body.rates.KZT ?? 0,
    EUR: body.rates.EUR ?? 0,
    RUB: body.rates.RUB ?? 0,
  };
  const rateDate = body.time_last_update_utc
    ? body.time_last_update_utc.slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const quotes: ExchangeRateQuote[] = [];

  for (const fromCurrency of supported) {
    for (const toCurrency of supported) {
      if (fromCurrency === toCurrency) {
        continue;
      }

      const fromRate = usdRates[fromCurrency];
      const toRate = usdRates[toCurrency];

      if (!fromRate || !toRate) {
        continue;
      }

      quotes.push({
        fromCurrency,
        toCurrency,
        rate: Math.round((toRate / fromRate) * 1_000_000) / 1_000_000,
        rateDate,
        source: "open.er-api.com",
      });
    }
  }

  return quotes;
}

export function normalizeFinanceBaseCurrency(value: unknown): CurrencyCode {
  const normalized =
    typeof value === "string" ? value.trim().toUpperCase() : "";
  return normalized === "USD" ||
    normalized === "EUR" ||
    normalized === "RUB" ||
    normalized === "KZT"
    ? normalized
    : DEFAULT_FINANCE_CURRENCY;
}
