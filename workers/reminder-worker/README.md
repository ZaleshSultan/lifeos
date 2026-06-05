# Reminder Worker

Sends pending LifeOS `reminders` rows to Telegram.

The worker is designed for the Arch Linux server that already hosts local LifeOS workers. Supabase remains the source of truth; the worker only reads due rows, sends Telegram messages, and updates reminder status.

## Commands

```bash
python reminder_worker.py status
python reminder_worker.py test-send
python reminder_worker.py run-once
python reminder_worker.py run-loop
```

## Environment

```bash
SUPABASE_URL=https://PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=replace-with-supabase-service-role-key
TELEGRAM_BOT_TOKEN=replace-with-telegram-bot-token
LIFEOS_DEFAULT_TELEGRAM_USER_ID=123456789
REMINDER_WORKER_POLL_SECONDS=30
REMINDER_WORKER_BATCH_SIZE=20
```

Never place the Telegram bot token or Supabase service role key in frontend env.

## Setup

```bash
cd /home/zalewko/lifeos/workers/reminder-worker
python -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cp .env.example .env
chmod 600 .env
$EDITOR .env
```

## Systemd

```bash
sudo cp lifeos-reminder-worker.service.example /etc/systemd/system/lifeos-reminder-worker.service
sudo systemctl daemon-reload
sudo systemctl enable --now lifeos-reminder-worker.service
sudo systemctl status lifeos-reminder-worker.service
journalctl -u lifeos-reminder-worker.service -f
```
