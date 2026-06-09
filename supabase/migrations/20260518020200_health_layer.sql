do $$
begin
  create type public.health_entry_source as enum (
    'manual',
    'telegram',
    'import',
    'automation'
  );
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  create type public.medication_log_status as enum (
    'planned',
    'taken',
    'skipped'
  );
exception
  when duplicate_object then null;
end;
$$;

create table if not exists public.health_vitals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  measured_at timestamptz not null default now(),
  metric text not null,
  value numeric(12, 4) not null,
  unit text not null,
  source public.health_entry_source not null default 'manual',
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint health_vitals_metric_not_blank check (length(btrim(metric)) > 0),
  constraint health_vitals_unit_not_blank check (length(btrim(unit)) > 0)
);

create table if not exists public.sleep_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sleep_date date not null,
  started_at timestamptz,
  ended_at timestamptz,
  duration_minutes integer,
  quality_score smallint,
  interruptions smallint not null default 0,
  source public.health_entry_source not null default 'manual',
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sleep_entries_user_date_unique unique (user_id, sleep_date),
  constraint sleep_entries_duration_positive check (duration_minutes is null or duration_minutes > 0),
  constraint sleep_entries_quality_range check (quality_score is null or quality_score between 1 and 10),
  constraint sleep_entries_interruptions_nonnegative check (interruptions >= 0),
  constraint sleep_entries_ended_after_started check (
    started_at is null
    or ended_at is null
    or ended_at > started_at
  )
);

create table if not exists public.mood_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  recorded_at timestamptz not null default now(),
  mood_score smallint not null,
  stress_score smallint,
  anxiety_score smallint,
  energy_score smallint,
  tags text[] not null default '{}'::text[],
  source public.health_entry_source not null default 'manual',
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mood_entries_mood_range check (mood_score between 1 and 10),
  constraint mood_entries_stress_range check (stress_score is null or stress_score between 1 and 10),
  constraint mood_entries_anxiety_range check (anxiety_score is null or anxiety_score between 1 and 10),
  constraint mood_entries_energy_range check (energy_score is null or energy_score between 1 and 10)
);

create table if not exists public.symptom_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  recorded_at timestamptz not null default now(),
  symptom text not null,
  severity smallint,
  body_area text,
  source public.health_entry_source not null default 'manual',
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint symptom_entries_symptom_not_blank check (length(btrim(symptom)) > 0),
  constraint symptom_entries_severity_range check (severity is null or severity between 1 and 10)
);

create table if not exists public.medications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  dosage text,
  schedule_text text,
  active boolean not null default true,
  started_on date,
  ended_on date,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint medications_name_not_blank check (length(btrim(name)) > 0),
  constraint medications_ended_after_started check (
    started_on is null
    or ended_on is null
    or ended_on >= started_on
  )
);

create table if not exists public.medication_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  medication_id uuid references public.medications(id) on delete set null,
  scheduled_for timestamptz,
  recorded_at timestamptz not null default now(),
  status public.medication_log_status not null default 'taken',
  dose_taken text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists health_vitals_user_id_measured_at_idx
  on public.health_vitals (user_id, measured_at desc);

create index if not exists health_vitals_user_id_metric_measured_at_idx
  on public.health_vitals (user_id, metric, measured_at desc);

create index if not exists sleep_entries_user_id_sleep_date_idx
  on public.sleep_entries (user_id, sleep_date desc);

create index if not exists mood_entries_user_id_recorded_at_idx
  on public.mood_entries (user_id, recorded_at desc);

create index if not exists mood_entries_tags_idx
  on public.mood_entries using gin (tags);

create index if not exists symptom_entries_user_id_recorded_at_idx
  on public.symptom_entries (user_id, recorded_at desc);

create index if not exists symptom_entries_user_id_symptom_idx
  on public.symptom_entries (user_id, symptom);

create index if not exists medications_user_id_active_idx
  on public.medications (user_id, active);

create index if not exists medication_logs_user_id_recorded_at_idx
  on public.medication_logs (user_id, recorded_at desc);

create index if not exists medication_logs_user_id_medication_id_idx
  on public.medication_logs (user_id, medication_id);

alter table public.health_vitals enable row level security;
alter table public.health_vitals force row level security;
alter table public.sleep_entries enable row level security;
alter table public.sleep_entries force row level security;
alter table public.mood_entries enable row level security;
alter table public.mood_entries force row level security;
alter table public.symptom_entries enable row level security;
alter table public.symptom_entries force row level security;
alter table public.medications enable row level security;
alter table public.medications force row level security;
alter table public.medication_logs enable row level security;
alter table public.medication_logs force row level security;

drop trigger if exists set_health_vitals_updated_at on public.health_vitals;
create trigger set_health_vitals_updated_at
before update on public.health_vitals
for each row execute function public.set_updated_at();

drop trigger if exists set_sleep_entries_updated_at on public.sleep_entries;
create trigger set_sleep_entries_updated_at
before update on public.sleep_entries
for each row execute function public.set_updated_at();

drop trigger if exists set_mood_entries_updated_at on public.mood_entries;
create trigger set_mood_entries_updated_at
before update on public.mood_entries
for each row execute function public.set_updated_at();

drop trigger if exists set_symptom_entries_updated_at on public.symptom_entries;
create trigger set_symptom_entries_updated_at
before update on public.symptom_entries
for each row execute function public.set_updated_at();

drop trigger if exists set_medications_updated_at on public.medications;
create trigger set_medications_updated_at
before update on public.medications
for each row execute function public.set_updated_at();

drop trigger if exists set_medication_logs_updated_at on public.medication_logs;
create trigger set_medication_logs_updated_at
before update on public.medication_logs
for each row execute function public.set_updated_at();

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'health_vitals'
      and policyname = 'health_vitals_owner_access'
  ) then
    create policy health_vitals_owner_access
      on public.health_vitals
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
      and tablename = 'sleep_entries'
      and policyname = 'sleep_entries_owner_access'
  ) then
    create policy sleep_entries_owner_access
      on public.sleep_entries
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
      and tablename = 'mood_entries'
      and policyname = 'mood_entries_owner_access'
  ) then
    create policy mood_entries_owner_access
      on public.mood_entries
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
      and tablename = 'symptom_entries'
      and policyname = 'symptom_entries_owner_access'
  ) then
    create policy symptom_entries_owner_access
      on public.symptom_entries
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
      and tablename = 'medications'
      and policyname = 'medications_owner_access'
  ) then
    create policy medications_owner_access
      on public.medications
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
      and tablename = 'medication_logs'
      and policyname = 'medication_logs_owner_access'
  ) then
    create policy medication_logs_owner_access
      on public.medication_logs
      for all
      to authenticated
      using (public.lifeos_is_owner(user_id))
      with check (public.lifeos_is_owner(user_id));
  end if;
end;
$$;
