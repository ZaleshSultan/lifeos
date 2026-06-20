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
    "priority": "critical",
    "source": "phase_1_seed",
    "topics": [
      "propositional logic",
      "truth tables",
      "logical operators",
      "sets and relations",
      "functions",
      "induction",
      "pigeonhole principle",
      "permutations and combinations",
      "graph basics",
      "Euler and Hamilton cycles",
      "adjacency matrix",
      "planar graphs",
      "graph coloring"
    ]
  }'::jsonb
from seed_user
on conflict (user_id, code) do update set
  title = excluded.title,
  term = excluded.term,
  starts_on = excluded.starts_on,
  ends_on = excluded.ends_on,
  status = excluded.status,
  metadata = public.study_courses.metadata || excluded.metadata;

with seed_user as (
  select '00000000-0000-0000-0000-000000000000'::uuid as user_id
)
insert into public.external_sources (
  user_id,
  source_key,
  source_type,
  display_name,
  status,
  config_json
)
select
  seed_user.user_id,
  seed_sources.source_key,
  seed_sources.source_type,
  seed_sources.display_name,
  case
    when seed_sources.source_key = 'health_connect'
      and exists (
        select 1
        from public.health_sync_runs
        where health_sync_runs.user_id = seed_user.user_id
      )
      then 'connected'
    else seed_sources.status
  end,
  seed_sources.config_json
from seed_user
cross join (
  values
    ('manual', 'manual', 'Manual', 'connected', '{"implemented": true, "source": "phase_1_seed"}'::jsonb),
    ('obsidian_config', 'obsidian', 'Obsidian Config', 'disabled', '{"planned": true, "owner": "arch_worker", "source": "phase_1_seed"}'::jsonb),
    ('google_calendar', 'google', 'Google Calendar', 'disabled', '{"planned": true, "oauth": false, "source": "phase_1_seed"}'::jsonb),
    ('google_tasks', 'google', 'Google Tasks', 'disabled', '{"planned": true, "oauth": false, "source": "phase_1_seed"}'::jsonb),
    ('health_connect', 'android', 'Health Connect', 'disabled', '{"planned": true, "source": "phase_1_seed"}'::jsonb),
    ('university_ics', 'university', 'University ICS', 'disabled', '{"planned": true, "source": "phase_1_seed"}'::jsonb),
    ('university_platform', 'university', 'University Platform', 'disabled', '{"planned": true, "credentials": "server_side_only", "source": "phase_1_seed"}'::jsonb)
) as seed_sources(source_key, source_type, display_name, status, config_json)
on conflict (user_id, source_key) do update set
  source_type = excluded.source_type,
  display_name = excluded.display_name,
  status = excluded.status,
  config_json = public.external_sources.config_json || excluded.config_json,
  updated_at = now();

