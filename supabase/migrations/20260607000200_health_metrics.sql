create table if not exists public.health_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  metric_date date not null,
  metric_type text not null,
  value numeric not null,
  unit text,
  source text not null default 'manual',
  confidence numeric,
  raw_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint health_metrics_type_allowed check (
    metric_type in (
      'steps',
      'sleep_minutes',
      'sleep_score',
      'resting_heart_rate',
      'average_heart_rate',
      'active_energy_kcal',
      'total_energy_kcal',
      'workout_minutes',
      'distance_m',
      'weight_kg',
      'spo2_percent',
      'stress_score',
      'mood_score',
      'energy_score'
    )
  ),
  constraint health_metrics_confidence_range check (
    confidence is null or (confidence >= 0 and confidence <= 1)
  ),
  constraint health_metrics_user_date_type_source_unique unique (
    user_id,
    metric_date,
    metric_type,
    source
  )
);

create index if not exists health_metrics_user_date_idx
  on public.health_metrics (user_id, metric_date desc);

create index if not exists health_metrics_user_type_date_idx
  on public.health_metrics (user_id, metric_type, metric_date desc);

drop trigger if exists set_health_metrics_updated_at on public.health_metrics;
create trigger set_health_metrics_updated_at
before update on public.health_metrics
for each row execute function public.set_updated_at();

alter table public.health_metrics enable row level security;
alter table public.health_metrics force row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'health_metrics'
      and policyname = 'health_metrics_owner_access'
  ) then
    create policy health_metrics_owner_access
      on public.health_metrics
      for all
      to authenticated
      using (public.lifeos_is_owner(user_id))
      with check (public.lifeos_is_owner(user_id));
  end if;
end $$;
