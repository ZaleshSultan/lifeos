-- ============================================================================
-- LifeOS Academic Engine: seed real Trimester 1 (2026-2027) schedule
--
-- BEFORE RUNNING: replace every 7fc34946-a7ff-4316-8c4e-cfb532ff3b5f below with your real LifeOS
-- user id (the same uuid as LIFEOS_DEFAULT_USER_ID in apps/bot/.env).
-- Find it fast, then do the replacement in one shot:
--   grep LIFEOS_DEFAULT_USER_ID ~/lifeos/apps/bot/.env
--   sed -i "s/7fc34946-a7ff-4316-8c4e-cfb532ff3b5f/paste-your-real-uuid-here/g" seed_schedule.sql
--
-- Run with your installed Supabase CLI (2.79.0+) via:
--   supabase db query --file seed_schedule.sql --linked
-- First check the exact flag name for your version:
--   supabase db query --help
-- If that subcommand doesn't take a --file flag in your version, pipe it
-- via stdin instead:
--   supabase db query --linked < seed_schedule.sql
-- Or simplest and always works: paste the whole file into the Supabase
-- dashboard's SQL Editor and run it there.
-- ============================================================================

-- 1. Study courses ----------------------------------------------------------

insert into public.study_courses (id, user_id, code, title, term, status)
values
  ('a1111111-1111-4111-8111-111111111111', '7fc34946-a7ff-4316-8c4e-cfb532ff3b5f', 'CNC53-EN', 'Компьютерные сети', '2026-2027, 1 период', 'active'),
  ('a2222222-2222-4222-8222-222222222222', '7fc34946-a7ff-4316-8c4e-cfb532ff3b5f', 'DLD52-EN', 'Цифровой логический дизайн', '2026-2027, 1 период', 'active'),
  ('a3333333-3333-4333-8333-333333333333', '7fc34946-a7ff-4316-8c4e-cfb532ff3b5f', 'DMS52-EN', 'Системы управления базами данных', '2026-2027, 1 период', 'active'),
  ('a4444444-4444-4444-8444-444444444444', '7fc34946-a7ff-4316-8c4e-cfb532ff3b5f', 'OS52-EN', 'Операционные системы', '2026-2027, 1 период', 'active'),
  ('a5555555-5555-4555-8555-555555555555', '7fc34946-a7ff-4316-8c4e-cfb532ff3b5f', 'K(RUSSIAN)L51-RU', 'Казахский (русский) язык 1 (С1)', '2026-2027, 1 период', 'active')
on conflict (id) do nothing;

-- 2. Course schedules --------------------------------------------------------

insert into public.course_schedules
  (study_course_id, day_of_week, start_time, end_time, room, session_type, instructor_name)
