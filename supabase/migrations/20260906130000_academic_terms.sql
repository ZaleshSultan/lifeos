-- Academic Engine Phase 1 — Academic Terms
-- Introduces queryable academic_terms entity and links study_courses via nullable term_id.
-- All changes are additive and idempotent.

-- ---------------------------------------------------------------------------
-- 1. academic_terms table
-- ---------------------------------------------------------------------------

create table if not exists public.academic_terms (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  institution text,
  program text,
  starts_on date,
  ends_on date,
  timezone text,
  status text not null default 'planned',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint academic_terms_name_not_blank check (length(btrim(name)) > 0),
  constraint academic_terms_date_order check (
    starts_on is null or ends_on is null or ends_on >= starts_on
  ),
  constraint academic_terms_status_allowed check (
    status in ('planned', 'active', 'completed', 'archived')
  )
);

create index if not exists academic_terms_user_id_idx
  on public.academic_terms (user_id);

alter table public.academic_terms enable row level security;
alter table public.academic_terms force row level security;

drop trigger if exists set_academic_terms_updated_at on public.academic_terms;
create trigger set_academic_terms_updated_at
before update on public.academic_terms
for each row execute function public.set_updated_at();

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'academic_terms'
      and policyname = 'academic_terms_owner_access'
  ) then
    create policy academic_terms_owner_access
      on public.academic_terms
      for all
      to authenticated
      using (public.lifeos_is_owner(user_id))
      with check (public.lifeos_is_owner(user_id));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Link study_courses to academic_terms
-- ---------------------------------------------------------------------------

alter table public.study_courses
  add column if not exists term_id uuid references public.academic_terms(id) on delete set null;

create index if not exists study_courses_term_id_idx
  on public.study_courses (term_id)
  where term_id is not null;
