# Telegram Mini App

The TMA is the in-Telegram workout and focus surface.

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
- `POST /api/tma/workout/sets/:setId/complete`
- `POST /api/tma/workout/sets/:setId/undo`
- `POST /api/tma/workout/:workoutId/complete`
- `GET /api/tma/health`
- `GET /api/tma/focus`

`GET /api/tma/workout/current` creates the active default workout if none exists. Set completion, undo, and workout completion all return the same `CurrentWorkout` shape consumed by the TMA.

## Local Run

```bash
corepack pnpm --filter @lifeos/tma dev
```

Set:

```bash
VITE_API_BASE_URL=http://localhost:3000
```
