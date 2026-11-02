# Database

Supabase Postgres is the durable LifeOS store.

## Production diagnostics and recovery

Verify the public project reference from the running service before querying a
database. Compare it with the service's environment file without printing keys,
passwords, connection strings or complete process environments. Use read-only
queries and distinguish a missing profile from an unavailable database or an
anonymous client filtered by RLS. The production backend requires its service
role; browser credentials are not a fallback.

`supabase db reset --linked` destroys data in the linked remote project. Never
use it against production. The reset command under **Local Supabase Flow**
below is only for a disposable local stack. Production migrations need a reviewed
dry run, a verified recovery point and explicit release authorization.

An intact migration ledger or a successful build does not establish that user
data is intact. Check authorized aggregate counts and identity relationships
before and after a release. Record manual schema changes as migrations; a reset
can remove objects that exist only in an ad hoc schema snapshot.

Recovery requires explicit owner approval before any production restore or data
import. First restore the backup in isolation with networking disabled, validate
its original identities and grades, and compare its schema with the current
database. Do not blindly replay a data dump or old migration ledger into a newer
schema. Preserve original user IDs and foreign keys; never create replacement
users to make missing data appear recovered. Review stale credentials and
outbound queues before any approved cutover.

## Optional assistant persistence

`20261011084249_assistant_brain_persistence.sql` adds separate user-owned
`assistant_memories` and minimal `assistant_actions` tables, plus a service-role-only
atomic memory/reminder mutation RPC. RLS is enabled, browser writes are revoked,
and operational academic/calendar tables are unchanged. Apply only through an
approved release; the feature defaults off. Local verification:
`bash supabase/tests/test-assistant-migration.sh` creates a disposable PostgreSQL
container and never reads hosted connection settings. See
[assistant rollout and rollback](ASSISTANT_ROLLOUT.md).

## Migration Order

Apply migrations in filename order:

```bash
supabase db push
```

The initial foundation migrations include:

- `20260518020100_lifeos_kernel.sql`
- `20260518020200_health_layer.sql`
- `20260518020300_fitness_layer.sql`
- `20260518020400_finance_layer.sql`
- `20260518020500_bot_life_entities.sql`
- `20260518020600_health_ingest_api.sql`
- `20260518020700_vertical_slice_stabilization.sql`
- `20260518020800_health_contract_metrics.sql`
- `20260520000100_telegram_log_inbox.sql`
- `20260521000100_life_modes.sql`
- `20260523000100_life_modes_phase1_study_courses.sql`
- `20260524000100_dynamic_sources_mvp.sql`
- `20260615000100_profile_status_roles.sql`

This is not the complete migration inventory. The authoritative ordered set is
`supabase/migrations/*.sql`; compare its versions with the target project's
`supabase_migrations.schema_migrations` before selecting a release. Do not push
unrelated pending migrations or rerun already applied SQL. A migration file's
presence does not establish that it has been applied in production.

## Kernel Tables

- `profiles`
- `daily_logs`
- `tasks`
- `life_entities`
- `obsidian_sync_queue`

## Health Tables

- `health_daily`
- `health_sync_runs`
- `health_workouts`
- `health_samples`
- `health_metrics`
- `health_ingest_credentials` (server-only, revocable device credentials)

## Fitness And Finance Tables

Workout sessions and sets use the existing `workouts` and `workout_sets` tables.
Finance uses `finance_transactions`, accounts, categories, budgets and related
receipt/tag/reimbursement tables; optional timeline entities are projections,
not a second authoritative transaction ledger. Currency and exchange-rate
lookups receive read-only browser policies in
`20261103000100_finance_lookup_rls.sql`; browser mutations remain forbidden.

## Dynamic Sources MVP

Dynamic source state is stored in:

- `external_sources`
- `source_events`
- `sync_runs`
- `reminders`
- `academic_records`

Integration workers and authenticated APIs reuse these tables alongside
`study_courses`, `course_schedules` and `assessment_items`. Their presence does
not establish a current university grant, a fresh sync or an authorized Google
account. See [LMS connection limitations](AITU_AUTH_DISCOVERY.md) and
[architecture](ARCHITECTURE.md) for the actual integration boundaries. Never
replay a historical seed over restored academic records or outbound queues.

## RLS

RLS is enabled by migration. The scaffold intentionally avoids unsafe public policies. Backend processes use a service role key through `packages/db`; browser apps must not.

## Identity And Bootstrap

LifeOS currently uses Supabase Auth as the identity root:

- `auth.users.id` is the durable LifeOS `user_id`.
- `public.profiles.user_id` references `auth.users(id)`.
- Telegram linking lives in `public.profiles.telegram_user_id`.
- `public.profiles.status` controls access: `pending`, `active`, or `blocked`.
- `public.profiles.role` controls admin commands: `user` or `admin`.

Only `active` profiles can use protected bot/TMA flows. New Telegram signups default to `pending` and `user`; admins approve them through the bot.

Single-user bootstrap snippet:

```bash
cp supabase/seed_single_user.sql /tmp/lifeos_seed.sql
# edit UUID and Telegram id
psql "$DATABASE_URL" -f /tmp/lifeos_seed.sql
```

The profile insert requires the referenced `auth.users` row to exist. If `/start` cannot link automatically, it returns exact profile SQL using the sender's Telegram id.

## Health Contract Columns

The canonical health ingest row is `health_daily`. It stores the final Health Connect bridge fields, including:

