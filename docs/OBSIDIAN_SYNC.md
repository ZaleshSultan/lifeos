# Obsidian Sync

The Obsidian mirror is a local Markdown projection of Supabase life entities.
In multi-user mode, each owner routes to their own local vault through
`public.user_obsidian_settings`.

See [recovery and safe rollout](OBSIDIAN_SYNC_RECOVERY.md) for the current lease,
managed-file, conflict and migration protocol. Read this before upgrading workers.

## Worker

Path: `workers/obsidian-mirror/obsidian_mirror.py`

Modes:

- `status` (read-only)
- `run-once`
- `run-loop`
- `render-test`
- `init-dashboards`

## Safety Rules

- The worker must write only inside the selected user's configured `vault_path`.
- Rendered paths must pass sanitizer checks.
- Writes use same-filesystem atomic publication with fsync and retained versions.
- The worker does not delete files.
- Supabase remains the source of truth.
- `OBSIDIAN_VAULT_PATH` is only for explicitly enabled legacy dashboard
  initialization, bound to a canonical `LIFEOS_DEFAULT_USER_ID`.
- Queue processing always requires connected per-user settings and an active
  profile; disabled owners retain their pending backlog.
- Differing unmanaged or externally modified notes produce a conflict.

## User Settings

Table: `public.user_obsidian_settings`

Required local-vault settings for writes:

- `enabled = true`
- `mode = 'local_vault'` or `'syncthing'`
- `is_active = true`
- `status = 'connected'`
- `vault_path = '/var/lifeos/vaults/<user_id>'` (server owned)

Admins manage these settings through Telegram, not manual SQL:

```text
/obsidian_set_vault 123456789 /var/lifeos/vaults/<resolved-owner-uuid>
/obsidian_enable 123456789
/obsidian_status 123456789
```

`/obsidian_set_vault` must use the resolved owner’s server-owned path; the
database and worker reject a different tenant root. `/obsidian_enable`
only succeeds for active profiles with an existing vault path.
`/obsidian_disable <telegram_id>` marks the integration disconnected without
deleting any notes.

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
sudo mkdir -p /opt/lifeos /etc/lifeos /var/lifeos/vaults
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

On Arch Linux, the systemd unit must allow writes to every configured user vault
root through `ReadWritePaths=`, using `/var/lifeos/vaults`. Install `workers/common/` alongside the worker.
