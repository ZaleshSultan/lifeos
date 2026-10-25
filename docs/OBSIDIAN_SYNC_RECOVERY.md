# Obsidian mirror recovery and data integrity

Task 4 builds on the unmerged security and notification changes in PRs #5, #6
and #7. Its PR targets `codex/reminder-digest-reliability`; retarget only after
those dependencies land. No production database, personal vault or Syncthing
configuration was used for validation.

## Verified original lifecycle

The bot/store `createLifeEntityWithSync` RPC and worker helpers in
`workers/common/lifeos_sync.py` create owner-scoped entity/queue rows in one
transaction. Academic integrations use those helpers too. The mirror renders
existing Markdown templates from the entity and owner-scoped linked records.
Obsidian remains a one-way read mirror; there is no import of edits into LifeOS.

Before this change the mirror selected pending jobs and PATCHed their state.
Its completion/failure PATCH checked only the job ID. There was no lease,
claim token, stale recovery, durable publication intent or managed-file hash.
A process death left `processing` jobs stuck indefinitely (high reliability
severity); a delayed worker could complete a newer attempt (high). Re-rendering
a changed title could choose a second path (medium). The filesystem writer
resolved symlinks before validation, created parents before the containment
check, and replaced arbitrary existing destinations without detecting manual
edits (high data integrity/security severity). Global legacy routing could
send several owners to one vault (high). Raw REST errors and private paths
could reach diagnostics (medium).

Database owner policies and server-assigned per-user vault paths already
existed; these protections were retained. The legacy monthly-review writer
is explicitly opt-in, but also had a direct replace path. It now shares safe
filesystem operations and refuses to replace differing existing review notes.

## Queue and publication protocol

Two additive migrations, in this order:

1. `20261025042616_obsidian_sync_recovery.sql` adds enum values `retry` and
   `conflict`. It must commit before the next migration uses those values.
2. `20261025043139_obsidian_sync_leases.sql` adds `claim_token`,
   `lease_expires_at`, `last_error_code`, service-only lifecycle RPCs and
   `obsidian_managed_notes`. Existing `attempts`, `available_at`, `locked_at`
   and `completed_at` are reused. There is no history reset or deletion.

The second migration quarantines every legacy `processing` row as `conflict`
with `legacy_claim_unverified`. Its prior attempt count and timestamps remain.
An old writer had no publication journal, so automatic replay cannot prove it
would preserve the user's file. Completed, failed and cancelled rows remain.

`claim_obsidian_sync_jobs` locks a settings row with `SKIP LOCKED`, claims one
ready job per user/vault, increments attempts atomically and issues a random
UUID token with a five-minute lease. A partial unique index also prohibits two
processing jobs in one vault. Different users can progress concurrently. Only
active profiles with enabled, active, connected local/Syncthing settings are
eligible; disabled owners retain their pending backlog without retry storms.
Deletion/unsupported operations and entities with incorrect ownership become
terminal failures without any filesystem side effect.

The worker takes the vault-wide filesystem lock, verifies its current claim,
boots missing dashboards, fetches the stable note binding, observes the exact
file hash and calls `prepare_obsidian_sync_job`. The durable intent records:

- `(user_id, life_entity_id)` logical identity and a unique, pinned relative path;
- applied, expected and pending SHA-256 hashes, without note bodies;
- a monotonically increasing revision, pending job and claim token.

Changing a title/date or queued destination never moves a bound note. Initial
adoption allows an absent file or byte-identical content only. An existing
unmanaged file with different content is a conflict. Later writes require a
recognized applied/expected/pending hash; missing previously applied files also
conflict. Filesystem publication checks the expected hash and inode again.
Completion atomically advances the ledger and queue only for the current
owner, token, unexpired lease, content hash and revision. A heartbeat renews
long-running claims; the worker checks authorization again immediately before
publication. Blocking/disconnecting an owner prevents renewal/preparation/ACK;
expired inactive claims are cancelled. Database and filesystem authorization
cannot be one atomic transaction, so a block concurrent with the last filesystem
instruction can race with that instruction; the resulting file stays in that
same owner's vault and no newer claim can be acknowledged by the old token.

`recover_obsidian_sync_jobs` recovers expired new claims with exponential
backoff. The worker recovers on every run/restart. There are at most five
claims per job, starting with a 60-second failure backoff and capped at one hour
(the lease-expiry recovery path is deliberately more conservative). Permanent
errors become `failed`; unsafe paths, manual edits and Syncthing conflict files
become `conflict`. Failed/conflict rows are not automatically requeued.

## Crash boundaries and filesystem behavior

All paths are validated component by component using directory descriptors and
`O_NOFOLLOW`, including root ancestors. Absolute/traversal/encoded escape paths,
reserved internal paths, symlinks, hardlinked notes, FIFOs and other unexpected
objects are rejected. The caller binds the root to the canonical UUID owner's
server-owned `/var/lifeos/vaults/<user_id>` path; database content cannot choose
an arbitrary root. Legacy dashboard initialization additionally requires an
explicit `LIFEOS_DEFAULT_USER_ID` binding and opt-in.