with seed_user as (
  select '00000000-0000-0000-0000-000000000000'::uuid as user_id
),
academic_events as (
  select *
  from (
    values
      ('academic:final:political-science:2026-05-25', 'academic_event', 'Political Science final', 'Final exam.', null::text, '2026-05-25T12:00:00+06'::timestamptz, null::timestamptz, null::timestamptz, 'active', '{"category": "final", "courseTitle": "Political Science", "source": "phase_1_seed"}'::jsonb),
      ('academic:final:calculus-2:2026-05-26', 'academic_event', 'Calculus 2 final', 'Final exam.', null, '2026-05-26T15:00:00+06'::timestamptz, null::timestamptz, null::timestamptz, 'active', '{"category": "final", "courseTitle": "Calculus 2", "source": "phase_1_seed"}'::jsonb),
      ('academic:final:electronics:2026-05-28', 'academic_event', 'Electronics final', 'Final exam.', null, '2026-05-28T10:00:00+06'::timestamptz, null::timestamptz, null::timestamptz, 'active', '{"category": "final", "courseTitle": "Electronics", "source": "phase_1_seed"}'::jsonb),
      ('academic:final:cultural-studies:2026-05-29', 'academic_event', 'Cultural Studies final', 'Final exam.', null, '2026-05-29T12:00:00+06'::timestamptz, null::timestamptz, null::timestamptz, 'active', '{"category": "final", "courseTitle": "Cultural Studies", "source": "phase_1_seed"}'::jsonb),
      ('academic:final:hacking-lab:2026-05-30', 'academic_event', 'Hacking Lab final', 'Final exam.', null, '2026-05-30T15:00:00+06'::timestamptz, null::timestamptz, null::timestamptz, 'active', '{"category": "final", "courseTitle": "Hacking Lab", "source": "phase_1_seed"}'::jsonb),
      ('academic:final:linear-algebra:2026-06-01', 'academic_event', 'Linear Algebra final', 'Final exam.', null, '2026-06-01T15:00:00+06'::timestamptz, null::timestamptz, null::timestamptz, 'active', '{"category": "final", "courseTitle": "Linear Algebra", "source": "phase_1_seed"}'::jsonb),
      ('academic:examfx:electronics:2026-06-02', 'academic_event', 'Electronics examfx', 'ExamFX session.', null, '2026-06-02T09:00:00+06'::timestamptz, null::timestamptz, null::timestamptz, 'active', '{"category": "examfx", "courseTitle": "Electronics", "source": "phase_1_seed"}'::jsonb),
      ('academic:examfx:calculus-2:2026-06-03', 'academic_event', 'Calculus 2 examfx', 'ExamFX session.', null, '2026-06-03T13:00:00+06'::timestamptz, null::timestamptz, null::timestamptz, 'active', '{"category": "examfx", "courseTitle": "Calculus 2", "source": "phase_1_seed"}'::jsonb),
      ('academic:examfx:political-science:2026-06-04', 'academic_event', 'Political Science examfx', 'ExamFX session.', null, '2026-06-04T12:00:00+06'::timestamptz, null::timestamptz, null::timestamptz, 'active', '{"category": "examfx", "courseTitle": "Political Science", "source": "phase_1_seed"}'::jsonb),
      ('academic:examfx:cultural-studies:2026-06-05', 'academic_event', 'Cultural Studies examfx', 'ExamFX session.', null, '2026-06-05T12:00:00+06'::timestamptz, null::timestamptz, null::timestamptz, 'active', '{"category": "examfx", "courseTitle": "Cultural Studies", "source": "phase_1_seed"}'::jsonb),
      ('academic:examfx:hacking-lab:2026-06-06', 'academic_event', 'Hacking Lab examfx', 'ExamFX session.', null, '2026-06-06T12:00:00+06'::timestamptz, null::timestamptz, null::timestamptz, 'active', '{"category": "examfx", "courseTitle": "Hacking Lab", "source": "phase_1_seed"}'::jsonb),
      ('academic:examfx:linear-algebra:2026-06-06', 'academic_event', 'Linear Algebra examfx', 'ExamFX session.', null, '2026-06-06T15:00:00+06'::timestamptz, null::timestamptz, null::timestamptz, 'active', '{"category": "examfx", "courseTitle": "Linear Algebra", "source": "phase_1_seed"}'::jsonb),
      ('academic:course:discrete-math-summer-2026', 'academic_event', 'Discrete Mathematics summer term', 'Summer term course window.', null, '2026-07-06T00:00:00+06'::timestamptz, '2026-08-15T23:59:00+06'::timestamptz, null::timestamptz, 'active', '{"category": "course_term", "courseTitle": "Discrete Mathematics", "courseCode": "DISCRETE-MATH-SUMMER-2026", "priority": "critical", "source": "phase_1_seed"}'::jsonb)
  ) as events(external_id, event_type, title, description, location, starts_at, ends_at, due_at, status, raw_json)
)
insert into public.source_events (
  user_id,
  source_key,
  external_id,
  event_type,
  title,
  description,
  location,
  starts_at,
  ends_at,
  due_at,
  status,
  raw_json
)
select
  seed_user.user_id,
  'manual',
  academic_events.external_id,
  academic_events.event_type,
  academic_events.title,
  academic_events.description,
  academic_events.location,
  academic_events.starts_at,
  academic_events.ends_at,
  academic_events.due_at,
  academic_events.status,
  academic_events.raw_json
from seed_user
cross join academic_events
on conflict (user_id, source_key, external_id) do update set
  event_type = excluded.event_type,
  title = excluded.title,
  description = excluded.description,
  location = excluded.location,
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at,
  due_at = excluded.due_at,
  status = excluded.status,
  raw_json = public.source_events.raw_json || excluded.raw_json,
  updated_at = now();

with seed_user as (
  select '00000000-0000-0000-0000-000000000000'::uuid as user_id
)
delete from public.academic_records
using seed_user
where academic_records.user_id = seed_user.user_id
  and academic_records.raw_json ->> 'source' = 'phase_1_seed';

