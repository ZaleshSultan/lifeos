# LifeOS Self-Host Runbook

Production runs on Arch with systemd and Tailscale Funnel:

```text
https://archlinux.tail2492c9.ts.net
```

The bot serves the TMA from `apps/tma/dist` at `/tma/`. Do not run Vite as a
production service.

## Build And Deploy

From the repository root:

```bash
pnpm selfhost:build-tma
pnpm selfhost:deploy
```

The build script removes the old TMA build, sets the production API origin,
disables mock data, builds with `/tma/` as the base path, and rejects broken
root `/assets/` references.

`pnpm selfhost:deploy` builds the TMA, restarts `lifeos-bot.service`, then
checks local health, public health, and the public TMA.

## Daily Study Digest (one-time setup)

After applying the latest Supabase migrations, install the daily digest service once:

```bash
cd /home/zalewko/lifeos/workers/daily-digest-worker
cp .env.example .env
chmod 600 .env
$EDITOR .env
sudo cp lifeos-daily-digest.service.example /etc/systemd/system/lifeos-daily-digest.service
sudo systemctl daemon-reload
sudo systemctl enable --now lifeos-daily-digest.service
```

The default delivery time is 08:00 in each profile timezone. The worker keeps a
per-day delivery record, so restarts do not create duplicate morning messages.

## Status And Logs

```bash
pnpm selfhost:status

journalctl -u lifeos-bot.service -n 100 --no-pager
journalctl -u lifeos-reminder-worker.service -n 100 --no-pager
journalctl -u lifeos-daily-digest.service -n 100 --no-pager
journalctl -u lifeos-google-sync.service -n 100 --no-pager
journalctl -u lifeos-obsidian-mirror.service -n 100 --no-pager
```

Restart an individual worker only when needed:

```bash
sudo systemctl restart lifeos-reminder-worker.service
sudo systemctl restart lifeos-daily-digest.service
sudo systemctl restart lifeos-google-sync.service
sudo systemctl restart lifeos-obsidian-mirror.service
```

## Health Checks

```bash
curl -fsS http://localhost:3000/healthz
curl -fsS https://archlinux.tail2492c9.ts.net/healthz
curl -fsS https://archlinux.tail2492c9.ts.net/tma/
tailscale funnel status
```

## Black TMA Screen

Check the generated asset paths first:

```bash
rg '/tma/assets/' apps/tma/dist/index.html
rg '(src|href)="/assets/' apps/tma/dist/index.html
```

The first command must find assets. The second must return no matches. Then
rebuild and deploy:

```bash
pnpm selfhost:deploy
```

Also verify `TMA_STATIC_DIR=/home/zalewko/lifeos/apps/tma/dist` and
`ALLOW_UNSAFE_TMA_DEV_AUTH=false` in the bot service environment.

## Release Verification

```bash
pnpm test
pnpm typecheck
pnpm selfhost:build-tma
pnpm --filter @lifeos/web build
python -m py_compile workers/reminder-worker/reminder_worker.py
python -m py_compile workers/daily-digest-worker/daily_digest_worker.py
python -m py_compile workers/google-sync/google_sync.py
python -m py_compile workers/ics-sync/ics_sync.py
```
