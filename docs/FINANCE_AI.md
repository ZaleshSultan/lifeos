# Finance AI

Finance AI is an optional layer on top of the deterministic finance ledger. The
base flow must work without an OpenRouter key.

## Default Behavior

- Manual and Telegram quick-entry flows use rule parsing first.
- Amounts are never invented; AI results are rejected when the parsed amount is
  not present in the original text.
- Sensitive card/account-like numbers are redacted before storage or AI calls.
- Canonical categories are English: `Food`, `Transport`, `Housing`,
  `Education`, `Entertainment`, `Health`, `Shopping`, `Other`, and `Income`.
- Russian words such as `eda`, `transport`, and their Cyrillic forms are input
  aliases only; stored standard category names remain canonical.

## OpenRouter Configuration

```text
FINANCE_AI_ENABLED=false
OPENROUTER_API_KEY=...
FINANCE_AI_MODEL=openai/gpt-4o-mini
```

Set `FINANCE_AI_ENABLED=true` only for processes that should call OpenRouter.
Missing keys, HTTP errors, invalid JSON, and unsafe parsed values fall back to
the deterministic parser.

## Supported AI Use Cases

- Expense categorization.
- Receipt JSON extraction from OCR text.
- Budget analysis.
- Anomaly detection.
- Spend forecasting.
- Finance recommendations.
- Habit analysis.

All persisted AI attempts should be auditable through `finance_ai_parse_runs` or
`finance_ai_analysis_runs`.

## Telegram Commands

```text
/spend 1200 shawarma
/income 20000 refund
/finance_ai spent 3500 taxi
/finance
/finance_today
/finance_week
/finance_month
/finance_categories
/finance_confirm <short_id>
/finance_cancel <short_id>
/finance_fix <short_id> amount:1500 category:Food
```

Quick input without slash is also supported when the message looks like a
finance entry, for example `Taxi 2700` or `-12000 Magnum food`.

## Receipt Output Shape

Receipt parsing uses rules-first extraction with optional OpenRouter enrichment.
Validation statuses:

- `linked` — amount and currency present, transaction confirmed
- `partial` — transaction saved as draft, optional fields missing
- `needs_review` — amount/currency missing, no transaction created

Optional OpenRouter vision can extract OCR text from receipt images when
`FINANCE_AI_ENABLED=true`.

```json
{
  "merchant": "",
  "amount": 0,
  "currency": "KZT",
  "date": "",
  "category": "",
  "items": []
}
```