- sleep totals: `sleep_minutes`, `deep_sleep_minutes`, `rem_sleep_minutes`, `awake_minutes`
- activity and energy: `steps`, `active_energy_kcal`, `calories_burned`
- recovery signals: `resting_heart_rate`, `hrv_ms`, `spo2_avg`
- subjective scores: `mood_score`, `energy_score`, `stress_score`
- `missing_metrics` as JSON for explicit unavailable metrics

`data_completeness_score` is always stored as a 0..100 score.

## Indexing

Indexes are included around user/date, entity type, due dates, sync status, and layer-specific lookup keys. When adding dashboard summary endpoints, prefer indexes that match exact query filters before adding broad materialized views.

## Local Supabase Flow

```bash
supabase start
supabase db reset
supabase migration list
supabase db push
```

For hosted Supabase, link once and push:

```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

## LMS session migration

`20261010141237_secure_lms_sessions.sql` adds optional encrypted AITU SSO-only sessions, credential-free metadata, queue/state fields and service-only per-user sync leases with atomic session mutation RPCs. Existing password/WS/iCal configurations and academic records remain intact. Browser roles cannot read/write credentials. Test with `bash scripts/test-lms-migration.sh` against disposable PostgreSQL; see [LMS_SESSIONS.md](LMS_SESSIONS.md) for the approved-deployment procedure.

## Web session migration

`20261022142222_secure_web_sessions.sql` adds service-only login-token/session
hash tables, atomic single-use exchange RPCs and profile-status invalidation.
It changes no existing user data. See [WEB_SESSIONS.md](WEB_SESSIONS.md). Run
`bash scripts/test-web-session-migration.sh` against its disposable container.

## Notification delivery leases

See [notification deliveries](NOTIFICATION_DELIVERIES.md) for additive migration
`20261024192839_notification_delivery_leases.sql`, service-only lifecycle RPCs,
legacy-state handling and required stop-old-workers rollout.

## Obsidian mirror recovery

See [Obsidian recovery](OBSIDIAN_SYNC_RECOVERY.md) for the ordered additive
`20261025042616_obsidian_sync_recovery.sql` and
`20261025043139_obsidian_sync_leases.sql` migrations, service-only publication
ledger, legacy quarantine and required stop-all-old-writers rollout.

## Daily Life release migrations

These three candidate migrations extend the existing data model. Actual applied
versions, restore evidence and deployed runtime verification are recorded in the
[phase 2 release report](OVERNIGHT_PHASE2_REPORT.md), not inferred here.

| Migration                                     | Tables and behavior                                                                                                                                                                                                                     |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20261103010000_daily_life_logs.sql`          | Adds `hydration_entries` and revisioned `daily_life_preferences`; adds nullable request/hash columns and a unique per-user request index to existing tasks; adds a monotonic task update timestamp trigger.                             |
| `20261103020000_ai_execution_budget.sql`      | Adds `ai_execution_reservations`, a conservative per-user/request accounting ledger with owner/feature/global UTC-day limits and durable task iteration limits.                                                                         |
| `20261103030000_daily_life_notifications.sql` | Adds `daily_life_notification_jobs` linking unique user/day/kind jobs to existing reminders, and preference revision/timezone fields on existing digest deliveries. Extends the existing send fence with consent and local-time checks. |

All four new tables have RLS enabled, with browser table access revoked. Their
mutation/read RPCs are service-role-only and retain explicit owner arguments from
the backend authentication boundary. Hydration add/undo and task mutations lock
the active owner's profile; exact request retries do not create duplicate rows.
`get_hydration_summary` computes the complete owned daily sum in one snapshot,
independently of its bounded 200-entry history. `manage_lifeos_task` checks the
saved timestamp before editing an existing task; completion evidence is set or
cleared by explicit status changes. `save_daily_life_preferences` compares the
expected revision, and missing preferences leave every notification disabled.

`reserve_ai_execution` serializes cross-process accounting under a database
advisory lock; `finish_ai_execution` records bounded usage/status without refunding
potentially billed work. Reservations contain no prompts, images, credentials or
model responses. They must survive application restarts and rollback. See
[AI execution safety](AI_EXECUTION_SAFETY.md).

`claim_daily_life_digest` and `enqueue_daily_life_notification` bind jobs to the
owner's current preferences and timezone. `begin_notification_delivery` rechecks
consent before using the established claim/lease/send transition. Confirmed or
ambiguous deliveries are never reopened to compensate for a changed preference.
The trigger-only `cancel_changed_daily_life_notifications` uses narrowly scoped
definer privileges, an empty search path and fixed public tables so the existing
authenticated owner timezone-update grant continues working without granting
browser access to queue tables. Profile RLS still prevents foreign-user updates.
See [notification consent and rollout](DAILY_LIFE_NOTIFICATIONS.md).

Before applying these migrations, verify a fresh backup and restore it in an
isolated database, then rehearse the ordered changes against that schema. Stop
old notification workers during the coordinated migration/application rollout.
Apply each reviewed version and its migration-ledger record atomically through
the established release procedure. These SQL files are once-only migrations,
not scripts to rerun blindly after a partially observed deployment.

Relevant isolated verification harnesses are
`bash scripts/test-daily-life-migration.sh`,
`bash scripts/test-ai-budget-migration.sh` and
`bash scripts/test-daily-life-notifications.sh`. They use synthetic identities;
the notification harness exercises the full migration chain and overlapping
claims. A successful fixture run does not verify current production data.

Application rollback retains the additive tables, existing task/history rows,
notification deduplication bindings and AI reservations. Stop incompatible
workers rather than restoring older send behavior. Never drop these tables,
reset the database, erase usage receipts or restore an old snapshot over current
data to roll back application code.
