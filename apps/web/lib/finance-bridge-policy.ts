// The shared Finance forms use just these user-owned resources.
const budget =
  /^finance\/budgets\/[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$/;
const archive =
  /^finance\/budgets\/[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}\/archive$/;
export const financeResources = [
  { pattern: /^finance\/categories$/, methods: ["GET"] },
  { pattern: /^finance\/(transactions|budgets|settings)$/, methods: ["POST"] },
  { pattern: budget, methods: ["PATCH"] },
  { pattern: archive, methods: ["POST"] },
];

function onlyKeys(
  value: unknown,
  keys: string[],
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => keys.includes(key))
  );
}

function amount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function optionalText(value: unknown) {
  return value == null || typeof value === "string";
}

function validDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const date = new Date(value + "T00:00:00Z");
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().startsWith(value + "T")
  );
}

export function financeMutationBodyError(
  path: string,
  payload: unknown,
): string | null {
  if (path === "finance/transactions") {
    const valid =
      onlyKeys(payload, [
        "amount",
        "category",
        "transactionType",
        "description",
        "merchant",
        "tags",
      ]) &&
      amount(payload.amount) &&
      payload.amount > 0 &&
      typeof payload.category === "string" &&
      payload.category.trim() !== "" &&
      payload.transactionType === "expense" &&
      optionalText(payload.description) &&
      optionalText(payload.merchant) &&
      (payload.tags === undefined ||
        (Array.isArray(payload.tags) &&
          payload.tags.every((tag) => typeof tag === "string")));
    return valid ? null : "invalid_finance_transaction_payload";
  }
  if (path === "finance/settings") {
    const valid =
      onlyKeys(payload, ["baseCurrency"]) &&
      typeof payload.baseCurrency === "string" &&
      ["KZT", "USD", "EUR", "RUB"].includes(payload.baseCurrency);
    return valid ? null : "invalid_base_currency";
  }
  if (path === "finance/budgets") {
    const valid =
      onlyKeys(payload, ["name", "amount", "period", "periodStart"]) &&
      optionalText(payload.name) &&
      amount(payload.amount) &&
      payload.period === "monthly" &&
      validDate(payload.periodStart);
    return valid ? null : "invalid_budget";
  }
  if (budget.test(path)) {
    const valid =
      onlyKeys(payload, ["name", "amount"]) &&
      typeof payload.name === "string" &&
      amount(payload.amount);
    return valid ? null : "invalid_budget";
  }
  if (archive.test(path) && !onlyKeys(payload, [])) return "invalid_budget";
  return null;
}
