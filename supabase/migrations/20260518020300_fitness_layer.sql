do $$
begin
  create type public.workout_intensity as enum (
    'easy',
    'moderate',
    'hard',
    'max'
  );
exception
  when duplicate_object then null;
end;
$$;

create table if not exists public.fitness_exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  category text,
  primary_muscles text[] not null default '{}'::text[],
  equipment text,
  archived_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fitness_exercises_name_not_blank check (length(btrim(name)) > 0)
);

create table if not exists public.workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  workout_type text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_minutes integer,
  intensity public.workout_intensity,
  perceived_effort smallint,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workouts_ended_after_started check (ended_at is null or ended_at > started_at),
  constraint workouts_duration_positive check (duration_minutes is null or duration_minutes > 0),
  constraint workouts_perceived_effort_range check (
    perceived_effort is null
    or perceived_effort between 1 and 10
  )
);

create table if not exists public.workout_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workout_id uuid not null references public.workouts(id) on delete cascade,
  exercise_id uuid references public.fitness_exercises(id) on delete set null,
  set_index integer not null default 1,
  reps integer,
  weight_kg numeric(8, 2),
  distance_meters numeric(10, 2),
  duration_seconds integer,
  rest_seconds integer,
  completed boolean not null default true,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workout_sets_set_index_positive check (set_index > 0),
  constraint workout_sets_reps_nonnegative check (reps is null or reps >= 0),
  constraint workout_sets_weight_nonnegative check (weight_kg is null or weight_kg >= 0),
  constraint workout_sets_distance_nonnegative check (distance_meters is null or distance_meters >= 0),
  constraint workout_sets_duration_nonnegative check (duration_seconds is null or duration_seconds >= 0),
  constraint workout_sets_rest_nonnegative check (rest_seconds is null or rest_seconds >= 0)
);

create table if not exists public.body_measurements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  measured_at timestamptz not null default now(),
  weight_kg numeric(6, 2),
  body_fat_percent numeric(5, 2),
  waist_cm numeric(6, 2),
  chest_cm numeric(6, 2),
  hip_cm numeric(6, 2),
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint body_measurements_weight_positive check (weight_kg is null or weight_kg > 0),
  constraint body_measurements_body_fat_range check (
    body_fat_percent is null
    or body_fat_percent between 0 and 100
  ),
  constraint body_measurements_waist_positive check (waist_cm is null or waist_cm > 0),
  constraint body_measurements_chest_positive check (chest_cm is null or chest_cm > 0),
  constraint body_measurements_hip_positive check (hip_cm is null or hip_cm > 0)
);

create table if not exists public.fitness_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  metric text not null,
  target_value numeric(12, 4),
  target_unit text,
  starts_on date,
  target_on date,
  completed_at timestamptz,
  archived_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fitness_goals_title_not_blank check (length(btrim(title)) > 0),
  constraint fitness_goals_metric_not_blank check (length(btrim(metric)) > 0),
  constraint fitness_goals_target_after_start check (
    starts_on is null
    or target_on is null
    or target_on >= starts_on
  )
);

create index if not exists fitness_exercises_user_id_name_idx
  on public.fitness_exercises (user_id, name);

create index if not exists fitness_exercises_primary_muscles_idx
  on public.fitness_exercises using gin (primary_muscles);

create index if not exists workouts_user_id_started_at_idx
  on public.workouts (user_id, started_at desc);

create index if not exists workouts_user_id_type_idx
  on public.workouts (user_id, workout_type);

create index if not exists workout_sets_user_id_workout_id_idx
  on public.workout_sets (user_id, workout_id, set_index);

create index if not exists workout_sets_user_id_exercise_id_idx
  on public.workout_sets (user_id, exercise_id);

create index if not exists body_measurements_user_id_measured_at_idx
  on public.body_measurements (user_id, measured_at desc);

create index if not exists fitness_goals_user_id_archived_at_idx
  on public.fitness_goals (user_id, archived_at);

create index if not exists fitness_goals_user_id_target_on_idx
  on public.fitness_goals (user_id, target_on)
  where target_on is not null;

alter table public.fitness_exercises enable row level security;
alter table public.fitness_exercises force row level security;
alter table public.workouts enable row level security;
alter table public.workouts force row level security;
alter table public.workout_sets enable row level security;
alter table public.workout_sets force row level security;
alter table public.body_measurements enable row level security;
alter table public.body_measurements force row level security;
alter table public.fitness_goals enable row level security;
alter table public.fitness_goals force row level security;

drop trigger if exists set_fitness_exercises_updated_at on public.fitness_exercises;
create trigger set_fitness_exercises_updated_at
before update on public.fitness_exercises
for each row execute function public.set_updated_at();

drop trigger if exists set_workouts_updated_at on public.workouts;
create trigger set_workouts_updated_at
before update on public.workouts
for each row execute function public.set_updated_at();

drop trigger if exists set_workout_sets_updated_at on public.workout_sets;
create trigger set_workout_sets_updated_at
before update on public.workout_sets
for each row execute function public.set_updated_at();

drop trigger if exists set_body_measurements_updated_at on public.body_measurements;
create trigger set_body_measurements_updated_at
before update on public.body_measurements
for each row execute function public.set_updated_at();

drop trigger if exists set_fitness_goals_updated_at on public.fitness_goals;
create trigger set_fitness_goals_updated_at
before update on public.fitness_goals
for each row execute function public.set_updated_at();

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'fitness_exercises'
      and policyname = 'fitness_exercises_owner_access'
  ) then
    create policy fitness_exercises_owner_access
      on public.fitness_exercises
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
      and tablename = 'workouts'
      and policyname = 'workouts_owner_access'
  ) then
    create policy workouts_owner_access
      on public.workouts
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
      and tablename = 'workout_sets'
      and policyname = 'workout_sets_owner_access'
  ) then
    create policy workout_sets_owner_access
      on public.workout_sets
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
      and tablename = 'body_measurements'
      and policyname = 'body_measurements_owner_access'
  ) then
    create policy body_measurements_owner_access
      on public.body_measurements
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
      and tablename = 'fitness_goals'
      and policyname = 'fitness_goals_owner_access'
  ) then
    create policy fitness_goals_owner_access
      on public.fitness_goals
      for all
      to authenticated
      using (public.lifeos_is_owner(user_id))
      with check (public.lifeos_is_owner(user_id));
  end if;
end;
$$;
