# Monthly Review Worker

Generates a monthly LifeOS markdown report from Supabase data, writes it to the
Obsidian vault when configured, upserts `monthly_reviews`, and sends a concise
Telegram notification.

## Commands

```bash
python monthly_review_worker.py generate --month 2026-06
python monthly_review_worker.py generate-last-month
python monthly_review_worker.py status
python monthly_review_worker.py run-loop
```

`generate-last-month` is the systemd timer entrypoint and runs best on the first
day of each month.

## Environment

```bash
SUPABASE_URL=https://PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=replace-with-service-role-key
LIFEOS_DEFAULT_USER_ID=00000000-0000-0000-0000-000000000000
LIFEOS_ENABLE_LEGACY_SINGLE_USER_MONTHLY_REVIEW=false
OBSIDIAN_VAULT_PATH=/home/zalewko/Documents/MAINN
TELEGRAM_BOT_TOKEN=replace-with-bot-token
LIFEOS_DEFAULT_TELEGRAM_USER_ID=123456789
MONTHLY_REVIEW_AI_ENABLED=false
OPENROUTER_API_KEY=
MONTHLY_REVIEW_MODEL=openai/gpt-4o-mini
MONTHLY_REVIEW_BASE_URL=https://openrouter.ai/api/v1
MONTHLY_REVIEW_POLL_SECONDS=3600
```

AI is optional. If disabled or missing a key, the worker writes deterministic
local markdown and still succeeds.

## Multi-user Status

The standalone worker is still legacy single-user. It reads one
`LIFEOS_DEFAULT_USER_ID`, optionally sends to one fallback Telegram user, and can
write one local Obsidian vault path. It will not load settings unless
`LIFEOS_ENABLE_LEGACY_SINGLE_USER_MONTHLY_REVIEW=true` is set. Only enable that
flag for local/dev or an explicitly accepted single-user deployment.

Next stage: generate monthly reviews per active user and route notifications and
Obsidian output through user-owned settings.

## Systemd

```bash
sudo cp workers/monthly-review-worker/lifeos-monthly-review.service.example /etc/systemd/system/lifeos-monthly-review.service
sudo cp workers/monthly-review-worker/lifeos-monthly-review.timer.example /etc/systemd/system/lifeos-monthly-review.timer
sudo systemctl daemon-reload
sudo systemctl enable --now lifeos-monthly-review.timer
systemctl list-timers lifeos-monthly-review.timer
```

The timer runs on the 1st day of every month at 09:30 and generates the previous
month.
