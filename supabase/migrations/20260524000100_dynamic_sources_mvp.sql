alter type public.life_entity_type add value if not exists 'external_event';
alter type public.life_entity_type add value if not exists 'reminder';

create table if not exists public.external_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_key text not null,
  source_type text not null,
  display_name text not null,
  status text not null default 'disabled',
  config_json jsonb not null default '{}'::jsonb,
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint external_sources_user_key_unique unique (user_id, source_key),
  constraint external_sources_source_key_not_blank check (
    length(btrim(source_key)) > 0
  ),
  constraint external_sources_source_type_not_blank check (
    length(btrim(source_type)) > 0
  ),
  constraint external_sources_display_name_not_blank check (
    length(btrim(display_name)) > 0
  ),
  constraint external_sources_status_allowed check (
    status in ('disabled', 'connected', 'error')
  )
);

create table if not exists public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_id uuid references public.external_sources(id) on delete set null,
  source_key text not null,
  status text not null default 'running',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  records_seen int not null default 0,
  records_created int not null default 0,
  records_updated int not null default 0,
  error_message text,
  metadata_json jsonb not null default '{}'::jsonb,
  constraint sync_runs_source_key_not_blank check (
    length(btrim(source_key)) > 0
  ),
  constraint sync_runs_status_allowed check (
    status in ('running', 'success', 'partial', 'failed')
  ),
  constraint sync_runs_finished_after_started check (
    finished_at is null or finished_at >= started_at
  ),
  constraint sync_runs_records_seen_nonnegative check (records_seen >= 0),
  constraint sync_runs_records_created_nonnegative check (records_created >= 0),
  constraint sync_runs_records_updated_nonnegative check (records_updated >= 0)
);

create table if not exists public.source_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_key text not null,
  external_id text,
  event_type text not null,
  title text,
  description text,
  location text,
  starts_at timestamptz,
  ends_at timestamptz,
  due_at timestamptz,
  status text not null default 'active',
  raw_json jsonb not null default '{}'::jsonb,
  normalized_entity_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint source_events_user_source_external_unique unique (
    user_id,
    source_key,
    external_id
  ),
  constraint source_events_source_key_not_blank check (
    length(btrim(source_key)) > 0
  ),
  constraint source_events_event_type_not_blank check (
    length(btrim(event_type)) > 0
  ),
  constraint source_events_ends_after_starts check (
    starts_at is null
    or ends_at is null
    or ends_at >= starts_at
  )
);

create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  life_entity_id uuid references public.life_entities(id) on delete set null,
  source_event_id uuid references public.source_events(id) on delete set null,
  channel text not null default 'telegram',
  remind_at timestamptz not null,
  status text not null default 'pending',
  message text not null,
  metadata_json jsonb not null default '{}'::jsonb,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reminders_channel_not_blank check (length(btrim(channel)) > 0),
  constraint reminders_message_not_blank check (length(btrim(message)) > 0),
  constraint reminders_status_allowed check (
    status in ('pending', 'sent', 'cancelled', 'failed')
  )
);

create table if not exists public.academic_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_event_id uuid references public.source_events(id) on delete set null,
  course_title text not null,
  record_type text not null,
  title text not null,
  value_text text,
  score numeric,
  max_score numeric,
  percentage numeric,
  occurs_at timestamptz,
  due_at timestamptz,
  raw_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint academic_records_course_title_not_blank check (
    length(btrim(course_title)) > 0
  ),
  constraint academic_records_record_type_not_blank check (
    length(btrim(record_type)) > 0
  ),
  constraint academic_records_title_not_blank check (length(btrim(title)) > 0)
);

create index if not exists external_sources_user_id_idx
  on public.external_sources (user_id);

create index if not exists external_sources_source_key_idx
  on public.external_sources (source_key);

create index if not exists external_sources_status_idx
  on public.external_sources (status);

create index if not exists external_sources_user_status_idx
  on public.external_sources (user_id, status, display_name);

create index if not exists sync_runs_user_id_idx
  on public.sync_runs (user_id);

create index if not exists sync_runs_source_key_idx
  on public.sync_runs (source_key);

create index if not exists sync_runs_status_idx
  on public.sync_runs (status);

create index if not exists sync_runs_created_idx
  on public.sync_runs (started_at desc);

create index if not exists sync_runs_user_source_started_idx
  on public.sync_runs (user_id, source_key, started_at desc);

