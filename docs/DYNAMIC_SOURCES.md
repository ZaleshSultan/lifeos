# Dynamic Sources

Supabase is the source of truth for LifeOS. Obsidian remains a mirror of LifeOS entities and can later become an optional structured config source, but Telegram and TMA never write directly to the vault.

## Data Flow

Connectors write raw or semi-normalized records into `source_events`. The deterministic normalizer in `packages/core` classifies those events and writes durable `life_entities` through backend code. Reminder creation writes `reminders`; a reminder engine can later send pending rows as Telegram notifications.

Core tables:

- `external_sources`: per-user source catalog and connection status.
- `source_events`: events/tasks/health/academic inputs from connectors or manual seed data.
- `sync_runs`: connector run audit trail and error summaries.
- `reminders`: pending/sent/cancelled Telegram reminder rows.
- `academic_records`: grades, exams, deadlines, topics, and course facts.

## Planned Connectors

Google Calendar and Google Tasks are planned, but OAuth is not implemented in this MVP. Health Connect bridge work remains separate. University ICS/platform import is planned; university credentials must stay local or server-side only, never in TMA/Web.

Obsidian config sync is the best next connector because the Arch worker already exists. It can read structured vault config locally and upsert `external_sources`, `source_events`, and `reminders` through backend/server-side credentials.

## Security

Frontend apps must not receive `SUPABASE_SERVICE_ROLE_KEY`. TMA routes authenticate Telegram `initData` and use backend Supabase access. University credentials, Google tokens, and Health Connect secrets must stay outside browser bundles.
