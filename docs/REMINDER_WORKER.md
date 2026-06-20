# Reminder Worker

The reminder worker sends due LifeOS reminders to Telegram.

Supabase stays the source of truth. Telegram `/remind` and the TMA create rows in `public.reminders`; the worker polls for pending Telegram reminders whose `remind_at` is due, resolves `reminders.user_id` to an active `profiles.telegram_user_id`, sends a Telegram message to that owner, then marks the row `sent`.

## Why It Runs On Arch

The worker is an always-on background process, similar to the Obsidian mirror worker already running on the Arch server through systemd. Keeping it there avoids adding another Railway service for a small polling loop and keeps service-role credentials off browser-facing apps.

## Environment

`workers/reminder-worker/.env`:

```bash
SUPABASE_URL=https://PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=replace-with-supabase-service-role-key
TELEGRAM_BOT_TOKEN=replace-with-telegram-bot-token
REMINDER_WORKER_TEST_TELEGRAM_USER_ID=123456789
REMINDER_WORKER_POLL_SECONDS=30
REMINDER_WORKER_BATCH_SIZE=20
```

Never expose `TELEGRAM_BOT_TOKEN` or `SUPABASE_SERVICE_ROLE_KEY` to the TMA, web app, logs, screenshots, or client-side env.

`REMINDER_WORKER_TEST_TELEGRAM_USER_ID` is only for `test-send`. Real reminders are never sent through a default Telegram id; inactive, blocked, pending, or unlinked profiles are skipped and recorded as send failures.

## Setup

```bash
cd /home/zalewko/lifeos/workers/reminder-worker
python -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cp .env.example .env
chmod 600 .env
$EDITOR .env
```

## Commands

Check connectivity and due count:

```bash
.venv/bin/python reminder_worker.py status
```

Send a Telegram test message:

```bash
.venv/bin/python reminder_worker.py test-send
```

Process one batch:

```bash
.venv/bin/python reminder_worker.py run-once
```

Run continuously:

```bash
.venv/bin/python -u reminder_worker.py run-loop
```

## Systemd Install

```bash
cd /home/zalewko/lifeos/workers/reminder-worker
sudo cp lifeos-reminder-worker.service.example /etc/systemd/system/lifeos-reminder-worker.service
sudo systemctl daemon-reload
sudo systemctl enable --now lifeos-reminder-worker.service
sudo systemctl status lifeos-reminder-worker.service
journalctl -u lifeos-reminder-worker.service -f
```

The example service uses:

```ini
User=zalewko
WorkingDirectory=/home/zalewko/lifeos/workers/reminder-worker
EnvironmentFile=/home/zalewko/lifeos/workers/reminder-worker/.env
ExecStart=/home/zalewko/lifeos/workers/reminder-worker/.venv/bin/python -u /home/zalewko/lifeos/workers/reminder-worker/reminder_worker.py run-loop
Restart=always
RestartSec=10
After=network-online.target
Wants=network-online.target
```

## Troubleshooting

- `Missing required environment variable`: check `.env` path and `EnvironmentFile`.
- `Telegram send failed`: run `test-send`, confirm the bot token and `REMINDER_WORKER_TEST_TELEGRAM_USER_ID`.
- `Reminder owner has no active Telegram profile`: approve/link the owning profile before the reminder can be delivered.
- `Supabase PATCH reminders failed`: confirm the service-role key and that `public.reminders` has `sent_at`, `updated_at`, and `metadata_json`.
- Reminder stays `pending`: send failures are retried and stored under `metadata_json.reminder_worker`; after three failed attempts the worker marks the reminder `failed`.
- Nothing sends: run `status` and confirm the row has `status='pending'`, `channel='telegram'`, and `remind_at <= now()`.

## Message Format

```text
🔔 Reminder

<message>

Time: <remind_at in Asia/Qyzylorda>
```

If the reminder has a linked `life_entity` or `source_event`, the worker also includes a title/source line when it can fetch that row safely.
