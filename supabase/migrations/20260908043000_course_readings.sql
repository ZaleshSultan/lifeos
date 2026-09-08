-- Academic Engine — Course Readings
-- Introduces course_readings: assigned readings mapped to specific class sessions.
-- This is a new table only; no existing tables are modified.

-- ---------------------------------------------------------------------------
-- 1. course_readings table
-- ---------------------------------------------------------------------------

create table if not exists public.course_readings (
  id uuid primary key default gen_random_uuid(),
  study_course_id uuid not null references public.study_courses(id) on delete cascade,
  title text not null,
  author text,
  reference text,
  session_date date,
  estimated_minutes integer,
  pages text,
  required boolean not null default true,
  status text not null default 'pending',
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint course_readings_title_not_blank check (length(btrim(title)) > 0),
  constraint course_readings_estimated_minutes_non_negative check (
    estimated_minutes is null or estimated_minutes >= 0
  ),
  constraint course_readings_status_allowed check (
    status in ('pending', 'completed', 'skipped')
  )
);

create index if not exists course_readings_study_course_id_session_date_idx
  on public.course_readings (study_course_id, session_date);

alter table public.course_readings enable row level security;
alter table public.course_readings force row level security;

drop trigger if exists set_course_readings_updated_at on public.course_readings;
create trigger set_course_readings_updated_at
before update on public.course_readings
for each row execute function public.set_updated_at();

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'course_readings'
      and policyname = 'course_readings_owner_access'
  ) then
    create policy course_readings_owner_access
      on public.course_readings
      for all
      to authenticated
      using (
        exists (
          select 1 from public.study_courses sc
          where sc.id = study_course_id
            and public.lifeos_is_owner(sc.user_id)
        )
      )
      with check (
        exists (
          select 1 from public.study_courses sc
          where sc.id = study_course_id
            and public.lifeos_is_owner(sc.user_id)
        )
      );
  end if;
end;
$$;
