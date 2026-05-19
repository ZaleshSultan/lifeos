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
- `apps/health-bridge` - Android Health Connect bridge scaffold
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

## Single-User Bootstrap

LifeOS currently uses Supabase Auth users as owner records. User-owned tables reference `auth.users(id)`, and `public.profiles.user_id` is the LifeOS user id.

For local single-user operation:

1. Create or choose a Supabase Auth user id.
2. Copy `supabase/seed_single_user.sql`, replace the UUID and Telegram id, and run it.
3. Set backend env:

```bash
LIFEOS_DEFAULT_USER_ID=your-auth-user-uuid
LIFEOS_DEFAULT_TELEGRAM_USER_ID=your-telegram-user-id
ALLOW_UNSAFE_TMA_DEV_AUTH=false
```

If `/start` sees the configured Telegram id, it will try to link the profile. If the `auth.users` row is missing, it replies with the exact profile SQL to run.

## Health Ingest API

`POST /health/ingest` accepts trusted previous-day health sync payloads. Requests must include:

```text
x-lifeos-ingest-secret: $LIFEOS_INGEST_SECRET
content-type: application/json
```

Example:

```bash
curl -X POST "https://YOUR_PUBLIC_DOMAIN/health/ingest" \
  -H "content-type: application/json" \
  -H "x-lifeos-ingest-secret: $LIFEOS_INGEST_SECRET" \
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

The repository now has backend foundations, Telegram webhook commands, Supabase migrations, health ingest, TMA scaffold, Obsidian worker, Android Health Connect scaffold, web dashboard scaffold, and deployment docs. Production auth, dashboard summary APIs, and full Android build hardening remain future phases.
