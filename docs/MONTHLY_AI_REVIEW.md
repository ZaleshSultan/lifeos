# Monthly AI Review

Monthly AI Review generates a privacy-safe monthly LifeOS report from local
Supabase data and saves it into Obsidian.

Flow:

```text
Supabase data
-> monthly-review-worker or Telegram/TMA trigger
-> local aggregation
-> optional OpenRouter analysis
-> Markdown report
-> Obsidian Reviews/Monthly
-> Telegram notification
```

## Data Model

Migration `20260607000400_monthly_reviews.sql` adds `monthly_reviews`:

- unique `user_id, period_month`
- `status`: `draft`, `generated`, `failed`
- markdown report, safe AI input/output JSON, local stats JSON
- Obsidian path and generated timestamp

## Aggregation

Finance:

- total income, total expenses, net cashflow
- top categories
- short redacted descriptions for recurring leaks
- biggest transactions
- daily spending trend
- draft/cancelled counts
- debt transactions where category is `Долги`

Health:

- average and total steps
- average sleep minutes
- average resting heart rate
- average active kcal
- total workout minutes
- missing health days
- best/worst step days when available

Productivity:

- reminders created, sent, failed
- Google Tasks reminders
- manual reminders
- pending/overdue count
- optional source event counts by provider

## Privacy Rules

- `.env`, OAuth tokens, credential files, APKs, heap dumps, and secrets are never
  read for report content.
- Card/account-like long numbers are replaced with `[REDACTED]`.
- AI input prefers aggregate stats.
- Transaction descriptions are included only when short and redacted.
- If AI fails, the worker writes deterministic local markdown instead of failing
  the review.

## Environment

Worker env:

```text
SUPABASE_URL=https://PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
LIFEOS_DEFAULT_USER_ID=...
APP_TIMEZONE=Asia/Qyzylorda
OBSIDIAN_VAULT_PATH=/home/zalewko/Documents/MAINN
TELEGRAM_BOT_TOKEN=...
LIFEOS_DEFAULT_TELEGRAM_USER_ID=...
MONTHLY_REVIEW_AI_ENABLED=false
OPENROUTER_API_KEY=
MONTHLY_REVIEW_MODEL=openai/gpt-4o-mini
MONTHLY_REVIEW_BASE_URL=https://openrouter.ai/api/v1
MONTHLY_REVIEW_POLL_SECONDS=3600
```

`MONTHLY_REVIEW_AI_ENABLED=false` is the default. If the OpenRouter key is
missing, the worker uses fallback markdown and still succeeds.

## Manual Commands

```bash
python workers/monthly-review-worker/monthly_review_worker.py generate --month 2026-06
python workers/monthly-review-worker/monthly_review_worker.py generate-last-month
python workers/monthly-review-worker/monthly_review_worker.py status
python workers/monthly-review-worker/monthly_review_worker.py run-loop
```

## Telegram Commands

```text
/monthly_review
/monthly_review 2026-06
/monthly_review_status
/monthly_review_regenerate 2026-06
```

Telegram output is intentionally short: status, generated timestamp, Obsidian
path, and the first summary bullets.

## TMA

The home screen includes a Monthly Review card with:

- latest review month
- status and generated time
- finance net cashflow
- average steps
- Obsidian path
- generate previous month button

The TMA uses live authenticated API routes and does not use mock review data in
production.

## Obsidian Output

Preferred report path:

```text
Reviews/Monthly/YYYY-MM-LifeOS-Review.md
```

The standalone worker writes directly to `OBSIDIAN_VAULT_PATH` when configured
and updates `Dashboards/Reviews.md` with a monthly review link. The bot/TMA path
also queues an Obsidian mirror job using the same relative path.

## Systemd Timer

Install examples:

```bash
sudo cp workers/monthly-review-worker/lifeos-monthly-review.service.example /etc/systemd/system/lifeos-monthly-review.service
sudo cp workers/monthly-review-worker/lifeos-monthly-review.timer.example /etc/systemd/system/lifeos-monthly-review.timer
sudo systemctl daemon-reload
sudo systemctl enable --now lifeos-monthly-review.timer
systemctl list-timers lifeos-monthly-review.timer
```

Timer schedule:

```text
*-*-01 09:30:00
```

It runs:

```text
python monthly_review_worker.py generate-last-month
```

## Troubleshooting

- `Missing required environment variable`: check `/etc/lifeos/monthly-review.env`.
- No Obsidian file: set `OBSIDIAN_VAULT_PATH` and confirm the service user has
  write access.
- AI unavailable: confirm `MONTHLY_REVIEW_AI_ENABLED=true`,
  `OPENROUTER_API_KEY`, and `MONTHLY_REVIEW_MODEL`; fallback markdown is
  expected when disabled.
- Telegram not notified: check `TELEGRAM_BOT_TOKEN` and
  `LIFEOS_DEFAULT_TELEGRAM_USER_ID`.
- Empty report: verify finance, health, reminders, and source events have rows
  inside the target `YYYY-MM`.
