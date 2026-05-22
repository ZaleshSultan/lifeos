create table if not exists public.life_modes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null,
  source text not null default 'manual',
  reason text,
  active_from timestamptz not null default now(),
  active_until timestamptz,
  is_active boolean not null default true,
  priority_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint life_modes_mode_allowed check (
    mode in (
      'exam_war',
      'summer',
      'trimester',
      'recovery',
      'project_sprint',
      'maintenance'
    )
  ),
  constraint life_modes_source_allowed check (
    source in ('manual', 'auto', 'health', 'season', 'sprint')
  ),
  constraint life_modes_active_until_after_from check (
    active_until is null or active_until > active_from
  )
);

create table if not exists public.life_seasons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  mode text not null,
  starts_on date not null,
  ends_on date not null,
  priority_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint life_seasons_name_not_blank check (length(btrim(name)) > 0),
  constraint life_seasons_mode_allowed check (
    mode in (
      'exam_war',
      'summer',
      'trimester',
      'recovery',
      'project_sprint',
      'maintenance'
    )
  ),
  constraint life_seasons_dates_ordered check (ends_on >= starts_on)
);

create index if not exists life_modes_user_id_active_idx
  on public.life_modes (user_id, is_active, active_from desc);

create index if not exists life_modes_user_id_source_active_idx
  on public.life_modes (user_id, source, is_active, active_from desc);

create index if not exists life_modes_user_id_active_until_idx
  on public.life_modes (user_id, active_until)
  where active_until is not null;

create index if not exists life_seasons_user_id_dates_idx
  on public.life_seasons (user_id, starts_on, ends_on);

alter table public.life_modes enable row level security;
alter table public.life_modes force row level security;
alter table public.life_seasons enable row level security;
alter table public.life_seasons force row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'life_modes'
      and policyname = 'life_modes_owner_access'
  ) then
    create policy life_modes_owner_access
      on public.life_modes
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
      and tablename = 'life_seasons'
      and policyname = 'life_seasons_owner_access'
  ) then
    create policy life_seasons_owner_access
      on public.life_seasons
      for all
      to authenticated
      using (public.lifeos_is_owner(user_id))
      with check (public.lifeos_is_owner(user_id));
  end if;
end;
$$;
