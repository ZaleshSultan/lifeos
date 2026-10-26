# LifeOS: safe local rehearsal after an accidental linked Supabase reset

**Purpose:** validate the *pre-reset* SQL exports and rehearse importing them
into a disposable **local** Supabase CLI PostgreSQL instance. The script in
`scripts/lifeos_rescue.py` never connects to a hosted project.

This runbook is for the incident in which a `supabase db reset --linked`
cleared live Auth and LifeOS tables. A snapshot was taken **before** the reset:

- `~/lifeos-rescue/schema.sql` (about 226 KB)
- `~/lifeos-rescue/data.sql` (about 44 MB)

Both files were independently copied from `~/lifeos-backups/` and hashed.
The dump is plain SQL with bulk `INSERT INTO "auth"."users"` and
`INSERT INTO "auth"."identities"`, as well as the application's user tables,
and a `PostgreSQL database dump complete` footer. **An INSERT may contain
multiple rows**, so statement count is not row count.

The live Supabase project was verified empty in several tables following the
reset. Restore rehearsal does **not** restore that project. No original dump
files, data, auth credentials or logs belong in Git or a PR.

## 0. Stop writes, preserve evidence and originals

Do not run `supabase db reset --linked`, `supabase db push`, `migration repair`,
SQL imports against a hosted database, or merge/deploy the pending PR chain.
Stop background LifeOS writers if still enabled; document their state before
changing services.

On Debian:

```bash
chmod 600 ~/lifeos-rescue/schema.sql ~/lifeos-rescue/data.sql
sha256sum ~/lifeos-rescue/schema.sql ~/lifeos-rescue/data.sql
df -h "$HOME"
free -h
```

Keep another encrypted/off-device copy. These SQL files can contain passwords,
Auth identity information, access tokens, medical and financial records.

**Do not paste SQL contents or entire restore logs into chat/issues/PRs.**
The log directory below is private and local. Supabase SQL dump metadata may
not include Storage object bytes; a metadata row isn't a restored file.

## 1. Obtain this branch separately

```bash
git clone --branch codex/lifeos-local-rescue-rehearsal \
  https://github.com/ZaleshSultan/lifeos.git ~/lifeos-rescue-repo
cd ~/lifeos-rescue-repo
python3 -m unittest discover -s scripts -p 'test_lifeos_rescue.py' -v
python3 scripts/lifeos_rescue.py inspect --backup-dir ~/lifeos-rescue
```

The inspect command prints table **names**, SQL statement counts, SHA-256 hashes,
and the footer check. It does not print INSERT values or upload files. Stop
if a required source table is missing or file hashes differ from the preserved
originals.

## 2. Create a NEW, UNLINKED local Supabase workspace

The old manual `postgres:17` and `lifeos-rescue-sb17` containers are
**incomplete**: they do not contain Supabase's Auth/Storage system tables.
Do not add guessed columns or service roles to them, or try importing data
there. The specialized `supabase/postgres` image includes extensions but
does not bootstrap every service schema on its own.

Use the **official Supabase CLI** to initialize a completely separate empty
workspace with no project linking, so it creates those tables correctly.
Do **not** use the existing `~/lifeos` checkout (which may have linked config,
pending migrations and other state).

```bash
mkdir -p ~/lifeos-rescue-rehearsal
cd ~/lifeos-rescue-rehearsal
supabase init
```

Set the **local-only project id** to match the script's hard-coded container
target:

```bash
python3 - <<'PY'
from pathlib import Path
import re

config = Path("supabase/config.toml")
text = config.read_text()
text, count = re.subn(
    r'(?m)^project_id\s*=\s*"[^"]+"$',
    'project_id = "lifeos_rescue_rehearsal"',
    text, count=1,
)
if count != 1:
    raise SystemExit("Could not find local project_id. Check config by hand.")
config.write_text(text)
PY

supabase start --help
```

**Low-RAM host warning:** Debian has approximately 3.2 GiB RAM (and swap).
The full Supabase local stack is resource-heavy. In CLI v2.107.0 the following
service names are supported by `supabase start -x`; verify your installed
version's `--help` before using them. Keep Docker jobs small and do not start
the full stack.

