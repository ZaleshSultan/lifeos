# LifeOS Modes

LifeOS Mode is the operating context used to bias prioritization, focus queues,
today summaries, workouts, health recommendations, the Telegram Mini App home,
and dashboard surfaces.

## Modes

- `exam_war` - Exam War Mode
- `summer` - Summer Mode
- `trimester` - Trimester Mode
- `recovery` - Recovery Mode
- `project_sprint` - Project Sprint
- `maintenance` - Maintenance Mode

## Automatic Resolver

Mode resolution runs in this order:

1. Active manual override that has not expired.
2. Recovery mode when latest `health_daily.sleep_minutes < 330` or
   `health_daily.recovery_mode = 'recovery'`.
3. Active `life_seasons` row for the current date.
4. Active project sprint configuration.
5. Default mode: `trimester`.

The resolver returns the mode, label, source, reason, optional expiry, and the
priority weights used by focus scoring.

## Manual Override

Telegram:

```text
/mode
/mode set summer
/mode set recovery today
/mode set exam_war until:2026-06-05
/mode auto
/mode clear
```

TMA:

- Open Mode.
- Choose Auto or a mode.
- Choose Today, 7 days, Until date, or Permanent.
- Save or clear the override.

Frontend requests never send a trusted `user_id`; the backend resolves the user
from Telegram initData.

## Season Examples

```sql
insert into public.life_seasons (
  user_id,
  name,
  mode,
  starts_on,
  ends_on,
  priority_json
) values (
  '00000000-0000-0000-0000-000000000000',
  'Summer build block',
  'summer',
  '2026-06-10',
  '2026-08-20',
  '{"cybersecurity": 100, "projects": 100}'::jsonb
);
```

```sql
insert into public.life_seasons (
  user_id,
  name,
  mode,
  starts_on,
  ends_on
) values (
  '00000000-0000-0000-0000-000000000000',
  'Exam block',
  'exam_war',
  '2026-05-25',
  '2026-06-05'
);
```

## Summer Mode Transition

Use a `life_seasons` row for the planned summer block. Summer Mode shifts focus
toward projects, cybersecurity, health, fitness, and finance while keeping a
small study weight.

Recommended transition:

1. Add the season row before the final exam period ends.
2. Use `/mode set exam_war until:YYYY-MM-DD` during the last push if needed.
3. Let `/mode auto` return control to the season resolver.

## Exam War Mode Transition

Exam War Mode gives strong weight to study and deadlines, keeps health visible,
and downshifts general projects. It is best as either a dated season or a manual
override with an expiry.

Recommended transition:

1. Create an `exam_war` season for the exam window.
2. Use `/mode` daily to confirm the source and reason.
3. Clear manual overrides with `/mode auto` after the exam window so seasons and
   health recovery can take over.
