alter type public.life_entity_type add value if not exists 'health_daily';

do $$
begin
  create type public.health_sync_reason as enum (
    'nightly_00_01',
    'retry_00_15',
    'morning_reconcile_06_00',
    'manual',
    'backfill'
  );
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  create type public.health_recovery_mode as enum (
    'recovery',
    'maintenance',
    'baseline',
    'growth'
  );
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  create type public.health_sync_run_status as enum (
    'success',
    'failed'
  );
exception
  when duplicate_object then null;
end;
$$;

create table if not exists public.health_daily (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  log_date date not null,
  sync_reason public.health_sync_reason not null,
  recovery_mode public.health_recovery_mode not null,
  data_completeness_score numeric(5, 2) not null,
  sleep_minutes integer,
  sleep_score numeric(5, 2),
  resting_heart_rate numeric(6, 2),
  hrv_ms numeric(8, 2),
  steps integer,
  calories_burned numeric(10, 2),
  active_energy_kcal numeric(10, 2),
  workout_minutes integer,
  weight_kg numeric(6, 2),
  mood_score smallint,
  energy_score smallint,
  stress_score smallint,
  source text,
  timezone text,
  metadata jsonb not null default '{}'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint health_daily_user_date_unique unique (user_id, log_date),
  constraint health_daily_completeness_range check (
    data_completeness_score >= 0
    and data_completeness_score <= 100
  ),
  constraint health_daily_sleep_minutes_nonnegative check (
    sleep_minutes is null
    or sleep_minutes >= 0
  ),
  constraint health_daily_steps_nonnegative check (
    steps is null
    or steps >= 0
  ),
  constraint health_daily_mood_score_range check (
    mood_score is null
    or mood_score between 1 and 10
  ),
  constraint health_daily_energy_score_range check (
    energy_score is null
    or energy_score between 1 and 10
  ),
  constraint health_daily_stress_score_range check (
    stress_score is null
    or stress_score between 1 and 10
  )
);

create table if not exists public.health_sync_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  health_daily_id uuid references public.health_daily(id) on delete set null,
  life_entity_id uuid references public.life_entities(id) on delete set null,
  sync_date date not null,
  sync_reason public.health_sync_reason not null,
  status public.health_sync_run_status not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  workouts_upserted integer not null default 0,
  samples_inserted integer not null default 0,
  data_completeness_score numeric(5, 2),
  recovery_mode public.health_recovery_mode,
  source text,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint health_sync_runs_workouts_nonnegative check (workouts_upserted >= 0),
  constraint health_sync_runs_samples_nonnegative check (samples_inserted >= 0)
);

create table if not exists public.health_workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  health_daily_id uuid references public.health_daily(id) on delete cascade,
  external_id text,
  workout_date date not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  workout_type text,
  title text,
  duration_minutes integer,
  calories_kcal numeric(10, 2),
  distance_meters numeric(10, 2),
  source text not null default 'health_ingest',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint health_workouts_user_source_external_unique unique (
    user_id,
    source,
    external_id
  ),
  constraint health_workouts_ended_after_started check (
    ended_at is null
    or ended_at > started_at
  ),
  constraint health_workouts_duration_nonnegative check (
    duration_minutes is null
    or duration_minutes >= 0
  )
);

create table if not exists public.health_samples (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  health_daily_id uuid references public.health_daily(id) on delete cascade,
  sample_type text not null,
  sampled_at timestamptz not null,
  value numeric(14, 4) not null,
  unit text not null,
  source text not null default 'health_ingest',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint health_samples_sample_type_not_blank check (length(btrim(sample_type)) > 0),
  constraint health_samples_unit_not_blank check (length(btrim(unit)) > 0)
);

create index if not exists health_daily_user_id_log_date_idx
  on public.health_daily (user_id, log_date desc);

create index if not exists health_daily_user_id_recovery_mode_idx
  on public.health_daily (user_id, recovery_mode, log_date desc);

create index if not exists health_sync_runs_user_id_sync_date_idx
  on public.health_sync_runs (user_id, sync_date desc);

create index if not exists health_sync_runs_user_id_status_idx
  on public.health_sync_runs (user_id, status, started_at desc);

create index if not exists health_workouts_user_id_workout_date_idx
  on public.health_workouts (user_id, workout_date desc);

create index if not exists health_workouts_health_daily_id_idx
  on public.health_workouts (health_daily_id);

create index if not exists health_samples_user_id_sampled_at_idx
  on public.health_samples (user_id, sampled_at desc);

create index if not exists health_samples_user_id_sample_type_idx
  on public.health_samples (user_id, sample_type, sampled_at desc);

create index if not exists health_samples_health_daily_id_idx
  on public.health_samples (health_daily_id);

alter table public.health_daily enable row level security;
alter table public.health_daily force row level security;
alter table public.health_sync_runs enable row level security;
alter table public.health_sync_runs force row level security;
alter table public.health_workouts enable row level security;
alter table public.health_workouts force row level security;
alter table public.health_samples enable row level security;
alter table public.health_samples force row level security;

drop trigger if exists set_health_daily_updated_at on public.health_daily;
create trigger set_health_daily_updated_at
before update on public.health_daily
for each row execute function public.set_updated_at();

drop trigger if exists set_health_sync_runs_updated_at on public.health_sync_runs;
create trigger set_health_sync_runs_updated_at
before update on public.health_sync_runs
for each row execute function public.set_updated_at();

drop trigger if exists set_health_workouts_updated_at on public.health_workouts;
create trigger set_health_workouts_updated_at
before update on public.health_workouts
for each row execute function public.set_updated_at();

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'health_daily'
      and policyname = 'health_daily_owner_access'
  ) then
    create policy health_daily_owner_access
      on public.health_daily
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
      and tablename = 'health_sync_runs'
      and policyname = 'health_sync_runs_owner_access'
  ) then
    create policy health_sync_runs_owner_access
      on public.health_sync_runs
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
      and tablename = 'health_workouts'
      and policyname = 'health_workouts_owner_access'
  ) then
    create policy health_workouts_owner_access
      on public.health_workouts
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
      and tablename = 'health_samples'
      and policyname = 'health_samples_owner_access'
  ) then
    create policy health_samples_owner_access
      on public.health_samples
      for all
      to authenticated
      using (public.lifeos_is_owner(user_id))
      with check (public.lifeos_is_owner(user_id));
  end if;
end;
$$;