values
  -- CNC53-EN — Компьютерные сети
  ('a1111111-1111-4111-8111-111111111111', 'tuesday',  '08:00', '08:50', '101L (Корпус Коркем)',       'lecture',   'Досумбеков'),
  ('a1111111-1111-4111-8111-111111111111', 'tuesday',  '09:00', '09:50', '101L (Корпус Коркем)',       'lecture',   'Досумбеков'),
  ('a1111111-1111-4111-8111-111111111111', 'friday',   '15:00', '15:50', 'C1.2.243K (Главный корпус)', 'practical', 'Досумбеков'),
  ('a1111111-1111-4111-8111-111111111111', 'friday',   '16:00', '16:50', 'C1.2.243K (Главный корпус)', 'practical', 'Досумбеков'),
  ('a1111111-1111-4111-8111-111111111111', 'saturday', '18:00', '18:50', 'C1.2.243K (Главный корпус)', 'practical', 'Досумбеков'),

  -- DLD52-EN — Цифровой логический дизайн
  ('a2222222-2222-4222-8222-222222222222', 'tuesday',   '10:00', '10:50', '301L (Корпус Коркем)',       'lecture', 'Амиров А.Х.'),
  ('a2222222-2222-4222-8222-222222222222', 'tuesday',   '11:00', '11:50', '301L (Корпус Коркем)',       'lecture', 'Амиров А.Х.'),
  ('a2222222-2222-4222-8222-222222222222', 'wednesday', '10:00', '10:50', '301L (Корпус Коркем)',       'lecture', 'Амиров А.Х.'),
  ('a2222222-2222-4222-8222-222222222222', 'wednesday', '14:00', '14:50', 'C1.2.252K (Главный корпус)', 'lab',     'Ярулин Д.С.'),
  ('a2222222-2222-4222-8222-222222222222', 'wednesday', '15:00', '15:50', 'C1.2.252K (Главный корпус)', 'lab',     'Ярулин Д.С.'),

  -- DMS52-EN — Системы управления базами данных
  ('a3333333-3333-4333-8333-333333333333', 'tuesday',  '12:00', '12:50', '204P (Корпус Коркем)',       'practical', 'Танкеев С.И.'),
  ('a3333333-3333-4333-8333-333333333333', 'tuesday',  '13:05', '13:55', '204P (Корпус Коркем)',       'practical', 'Танкеев С.И.'),
  ('a3333333-3333-4333-8333-333333333333', 'thursday', '08:00', '08:50', 'Online',                     'lecture',   'Нургалиева С.А.'),
  ('a3333333-3333-4333-8333-333333333333', 'thursday', '09:00', '09:50', 'Online',                     'lecture',   'Нургалиева С.А.'),
  ('a3333333-3333-4333-8333-333333333333', 'thursday', '16:00', '16:50', 'C1.1.238K (Главный корпус)', 'practical', 'Танкеев С.И.'),

  -- OS52-EN — Операционные системы
  ('a4444444-4444-4444-8444-444444444444', 'wednesday', '16:00', '16:50', 'C1.2.123 lab ШПИ (Huawei) (Главный корпус)', 'practical', 'Сейлханова К.Ж.'),
  ('a4444444-4444-4444-8444-444444444444', 'wednesday', '17:00', '17:50', 'C1.2.123 lab ШПИ (Huawei) (Главный корпус)', 'practical', 'Сейлханова К.Ж.'),
  ('a4444444-4444-4444-8444-444444444444', 'saturday',  '09:00', '09:50', 'Online',                     'lecture',   'learn.astanait.edu.kz'),
  ('a4444444-4444-4444-8444-444444444444', 'saturday',  '10:00', '10:50', 'Online',                     'lecture',   'learn.astanait.edu.kz'),
  ('a4444444-4444-4444-8444-444444444444', 'saturday',  '17:00', '17:50', 'C1.1.244K (Главный корпус)', 'practical', 'Сейлханова К.Ж.'),

  -- K(RUSSIAN)L51-RU — Казахский (русский) язык 1 (С1)
  ('a5555555-5555-4555-8555-555555555555', 'monday',   '16:00', '16:50', 'C1.2.225P (Главный корпус)', 'practical', 'Молдахметова З.Н.'),
  ('a5555555-5555-4555-8555-555555555555', 'monday',   '17:00', '17:50', 'C1.2.225P (Главный корпус)', 'practical', 'Молдахметова З.Н.'),
  ('a5555555-5555-4555-8555-555555555555', 'saturday', '11:00', '11:50', 'Online',                     'practical', 'Молдахметова З.Н.'),
  ('a5555555-5555-4555-8555-555555555555', 'saturday', '12:00', '12:50', 'Online',                     'practical', 'Молдахметова З.Н.'),
  ('a5555555-5555-4555-8555-555555555555', 'saturday', '13:05', '13:55', 'Online',                     'practical', 'Молдахметова З.Н.');

-- 3. Sanity check ------------------------------------------------------------
select sc.code, sc.title, cs.day_of_week, cs.start_time, cs.end_time,
       cs.session_type, cs.instructor_name, cs.room
from public.course_schedules cs
join public.study_courses sc on sc.id = cs.study_course_id
where sc.user_id = '7fc34946-a7ff-4316-8c4e-cfb532ff3b5f'
order by
  array_position(array['monday','tuesday','wednesday','thursday','friday','saturday','sunday'], cs.day_of_week),
  cs.start_time;
