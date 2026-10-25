# Reminder and daily digest reliability

Task 3 builds on PRs [#5](https://github.com/ZaleshSultan/lifeos/pull/5) and
[#6](https://github.com/ZaleshSultan/lifeos/pull/6). Both remain open at implementation
time. Branch `codex/reminder-digest-reliability` is based on
`309e27f1e9eed6d10f79cb984242cea0a1aa1cac`; its PR targets
`codex/security-hardening-phase-2`. Merge dependencies first, then retarget to
`main-v2`, check the resulting diff and rerun CI. No production deployment,
production database access, historical migration edits or user-data deletion
was performed.

## Confirmed causes

- Reminder claiming already used atomic `FOR UPDATE SKIP LOCKED`, but subsequent
  updates checked only status/id. Stale workers could overwrite a newer claim.
- Old stale recovery always returned `processing` to `pending`, even if a
  Telegram send had already happened. It could resend an acknowledged message
  after a failed database confirmation. Retry counts lived in mutable metadata.
- Digest insert deduplication protected concurrent creation but left crashed
  `sending` rows stuck. Its error path deleted the delivery row, losing attempts
  and retrying uncertain outcomes, including send-success/DB-write-failure.
- Reminder formatting/quiet hours and source scheduling used a global timezone.
  Quiet-end construction mishandled daytime intervals and DST gaps/folds.
- Linked reminder context reads lacked user filters; raw database/transport
  exception details could appear in logs.

## Durable delivery protocol

PostgreSQL and Telegram do not share a transaction. There is **no exactly-once
Telegram guarantee** and no automatic retry of an ambiguous external send.

| State        | Meaning                                                            | Recovery                                                |
| ------------ | ------------------------------------------------------------------ | ------------------------------------------------------- |
| `pending`    | Ready or waiting for `next_attempt_at`                             | Atomically claim when due                               |
| `processing` | Owned preparation lease; Telegram has not been started             | Expired lease retries with an incremented failure count |
| `sending`    | Durable begin boundary committed before the HTTP request           | Expired lease becomes `unknown`                         |
| `sent`       | Telegram returned a valid message ID and DB confirmation committed | Never automatically reclaimed                           |
| `unknown`    | A message may have been accepted; outcome cannot be proven         | Operator review, no automatic resend                    |
| `failed`     | Permanent rejection, exhausted budget or obsolete digest date      | Operator review                                         |
| `cancelled`  | Cancelled or recipient access revoked before send                  | Never restored by recovery                              |

Claims have a fresh UUID token and five-minute preparation lease. The shared
begin RPC checks the active recipient, current Telegram link, row owner, token,
status and lease. For digests it also rechecks the current profile-local date,
so preparation cannot carry yesterday's digest across midnight. It increments
`delivery_attempts` and creates a two-minute sending lease. Workers make no HTTP
request unless the begin response confirms authorization. Reminders claim one
row at a time, up to the configured batch size, avoiding expiring an entire batch
while an earlier item is slow.

Every finish/defer operation includes `user_id`, row ID and claim token and checks
an unexpired lease. Cancelled, sent or superseded claims cannot be overwritten.
Retries increment `failure_count`; three failures or three Telegram attempts
terminate processing. Backoff starts at 60 seconds and doubles for subsequent
failures; a verified Telegram 429 uses its retry_after, bounded to one day.
Quiet-hour deferrals do not increment or reset either counter. Claim-only crashes
consume the failure budget during recovery, without inventing a Telegram send.

A verified Bot API 4xx rejection is terminal; a verified 429 is definitely not
sent and retryable. Transport failures, timeouts, 5xx, redirects and malformed or
unverified responses are `unknown`. A lost begin response causes no send. If
Telegram acknowledges but the DB write fails, the worker leaves the durable
sending record in place; expiry makes it unknown rather than resending. The
crash gap between committing begin and actually transmitting HTTP is also
conservatively unknown, even if no request was transmitted.

Digest `(user_id, local_date)` deduplication remains intact. Recovery marks old
pending local dates failed instead of sending yesterday's content. Confirmed
sent history is retained. Account blocking cancels pending/preparing work and
marks in-flight sends unknown; reapproval does not restore those records. An
already-authorized/in-flight Telegram request cannot be recalled.

## Migration and compatibility

Apply `supabase/migrations/20261024192839_notification_delivery_leases.sql`
after Task 2 migrations. It extends the existing tables with claim/lease fields,
durable counters, retry time, fixed error code and acknowledged message ID.
Legacy ambiguous `processing` reminders and `sending` digests become `unknown`;
confirmed sent records and existing retry counts are preserved.

The original claim RPC signature and SKIP LOCKED mechanism remain. New lifecycle
RPCs and queue health are service-role-only, with explicit PUBLIC/anon/
authenticated revokes and pinned search paths. Existing RLS remains enabled.
The profile block trigger follows the same profile-first lock order as begin.
No message content, credentials or copied provider responses are stored in
failure codes.

`remind_at` and `metadata_json.event_at` retain original times. Generated
`notification_at = greatest(remind_at, next_attempt_at)` supplies the effective
availability time to claim queries and existing reminder API projections.
This keeps deferred reminders visible in upcoming lists and excludes them from
currently due lists. Explicit snooze clears the worker defer without resetting
attempts. No unrelated screens or auth/session design changed.

## Recipient-local scheduling

IANA profile timezones govern scheduling, display, quiet hours and digest dates.
Invalid/missing zones fall back to UTC. Persistent timestamps remain UTC.

- Tested zones: Asia/Almaty, Asia/Qyzylorda, Europe/London, America/New_York.
- A nonexistent spring-forward clock advances to the first valid local minute.
  A repeated fall-back clock selects the earlier occurrence; quiet-end selection
  chooses the first occurrence still in the future.
- Digest windows compare elapsed UTC time, stay anchored to the current local
  date and cannot reopen the previous day's delivery. Day boundaries preserve
  23/25-hour DST days.
- Daytime and overnight quiet intervals work; equal endpoints disable quiet
  hours. Deferrals are capped at one hour before the event; near events and the
  existing instant-academic/war/duolingo exceptions retain immediate behavior.
- Quiet hours are rechecked after slow preparation. Different scheduling offsets
  that collapse onto one quiet-end instant produce one reminder for that event.
- Source reconciliation fetches profile timezone and uses owner/pending/version
  conditions for updates. It preserves attempt metadata and never restores a
  concurrently cancelled, processing or terminal row.

## Inspection and recovery

These commands are read-only and never initialize a Telegram sender:

```sh
python workers/reminder-worker/reminder_worker.py status
python workers/daily-digest-worker/daily_digest_worker.py --status
```

They print aggregate status counts from `notification_queue_health()`, without
message bodies or credentials. Poll logs report claims, stale recoveries,
attempts, failures, unknown outcomes, acknowledgements and duration. Use existing
systemd/journal monitoring to alert on `unknown`/`failed`, repeated database
outages and persistently pending queues. A dry status poll does not recover or
send jobs. `test-send` remains an explicit manual sending command and was not
executed in tests.

For investigation, an authorized service operator can inspect only the relevant
owner's `id`, status, counters, `last_error_code`, lease and message ID. Unknown
outcomes require checking Telegram before any deliberate intervention. Do not
bulk-reset rows or automatically set unknown to pending. Never reset a confirmed
sent digest for a local date without an explicit user request. There is no
provider-supported idempotency key for sendMessage that this worker can use.

## Rollout

1. Merge/review PR dependencies and back up through the normal process.
2. Stop **all old reminder and digest worker instances** and let active sends
   finish. Old binaries do not honor new fencing and must not run alongside these.
3. Apply the additive migration as the existing migration owner. Review legacy
   rows now marked unknown; the migration never blindly resends them.
4. Update the backend reminder API/store projections and worker code together
   with `workers/common`. Keep secrets in existing
   protected environment files and service roles on the backend only.
5. Run read-only status, then start workers and inspect queue/recovery metrics.
   Multiple new instances are safe. Verify a synthetic reminder and one digest
   per intended local date in staging before production rollout.
6. On rollback, stop notification workers; do not restore old send/delete/requeue
   logic against the new state. Keep history and resolve uncertain outcomes
   explicitly. No deployment was performed by this task.

`REMINDER_WORKER_BATCH_SIZE` is the maximum rows processed per poll.
`REMINDER_WORKER_CLAIM_TIMEOUT_MINUTES` remains accepted for old environment
files but database-enforced preparation/sending leases are now fixed at five/two
minutes; that old setting cannot shorten the safety boundary. `APP_TIMEZONE`
remains useful for explicit test-send display; live notifications use profiles.
No new service, dependency or production environment secret is required.

## Tests and operational limits

Final local validation on 2026-10-25:

| Command                                        | Result                                                                 |
| ---------------------------------------------- | ---------------------------------------------------------------------- |
| `pnpm typecheck`                               | Passed                                                                 |
| `pnpm test`                                    | 638 tests / 53 files passed                                            |
| `pnpm test:workers`                            | 279 tests passed with the repository requirements in an isolated venv  |
| `pnpm --filter @lifeos/tma build`              | Passed; existing chunk-size warning                                    |
| `pnpm --filter @lifeos/web build`              | Passed                                                                 |
| `node scripts/test-web-session-smoke.mjs`      | Passed with built Next.js and local mock backend                       |
| `bash scripts/test-notification-deliveries.sh` | 107 SQL assertions; eight reminder and eight digest claim transactions |
| `bash scripts/test-security-migrations.sh`     | Passed                                                                 |
| `bash scripts/test-lms-migration.sh`           | Passed                                                                 |
| `bash scripts/test-web-session-migration.sh`   | Passed                                                                 |

The first SQL test run hit slow host WAL storage and was replaced by a bounded
256 MiB tmpfs disposable container. Normal PostgreSQL transactions/locking and
crash lifecycle simulations remain in use; no production storage was accessed.
During implementation, stale in-memory claim fixtures and a duplicate TypeScript
field declaration were corrected before the final successful runs. No unresolved
local failures remain.

`pnpm test:workers` includes the new
shared protocol/timezone tests, reminder and digest failures, security regressions
and existing workers. `scripts/test-notification-deliveries.sh` creates its own
bounded tmpfs PostgreSQL 15 container, loads the entire migration chain and uses
independent overlapping transactions for eight reminder and eight digest claims.
Only synthetic users/data and mocked Telegram are used.

Live Telegram delivery, real-device/provider integration and production settings
were not tested. This policy prefers an explicit unknown outcome over a possible
duplicate; ambiguous jobs need operator attention. Automated reconciliation of
unknown Telegram sends, operator UI, proactive alert routing, retention scheduling
and distributed rate limiting remain follow-up work. Existing API credentials,
web-session protections, LMS restrictions and health revocation remain enforced.
