# Obsidian Mirror Worker

Mirrors pending LifeOS `obsidian_sync_queue` jobs from Supabase into Markdown files inside `OBSIDIAN_VAULT_PATH`.

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
OBSIDIAN_VAULT_PATH=/srv/obsidian-vault
OBSIDIAN_MIRROR_BATCH_SIZE=10
OBSIDIAN_MIRROR_INTERVAL_SECONDS=30
OBSIDIAN_MIRROR_DASHBOARD_DIR=Dashboards
```

Use a service-role key only on the server. Do not ship it to a frontend.

## Arch Setup

```bash
sudo pacman -Syu --needed python git
sudo useradd --system --home-dir /var/lib/lifeos --create-home --shell /usr/bin/nologin lifeos
sudo mkdir -p /opt/lifeos /etc/lifeos /srv/obsidian-vault
sudo chown -R lifeos:lifeos /srv/obsidian-vault
sudo cp -r workers/obsidian-mirror /opt/lifeos/workers/
sudo cp workers/obsidian-mirror/.env.example /etc/lifeos/obsidian-mirror.env
sudo chmod 600 /etc/lifeos/obsidian-mirror.env
sudoedit /etc/lifeos/obsidian-mirror.env
```

## Systemd

```bash
sudo cp /opt/lifeos/workers/obsidian-mirror/systemd/obsidian-mirror.service /etc/systemd/system/obsidian-mirror.service
sudo systemctl daemon-reload
sudo systemctl enable --now obsidian-mirror.service
sudo systemctl status obsidian-mirror.service
journalctl -u obsidian-mirror.service -f
```

If your vault is not `/srv/obsidian-vault`, update both `/etc/lifeos/obsidian-mirror.env` and `ReadWritePaths=` in the service file.

## Render Test

```bash
python obsidian_mirror.py render-test --entity-type health_daily
```

`render-test` prints Markdown to stdout and does not write to the vault.
