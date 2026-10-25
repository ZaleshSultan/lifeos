# Reminder Worker

Sends pending LifeOS `reminders` rows to Telegram.

The worker is designed for the Arch Linux server that already hosts local LifeOS workers. Supabase remains the source of truth; the worker reads due rows, resolves each row's `user_id` to an active `profiles.telegram_user_id`, sends Telegram messages to that owner, and updates reminder status.

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
REMINDER_WORKER_TEST_TELEGRAM_USER_ID=123456789
REMINDER_WORKER_POLL_SECONDS=30
REMINDER_WORKER_BATCH_SIZE=20
```

Never place the Telegram bot token or Supabase service role key in frontend env.

`REMINDER_WORKER_TEST_TELEGRAM_USER_ID` is only for `test-send`; real reminders are delivered by profile ownership and are not routed through a default Telegram id.

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

## Delivery guarantees and migration

See [notification delivery protocol](../../docs/NOTIFICATION_DELIVERIES.md) for
claims, retry budgets, unknown outcomes, recipient timezones and rollout.
Apply `20261024192839_notification_delivery_leases.sql` with all old reminder and
digest workers stopped. New workers require this migration and workers/common.

The worker keeps the atomic SKIP LOCKED claim RPC, claims one row just before
preparing it, and uses fenced owner/token/lease transitions. Quiet deferrals keep
the original event time. Only definitely rejected sends retry automatically;
timeouts and lost confirmation writes become explicit `unknown` outcomes.
This is not exactly-once Telegram delivery. `status` prints aggregate queue
health without content, secrets or Telegram calls. The old claim-timeout env is
accepted for compatibility; DB-enforced leases are five/two minutes.
