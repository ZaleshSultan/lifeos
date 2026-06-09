# Finance Module

Finance is the single source of truth for user money data across Supabase,
Telegram Bot, Telegram Mini App, Web App, Obsidian sync, and optional AI
analysis.

## Audit

Existing reusable assets:

- Supabase migrations:
  - `20260518020400_finance_layer.sql`: base accounts, categories,
    transactions, budgets, recurring rules, AI parse runs, and RLS.
  - `20260607000300_finance_v1.sql`: KZT defaults, transaction status/source
    fields, default account/category seeding.
  - `20260610000100_finance_v2.sql`: custom budget periods, tags,
    currencies, exchange rates, reimbursements, and receipts.
  - `20260610000200_finance_ssot.sql`: budget category limits, budget status
    view, base-currency transaction fields, receipt items, and AI analysis
    runs.
- Core finance parser and OpenRouter adapter in `packages/core/src/finance.ts`.
- Supabase store facade in `packages/db/src/lifeos-store.ts`.
- Shared generated-style database types in `packages/db/src/types.ts`.
- Telegram commands in `apps/bot/src/telegram/commands.ts`.
- Web finance dashboard shell in `apps/web/app/(dashboard)/finance/page.tsx`.
- TMA finance integration in `apps/tma/src/screens/FinanceScreen.tsx` with
  transaction entry, budget management, and analytics via `/api/tma/finance`.

Duplications removed or avoided:

- No parallel finance schema was introduced.
- Existing `finance_*` tables remain canonical.
- Standard categories are canonical English names with Russian aliases handled
  at parser/input boundaries.
- AI parsing and analysis are optional; rule parsing and manual ledger writes
  work without OpenRouter.

## Domain Model

Canonical finance domain:

- Accounts: `finance_accounts`
- Transactions: `finance_transactions`
- Categories: `finance_categories`
- Budgets: `finance_budgets`
- BudgetPeriods and category envelopes: `finance_budget_categories`
- Reports: store aggregation methods and export API payloads
- Receipts: `finance_receipts`, `finance_receipt_items`
- RecurringExpenses: `finance_recurring_rules`
- Reimbursements: `finance_reimbursements`
- Currencies: `finance_currencies`, `finance_exchange_rates`
- AI Analysis: `finance_ai_parse_runs`, `finance_ai_analysis_runs`

RLS ownership stays user-scoped through `user_id = auth.uid()` policies in the
existing finance migrations.

## Data Rules

- Default base currency is `KZT`.
- Supported currencies are `KZT`, `USD`, `EUR`, and `RUB`.
- Transaction rows store both original `amount/currency` and normalized
  `base_amount/base_currency/exchange_rate`.
- Standard expense categories are `Food`, `Transport`, `Housing`,
  `Education`, `Entertainment`, `Health`, `Shopping`, and `Other`.
- User categories remain supported through `finance_categories`.
- Tags are stored on the transaction row for fast reads and mirrored into
  `finance_transaction_tags` for normalized querying.
- Budget analytics are computed from confirmed expense transactions in base
  currency and exposed as planned, spent, remaining, overspent, and percent
  used.

## Runtime Architecture

Folder responsibilities:

- `packages/core/src/finance.ts`: deterministic parsing, optional OpenRouter
  calls, receipt JSON parsing, category normalization, report/assistant types.
- `packages/db/src/types.ts`: Supabase table/view TypeScript contracts.
- `packages/db/src/lifeos-store.ts`: single application API over Supabase.
- `apps/bot/src/telegram/commands.ts`: slash commands and quick expense input.
- `apps/tma/src/api/types.ts`: TMA wire types.
- `apps/tma/src/screens/FinanceScreen.tsx`: mobile finance surface with
  expense entry, budget create/edit/archive, and analytics UI.
- `apps/bot/src/server.ts`: TMA finance API routes.
- `apps/web/app/(dashboard)/finance/page.tsx`: web dashboard entry point.
- `docs/FINANCE_AI.md`: AI parser/assistant operational notes.

## Implemented API Surface

Store methods include:

- `createFinanceTransaction`, `updateFinanceTransaction`
- `listFinanceTransactions`, `getFinanceReport`, `getFinanceSummary`
- `createBudget`, `updateBudget`, `deleteBudget`
- `listBudgets`, `archiveBudget`, `getBudgetSummaries`
- `createRecurringRule`, `listRecurringRules`, `runDueRecurringRules`
- `createReceipt`, `processReceiptOcrText`, `listReceipts`
- `createReimbursement`, `updateReimbursement`, `listReimbursements`
- `answerFinanceQuestion`, `recordFinanceAiAnalysisRun`
- `exportFinanceReport`

## Telegram Flow

Supported entry points:

- `/spend 1200 shawarma`
- `/income 20000 refund`
- `/finance_ai spent 3500 taxi`
- `/finance_ask <question>` — finance assistant (monthly spend, categories, budget, forecast, anomalies)
- Quick text without slash, for example `Taxi 2700` or `-12000 Magnum food`

The parser extracts amount, currency, transaction type, category, merchant,
description, and tags. Quick/manual flows use rules first and only call
OpenRouter when explicitly enabled for AI flows.

## Receipt Flow

Receipt pipeline:

1. Image uploads to Supabase Storage bucket `receipts`.
2. OCR text is extracted optionally via OpenRouter vision, or supplied by caller.
3. OCR text is stored on `finance_receipts`.
4. Rules-first parsing with optional OpenRouter enrichment.
5. Validation marks receipts as `linked`, `partial`, or `needs_review`.
6. Parsed receipts create `finance_transactions` rows with source
   `receipt_import` (draft when partial).
7. Line items are stored in `finance_receipt_items`.
8. AI attempts are audited in `finance_ai_analysis_runs`.

Expected JSON shape:

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

## TMA Finance API

- `GET /api/tma/finance` — summary via `getTmaFinanceSummary()`
- `GET /api/tma/finance/categories` — expense/income categories
- `GET /api/tma/finance/settings` — user base currency
- `POST /api/tma/finance/settings` — save base currency (`KZT|USD|EUR|RUB`)
- `POST /api/tma/finance/receipts` — upload receipt image (base64) and run pipeline
- `GET /api/tma/finance/receipts` — recent receipt statuses
- `POST /api/tma/finance/transactions` — create expense/income
- `POST /api/tma/finance/budgets` — create budget
- `PATCH /api/tma/finance/budgets/:id` — update budget
- `POST /api/tma/finance/budgets/:id/archive` — archive budget

## Migration Plan

1. Apply finance migrations in timestamp order.
2. Keep existing `finance_accounts`, `finance_categories`,
   `finance_transactions`, `finance_budgets`, and `finance_recurring_rules`
   data.
3. Run `20260610000100_finance_v2.sql`, `20260610000200_finance_ssot.sql`,
   and `20260610000300_finance_receipts_storage.sql`
   to add tags, currencies, reimbursements, receipts, base-currency columns,
   and budget category limits.
4. Let `LifeOSStore.ensureFinanceDefaults` lazily backfill default account and
   standard categories for users that do not have them yet.
5. For old Russian category names, keep rows for historical display if already
   present, but write new standard rows using canonical English category names.
6. Backfill `base_amount/base_currency` for historical transactions where null
   using `amount` and the user's base currency, unless a reliable exchange rate
   exists for the transaction date.

## Export

`exportFinanceReport` returns report payloads for:

- CSV: `text/csv`
- XLSX: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- PDF: `application/pdf`

The XLSX/PDF writers are intentionally dependency-free and generate compact
single-sheet or single-page reports suitable for HTTP download responses.
