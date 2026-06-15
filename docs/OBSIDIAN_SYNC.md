# Obsidian Sync

The Obsidian mirror is a local Markdown projection of Supabase life entities.

## Worker

Path: `workers/obsidian-mirror/obsidian_mirror.py`

Modes:

- `run-once`
- `run-loop`
- `render-test`
- `init-dashboards`

## Safety Rules

- The worker must write only inside `OBSIDIAN_VAULT_PATH`.
- Rendered paths must pass sanitizer checks.
- Writes are atomic.
- The worker does not delete files.
- Supabase remains the source of truth.
- The current worker is legacy single-user and must keep
  `LIFEOS_ENABLE_LEGACY_SINGLE_USER_OBSIDIAN=false` in multi-user production
  until queue claims and vault output are routed per user.

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
sudo mkdir -p /opt/lifeos /etc/lifeos /srv/obsidian-vault
cd /opt/lifeos/workers/obsidian-mirror
cp .env.example /etc/lifeos/obsidian-mirror.env
$EDITOR /etc/lifeos/obsidian-mirror.env
python obsidian_mirror.py init-dashboards
python obsidian_mirror.py run-once
```

Set `LIFEOS_ENABLE_LEGACY_SINGLE_USER_OBSIDIAN=true` only for local/dev or an
explicitly accepted single-user deployment.

## systemd

Install the example service from `workers/obsidian-mirror/systemd/obsidian-mirror.service`, adjust paths and user, then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now obsidian-mirror.service
sudo journalctl -u obsidian-mirror.service -f
```
