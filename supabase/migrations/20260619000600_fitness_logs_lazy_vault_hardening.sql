-- ============================================================================
-- LifeOS hardening: fitness_logs SSOT + Obsidian timezone
-- ============================================================================

create table if not exists public.fitness_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workout_id uuid references public.workouts(id) on delete set null,
  life_entity_id uuid references public.life_entities(id) on delete set null,
  exercise_id uuid references public.fitness_exercises(id) on delete set null,
  exercise_name text not null,
  logged_at timestamptz not null default now(),
  weight_kg numeric(8, 2),
  sets integer not null default 1,
  reps integer,
  volume_kg numeric(12, 2) generated always as (
    case
      when weight_kg is null or reps is null then null
      else weight_kg * sets * reps
    end
  ) stored,
  source text not null default 'telegram',
  source_command text,
  source_telegram_chat_id bigint,
  source_telegram_message_id bigint,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fitness_logs_exercise_name_not_blank check (length(btrim(exercise_name)) > 0),
  constraint fitness_logs_sets_positive check (sets > 0),
  constraint fitness_logs_reps_nonnegative check (reps is null or reps >= 0),
  constraint fitness_logs_weight_nonnegative check (weight_kg is null or weight_kg >= 0)
);

create index if not exists fitness_logs_user_id_logged_at_idx
  on public.fitness_logs (user_id, logged_at desc);

create index if not exists fitness_logs_user_id_exercise_logged_at_idx
  on public.fitness_logs (user_id, lower(exercise_name), logged_at desc);

create unique index if not exists fitness_logs_telegram_message_exercise_key
  on public.fitness_logs (
    user_id,
    source_telegram_chat_id,
    source_telegram_message_id,
    exercise_name
  );

alter table public.fitness_logs enable row level security;
alter table public.fitness_logs force row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'fitness_logs'
      and policyname = 'fitness_logs_owner_access'
  ) then
    create policy fitness_logs_owner_access
      on public.fitness_logs
      for all
      to authenticated
      using (public.lifeos_is_owner(user_id))
      with check (public.lifeos_is_owner(user_id));
  end if;
end;
$$;

drop trigger if exists set_fitness_logs_updated_at on public.fitness_logs;
create trigger set_fitness_logs_updated_at
before update on public.fitness_logs
for each row execute function public.set_updated_at();

-- Store the user's Obsidian-local timezone next to their vault settings so the
-- mirror worker can render date-sensitive notes without falling back to server UTC.
alter table if exists public.user_obsidian_settings
  add column if not exists timezone text not null default 'UTC';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'user_obsidian_settings_timezone_not_blank_check'
  ) then
    alter table public.user_obsidian_settings
      add constraint user_obsidian_settings_timezone_not_blank_check
      check (length(btrim(timezone)) > 0 and position('/' in timezone) > 0 or timezone = 'UTC');
  end if;
end;
$$;

update public.user_obsidian_settings uos
set timezone = coalesce(nullif(p.timezone, ''), 'UTC')
from public.profiles p
where p.user_id = uos.user_id
  and (uos.timezone is null or uos.timezone = 'UTC');