with seed_user as (
  select '00000000-0000-0000-0000-000000000000'::uuid as user_id
),
seed_academic_events as (
  select source_events.*
  from public.source_events
  join seed_user on seed_user.user_id = source_events.user_id
  where source_events.source_key = 'manual'
    and source_events.raw_json ->> 'source' = 'phase_1_seed'
    and source_events.raw_json ->> 'category' in ('final', 'examfx')
)
insert into public.academic_records (
  user_id,
  source_event_id,
  course_title,
  record_type,
  title,
  occurs_at,
  raw_json
)
select
  seed_academic_events.user_id,
  seed_academic_events.id,
  seed_academic_events.raw_json ->> 'courseTitle',
  seed_academic_events.raw_json ->> 'category',
  seed_academic_events.title,
  seed_academic_events.starts_at,
  seed_academic_events.raw_json
from seed_academic_events;

with seed_user as (
  select '00000000-0000-0000-0000-000000000000'::uuid as user_id
),
topic_rows as (
  select *
  from (
    values
      ('propositional logic'),
      ('truth tables'),
      ('logical operators'),
      ('sets and relations'),
      ('functions'),
      ('induction'),
      ('pigeonhole principle'),
      ('permutations and combinations'),
      ('graph basics'),
      ('Euler and Hamilton cycles'),
      ('adjacency matrix'),
      ('planar graphs'),
      ('graph coloring')
  ) as topics(title)
),
course_event as (
  select source_events.id, source_events.user_id
  from public.source_events
  join seed_user on seed_user.user_id = source_events.user_id
  where source_events.source_key = 'manual'
    and source_events.external_id = 'academic:course:discrete-math-summer-2026'
)
insert into public.academic_records (
  user_id,
  source_event_id,
  course_title,
  record_type,
  title,
  value_text,
  raw_json
)
select
  course_event.user_id,
  course_event.id,
  'Discrete Mathematics',
  'topic',
  topic_rows.title,
  'critical/high',
  jsonb_build_object(
    'source', 'phase_1_seed',
    'courseCode', 'DISCRETE-MATH-SUMMER-2026',
    'category', 'topic'
  )
from course_event
cross join topic_rows;

with seed_user as (
  select '00000000-0000-0000-0000-000000000000'::uuid as user_id
)
delete from public.reminders
using seed_user
where reminders.user_id = seed_user.user_id
  and reminders.metadata_json ->> 'seedKey' = 'DISCRETE-MATH-SUMMER-2026:start';

with seed_user as (
  select '00000000-0000-0000-0000-000000000000'::uuid as user_id
),
course_event as (
  select source_events.id, source_events.user_id
  from public.source_events
  join seed_user on seed_user.user_id = source_events.user_id
  where source_events.source_key = 'manual'
    and source_events.external_id = 'academic:course:discrete-math-summer-2026'
)
insert into public.reminders (
  user_id,
  source_event_id,
  channel,
  remind_at,
  message,
  metadata_json
)
select
  course_event.user_id,
  course_event.id,
  'telegram',
  '2026-07-06T08:00:00+06'::timestamptz,
  'Discrete Mathematics starts today.',
  '{
    "seedKey": "DISCRETE-MATH-SUMMER-2026:start",
    "courseCode": "DISCRETE-MATH-SUMMER-2026",
    "source": "phase_1_seed"
  }'::jsonb
from course_event;

with seed_user as (
  select '00000000-0000-0000-0000-000000000000'::uuid as user_id
)
delete from public.sync_runs
using seed_user
where sync_runs.user_id = seed_user.user_id
  and sync_runs.source_key = 'manual'
  and sync_runs.metadata_json ->> 'seedKey' = 'ACADEMIC-SCHEDULE-2026';

with seed_user as (
  select '00000000-0000-0000-0000-000000000000'::uuid as user_id
),
manual_source as (
  select external_sources.id, external_sources.user_id
  from public.external_sources
  join seed_user on seed_user.user_id = external_sources.user_id
  where external_sources.source_key = 'manual'
)
insert into public.sync_runs (
  user_id,
  source_id,
  source_key,
  status,
  finished_at,
  records_seen,
  records_created,
  records_updated,
  metadata_json
)
select
  manual_source.user_id,
  manual_source.id,
  'manual',
  'success',
  now(),
  27,
  27,
  0,
  '{
    "seedKey": "ACADEMIC-SCHEDULE-2026",
    "source": "phase_1_seed"
  }'::jsonb
from manual_source;
