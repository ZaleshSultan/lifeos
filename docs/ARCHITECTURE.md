# LifeOS Architecture

## Optional internal AI and external consumers

Daily planning is deterministic in `packages/core`; optional Gemini text
assistance runs through the authenticated `apps/bot` boundary. Supabase remains
authoritative. TMA Today and AI screens use bounded read-only context; model
suggestions cannot write user data. Existing Gemini/OpenRouter calls now share
the backend AI governor and durable budget reservations; the ungoverned legacy
monthly AI path fails closed. See [AI execution safety](AI_EXECUTION_SAFETY.md).
See [LifeOS AI](LIFEOS_AI.md) for configuration, contracts and limitations.

An optional, disabled-by-default assistant Brain adds deterministic authorized
tools and explicit persistent memory to the existing AI screen and private
Telegram messages. Gemini remains the existing optional read-only planning
provider. TMA changes require signed confirmation and atomic per-user receipts.
See [assistant architecture](ASSISTANT_ARCHITECTURE.md) and
[rollout](ASSISTANT_ROLLOUT.md).

AGATA is a proposed optional external consumer. No deployed compatible service
or `/api/agata/*` personal-data API was found. Its authenticated capability
projection and proposed v1 draft contract remain disabled; see
[AGATA boundary](AGATA_INTEGRATION.md).

LifeOS is a personal operating system monorepo. The center of the system is a Supabase-backed kernel of life entities, with specialized layers for health, fitness, finance, Telegram capture, a Telegram Mini App, a web dashboard, Android Health Connect ingestion, and an Obsidian mirror.

## Repository Map

- `apps/bot` - Node HTTP server for Telegram webhooks, health ingest, and backend API boundaries.
- `apps/tma` - Vite React Telegram Mini App for workout and focus workflows.
- `apps/web` - Next.js dashboard for desktop and mobile browser use.
- `apps/health-bridge` - Kotlin Health Connect app; hosted CI verifies a debug APK, JVM tests and lint. Physical-phone behavior remains unverified; see `ANDROID_HEALTH_BRIDGE.md`.
- `packages/core` - Pure domain logic, parsers, health mode, ingest scoring, and shared types.
- `packages/db` - Supabase client/config/store boundary.
- `packages/obsidian` - Obsidian path safety utilities.
- `supabase/migrations` - Kernel, health, fitness, finance, bot, and ingest schema.
- `workers/obsidian-mirror` - systemd worker on the current Debian host that renders queued entities into Markdown.
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

The web dashboard reads through backend APIs. Telegram `/web` links exchange once
for revocable, opaque sessions; Next.js and the backend check live session and
profile status. See [Web sessions](WEB_SESSIONS.md). It does not carry service-role
keys, per-user health session tokens, or bot tokens.

The Obsidian mirror worker runs on the current Debian server, claims queue rows from Supabase, loads `public.user_obsidian_settings` for the row owner, renders safe Markdown paths inside that user's configured vault, and writes atomically. Arch Linux was a historical target.

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

## Current Deployment Topology

The active installation uses Debian/systemd and the existing Cloudflare Tunnel
at `https://lifeos.zalewko.me`. The bot serves `/tma/`, the webhook and protected
APIs on local port 3000; Next.js serves `/web` on port 3001. Workers are separate
systemd services. Supabase remains the database, and its service credentials stay
in trusted backend/worker environments. See [production operations](OPERATIONS.md).

Railway, Vercel and Arch/Tailscale deployment assets remain as historical or
alternative targets. They are not evidence of the currently deployed version.
Capture the real source/build SHA, active service configuration, backup and
rollback artifacts before a release. New application behavior is not considered
live until its release report records runtime verification.

## Current Acceptance Boundary

The original vertical slice covered Telegram capture/tasks/workouts, TMA workout
control, health ingest, Supabase persistence and Obsidian rendering. The explicitly
authorized November 3 overnight mission extends that scope to secure web sessions,
shared daily workspaces and the Android Health Connect application. Old exclusions
of production web authentication and Android builds are historical. The web UI
uses authenticated backend projections and an allowlisted CSRF-protected bridge;
credential-changing LMS flows still require Telegram authorization. Building an
Android artifact does not prove physical-device permissions or background sync.
The audited host has no JDK, Android SDK or Gradle wrapper available; an APK build
and actual device ingestion remain blocked/unverified rather than claimed complete.
External institutional/creator grants require genuine authorization and must be
reported as unavailable when missing. See the [phase 2 report](OVERNIGHT_PHASE2_REPORT.md)
for actual implementation, deployment evidence and unresolved limitations.
