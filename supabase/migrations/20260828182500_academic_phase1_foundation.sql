-- Academic Engine Phase 1 — Foundation
-- Extends study_courses with academic fields, creates course_schedules
-- and assessment_items tables. All changes are additive and idempotent.

-- ---------------------------------------------------------------------------
-- 1. Extend study_courses with academic fields
-- ---------------------------------------------------------------------------

alter table public.study_courses
  add column if not exists instructor_name text,
  add column if not exists instructor_email text,
  add column if not exists room text,
  add column if not exists external_course_key text;

create index if not exists study_courses_user_id_external_key_idx
  on public.study_courses (user_id, external_course_key)
  where external_course_key is not null;

-- ---------------------------------------------------------------------------
-- 2. course_schedules — recurring weekly meeting pattern
-- ---------------------------------------------------------------------------

create table if not exists public.course_schedules (
  id uuid primary key default gen_random_uuid(),
  study_course_id uuid not null references public.study_courses(id) on delete cascade,
  day_of_week text not null,
  start_time time not null,
  end_time time not null,
  room text,
  session_type text,
  created_at timestamptz not null default now(),
  constraint course_schedules_day_of_week_allowed check (
    day_of_week in (
      'monday', 'tuesday', 'wednesday', 'thursday',
      'friday', 'saturday', 'sunday'
    )
  ),
  constraint course_schedules_time_ordered check (end_time > start_time)
);

create index if not exists course_schedules_study_course_id_idx
  on public.course_schedules (study_course_id);

alter table public.course_schedules enable row level security;
alter table public.course_schedules force row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'course_schedules'
      and policyname = 'course_schedules_owner_access'
  ) then
    create policy course_schedules_owner_access
      on public.course_schedules
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

-- ---------------------------------------------------------------------------
-- 3. assessment_items — definition + actual grade + deadline, combined
-- ---------------------------------------------------------------------------

create table if not exists public.assessment_items (
  id uuid primary key default gen_random_uuid(),
  study_course_id uuid not null references public.study_courses(id) on delete cascade,
  title text not null,
  assessment_type text,
  weight_percent numeric(5, 2),
  max_score numeric,
  actual_score numeric,
  due_at timestamptz,
  due_source text,
  syllabus_due_at timestamptz,
  status text not null default 'pending',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assessment_items_title_not_blank check (length(btrim(title)) > 0),
  constraint assessment_items_weight_percent_range check (
    weight_percent is null or (weight_percent >= 0 and weight_percent <= 100)
  ),
  constraint assessment_items_status_allowed check (
    status in ('pending', 'submitted', 'graded', 'missed')
  )
);

create index if not exists assessment_items_study_course_id_idx
  on public.assessment_items (study_course_id);

alter table public.assessment_items enable row level security;
alter table public.assessment_items force row level security;

drop trigger if exists set_assessment_items_updated_at on public.assessment_items;
create trigger set_assessment_items_updated_at
before update on public.assessment_items
for each row execute function public.set_updated_at();

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'assessment_items'
      and policyname = 'assessment_items_owner_access'
  ) then
    create policy assessment_items_owner_access
      on public.assessment_items
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
