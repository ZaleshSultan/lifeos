create schema if not exists extensions;

create extension if not exists pgcrypto with schema extensions;

create or replace function public.lifeos_current_user_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select auth.uid()
$$;

create or replace function public.lifeos_is_owner(row_user_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select auth.uid() is not null and auth.uid() = row_user_id
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  create type public.lifeos_project_status as enum (
    'active',
    'paused',
    'completed',
    'archived'
  );
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  create type public.lifeos_task_status as enum (
    'inbox',
    'next',
    'scheduled',
    'waiting',
    'done',
    'cancelled'
  );
exception
  when duplicate_object then null;
end;
$$;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  timezone text not null default 'UTC',
  locale text not null default 'en',
  telegram_user_id bigint unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.life_areas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  color text,
  sort_order integer not null default 0,
  archived_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint life_areas_name_not_blank check (length(btrim(name)) > 0)
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  area_id uuid references public.life_areas(id) on delete set null,
  name text not null,
  description text,
  status public.lifeos_project_status not null default 'active',
  starts_on date,
  due_on date,
  completed_at timestamptz,
  archived_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_name_not_blank check (length(btrim(name)) > 0),
  constraint projects_due_after_start check (
    starts_on is null
    or due_on is null
    or due_on >= starts_on
  )
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  area_id uuid references public.life_areas(id) on delete set null,
  parent_task_id uuid references public.tasks(id) on delete set null,
  title text not null,
  notes text,
  status public.lifeos_task_status not null default 'inbox',
  priority integer not null default 0,
  due_at timestamptz,
  scheduled_for timestamptz,
  completed_at timestamptz,
  source text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_title_not_blank check (length(btrim(title)) > 0),
  constraint tasks_not_own_parent check (parent_task_id is null or parent_task_id <> id)
);

create table if not exists public.daily_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  log_date date not null,
  mood_score smallint,
  energy_score smallint,
  focus_score smallint,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daily_logs_user_date_unique unique (user_id, log_date),
  constraint daily_logs_mood_score_range check (mood_score is null or mood_score between 1 and 10),
  constraint daily_logs_energy_score_range check (energy_score is null or energy_score between 1 and 10),
  constraint daily_logs_focus_score_range check (focus_score is null or focus_score between 1 and 10)
);

create index if not exists profiles_telegram_user_id_idx
  on public.profiles (telegram_user_id)
  where telegram_user_id is not null;

create index if not exists life_areas_user_id_sort_order_idx
  on public.life_areas (user_id, sort_order, name);

create index if not exists life_areas_user_id_archived_at_idx
  on public.life_areas (user_id, archived_at);

create index if not exists projects_user_id_status_idx
  on public.projects (user_id, status);

create index if not exists projects_user_id_area_id_idx
  on public.projects (user_id, area_id);

create index if not exists projects_user_id_due_on_idx
  on public.projects (user_id, due_on)
  where due_on is not null;

create index if not exists tasks_user_id_status_idx
  on public.tasks (user_id, status);

create index if not exists tasks_user_id_project_id_idx
  on public.tasks (user_id, project_id);

create index if not exists tasks_user_id_area_id_idx
  on public.tasks (user_id, area_id);

create index if not exists tasks_user_id_due_at_idx
  on public.tasks (user_id, due_at)
  where due_at is not null;

create index if not exists tasks_user_id_scheduled_for_idx
  on public.tasks (user_id, scheduled_for)
  where scheduled_for is not null;

create index if not exists daily_logs_user_id_log_date_idx
  on public.daily_logs (user_id, log_date desc);

alter table public.profiles enable row level security;
alter table public.profiles force row level security;
alter table public.user_settings enable row level security;
alter table public.user_settings force row level security;
alter table public.life_areas enable row level security;
alter table public.life_areas force row level security;
alter table public.projects enable row level security;
alter table public.projects force row level security;
alter table public.tasks enable row level security;
alter table public.tasks force row level security;
alter table public.daily_logs enable row level security;
alter table public.daily_logs force row level security;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_user_settings_updated_at on public.user_settings;
create trigger set_user_settings_updated_at
before update on public.user_settings
for each row execute function public.set_updated_at();

drop trigger if exists set_life_areas_updated_at on public.life_areas;
create trigger set_life_areas_updated_at
before update on public.life_areas
for each row execute function public.set_updated_at();

drop trigger if exists set_projects_updated_at on public.projects;
create trigger set_projects_updated_at
before update on public.projects
for each row execute function public.set_updated_at();

drop trigger if exists set_tasks_updated_at on public.tasks;
create trigger set_tasks_updated_at
before update on public.tasks
for each row execute function public.set_updated_at();

drop trigger if exists set_daily_logs_updated_at on public.daily_logs;
create trigger set_daily_logs_updated_at
before update on public.daily_logs
for each row execute function public.set_updated_at();

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'profiles_owner_access'
  ) then
    create policy profiles_owner_access
      on public.profiles
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
      and tablename = 'user_settings'
      and policyname = 'user_settings_owner_access'
  ) then
    create policy user_settings_owner_access
      on public.user_settings
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
      and tablename = 'life_areas'
      and policyname = 'life_areas_owner_access'
  ) then
    create policy life_areas_owner_access
      on public.life_areas
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
      and tablename = 'projects'
      and policyname = 'projects_owner_access'
  ) then
    create policy projects_owner_access
      on public.projects
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
      and tablename = 'tasks'
      and policyname = 'tasks_owner_access'
  ) then
    create policy tasks_owner_access
      on public.tasks
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
      and tablename = 'daily_logs'
      and policyname = 'daily_logs_owner_access'
  ) then
    create policy daily_logs_owner_access
      on public.daily_logs
      for all
      to authenticated
      using (public.lifeos_is_owner(user_id))
      with check (public.lifeos_is_owner(user_id));
  end if;
end;
$$;