create index if not exists source_events_user_id_idx
  on public.source_events (user_id);

create index if not exists source_events_source_key_idx
  on public.source_events (source_key);

create index if not exists source_events_external_id_idx
  on public.source_events (external_id)
  where external_id is not null;

create index if not exists source_events_status_idx
  on public.source_events (status);

create index if not exists source_events_due_at_idx
  on public.source_events (due_at)
  where due_at is not null;

create index if not exists source_events_starts_at_idx
  on public.source_events (starts_at)
  where starts_at is not null;

create index if not exists source_events_created_at_idx
  on public.source_events (created_at desc);

create index if not exists source_events_user_timeline_idx
  on public.source_events (user_id, starts_at, due_at);

create index if not exists reminders_user_id_idx
  on public.reminders (user_id);

create index if not exists reminders_status_idx
  on public.reminders (status);

create index if not exists reminders_remind_at_idx
  on public.reminders (remind_at);

create index if not exists reminders_user_status_remind_idx
  on public.reminders (user_id, status, remind_at);

create index if not exists reminders_source_event_id_idx
  on public.reminders (source_event_id)
  where source_event_id is not null;

create index if not exists reminders_created_at_idx
  on public.reminders (created_at desc);

create index if not exists academic_records_user_id_idx
  on public.academic_records (user_id);

create index if not exists academic_records_status_due_idx
  on public.academic_records (record_type, due_at)
  where due_at is not null;

create index if not exists academic_records_due_at_idx
  on public.academic_records (due_at)
  where due_at is not null;

create index if not exists academic_records_occurs_at_idx
  on public.academic_records (occurs_at)
  where occurs_at is not null;

create index if not exists academic_records_created_at_idx
  on public.academic_records (created_at desc);

create index if not exists academic_records_source_event_id_idx
  on public.academic_records (source_event_id)
  where source_event_id is not null;

alter table public.external_sources enable row level security;
alter table public.external_sources force row level security;
alter table public.sync_runs enable row level security;
alter table public.sync_runs force row level security;
alter table public.source_events enable row level security;
alter table public.source_events force row level security;
alter table public.reminders enable row level security;
alter table public.reminders force row level security;
alter table public.academic_records enable row level security;
alter table public.academic_records force row level security;

drop trigger if exists set_external_sources_updated_at on public.external_sources;
create trigger set_external_sources_updated_at
before update on public.external_sources
for each row execute function public.set_updated_at();

drop trigger if exists set_source_events_updated_at on public.source_events;
create trigger set_source_events_updated_at
before update on public.source_events
for each row execute function public.set_updated_at();

drop trigger if exists set_reminders_updated_at on public.reminders;
create trigger set_reminders_updated_at
before update on public.reminders
for each row execute function public.set_updated_at();

drop trigger if exists set_academic_records_updated_at on public.academic_records;
create trigger set_academic_records_updated_at
before update on public.academic_records
for each row execute function public.set_updated_at();

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'external_sources'
      and policyname = 'external_sources_owner_access'
  ) then
    create policy external_sources_owner_access
      on public.external_sources
      for all
      to authenticated
      using (public.lifeos_is_owner(user_id))
      with check (public.lifeos_is_owner(user_id));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'sync_runs'
      and policyname = 'sync_runs_owner_access'
  ) then
    create policy sync_runs_owner_access
      on public.sync_runs
      for all
      to authenticated
      using (public.lifeos_is_owner(user_id))
      with check (public.lifeos_is_owner(user_id));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'source_events'
      and policyname = 'source_events_owner_access'
  ) then
    create policy source_events_owner_access
      on public.source_events
      for all
      to authenticated
      using (public.lifeos_is_owner(user_id))
      with check (public.lifeos_is_owner(user_id));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'reminders'
      and policyname = 'reminders_owner_access'
  ) then
    create policy reminders_owner_access
      on public.reminders
      for all
      to authenticated
      using (public.lifeos_is_owner(user_id))
      with check (public.lifeos_is_owner(user_id));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'academic_records'
      and policyname = 'academic_records_owner_access'
  ) then
    create policy academic_records_owner_access
      on public.academic_records
      for all
      to authenticated
      using (public.lifeos_is_owner(user_id))
      with check (public.lifeos_is_owner(user_id));
  end if;
end;
$$;
