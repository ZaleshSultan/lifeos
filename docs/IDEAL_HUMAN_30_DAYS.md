# Ideal Human · November 3–December 2, 2026

The 30 calendar days use `Asia/Almaty` (UTC+05:00), independently of the phone or server timezone. November 3 is Day 1; December 2 is Day 30. Open **Ideal Human** from Today or More in the Telegram Mini App. The private journal accepts partial entries; blank measurements remain unknown. A saved plan does not count as an observed check-in.

## First morning

Open Day 1, measure morning weight and record actual sleep duration. Height is an optional editable baseline; no weight, sleep, nutrition or fitness result is prefilled. Save whenever convenient, then reopen to retrieve the database copy.

Day 1 has editable, ordered blocks: morning → university → Underground GYM with Alinur → sports Mafia → flexible evening. Times are blank. The separate university panel reads existing courses/schedules and LMS assignments. It never invents classes or deadlines; check synchronization freshness and confirm your actual timetable. Rest and social time belong in the plan.

## Daily use

- **Body and recovery:** optional weight, sleep hours, bedtime/wake time, energy, mood, training effort and recovery notes. Sleep duration is an actual observation, not inferred from two clock times.
- **Plan and habits:** edit block names, notes, optional times and task status. Unknown status does not count as failure. Add or reorder flexible blocks as life changes.
- **Workout:** open the existing Workout screen for exercises, sets, repetitions, weights and duration/history. A manual journal training label is not another workout session. With no saved program, the program editor offers an editable introductory plan; no training starts or completes automatically. Weights remain blank until selected in the gym.
- **Nutrition:** describe meals manually; calories and protein are optional. Mark estimates explicitly. Meal totals include only recorded values and indicate incomplete coverage. The daily total remains available for legacy entries; meal entries take precedence to avoid counting the same nutrition twice. No photo analysis or calorie prescription is claimed.
- **Learning:** choose programming, English, cybersecurity, science or another category; enter a topic, optional minutes, resource, notes and completion. Detailed sessions take precedence over legacy totals in the same category.
- **Documentary:** record captured footage, A-roll, B-roll, minutes, reflection and editing status. Confirm backup only after checking the actual copied files. LifeOS does not upload or verify footage and never marks a backup automatically.
- **Evening:** note what worked, what did not, memorable events and tomorrow's plan. Fields are optional. Save the day before closing Telegram.

Weekly summaries use recorded observations. They report sample counts and missing data, without filling gaps with zeros. Workout frequency comes from existing workout history when available. Weight/sleep trends, study minutes, filming days, journal completion and explicitly answered task adherence are shown across the experiment.

The full JSON export includes private notes, plans, meals and learning sessions. Export stays on your device; choose a private destination. It does not fetch or upload video files.

## Reminders

Use the existing Reminders screen to choose the actual times for morning check-in, workout logging, evening reflection and sleep preparation. Confirm each reminder through its normal creation flow. No reminders or Telegram messages are created by experiment initialization. Delivery depends on an active linked profile, configured worker and your chosen timezone; check the displayed next delivery time.

## Persistence and recovery

The authenticated bot API owns `GET/PUT /api/tma/ideal-human/days`. A write sends `{day, expectedRevision}`. `user_id` comes exclusively from the existing authentication boundary. Each day is stored in `ideal_human_days` under `(user_id,date)`, with a monotonically increasing revision and an atomic service-only RPC. A stale write returns 409; the form retains edits and offers a deliberate reload of the saved version. Exact retries after a lost response return the already saved revision.

The additive migration `20261102120000_ideal_human_days.sql` copies recognizable legacy `user_settings.settings.ideal_human_days` entries without deleting or modifying that JSON or unrelated settings. Apply it before restarting the new backend. RLS remains enabled; browsers have no direct table or RPC privileges. Workouts and LMS retain their existing databases and authentication.

Edits remain in memory during a failed save. The form warns before date changes, navigation or page exit that would discard unsaved work. A reload after a successful save reads Supabase. An offline reload cannot retrieve a server record; retry once connected. No credentials or private journal are written into URLs or persistent browser storage.

## Release and rollback

Read `docs/IDEAL_HUMAN_DEPLOYMENT_REPORT.md` for actual production revision, backup evidence, tests, health checks and remaining integration/security limits. Use the existing self-host deployment/publisher; never build directly into the live static directory before validation. Rollback restores prior application code and TMA entrypoint while retaining the additive journal table and all observations. Never reset a database or remove journal data to roll back code.
