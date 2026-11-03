# Daily Life notification consent and delivery

The existing `daily-digest-worker` remains the single planner/poller. Morning,
evening and hydration delivery all require explicit saved preferences. Missing
preferences and first-run defaults enable **no notifications**. Deployment creates
no user opt-ins, reminders or check-ins. Health content is off by default.

## Scheduling and privacy

The worker uses the active profile's valid IANA timezone, the saved morning and
evening clocks, and saved quiet hours. Invalid or missing timezone/preferences
fail closed. Quiet start equal to quiet end means quiet hours are disabled.
Morning retains the existing configurable catch-up window and unique daily
digest lease. Evening is prepared only within one hour after its configured time,
so its summary reflects evening data. Optional hydration reminders occupy at most
two unique slots per local day, inside the awake interval; they carry no medical
quota or compulsory target. Changing preferences does not replay sent messages.

The internal `scripts/render-daily-briefing.ts` CLI reuses the same deterministic
Daily Life summary as the application. The worker invokes static Node/tsx argv
with no shell, a 128 MiB JavaScript heap limit, 30-second deadline, 8 KiB stdout
limit and a minimal service-only environment. Bot, model and unrelated encryption
credentials are excluded. The renderer rereads active ownership and saved
health/filming inclusion preferences. It never calls a model, sends notifications,
or persists private journal text. Messages are bounded plain text, avoiding HTML
parse errors after truncation. This is not a claim that a paid AI briefing runs.

When health inclusion is enabled, both overviews can include recorded sleep with
its source and stale marker, plus a short excerpt of an explicitly saved manual
recovery note. Missing values remain unknown; no recovery score is inferred.
Health facts and health/workout source warnings are omitted from delivery when
health inclusion is off. Failed task/workout/journal reads produce an unavailable
warning, not a claim of zero completed tasks, no recorded workout or an unsaved day.

If rendering is unavailable, morning uses the existing saved study digest with
an explicit uncertain-freshness warning; empty LMS data is not presented as proof
that no classes or assignments exist. Evening uses optional reflection questions
and states that current facts are unavailable. No response is saved automatically.

## Existing queues and final authorization

Migration `20261103030000_daily_life_notifications.sql` adds service-only,
RLS-protected `(user_id, local_date, kind)` bindings into the existing reminders
queue. Evening and hydration are delivered by the existing reminder worker.
Morning uses `claim_daily_life_digest`, which wraps the existing digest claim and
binds its preference revision and timezone. The existing lease, retry, fencing,
active-profile and Telegram-link checks remain in use.

Immediately before crossing the durable send boundary,
`begin_notification_delivery` rechecks current consent revision, timezone, quiet
hours and local date for Daily Life jobs. Legacy unbound digest claims cannot
send through this boundary. Ordinary user-created reminders retain their existing
behavior. Preference changes/revocation or timezone changes cancel pending and
prepared Daily Life jobs and prepared digests. An explicit changed configuration
may replace a canceled job only when it has never reached a send attempt.
Confirmed, ambiguous and attempted deliveries are never silently reopened.
Already in-flight HTTP delivery cannot be recalled; the existing conservative
`unknown` outcome avoids blind duplicate retries after network uncertainty.

## Release and rollback

Stop notification workers, apply the additive migrations in timestamp order,
then restart workers from the same reviewed release. The daily-life preferences
migration must precede the notification migration. Keep all default preferences
off. Verify delivery with synthetic fixtures; do not queue production messages
without user opt-in. On rollback stop these workers rather than restoring old
send/delete/requeue behavior. The additive tables and historical delivery rows
can remain; do not erase deduplication history.

## Verification

`bash scripts/test-daily-life-notifications.sh` runs the actual full migration
chain in disposable PostgreSQL 15, existing reminder/digest lease and restart
assertions, eight competing digest claims, eight competing reminder claims, and
eight competing optional-job enqueues. Additional assertions cover default-off,
legacy claims, owner scope, RLS grants, invalid timezone, quiet hours, revoked
preferences, canceled-job reconfiguration and preservation of confirmed sends.
The worker suite includes bounded real child-process timeout/output tests,
plaintext rendering, timezone/DST boundaries and opt-in/quiet/deduplication tests.
These synthetic checks do not prove delivery to a physical Telegram client.
