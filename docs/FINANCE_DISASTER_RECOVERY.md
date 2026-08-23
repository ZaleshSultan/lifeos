# Finance Module Disaster Recovery Runbook

This document details recovery procedures for the LifeOS Finance module to maintain Single Source of Truth (SSOT) integrity during failures.

## 1. AI Parsing Failures (OpenRouter / Model Errors)

If a receipt fails to parse due to OpenAI/OpenRouter timeouts or bad JSON formatting, its status is set to `failed`.

**Recovery Procedure:**

1. Open the receipt in the TMA interface; the UI will show it as `failed` with the parsing error.
2. The user can manually review and edit the missing data using the fallback manual review form.
3. Submitting the manual review will set the status to `linked` and create the corresponding transaction automatically.

> [!TIP]
> Alternatively, developers can reset the status to `uploaded` in the `finance_receipts` table to allow the automated webhook or script to re-process it.

## 2. Push Alert De-synchronization

Alerts (overspend, anomaly detection) are stored in JSON state to prevent spam. If the bot stops sending alerts or spams them:

**Recovery Procedure (Spamming):**

1. Ensure the DB user executing the alert check has permissions to write to `finance_budgets.metadata` and `user_settings.settings`.
2. Inspect `finance_budgets.metadata->'lastNotifiedPeriodStart'`. If it is missing or invalid, manually patch it using `UPDATE finance_budgets SET metadata = jsonb_set(metadata, '{lastNotifiedPeriodStart}', '"YYYY-MM-DD"');`.

**Recovery Procedure (Missing Alerts):**

1. Check the server logs for `triggerFinanceAlerts` output.
2. Confirm that transactions are successfully tagged as `confirmed` (Draft transactions do not trigger alerts).
3. If necessary, force a re-evaluation by resetting the notified state in the JSON metadata.

## 3. Base Currency and Exchange Rate Corruption

Historical transactions are backfilled based on daily exchange rates. If an API outage corrupted the rates:

**Recovery Procedure:**

1. Manually insert or update the correct exchange rate in the `finance_exchange_rates` table for the affected `rate_date`.
2. Re-trigger the backfill via the TMA `/api/tma/finance/backfill` endpoint (or wait for the user to change their base currency). The endpoint operates idempotently and will recalculate `base_amount` using the updated rate.

## 4. Database Point-In-Time Recovery (PITR)

If `finance_transactions` or `finance_receipts` are accidentally purged:

1. Log into the Supabase Dashboard.
2. Navigate to Database -> Backups.
3. Select a Point-In-Time recovery point prior to the incident.
4. Note that restoring the database will NOT restore deleted files from the `receipts` storage bucket. Ensure you do not purge the S3 bucket if you intend to recover receipts. S3 bucket items must be manually backed up if desired.

> [!WARNING]
> Because the Finance module is a Single Source of Truth, never run bulk deletions manually on the `finance_transactions` table without disabling the cascading triggers first.
