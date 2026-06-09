alter table public.workout_sets
  alter column completed set default false;

alter table public.workout_sets
  add column if not exists completed_at timestamptz;

create index if not exists workout_sets_user_id_completed_idx
  on public.workout_sets (user_id, completed, completed_at desc);

create index if not exists workouts_user_id_active_idx
  on public.workouts (user_id, started_at desc)
  where ended_at is null;
