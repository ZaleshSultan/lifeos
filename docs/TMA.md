# Telegram Mini App

The TMA is the in-Telegram onboarding, workout, focus, mode, and sources
surface.

## Runtime

- Vite
- React
- TypeScript
- Tailwind
- Telegram WebApp SDK
- TanStack Query

## Security Boundary

The TMA sends Telegram `initData` in `X-Telegram-Init-Data` and fetches from backend API routes. It does not connect to Supabase with a service role key and does not place full workout state in URLs.

The backend validates Telegram WebApp `initData` with `TELEGRAM_BOT_TOKEN`. Local development can bypass this only when explicitly enabled:

```bash
ALLOW_UNSAFE_TMA_DEV_AUTH=true
LIFEOS_DEFAULT_USER_ID=your-auth-user-uuid
```

The default is `ALLOW_UNSAFE_TMA_DEV_AUTH=false`.

`GET /api/tma/session` is the safe onboarding/status endpoint. It validates
Telegram `initData` but works for unregistered, pending, active, and blocked
users. It never returns vault paths or another user's data.

Google OAuth is started through the backend, not the browser. Configure:

```bash
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
GOOGLE_OAUTH_REDIRECT_URI=https://your-bot.example/api/oauth/google/callback
GOOGLE_OAUTH_STATE_SECRET=...
```

The TMA calls `GET /api/tma/integrations/google/start`, receives only a Google
authorization URL, and the callback stores tokens in
`public.user_oauth_connections` for the signed-state user. The session response
returns only safe metadata such as `status` and `accountEmail`.

Protected data endpoints still require the resolved Telegram profile to be
`status = 'active'`. Pending users receive `telegram_user_pending`; blocked
users receive `telegram_user_blocked`.

For local browser testing without Telegram, set:

```bash
ALLOW_UNSAFE_TMA_DEV_AUTH=true
LIFEOS_DEFAULT_USER_ID=your-auth-user-uuid
VITE_API_BASE_URL=http://localhost:3000
```

Never expose `SUPABASE_SERVICE_ROLE_KEY` in the TMA. All TMA data comes through the backend API.

## Workout Contract

Implemented backend routes:

- `GET /api/tma/session`
- `POST /api/tma/register`
- `GET /api/tma/integrations/google/start`
- `POST /api/tma/integrations/google/disconnect`
- `GET /api/tma/home`
- `GET /api/tma/workout/current`
- `POST /api/tma/workout/start`
- `POST /api/tma/workout/sets/:setId/complete`
- `POST /api/tma/workout/sets/:setId/undo`
- `POST /api/tma/workout/:workoutId/complete`
- `GET /api/tma/health`
- `GET /api/tma/focus`
- `GET /api/tma/academic`
- `GET /api/tma/course/active`
- `POST /api/tma/course/active/progress`
- `GET /api/tma/sources`
- `GET /api/tma/reminders`
- `POST /api/tma/reminders`
- `GET /api/oauth/google/callback`

## Onboarding Flow

```text
1. User opens bot/TMA
2. User creates pending registration with /start or POST /api/tma/register
3. Admin approves via /approve
4. User sees active TMA dashboard
5. Admin configures Obsidian via /obsidian_set_vault + /obsidian_enable
6. User sees Obsidian status in TMA
```

TMA session states:

- `unregistered` - show the LifeOS welcome state and prompt `/start` or
  "Создать заявку".
- `pending` - show that the request is waiting for admin approval.
- `blocked` - show a simple blocked-access message without technical details.
- `active` - show the normal dashboard and integration cards.

Integration status cards show Telegram, Obsidian, Google Calendar, and Health.
Obsidian uses the path-free session status from `user_obsidian_settings`; the
frontend never receives `vault_path`.
Google uses token-free session status from `user_oauth_connections`; the
frontend never receives `access_token` or `refresh_token`.

`GET /api/tma/workout/current` only returns an existing active workout. It does not create a default workout. Starting a workout is explicit through Telegram `/workout` or `POST /api/tma/workout/start`.

Course and sources screens are backed by Supabase rows. The TMA should show empty states when rows are absent, not hardcoded course or workout defaults.

Mock data is disabled by default. Development-only mock fallbacks may be enabled explicitly with:

```bash
VITE_ALLOW_MOCK_DATA=true
```

Production must leave this unset or set it to `false`.

## Local Run

```bash
corepack pnpm --filter @lifeos/tma dev
```

Set:

```bash
VITE_API_BASE_URL=http://localhost:3000
```
