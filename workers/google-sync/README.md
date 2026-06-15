# Google Sync Worker

Local Arch worker for read-only Google Calendar and Google Tasks sync. Supabase is
the normalized source of truth; OAuth credentials stay under `secrets/`.

```bash
python -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env
mkdir -p secrets
chmod 700 secrets
.venv/bin/python google_sync.py auth
.venv/bin/python google_sync.py sync-once
.venv/bin/python google_sync.py run-loop
```

Never commit `.env`, `secrets/client_secret.json`, or `secrets/token.json`.
Google Tasks due dates have no reliable time component, so LifeOS anchors them
at 18:00 in `APP_TIMEZONE` for reminder policy calculation.

## Multi-user Status

This worker is still legacy single-user. It stores one local `GOOGLE_TOKEN_FILE`
and writes Google Calendar/Tasks rows for `LIFEOS_DEFAULT_USER_ID`. It will not
load settings unless `LIFEOS_ENABLE_LEGACY_SINGLE_USER_GOOGLE_SYNC=true` is set.
Only enable that flag for local/dev or an explicitly accepted single-user
deployment.

Next stage: move OAuth tokens and connected calendar/task ownership into
per-user Supabase configuration, then iterate active connected users instead of
using the default user.
