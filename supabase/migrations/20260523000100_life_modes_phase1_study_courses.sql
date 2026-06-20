alter table public.life_modes
  drop constraint if exists life_modes_mode_allowed;

alter table public.life_modes
  add constraint life_modes_mode_allowed check (
    mode in (
      'exam_war',
      'practice',
      'recovery_setup',
      'summer_term',
      'summer',
      'trimester',
      'recovery',
      'project_sprint',
      'maintenance'
    )
  );

alter table public.life_seasons
  drop constraint if exists life_seasons_mode_allowed;

alter table public.life_seasons
  add constraint life_seasons_mode_allowed check (
    mode in (
      'exam_war',
      'practice',
      'recovery_setup',
      'summer_term',
      'summer',
      'trimester',
      'recovery',
      'project_sprint',
      'maintenance'
    )
  );

create table if not exists public.study_courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code text not null,
  title text not null,
  term text,
  starts_on date,
  ends_on date,
  status text not null default 'active',
  progress_percent numeric(5, 2) not null default 0,
  completed_units integer not null default 0,
  total_units integer,
  last_studied_on date,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint study_courses_code_not_blank check (length(btrim(code)) > 0),
  constraint study_courses_title_not_blank check (length(btrim(title)) > 0),
  constraint study_courses_status_allowed check (
    status in ('planned', 'active', 'paused', 'completed', 'archived')
  ),
  constraint study_courses_progress_percent_range check (
    progress_percent between 0 and 100
  ),
  constraint study_courses_completed_units_nonnegative check (
    completed_units >= 0
  ),
  constraint study_courses_total_units_nonnegative check (
    total_units is null or total_units >= 0
  ),
  constraint study_courses_units_ordered check (
    total_units is null or completed_units <= total_units
  ),
  constraint study_courses_dates_ordered check (
    starts_on is null
    or ends_on is null
    or ends_on >= starts_on
  ),
  constraint study_courses_user_code_unique unique (user_id, code)
);

create index if not exists study_courses_user_id_status_idx
  on public.study_courses (user_id, status);

create index if not exists study_courses_user_id_dates_idx
  on public.study_courses (user_id, starts_on, ends_on);

alter table public.study_courses enable row level security;
alter table public.study_courses force row level security;

drop trigger if exists set_study_courses_updated_at on public.study_courses;
create trigger set_study_courses_updated_at
before update on public.study_courses
for each row execute function public.set_updated_at();

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'study_courses'
      and policyname = 'study_courses_owner_access'
  ) then
    create policy study_courses_owner_access
      on public.study_courses
      for all
      to authenticated
      using (public.lifeos_is_owner(user_id))
      with check (public.lifeos_is_owner(user_id));
  end if;
end;
$$;
