alter table public.source_events
  add column if not exists provider text,
  add column if not exists external_updated_at timestamptz,
  add column if not exists source_url text,
  add column if not exists reminder_policy_key text,
  add column if not exists checksum text,
  add column if not exists last_synced_at timestamptz;

update public.source_events
set provider = source_key
where provider is null;

create index if not exists source_events_user_provider_external_idx
  on public.source_events (user_id, provider, external_id)
  where external_id is not null;

create index if not exists source_events_user_last_synced_idx
  on public.source_events (user_id, last_synced_at desc);

alter table public.reminders
  add column if not exists dedup_key text,
  add column if not exists reminder_policy_key text,
  add column if not exists claimed_at timestamptz;

create unique index if not exists reminders_user_dedup_key_unique
  on public.reminders (user_id, dedup_key)
  where dedup_key is not null;

create index if not exists reminders_processing_claimed_idx
  on public.reminders (claimed_at)
  where status = 'processing';

alter table public.reminders
  drop constraint if exists reminders_status_allowed;

alter table public.reminders
  add constraint reminders_status_allowed check (
    status in ('pending', 'processing', 'sent', 'cancelled', 'failed')
  );

