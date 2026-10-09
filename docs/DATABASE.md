# Database

Supabase Postgres is the durable LifeOS store.

## Migration Order

Apply migrations in filename order:

```bash
supabase db push
```

Current migration set:

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

## Fitness And Finance Tables

The fitness and finance migrations establish layer tables and indexes for future structured workflows. Telegram spend capture currently writes finance-flavored `life_entities` and stores parsed amount metadata.

## Dynamic Sources MVP

Dynamic source state is stored in:

- `external_sources`
- `source_events`
- `sync_runs`
- `reminders`
- `academic_records`

These tables prepare integrations without implementing Google OAuth, Google sync, university scraping, or mobile bridge changes. The Phase 1 seed can populate source catalog rows, finals, ExamFX, the Discrete Mathematics summer course, academic records/topics, and starter reminders as Supabase data.

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

## Study workspace and PDF Storage

The repository includes the existing `20261008000100_study_workspace`, `20261008000200_study_syllabus_seeds`, `20261008000300_study_pdf_storage`, and `20261008000400_daily_digest_claims` migrations. Production history was checked read-only on 2026-10-09 and already contains all four; do not replay or repair them.

`syllabus_documents`, `grading_schemes`, `assessment_grade_overrides`, and `assessment_component_mappings` extend the existing courses/assessments without replacing historical data. New PDF bytes live in the private `lifeos-study-syllabi` bucket; legacy Base64 documents remain readable. Metadata is registered only after download length and SHA-256 verification. Daily digest claims use service-only atomic RPCs and retain existing delivery history.

Run `bash scripts/test-study-postgres.sh` to check migrations, A/B/anon RLS, content hydration, version preservation, and concurrent claims in a disposable local database. This command does not use production credentials. See [the deployment runbook](STUDY_REFACTOR_DEPLOY_DEBIAN.md).
