# Obsidian Sync

The Obsidian mirror is a local Markdown projection of Supabase life entities.
In multi-user mode, each owner routes to their own local vault through
`public.user_obsidian_settings`.

## Worker

Path: `workers/obsidian-mirror/obsidian_mirror.py`

Modes:

- `run-once`
- `run-loop`
- `render-test`
- `init-dashboards`

## Safety Rules

- The worker must write only inside the selected user's configured `vault_path`.
- Rendered paths must pass sanitizer checks.
- Writes are atomic.
- The worker does not delete files.
- Supabase remains the source of truth.
- `OBSIDIAN_VAULT_PATH` is legacy/dev fallback only and is ignored unless
  `LIFEOS_ENABLE_LEGACY_SINGLE_USER_OBSIDIAN=true`.
- Queue rows without connected per-user settings are deferred without file
  writes.

## User Settings

Table: `public.user_obsidian_settings`

Required local-vault settings for writes:

- `enabled = true`
- `mode = 'local_vault'`
- `status = 'connected'`
- `vault_path` points to that user's local vault

## Supported Render Types

- task
- deadline
- capture
- health_daily
- review
- expense
- workout

Completed TMA workouts update the linked `workout` life entity with exercise/set metadata before queueing Obsidian sync, so rendered workout notes include the completed set breakdown when that metadata is present.

## Arch Linux Setup

```bash
sudo pacman -Syu --needed python git
sudo mkdir -p /opt/lifeos /etc/lifeos /srv/obsidian-vaults
cd /opt/lifeos/workers/obsidian-mirror
cp .env.example /etc/lifeos/obsidian-mirror.env
$EDITOR /etc/lifeos/obsidian-mirror.env
python obsidian_mirror.py run-once
```

`init-dashboards` is for legacy single-user fallback only. Multi-user dashboards
are initialized in the selected user's vault while processing jobs.

## systemd

Install the example service from `workers/obsidian-mirror/systemd/obsidian-mirror.service`, adjust paths and user, then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now obsidian-mirror.service
sudo journalctl -u obsidian-mirror.service -f
```
