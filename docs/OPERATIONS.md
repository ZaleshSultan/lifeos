# LifeOS production operations

The active installation uses Debian, systemd, Supabase and Cloudflare Tunnel at
<https://lifeos.zalewko.me>. Railway, Vercel and the old Arch/Tailscale examples
are alternative/historical deployment notes, not the current production target.
The bot serves `/tma/` and authenticated APIs on local port 3000; Next.js serves
`/web` on port 3001. The existing workers remain separate system services.

## Backup design

`scripts/ops/lifeos_backup.py` makes a consistent PostgreSQL 17 custom archive
containing the database's non-system schemas, rows, functions, policies, grants
and migration ledger. It does not substitute a schema-only dump or silently
accept an empty user database. Both live preflight and the actual archive must
contain the configured original identity and nonempty factual history.

The program uses the existing Supabase management credential to provision the
official **read-only** temporary login (300-second provider TTL), then connects
through the session pooler with `sslmode=verify-full`. It sets the read-only role
and a read-only transaction; `pg_dump` retains its normal RLS safety check. The
legacy malformed `DATABASE_URL` is never read or repaired. No application user
or domain record is created, reassigned, restored or deleted by a backup job.
The shared temporary login is allowed to expire rather than blindly revoking
another operator's later login.

The dump uses PostgreSQL's normal consistent repeatable-read snapshot. It does
not request `--serializable-deferrable`, whose safe-snapshot wait can stall a
backup on a busy database. A 15-second table-lock wait, 120-second statement
timeout and 360-second whole-dump timeout keep failures bounded; the existing
backup remains intact if any limit is reached. TLS verification and the
read-only role remain mandatory. These are ordinary
[PostgreSQL 17 pg_dump guarantees and options](https://www.postgresql.org/docs/17/app-pgdump.html),
not a claim that every network or provider outage can be repaired automatically.
`dump_timeout_seconds` accepts only an integer from 60 through 420, default 360.
The installed service retains its ten-minute whole-job limit, covering export,
validation and optional off-site work. Password expiry limits new authentication;
it does not serve as the deadline for an already authenticated export session.
See PostgreSQL's [password expiration semantics](https://www.postgresql.org/docs/17/sql-createrole.html).

The host's PostgreSQL 15 client cannot dump PostgreSQL 17. A bounded, temporary
`postgres:17` client container supplies the compatible tool. It publishes no
ports, runs without capabilities, mounts its password/CA files read-only and
is removed after the command. Every backup client uses `--log-driver=none`, so
Docker does not persist private archive/data stdout in its default container logs;
the caller still captures it for verification and encryption. See
[Docker logging configuration](https://docs.docker.com/engine/logging/configure/).
The existing image must already be installed;
jobs do not pull new images automatically. Supabase's database CA bundle is
held privately and verified against the pooler hostname. The inspected official
CLI templates provide the [2021](https://github.com/supabase/cli/blob/develop/apps/cli/src/commands/gen/types/templates/prod-ca-2021.ts)
and [2025](https://github.com/supabase/cli/blob/develop/apps/cli/src/commands/gen/types/templates/prod-ca-2025.ts)
certificates. Updating this trust bundle requires deliberate verification.

Archives use a versioned AES-256-GCM envelope with an authenticated project,
format and timestamp header, random nonce, ciphertext checksum and plaintext
checksum. The dedicated 32-byte backup key is a separate owner-readable file;
application/OAuth encryption keys are not rotated or repurposed. Plaintext and
temporary connection passwords live only in private RAMfs directories and are
removed after a run. Archive authentication, checksums, archive readability,
canonical identity and actual data floors must pass before local success is
recorded atomically. Failed runs preserve the last successful backup marker.

Private runtime configuration lives outside Git, normally
`~/.config/lifeos/ops.json`; see `scripts/ops/config.example.json` for placeholders.
The key and config require mode 0600, and backup/state directories require 0700.
Never paste keys, cookies, passwords, exports or complete service environments
into chat, issues, shell arguments or logs.

## Storage, retention and recovery keys

The managed local directory is
`/home/zalewko/lifeos-backups/automated-v1`. Historical backups elsewhere are
preserved. Retention selects only recognized, checksum-valid, verified
`lifeos-v1-*` archive/manifest pairs: 30 days, preserving at least seven copies.
It never prunes historical SQL dumps, rescue directories, symlinks or unknown
files. Pruning pauses while a configured off-site copy is failing.

The optional existing rclone remote receives only encrypted archives and safe
manifests under a new dedicated prefix. Copy uses immutable names and downloads
the result to verify its checksum; it never runs a destructive remote sync.
No off-site retention deletion is enabled. Cloud upload failure records a
separate degraded result while preserving verified local success.

During the November 3 mission the existing Google Drive credential was valid,
but an actual upload returned `403 storageQuotaExceeded`. **Off-site protection
is blocked by that account's quota; no successful cloud copy is claimed.** No
existing Drive files were deleted and no storage upgrade was purchased.

The backup key currently has verified local custody only. The owner should put
an independent copy in their private password manager or offline key storage;
do not upload an unwrapped key beside the encrypted archives. Until independent
key custody and a successful off-site copy are verified, whole-host-loss
recovery is not established. PostgreSQL dumps contain Storage metadata, not
receipt/video object bytes, private vault files or server environment files.
Those require their own protected backups. Existing historical vault backups
were preserved.

## Commands and schedules

Use the existing worker Python environment, which already supplies cryptography:

```bash
cd /home/zalewko/lifeos
task_python=workers/university-sync/.venv/bin/python
$task_python scripts/ops/lifeos_backup.py backup
$task_python scripts/ops/lifeos_backup.py verify --manifest /PRIVATE/PATH/lifeos-v1-TIMESTAMP.manifest.json
$task_python scripts/ops/lifeos_backup.py restore-drill
$task_python scripts/ops/lifeos_backup.py predeploy
$task_python scripts/ops/lifeos_monitor.py --dry-run
```

The user-unit installer defaults to preview. After code deployment, reviewed
private configuration, a verified backup and a successful actual restore drill:

```bash
workers/university-sync/.venv/bin/python scripts/ops/install_ops.py \
  --repo-root /home/zalewko/lifeos \
  --python /home/zalewko/lifeos/workers/university-sync/.venv/bin/python \
  --apply
systemctl --user list-timers 'lifeos-*' --no-pager
```

The installer requires existing user linger and refuses to replace unrelated
units. It enables a daily backup at 03:10, weekly Sunday restore at 03:40, both
in **Asia/Almaty**, and monitoring every five minutes. Timer persistence handles
missed calendar runs; backup retry is bounded. Services use time, CPU, memory
and process limits. These are lightweight oneshot jobs, not permanent databases
or a new application stack. The release report records actual installation and
runtime results separately; files alone are not evidence of active schedules.

## Isolated restore verification

`restore-drill` accepts an encrypted manifest, never a database URL, production
host or existing container. It authenticates and decrypts into RAMfs, creates
one unpredictably named container with network `none`, no published ports and
tmpfs database storage, and creates a new UUID-named database. Inspection guards
recheck the identity, labels, network and mounts before writes and cleanup.
No production service credentials enter this container. Existing rescue or
application containers cannot pass the guard.

The archive is restored with standard PostgreSQL ordering and exit-on-error.
Cluster login passwords are not part of `pg_dump`: missing platform owner names
from its TOC are created only in the disposable fixture as nonprivileged
`NOLOGIN` roles. The archive restores database ownership and ACLs. The drill
checks actual restored rows and canonical ownership against the authenticated
archive and configured data floors, then removes only its new container.
Cluster IAM, external provider grants, database passwords and hosted platform
configuration require separate recovery; this is a logical database restore,
not a whole Supabase platform clone.

On November 3, an actual fresh encrypted production archive was restored this
way with the two original identities/profiles, five courses, 97 academic
records, four workouts and 20 finance transactions intact. The first attempt
exposed a missing local platform owner role; the explicit NOLOGIN bootstrap
fixed that environment mismatch. The successful drill also validated the
finance lookup RLS migration and browser/service actor tests on the isolated
copy. No production data restore was performed. Private evidence is in
`~/.local/state/lifeos-ops/last-restore-success.json`; consult the release report
for the final archive hash and timestamp.

## Monitoring and incident alerts

The monitor checks local/public backend health, TMA assets, web entry delivery,
the active tunnel, supported worker units, Telegram webhook status, real
read-only authenticated Ideal Human/Study APIs, canonical database ownership,
data floors, backup integrity/freshness, restore age and free disk space.
Authenticated probes use server-key-signed service test headers held only in
memory. They do not create web sessions, edit a journal or demonstrate a real
handset session. Web entry health is not a claim that every authenticated web
screen has been exercised.

Telegram's [`getWebhookInfo`](https://core.telegram.org/bots/api#getwebhookinfo)
retains the most recent error and its timestamp. A correct webhook with no pending
updates and no error in the last 15 minutes reports `webhook_available_with_history`;
recent errors, unknown error timestamps or an undrained error queue still fail.
This read-only check neither clears Telegram's diagnostics nor proves delivery of
a new handset message.

An active LMS process alone does not mean synchronization works. The monitor
checks safe session/freshness metadata and reports disconnected, expired or
stale LMS data as `WARN`; it never substitutes old grades or a process state
for fresh synchronization. Existing disconnected LMS/off-site baselines are
recorded quietly, not presented as healthy and not repeatedly messaged.

Operational alerts are explicitly authorized to the configured original
administrator through the existing bot. Alerts require two consecutive changed
failure observations by default. A durable reservation is written **before**
network transmission; ambiguous delivery is not automatically resent. Recovery
rearms a future incident. This avoids duplicates across timer restarts, at the
cost of possibly losing an alert if the process dies immediately after its
reservation. It does not promise exactly-once Telegram delivery. Messages
contain component/error codes only, never credentials or private records.
Dry runs do not send or mutate incident state; first-run known `WARN` states
are suppressed. Critical `FAIL` states still alert after the observation
threshold, including a critical baseline suppressed by an older monitor
version. The release must explicitly enable the private alert setting
after checking its baseline. Do not induce production outages just to test it.

```bash
systemctl --user status lifeos-backup.timer lifeos-monitor.timer lifeos-restore-drill.timer
journalctl --user -u lifeos-backup.service -n 40 --no-pager
cat ~/.local/state/lifeos-ops/monitor-status.json
```

Logs and status contain sanitized codes and aggregates. Inspect selected systemd
properties; do not dump token-bearing legacy unit commands or process environments.

## Deployment and incident recovery

Before each release, inspect the actual production checkout and live processes,
run the predeploy guard, test compatible migrations on an isolated copy and
retain source/build rollback artifacts. The guard requires a verified backup
no older than 24 hours, live identity/data floors, a backup matching the current
production migration count and a recent actual restore for that schema. After
applying a migration, take and rehearse a new backup before deploying the app.
Schema migration dry-runs and application smoke tests remain required;
the backup guard cannot replace them. Apply reviewed migrations atomically with
their ledger record, and verify public HTTPS, auth, owned data and services.

Application rollback restores reviewed source/dependencies and prior validated
TMA/Next artifacts. It **never** restores an old database over populated current
tables, resets volumes, discards journal entries or reactivates disclosed tokens.
Additive tables/observations survive rollback.

If data is missing: stop affected writers only through the approved service
process, preserve a fresh encrypted snapshot, compare identity mappings and
per-user counts privately, and rehearse recovery in isolation. Never merge
identities or move user records to make an empty screen look populated. Any
selective production recovery needs a separately reviewed, non-destructive
transaction and evidence that it preserves current records. Do not disable
triggers, RLS or authorization to force a recovery or test to pass.
