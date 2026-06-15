# LifeOS Architecture

LifeOS is a personal operating system monorepo. The center of the system is a Supabase-backed kernel of life entities, with specialized layers for health, fitness, finance, Telegram capture, a Telegram Mini App, a web dashboard, Android Health Connect ingestion, and an Obsidian mirror.

## Repository Map

- `apps/bot` - Node HTTP server for Telegram webhooks, health ingest, and backend API boundaries.
- `apps/tma` - Vite React Telegram Mini App for workout and focus workflows.
- `apps/web` - Next.js dashboard for desktop and mobile browser use.
- `apps/android-health-bridge` - installable manual Android Health Connect bridge with preview-before-send.
- `apps/health-bridge` - legacy Android Kotlin scaffold.
- `packages/core` - Pure domain logic, parsers, health mode, ingest scoring, and shared types.
- `packages/db` - Supabase client/config/store boundary.
- `packages/obsidian` - Obsidian path safety utilities.
- `supabase/migrations` - Kernel, health, fitness, finance, bot, and ingest schema.
- `workers/obsidian-mirror` - Arch Linux worker that renders queued entities into Markdown.
- `deploy` - Deployment assets and platform notes.
- `docs` - Architecture, contracts, security, and operations documentation.

## Runtime Topology

Telegram sends webhooks to `apps/bot`. The bot resolves a LifeOS user through Supabase, writes domain rows through `packages/db`, and enqueues Obsidian sync records when a Markdown mirror is expected.

The TMA is opened from Telegram with a short URL only. Workout identity and state live in Supabase and are fetched through backend API routes with Telegram init data in `X-Telegram-Init-Data`.

The Android health bridge reads previous-day data from Health Connect and posts to `POST /health/ingest`. The backend validates `x-lifeos-ingest-secret`, computes recovery and completeness with `packages/core`, upserts health tables, creates a `health_daily` life entity, and enqueues Obsidian sync.

The web dashboard reads through backend APIs. It does not carry service-role keys, ingest secrets, or bot tokens.

The Obsidian mirror worker runs on an Arch Linux server, claims queue rows from Supabase, loads `public.user_obsidian_settings` for the row owner, renders safe Markdown paths inside that user's configured vault, and writes atomically.

## Source Of Truth

Supabase is the system of record. Obsidian is a local mirror and human-readable knowledge surface. Telegram and the web dashboard are input/control surfaces. Health Connect is an upstream data source, not a storage layer.

## Identity Model

The stabilized vertical slice keeps Supabase Auth as the identity root:

- `auth.users.id` is the canonical LifeOS `user_id`.
- `public.profiles.user_id` references `auth.users(id)`.
- `public.profiles.telegram_user_id` links Telegram bot and TMA requests to the LifeOS user.
- User-owned tables keep `user_id uuid references auth.users(id)`.
- `public.profiles.status` gates access; only `active` users can use protected bot/TMA flows.
- `public.profiles.role` plus `LIFEOS_ADMIN_TELEGRAM_IDS` gates Telegram admin commands.

For local single-user setup, `LIFEOS_DEFAULT_USER_ID` and `LIFEOS_DEFAULT_TELEGRAM_USER_ID` let `/start` link the configured Telegram account when the auth user exists.

Current multi-user MVP caveat: Telegram bot/TMA access, health ingest, reminder delivery, and Obsidian mirror routing are user-scoped. The remaining local integrations are guarded legacy single-user modes and are not production multi-user until per-user configuration exists:

- `workers/google-sync` uses one local `GOOGLE_TOKEN_FILE` and `LIFEOS_DEFAULT_USER_ID`. It requires `LIFEOS_ENABLE_LEGACY_SINGLE_USER_GOOGLE_SYNC=true`.
- `workers/ics-sync` assigns configured feed URLs to `LIFEOS_DEFAULT_USER_ID`. It requires `LIFEOS_ENABLE_LEGACY_SINGLE_USER_ICS_SYNC=true`.
- `workers/monthly-review-worker` uses `LIFEOS_DEFAULT_USER_ID`, optional `LIFEOS_DEFAULT_TELEGRAM_USER_ID`, and one vault path. It requires `LIFEOS_ENABLE_LEGACY_SINGLE_USER_MONTHLY_REVIEW=true`.

Do not present Google, ICS, or standalone monthly-review integrations as connected for every newly approved user until per-user OAuth/source configuration exists. Obsidian mirror is connected only for users with `user_obsidian_settings.enabled = true`, `status = 'connected'`, and a local vault path.

## Deployment Targets

- Railway: `apps/bot` backend HTTP service.
- Vercel: `apps/web` Next.js dashboard.
- Telegram hosting surface: `apps/tma` built as static assets, commonly Vercel or another HTTPS static host.
- Arch Linux: `workers/obsidian-mirror` and a local Obsidian vault.
- Android phone: `apps/health-bridge` Health Connect bridge.

## Current Acceptance Boundary

This phase stabilizes the first vertical slice: Telegram capture/tasks/workouts, TMA workout control, health ingest, Supabase persistence, and Obsidian queue rendering. It does not add production web dashboard auth or Android production build hardening.
