# LifeOS

Personal LifeOS monorepo for automation, knowledge workflows, and user-facing interfaces.

## Workspace

- `apps/bot` - Telegram bot application
- `apps/tma` - Telegram Mini App
- `apps/web` - Web application
- `packages/core` - Shared domain logic and contracts
- `packages/db` - Database package boundary
- `packages/obsidian` - Obsidian integration package boundary
- `workers/obsidian-mirror` - Supabase to Obsidian Markdown mirror
- `workers/reminder-worker` - Supabase reminders to Telegram worker
- `workers/daily-digest-worker` - daily Telegram briefing with tasks, classes, and deadlines
- `apps/android-health-bridge` - installable manual Android Health Connect bridge
- `apps/health-bridge` - legacy Android Health Connect bridge scaffold
- `docs` - architecture, contracts, deployment, and operations docs
- `deploy` - platform deployment assets

## Getting Started

Install dependencies:

```bash
corepack pnpm install
```

Run checks:

```bash
corepack pnpm typecheck
corepack pnpm test
# With the worker Python dependencies installed:
corepack pnpm test:workers
corepack pnpm --filter @lifeos/web build
corepack pnpm --filter @lifeos/tma build
```

Run the backend:

```bash
cp apps/bot/.env.example apps/bot/.env
corepack pnpm --filter @lifeos/bot dev
```

Run the web dashboard:

```bash
cp apps/web/.env.example apps/web/.env.local
corepack pnpm --filter @lifeos/web dev
```

Run the TMA:

```bash
cp apps/tma/.env.example apps/tma/.env.local
corepack pnpm --filter @lifeos/tma dev
```

Run the reminder worker locally:

```bash
cd workers/reminder-worker
python -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cp .env.example .env
.venv/bin/python reminder_worker.py status
```

See `docs/REMINDER_WORKER.md` for Arch/systemd setup.

Run the daily briefing worker locally:

```bash
cd workers/daily-digest-worker
cp .env.example .env
python3 daily_digest_worker.py
```

The default briefing time is `06:00` in each profile timezone; change
`DAILY_DIGEST_TIME` in the worker `.env` if needed. Apply the latest Supabase
migrations first so `daily_digest_deliveries` is available for duplicate
protection. The default catch-up window is 12 hours after the configured time.

## Multi-User Telegram Onboarding

LifeOS currently uses Supabase Auth users as owner records. User-owned tables reference `auth.users(id)`, and `public.profiles.user_id` is the LifeOS user id.

For multi-user Telegram onboarding, set:

```bash
LIFEOS_ADMIN_TELEGRAM_IDS=123456789
LIFEOS_SIGNUP_MODE=pending_approval
```

The first admin can be assigned with `LIFEOS_ADMIN_TELEGRAM_IDS` before any profile has `role = 'admin'`. New Telegram users send `/start`; the bot creates a Supabase Auth user plus a `profiles` row with `status = 'pending'` and `role = 'user'`. Admins can review and manage access with:

```text
/pending
/approve <telegram_id>
/block <telegram_id>
/users
```

Only `status = 'active'` users can use protected bot and TMA flows.

## Single-User Bootstrap

For local single-user operation:

1. Create or choose a Supabase Auth user id.
2. Copy `supabase/seed_single_user.sql`, replace the UUID and Telegram id, and run it.
3. Set backend env:

```bash
LIFEOS_DEFAULT_USER_ID=your-auth-user-uuid
LIFEOS_DEFAULT_TELEGRAM_USER_ID=your-telegram-user-id
ALLOW_UNSAFE_TMA_DEV_AUTH=false
```

These default-user variables are legacy/dev bootstrap helpers. They are not used to register new production users. If `/start` sees the configured Telegram id, it will try to link that one profile as active/admin. If the `auth.users` row is missing, it replies with the exact profile SQL to run.


## Personal Web, Weather, and Google Calendar

The web dashboard is multi-user. An active Telegram user runs `/web`; the bot
creates a signed short login URL, and the Next.js app stores the session in an
HttpOnly cookie. Backend requests are resolved back to that LifeOS `user_id`, so
`/today` and `/study` show that user's data. Configure:

```bash
# apps/bot/.env
LIFEOS_WEB_URL=https://web.example.com
LIFEOS_WEB_SESSION_SECRET=replace-with-a-random-secret

# apps/web/.env.local
LIFEOS_API_BASE_URL=https://api.example.com
NEXT_PUBLIC_LIFEOS_API_BASE_URL=https://api.example.com
```

Weather is also per-user. Run `/weather Astana` (or any city supported by
Open-Meteo) once; the selected coordinates are saved in `user_settings` and
used on the home screen and in the daily briefing.

Google OAuth now requests Calendar event write access. After connecting Google,
new `/remind` reminders are mirrored to the user's primary Google Calendar;
snoozing updates the event and cancelling removes it. Existing users who
connected with the old `calendar.readonly` scope need to reconnect Google once.
The LifeOS reminder remains valid even if Google is temporarily unavailable.

## Health Ingest API

`POST /health/ingest` accepts trusted previous-day health sync payloads. Requests must include:

```text
Authorization: Bearer $LIFEOS_HEALTH_SESSION_TOKEN
content-type: application/json
```

Example:

```bash
curl -X POST "https://YOUR_PUBLIC_DOMAIN/health/ingest" \
  -H "content-type: application/json" \
  -H "Authorization: Bearer $LIFEOS_HEALTH_SESSION_TOKEN" \
  -d '{
    "user_id": "00000000-0000-0000-0000-000000000000",
    "date": "2026-05-17",
    "sync_reason": "nightly_00_01",
    "source": "healthkit",
    "timezone": "Asia/Qyzylorda",
    "metrics": {
      "sleep_minutes": 480,
      "resting_heart_rate": 58,
      "hrv_ms": 45,
      "steps": 9200,
      "active_energy_kcal": 620
    },
    "workouts": [
      {
        "external_id": "healthkit-workout-1",
        "started_at": "2026-05-17T10:00:00.000Z",
        "ended_at": "2026-05-17T10:45:00.000Z",
        "workout_type": "strength",
        "duration_minutes": 45
      }
    ],
    "samples": [
      {
        "sample_type": "heart_rate",
        "sampled_at": "2026-05-17T10:15:00.000Z",
        "value": 110,
        "unit": "bpm"
      }
    ]
  }'
```

## Docs

Start with:

- `docs/ARCHITECTURE.md`
- `docs/DEPLOYMENT.md`
- `docs/SECURITY.md`
- `docs/HEALTH_BRIDGE_CONTRACT.md`
- `docs/OBSIDIAN_SYNC.md`

## Status

The repository now has backend foundations, Telegram webhook commands, Supabase migrations, health ingest, TMA scaffold, Obsidian worker, Android Health Connect scaffold, personal multi-user web dashboard, and deployment docs. Full Android build hardening and additional web surfaces remain future phases.

## Academic sync

See [the academic sync update guide](docs/ACADEMIC_SYNC_COMPLETION.md) for Moodle grade parsing, explicit course links, worker checks, and deployment instructions.
