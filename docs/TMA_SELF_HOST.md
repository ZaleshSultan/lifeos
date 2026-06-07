# Self-Hosted Telegram Mini App

The bot backend can serve the TMA static build at `/tma/`. This keeps the
Telegram webhook, TMA API, and TMA frontend on the same Tailscale Funnel URL.
It does not require Vite preview, a second server process, Railway, or
Cloudflare.

## Build The TMA

From `/home/zalewko/lifeos`, use the checked self-host build:

```bash
pnpm selfhost:build-tma
```

The build is written to `/home/zalewko/lifeos/apps/tma/dist`. With
`VITE_BASE_PATH=/tma/`, generated asset URLs point to `/tma/assets/...`.

## Configure The Bot

Add these values to the environment file loaded by `lifeos-bot.service`:

```bash
PUBLIC_BOT_URL=https://archlinux.tail2492c9.ts.net
TMA_URL=https://archlinux.tail2492c9.ts.net/tma/
TELEGRAM_WEBAPP_URL=https://archlinux.tail2492c9.ts.net/tma/
TMA_STATIC_DIR=/home/zalewko/lifeos/apps/tma/dist
```

Keep `ALLOW_UNSAFE_TMA_DEV_AUTH=false` in production. The TMA calls
`https://archlinux.tail2492c9.ts.net/api/tma/...` because
`VITE_API_BASE_URL` is set to the shared public origin.

When `TMA_STATIC_DIR` exists, the existing bot HTTP server serves:

- `/tma/` as `index.html`
- `/tma/assets/*` as static assets with immutable caching
- `/tma/*` as the SPA fallback to `index.html`

The `/workout` and `/mode` commands use `TMA_URL` for their Telegram Web App
buttons. `/workout` opens the workout screen and `/mode` opens mode settings.

## Restart

Rebuild the TMA after every frontend change, then restart the existing bot
service and run HTTP checks:

```bash
pnpm selfhost:deploy
```

No Vite production process is needed.

## Test

Check the public TMA and existing backend health endpoint:

```bash
curl -fsSI https://archlinux.tail2492c9.ts.net/tma/
curl -fsS https://archlinux.tail2492c9.ts.net/healthz
curl -fsS https://archlinux.tail2492c9.ts.net/tma/ | rg -o '/tma/assets/[^"]+'
```

Open `https://archlinux.tail2492c9.ts.net/tma/` in a browser. In Telegram,
send `/workout` and `/mode` and open both Web App buttons. Also verify `/log`,
`/sources`, and `/reminders`; the webhook remains at:

```text
https://archlinux.tail2492c9.ts.net/telegram/webhook
```

Run repository checks from the repo root:

```bash
pnpm test
pnpm typecheck
VITE_API_BASE_URL=https://archlinux.tail2492c9.ts.net VITE_ALLOW_MOCK_DATA=false VITE_BASE_PATH=/tma/ pnpm --filter @lifeos/tma build
pnpm --filter @lifeos/web build
python -m py_compile workers/obsidian-mirror/obsidian_mirror.py
python -m py_compile workers/reminder-worker/reminder_worker.py
```
