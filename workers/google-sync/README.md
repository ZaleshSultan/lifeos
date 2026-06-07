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

