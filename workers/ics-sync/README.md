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

