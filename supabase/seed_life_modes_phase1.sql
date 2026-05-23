-- Phase 1 LifeOS Modes seed.
--
-- Replace the placeholder UUID with the existing auth.users.id / profiles.user_id
-- before running.

with seed_user as (
  select '00000000-0000-0000-0000-000000000000'::uuid as user_id
),
phase1_seasons as (
  select *
  from (
    values
      (
        'Exam War Mode',
        'exam_war',
        '2026-05-25',
        '2026-06-06',
        '{"study": 100, "deadline": 100, "practice": 90, "health": 25, "fitness": 10, "projects": -40}'::jsonb
      ),
      (
        'Practice Mode',
        'practice',
        '2026-06-08',
        '2026-06-20',
        '{"practice": 100, "problem_sets": 90, "study": 80, "deadline": 65, "health": 35, "projects": -10}'::jsonb
      ),
      (
        'Recovery / Setup Mode',
        'recovery_setup',
        '2026-06-22',
        '2026-07-05',
        '{"health": 100, "sleep": 100, "setup": 90, "admin": 70, "study": 10, "heavy_fitness": -80}'::jsonb
      ),
      (
        'Summer Term Mode',
        'summer_term',
        '2026-07-06',
        '2026-08-15',
        '{"discrete_math": 100, "coursework": 90, "study": 90, "practice": 70, "health": 50, "projects": 40}'::jsonb
      ),
      (
        'Summer Mode',
        'summer',
        '2026-08-16',
        '2026-08-31',
        '{"projects": 90, "cybersecurity": 80, "health": 75, "fitness": 65, "finance": 50, "study": 20}'::jsonb
      )
  ) as season(name, mode, starts_on, ends_on, priority_json)
)
delete from public.life_seasons
using seed_user, phase1_seasons
where life_seasons.user_id = seed_user.user_id
  and life_seasons.name = phase1_seasons.name
  and life_seasons.starts_on = phase1_seasons.starts_on::date
  and life_seasons.ends_on = phase1_seasons.ends_on::date;

with seed_user as (
  select '00000000-0000-0000-0000-000000000000'::uuid as user_id
)
insert into public.life_seasons (
  user_id,
  name,
  mode,
  starts_on,
  ends_on,
  priority_json
)
select
  seed_user.user_id,
  season.name,
  season.mode,
  season.starts_on::date,
  season.ends_on::date,
  season.priority_json::jsonb
from seed_user
cross join (
  values
    (
      'Exam War Mode',
      'exam_war',
      '2026-05-25',
      '2026-06-06',
      '{"study": 100, "deadline": 100, "practice": 90, "health": 25, "fitness": 10, "projects": -40}'::jsonb
    ),
    (
      'Practice Mode',
      'practice',
      '2026-06-08',
      '2026-06-20',
      '{"practice": 100, "problem_sets": 90, "study": 80, "deadline": 65, "health": 35, "projects": -10}'::jsonb
    ),
    (
      'Recovery / Setup Mode',
      'recovery_setup',
      '2026-06-22',
      '2026-07-05',
      '{"health": 100, "sleep": 100, "setup": 90, "admin": 70, "study": 10, "heavy_fitness": -80}'::jsonb
    ),
    (
      'Summer Term Mode',
      'summer_term',
      '2026-07-06',
      '2026-08-15',
      '{"discrete_math": 100, "coursework": 90, "study": 90, "practice": 70, "health": 50, "projects": 40}'::jsonb
    ),
    (
      'Summer Mode',
      'summer',
      '2026-08-16',
      '2026-08-31',
      '{"projects": 90, "cybersecurity": 80, "health": 75, "fitness": 65, "finance": 50, "study": 20}'::jsonb
    )
) as season(name, mode, starts_on, ends_on, priority_json);

with seed_user as (
  select '00000000-0000-0000-0000-000000000000'::uuid as user_id
)
insert into public.study_courses (
  user_id,
  code,
  title,
  term,
  starts_on,
  ends_on,
  status,
  progress_percent,
  completed_units,
  total_units,
  metadata
)
select
  seed_user.user_id,
  'DISCRETE-MATH-SUMMER-2026',
  'Discrete Mathematics',
  'Summer 2026',
  '2026-07-06'::date,
  '2026-08-15'::date,
  'active',
  0,
  0,
  null,
  '{
    "mode": "summer_term",
    "priorityKey": "discrete_math",
    "source": "phase_1_seed"
  }'::jsonb
from seed_user
on conflict (user_id, code) do update set
  title = excluded.title,
  term = excluded.term,
  starts_on = excluded.starts_on,
  ends_on = excluded.ends_on,
  status = excluded.status,
  metadata = public.study_courses.metadata || excluded.metadata;
