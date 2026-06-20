# ICS Sync Worker

Fetches official Moodle calendar export ICS and/or a personal ICS feed. It does
not scrape passwords, cookies, HTML, CAPTCHA, or 2FA.

```bash
python -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env
.venv/bin/python ics_sync.py status
.venv/bin/python ics_sync.py sync-once
.venv/bin/python ics_sync.py run-loop
```

Keep Moodle and personal ICS URLs only in the local `.env`.

## Multi-user Status

This worker is still legacy single-user. The configured ICS URLs are assigned to
`LIFEOS_DEFAULT_USER_ID`, so settings fail closed unless
`LIFEOS_ENABLE_LEGACY_SINGLE_USER_ICS_SYNC=true` is set. Only enable that flag
for local/dev or an explicitly accepted single-user deployment.

Next stage: store ICS feed configuration per user and sync only connected active
users.
