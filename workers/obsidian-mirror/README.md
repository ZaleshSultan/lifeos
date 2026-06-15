# Obsidian Mirror Worker

Mirrors pending LifeOS `obsidian_sync_queue` jobs from Supabase into Markdown
files inside the vault configured for each job owner in
`public.user_obsidian_settings`.

The worker is designed for an Arch Linux server and uses only the Python standard library. It never deletes files and writes notes atomically by replacing a temp file created inside the target note directory.

## Commands

```bash
python obsidian_mirror.py run-once
python obsidian_mirror.py run-loop
python obsidian_mirror.py render-test
python obsidian_mirror.py init-dashboards
```

## Environment

```bash
SUPABASE_URL=https://PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=replace-with-supabase-service-role-key
LIFEOS_ENABLE_LEGACY_SINGLE_USER_OBSIDIAN=false
# Legacy/dev fallback only. Multi-user mode reads user_obsidian_settings.vault_path.
OBSIDIAN_VAULT_PATH=/srv/obsidian-vault
OBSIDIAN_MIRROR_BATCH_SIZE=10
OBSIDIAN_MIRROR_INTERVAL_SECONDS=30
OBSIDIAN_MIRROR_DASHBOARD_DIR=Dashboards
```

Use a service-role key only on the server. Do not ship it to a frontend.

## Multi-user Routing

The worker claims a queue row, reads its `user_id`, and loads
`public.user_obsidian_settings` for that owner. It writes only when settings are:

- `enabled = true`
- `mode = 'local_vault'`
- `status = 'connected'`
- `vault_path` is not empty

If settings are missing, disabled, disconnected, or not a local vault, the job is
deferred without writing a file.

`OBSIDIAN_VAULT_PATH` is legacy/dev fallback only and is ignored unless
`LIFEOS_ENABLE_LEGACY_SINGLE_USER_OBSIDIAN=true` is set.

## Arch Setup

```bash
sudo pacman -Syu --needed python git
sudo useradd --system --home-dir /var/lib/lifeos --create-home --shell /usr/bin/nologin lifeos
sudo mkdir -p /opt/lifeos /etc/lifeos /srv/obsidian-vaults
sudo chown -R lifeos:lifeos /srv/obsidian-vaults
sudo cp -r workers/obsidian-mirror /opt/lifeos/workers/
sudo cp workers/obsidian-mirror/.env.example /etc/lifeos/obsidian-mirror.env
sudo chmod 600 /etc/lifeos/obsidian-mirror.env
sudoedit /etc/lifeos/obsidian-mirror.env
```

Seed one settings row per connected user, for example:

```sql
insert into public.user_obsidian_settings
  (user_id, enabled, mode, vault_path, status)
values
  ('00000000-0000-0000-0000-000000000000', true, 'local_vault', '/srv/obsidian-vaults/user-a', 'connected')
on conflict (user_id) do update set
  enabled = excluded.enabled,
  mode = excluded.mode,
  vault_path = excluded.vault_path,
  status = excluded.status;
```

## Systemd

```bash
sudo cp /opt/lifeos/workers/obsidian-mirror/systemd/obsidian-mirror.service /etc/systemd/system/obsidian-mirror.service
sudo systemctl daemon-reload
sudo systemctl enable --now obsidian-mirror.service
sudo systemctl status obsidian-mirror.service
journalctl -u obsidian-mirror.service -f
```

Make sure `ReadWritePaths=` in the service file covers every configured user
vault root, for example `/srv/obsidian-vaults`.

## Render Test

```bash
python obsidian_mirror.py render-test --entity-type health_daily
```

`render-test` prints Markdown to stdout and does not write to the vault.
