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

Google OAuth starts at the backend TMA boundary. Active Telegram users call
`GET /api/tma/integrations/google/start`, the bot signs state bound to their
LifeOS `user_id`, and `GET /api/oauth/google/callback` stores the resulting
Google tokens in `public.user_oauth_connections`. TMA status uses only safe
metadata from that connection; browser apps never receive access or refresh
tokens.

The Android health bridge reads previous-day data from Health Connect and posts to `POST /health/ingest`. The backend validates `Authorization: Bearer <health-session-token>`, computes recovery and completeness with `packages/core`, upserts health tables, creates a `health_daily` life entity, and enqueues Obsidian sync.

The web dashboard reads through backend APIs. It does not carry service-role keys, per-user health session tokens, or bot tokens.

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

Current multi-user MVP caveat: Telegram bot/TMA access, health ingest, reminder delivery, Obsidian mirror routing, and Google OAuth management are user-scoped. The remaining local worker integrations are guarded legacy single-user modes and are not production multi-user until their runtime sync loops consume per-user configuration:

- `workers/google-sync` still uses one local `GOOGLE_TOKEN_FILE` and `LIFEOS_DEFAULT_USER_ID`. It ignores `user_oauth_connections` until the next worker migration and requires `LIFEOS_ENABLE_LEGACY_SINGLE_USER_GOOGLE_SYNC=true`.
- `workers/ics-sync` assigns configured feed URLs to `LIFEOS_DEFAULT_USER_ID`. It requires `LIFEOS_ENABLE_LEGACY_SINGLE_USER_ICS_SYNC=true`.
- `workers/monthly-review-worker` uses `LIFEOS_DEFAULT_USER_ID`, optional `LIFEOS_DEFAULT_TELEGRAM_USER_ID`, and one vault path. It requires `LIFEOS_ENABLE_LEGACY_SINGLE_USER_MONTHLY_REVIEW=true`.

Do not present the Google sync worker, ICS, or standalone monthly-review integrations as fully multi-user-safe until per-user source configuration is consumed by those workers. Google OAuth status is connected only for users with `user_oauth_connections.provider = 'google'` and `status = 'connected'`. Obsidian mirror is connected only for users with `user_obsidian_settings.enabled = true`, `status = 'connected'`, and a local vault path.

## Deployment Targets

- Railway: `apps/bot` backend HTTP service.
- Vercel: `apps/web` Next.js dashboard.
- Telegram hosting surface: `apps/tma` built as static assets, commonly Vercel or another HTTPS static host.
- Arch Linux: `workers/obsidian-mirror` and a local Obsidian vault.
- Android phone: `apps/health-bridge` Health Connect bridge.

## Current Acceptance Boundary

This phase stabilizes the first vertical slice: Telegram capture/tasks/workouts, TMA workout control, health ingest, Supabase persistence, and Obsidian queue rendering. It does not add production web dashboard auth or Android production build hardening.