```bash
supabase start -x gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
docker ps --filter "name=^/supabase_db_lifeos_rescue_rehearsal$"
```

If the CLI refuses a service exclusion, the local database fails to start,
or memory is insufficient, **stop** rather than changing the production
project or reusing the manual incomplete image. Try on a more capable
computer if needed. Do not disable Auth/Storage schemas *inside the DB*;
excluding app services is not the same as deleting database system tables.

The recovery script expects exactly:
`supabase_db_lifeos_rescue_rehearsal` with a `supabase/postgres` image,
a running PostgreSQL service, `auth.users` and `storage.objects` present,
zero `auth.users`, and **no** `public.profiles`.

## 3. Restore ONLY into the fixed local Docker container

Read the inspect output and verify the fresh target first. Then from any
directory:

```bash
python3 ~/lifeos-rescue-repo/scripts/lifeos_rescue.py restore-local \
  --backup-dir ~/lifeos-rescue \
  --confirm-local-restore
```

This code neither accepts `--db-url` nor reads `supabase link` settings,
and never invokes `supabase db push` or remote CLI operations. It imports
schema then data with `psql --single-transaction -v ON_ERROR_STOP=1`, using
`session_replication_role=replica` for the data stage per Supabase's documented
SQL backup/restore workflow. Each stage has its own transaction. **If data
fails, schema may have committed**; do not simply rerun against the same DB.
Use a fresh isolated workspace after the root cause is resolved.

On failure, review (privately, without publishing rows or secrets):

```bash
ls -l ~/lifeos-rescue/local-restore-logs/
```

The logs may contain sensitive information. The script prints only failure
status and log *path*, not SQL statements. Do not disable integrity checks or
strip failing foreign keys as a shortcut.

After successful import:

```bash
python3 ~/lifeos-rescue-repo/scripts/lifeos_rescue.py verify-local
```

This shows aggregate row counts for Auth, profiles, tasks, finance, study,
entities, reminders and Storage metadata, plus orphan counts for key owner
relationships. All `orphan ...` counts must be **zero**. Compare counts with
the original known pre-incident values if available. A successful import does
not automatically mean every API endpoint or encryption key works.

## 4. Manual checks before ANY hosted recovery

- Audit SQL output and resolve all import/foreign-key/schema errors in a new
  throwaway local instance. Do not run partial imports against production.
- Check Auth UUIDs and identity links are retained, and verify logins against
  a separately configured *staging* Supabase service. Sessions/tokens may
  require re-authentication after recovery.
- Check Storage: restoring `storage.objects` metadata **does not restore the
  underlying file bytes**. Verify object content independently.
- Check encrypted values: Vault root keys and application encryption secrets
  may be missing/different in a new environment. Do not claim secrets are
  decryptable solely because the table rows were restored.
- The SQL snapshot was created before Tasks 1–4 migrations. Reconcile repo vs
  live migration history, including missing remote-only migrations
  `20261008000100`–`20261008000400`. Never mark migrations applied by
  hand without checking actual schema.
- Back up any data created **after** the reset before attempting a real
  hosted recovery; restoring can overwrite new changes.
- Only after staging evidence and independently verified backups should an
  operator explicitly authorize a production restoration plan. Nothing in
  these scripts can perform that step.

Useful authoritative guidance:
- https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
- https://supabase.com/docs/guides/local-development/cli/getting-started
- https://supabase.com/docs/guides/platform/backups

## Scope and trust limits

The input SQL is trusted because it was exported from the owner's project.
Do not run an untrusted SQL file even locally. Docker containers are not a
perfect sandbox against a deliberately malicious database extension or file.
The local CLI instance can expose ports to localhost, so do not configure
production API keys or real bot/web endpoints for it.

This tool can test SQL compatibility and detect important relationship
problems, but it cannot prove perfect recovery without testing original
Auth/Storage behavior, secret decryption, account access, and application data.
