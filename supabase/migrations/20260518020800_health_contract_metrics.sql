alter table public.health_daily
  add column if not exists deep_sleep_minutes integer,
  add column if not exists rem_sleep_minutes integer,
  add column if not exists awake_minutes integer,
  add column if not exists spo2_avg numeric(5, 2),
  add column if not exists missing_metrics jsonb not null default '{}'::jsonb;

alter table public.health_sync_runs
  add column if not exists missing_metrics jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'health_daily_deep_sleep_minutes_nonnegative'
      and conrelid = 'public.health_daily'::regclass
  ) then
    alter table public.health_daily
      add constraint health_daily_deep_sleep_minutes_nonnegative
      check (deep_sleep_minutes is null or deep_sleep_minutes >= 0) not valid;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'health_daily_rem_sleep_minutes_nonnegative'
      and conrelid = 'public.health_daily'::regclass
  ) then
    alter table public.health_daily
      add constraint health_daily_rem_sleep_minutes_nonnegative
      check (rem_sleep_minutes is null or rem_sleep_minutes >= 0) not valid;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'health_daily_awake_minutes_nonnegative'
      and conrelid = 'public.health_daily'::regclass
  ) then
    alter table public.health_daily
      add constraint health_daily_awake_minutes_nonnegative
      check (awake_minutes is null or awake_minutes >= 0) not valid;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'health_daily_spo2_avg_range'
      and conrelid = 'public.health_daily'::regclass
  ) then
    alter table public.health_daily
      add constraint health_daily_spo2_avg_range
      check (spo2_avg is null or spo2_avg between 0 and 100) not valid;
  end if;
end;
$$;

create index if not exists health_daily_missing_metrics_idx
  on public.health_daily using gin (missing_metrics);
