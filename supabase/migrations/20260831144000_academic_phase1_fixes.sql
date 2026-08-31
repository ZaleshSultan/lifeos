-- ============================================================================
-- Academic Engine Phase 1 — Foundation Fixes & Idempotency
-- Migration: 20260831144000_academic_phase1_fixes.sql
-- ============================================================================
-- 1. Adds external_id, source, and raw_json to assessment_items for sync lineage.
-- 2. Enforces unique external identity for assessment_items and study_courses.
-- 3. Adds updated_at and unique slot constraint for course_schedules.
-- All changes are additive, idempotent, and backwards-compatible.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Extend assessment_items with external identity & source lineage
-- ---------------------------------------------------------------------------

alter table public.assessment_items
  add column if not exists external_id text,
  add column if not exists source text not null default 'manual',
  add column if not exists raw_json jsonb not null default '{}'::jsonb;

-- Prevent duplicate assessments per course on repeated LMS sync
create unique index if not exists assessment_items_course_external_id_uidx
  on public.assessment_items (study_course_id, external_id)
  where external_id is not null;

-- Non-negative checks for scores if populated
alter table public.assessment_items
  drop constraint if exists assessment_items_max_score_nonnegative;

alter table public.assessment_items
  add constraint assessment_items_max_score_nonnegative check (
    max_score is null or max_score >= 0
  );

alter table public.assessment_items
  drop constraint if exists assessment_items_actual_score_nonnegative;

alter table public.assessment_items
  add constraint assessment_items_actual_score_nonnegative check (
    actual_score is null or actual_score >= 0
  );

-- ---------------------------------------------------------------------------
-- 2. Upgrade study_courses external_course_key index to UNIQUE
-- ---------------------------------------------------------------------------

drop index if exists public.study_courses_user_id_external_key_idx;

create unique index if not exists study_courses_user_id_external_key_uidx
  on public.study_courses (user_id, external_course_key)
  where external_course_key is not null;

-- ---------------------------------------------------------------------------
-- 3. course_schedules — updated_at audit & slot deduplication
-- ---------------------------------------------------------------------------

alter table public.course_schedules
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists set_course_schedules_updated_at on public.course_schedules;
create trigger set_course_schedules_updated_at
before update on public.course_schedules
for each row execute function public.set_updated_at();

-- Prevent duplicate timetable slots for the same course session
create unique index if not exists course_schedules_slot_uidx
  on public.course_schedules (
    study_course_id,
    day_of_week,
    start_time,
    coalesce(session_type, '')
  );

-- Explicitly revoke access for anon role (defense-in-depth)
revoke all on public.course_schedules from anon;
revoke all on public.assessment_items from anon;
