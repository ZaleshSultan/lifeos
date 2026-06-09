# Google Calendar And Tasks Sync

`lifeos-google-sync.service` reads Google Calendar and Google Tasks through
local OAuth, writes normalized source events to Supabase, and reconciles future
reminders.

OAuth credentials remain in `workers/google-sync/secrets/`.

## OAuth Over SSH Port Forward

On the local computer, forward the worker callback port:

```bash
ssh -L 8765:127.0.0.1:8765 zalewko@archlinux
```

In that SSH session:

```bash
cd /home/zalewko/lifeos/workers/google-sync
.venv/bin/python google_sync.py auth
```

Open the printed Google authorization URL in the local browser. The callback
to `127.0.0.1:8765` is forwarded to the worker. Keep the SSH session open until
the token is written.

## Run And Inspect

```bash
cd /home/zalewko/lifeos/workers/google-sync
.venv/bin/python google_sync.py status
.venv/bin/python google_sync.py sync-once

sudo systemctl restart lifeos-google-sync.service
systemctl status --no-pager lifeos-google-sync.service
journalctl -u lifeos-google-sync.service -n 100 --no-pager
```

Logs report events/tasks seen and reminders created, updated, and cancelled.

## Verify A Google Task

1. Create a Google Task with a due date.
2. Run `.venv/bin/python google_sync.py sync-once`.
3. Send `/reminders` in Telegram or open the TMA Reminders screen.
4. Confirm the task appears with the `Google Tasks` source label.
5. Complete the Google Task and run sync again.
6. Confirm its future pending reminders are cancelled.

A Google Task due date has no reliable time component. LifeOS anchors it at
18:00 in `APP_TIMEZONE` (`Asia/Qyzylorda` in production).

## Troubleshooting

- `/google_sync` should show Google Calendar and Google Tasks as connected.
- Missing OAuth token: run the SSH-forwarded auth flow again.
- Task visible but no reminder: confirm it has a due date and the due date is
  still in the future.
- Duplicate concern: run `sync-once` twice; the second run should log zero
  reminder creates for unchanged events.
- Wrong local time: confirm `APP_TIMEZONE=Asia/Qyzylorda` in the worker env.
