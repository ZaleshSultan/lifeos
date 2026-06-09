# Reminders V1

LifeOS stores reminders in Supabase. Telegram and the TMA create pending rows;
`lifeos-reminder-worker.service` sends due Telegram notifications and marks
successful sends as `sent`.

The configured local timezone is `Asia/Qyzylorda`.

## Telegram Commands

```text
/remind Review notes in:30m
/remind Review notes in:2h
/remind Review notes tomorrow 19:00
/remind Review notes at:2026-07-06 08:00
/reminders
/reminder cancel <short_id>
/reminder snooze <short_id> 10m
/reminder_mode
/reminder_mode chill|normal|duolingo|war
```

`/reminders` shows the short IDs used by cancel and snooze. Manual reminder
times must be in the future.

## Smoke Test

In Telegram:

```text
/remind LifeOS reminder smoke test in:1m
/reminders
```

Confirm the reminder appears, then wait for the notification. Check the worker
if it does not arrive:

```bash
systemctl status --no-pager lifeos-reminder-worker.service
journalctl -u lifeos-reminder-worker.service -n 100 --no-pager
```

The worker retries failed Telegram sends without crashing. After three failed
attempts it marks the reminder `failed`; successful sends are marked `sent`.

## Source Reminder Rules

- Google Tasks with a due date create scheduled reminders.
- Google Tasks without a due date remain visible as source events but do not
  create scheduled reminders.
- Completed tasks cancel future pending reminders.
- Due-date changes update future pending reminders.
- Repeated syncs do not duplicate reminders.
- Google Calendar and ICS events use the active reminder mode.
- High-priority keywords such as `exam`, `final`, and `deadline` promote the
  event to a stronger reminder schedule.
