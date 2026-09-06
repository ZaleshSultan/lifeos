-- Academic Engine Phase 1 discovered a real gap once actual AITU schedule
-- data came in: course_schedules had no instructor field at all, but the
-- same course routinely has a different instructor for its lecture vs its
-- practical/lab sessions (e.g. "Системы управления базами данных" —
-- Нургалиева reads the lecture, Танкеев runs the practical). A single
-- study_courses.instructor_name can't represent that correctly.
--
-- Additive-only: nullable column, no backfill needed for existing rows.

alter table public.course_schedules
  add column if not exists instructor_name text;