Temporary files are created in the destination directory on the same
filesystem, written as UTF-8, flushed and fsynced before publication. The
containing directories are fsynced. New files use an atomic no-clobber `RENAME_NOREPLACE`
publication; there is no two-link crash window. Linux existing-file updates require `renameat2(RENAME_EXCHANGE)`;
unsupported filesystems fail closed. The displaced inode is kept under an
opaque random name in `.lifeos-recovery/`, with no automatic pruning. A crash
at the exchange boundary can leave that old inode under a target-directory
`*.tmp-lifeos` name instead. These are recoverable versions, not disposable
files that a cleanup job may delete blindly.

| Failure boundary                         | Recovery                                                                                     |
| ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| Before claim                             | Queue unchanged                                                                              |
| After claim/before prepare               | Expired lease becomes bounded retry                                                          |
| After prepare/before publication         | Durable pending hash permits retry                                                           |
| During temporary write                   | Target unchanged; ignored artifact may remain                                                |
| After publication/before ACK             | Observed pending hash is recognized; identical retry avoids another write                    |
| ACK committed but response lost          | Completed job is not reclaimed                                                               |
| New claim issued while old worker pauses | Vault lock serializes writers; old worker must renew before publication and token-fenced ACK |
| Unexpected user/Syncthing bytes          | Conflict; existing file retained                                                             |

This is recoverable, idempotent publication, **not exactly-once execution across
PostgreSQL and the filesystem**. Editors and Syncthing do not honor the worker's
lock. All worker processes must share the same underlying vault and lock inode;
separate Syncthing replicas on different hosts do not share filesystem locks.
Hash/inode checks plus retained displaced versions detect observed races
and attempt restoration while retaining both versions. They cannot provide a
full compare-and-swap against an uncooperative process writing an already-open
inode after the check. Use normal backup/versioning, restrictive OS ownership
and a dedicated worker account. An attacker controlling ancestor directories,
mounts or root privileges is outside the filesystem trust boundary.

## Syncthing and conflict handling

Existing device IDs, credentials and folder configuration are unchanged. The
worker appends a managed block to `.stignore` while preserving custom rules:
`.lifeos-tmp/`, `*.tmp-lifeos`, `.*tmp-lifeos`, `.lifeos-state/` and
`.lifeos-recovery/` are ignored. Preinstall these ignore rules before starting either writer: acquiring the lock
creates `.lifeos-state` before bootstrap can update `.stignore`. Standalone monthly
review deployments also require them. Review effective ignores on every peer;
Syncthing's `.stignore` is local configuration. Unexpected objects/races while
updating it stop processing. The unresolved `sync-conflict` guard runs before
bootstrap writes. Dashboards are create-only and never replace manual content.
The unused LMS dashboard helper also uses conservative create-only publication.

Conflicts need operator review with the owner. Stop that vault's processing,
back up its notes, ledger and retained versions, compare the actual file with
the recorded hashes, and choose which bytes to preserve. Do not delete the
ledger, erase history, change hashes blindly or bulk-requeue legacy rows.
After an explicit decision, an authorized operator may create a fresh scoped
job or resolve the recorded binding in a separately reviewed procedure. This
change intentionally supplies no destructive auto-resolution command.
Monthly reviews also use create-only publication: regenerating a different
report at an existing path requires review rather than overwriting it.

## Diagnostics and rollout

`python workers/obsidian-mirror/obsidian_mirror.py status` is read-only. It calls
only the aggregate status RPC; it does not recover jobs, claim work, instantiate
a vault or initialize dashboards. Counts include backlog, states, stale leases,
retry attempts and durations. Runtime events use fixed error categories and
aggregate timings, without bodies, filenames, vault paths, credentials or raw
external responses. Do not publish the private database ledger or queue.

Before an approved deployment:

1. Back up the database, vaults, local `.stignore` and Syncthing versions.
2. Stop **all** old mirror processes and legacy direct writers. There must be
   no mixed old/new writers: the old code does not understand tokens/locks.
3. Apply dependencies from PRs #5/#6/#7, then the two migrations above in order
   and in separate migration transactions. Review quarantined legacy jobs.
4. Install `workers/common/obsidian_files.py` alongside the worker and preserve
   the existing directory layout. No new runtime Python packages are needed.
   Verify Linux exchange/fsync/no-clobber rename support on the actual filesystem with
   disposable data, not a personal vault. The worker account must own its vault
   and internal directories. Network filesystems need separate validation.
5. Start one new worker, inspect read-only status and fixed events, and verify
   one owner-scoped test job before increasing worker concurrency.
6. Monitor conflicts, exhausted retries, backlog, stale leases, recovery storage
   growth and unsupported filesystem errors. Recovery versions are not pruned.

Rollback means stopping the worker while preserving the additive schema and
ledger. Do not restart the old writer against this protocol or drop its journal;
ship a forward fix or restore a deliberately reviewed complete backup. Enum
values cannot simply be removed. No production deployment is performed here.

## Verification

`bash scripts/test-obsidian-sync.sh` loads every migration into disposable
PostgreSQL 15 with realistic Supabase roles/default privileges. It runs competing
transactions, legacy-state preservation, fenced lifecycle, hash/revision,
active-user, browser denial and cross-user assertions. CI runs it together with
the existing web, security, LMS and notification SQL tests.

`pnpm test:workers` includes filesystem tests using only temporary directories,
real atomic exchange, subprocess termination and crash artifacts, plus mirror
recovery/ACK-loss/conflict/authorization tests. Also run `pnpm typecheck`,
`pnpm test`, both frontend production builds and the web-session smoke script.
The PR records exact final counts and any limitations.
