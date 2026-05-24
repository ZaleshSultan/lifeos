# Telegram Mini App

The TMA is the in-Telegram workout, focus, mode, and sources surface.

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

For local browser testing without Telegram, set:

```bash
ALLOW_UNSAFE_TMA_DEV_AUTH=true
LIFEOS_DEFAULT_USER_ID=your-auth-user-uuid
VITE_API_BASE_URL=http://localhost:3000
```

Never expose `SUPABASE_SERVICE_ROLE_KEY` in the TMA. All TMA data comes through the backend API.

## Workout Contract

Implemented backend routes:

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
- `POST /api/tma/reminders`

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
