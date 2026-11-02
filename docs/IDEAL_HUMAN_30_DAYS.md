# Ideal Human · November 3–December 2, 2026

The 30 calendar days use `Asia/Almaty` (UTC+05:00), independently of the phone or server timezone. November 3 is Day 1; December 2 is Day 30. Open **Ideal Human** from Today or More in the Telegram Mini App, or from the authenticated [web dashboard](WEB_DASHBOARD.md). The private journal accepts partial entries; blank measurements remain unknown. A saved plan does not count as an observed check-in. This guide describes the implementation; actual deployment and verification belong in the [phase 2 report](OVERNIGHT_PHASE2_REPORT.md).

## First morning

Open Day 1, measure morning weight and record actual sleep duration. Height is an optional editable baseline; no weight, sleep, nutrition or fitness result is prefilled. Save whenever convenient, then reopen to retrieve the database copy.

Day 1 has editable, ordered blocks: morning → university → Underground GYM with Alinur → sports Mafia → flexible evening. Times are blank. The separate university panel reads existing courses/schedules and LMS assignments. It never invents classes or deadlines; check synchronization freshness and confirm your actual timetable. Rest and social time belong in the plan.

## Daily use

- **Body and recovery:** optional weight, sleep hours, bedtime/wake time, energy, mood, training effort and recovery notes. Sleep duration is an actual observation, not inferred from two clock times. A read-only source panel also projects available recorded sleep, weight, steps and activity measurements with source, missing/stale markers and recent ingest status. Manual journal fields take priority; opening the panel never copies automatic values into the journal or creates a check-in. A successful ingest status does not prove current device permissions or new sensor coverage. Android builds and physical Galaxy S23+ background synchronization remain unverified until recorded separately; LifeOS does not invent sensor access.
- **Plan and habits:** edit block names, notes, optional times and task status. Unknown status does not count as failure. Add or reorder flexible blocks as life changes.
- **Workout:** open the existing Workout screen for exercises, sets, repetitions, weights and duration/history. A manual journal training label is not another workout session. With no saved program, the program editor offers an editable introductory plan; no training starts or completes automatically. Weights remain blank until selected in the gym.
- **Nutrition:** describe meals manually with optional calories, protein, fat, carbohydrates, meal time and portion. Mark estimates and corrections explicitly. Meal totals include only recorded values and indicate incomplete coverage. The daily total remains available for legacy entries; meal entries take precedence to avoid counting the same nutrition twice. Optional food-photo analysis requires explicit consent before external transmission, produces an unsaved estimate and requires correction/review plus a separate save action. Telegram `/meal` opens the same owner-scoped correction workflow; ordinary receipt photos retain their existing finance flow. The vision provider is disabled by default, and manual logging works when unavailable. Real provider accuracy is unverified; no calorie prescription or precise nutrition from a photograph is claimed. See [meal privacy, retention and fallback](FOOD_PHOTO_LOGGING.md).
- **Water:** use `/water` privately in Telegram for +150/+250/+500 ml, a custom amount or undo, or use the Mini App/web Nutrition and Water controls. Each explicit entry records source and time; retries do not double-count and undo retains the original entry. Daily totals use the active profile's local timezone; keep it at Asia/Almaty for the experiment. Water has its own owner-scoped log rather than a conflicting health measurement or duplicate journal total. There is no imposed medical target and reminders default off.
- **Learning:** choose programming, English, cybersecurity, science or another category; enter a topic, optional minutes, resource, notes and completion. Detailed sessions take precedence over legacy totals in the same category.
- **Documentary:** record captured footage, A-roll, B-roll, minutes, reflection and editing status. The private footage catalog adds an editable label, capture time, filename, explicitly supplied location, notes, story beat, editing status and storyboard. Unknown capture times stay blank. Backup states are `not_backed_up` or `user_confirmed`; confirm only after checking the actual copied files. Server-verified backup status is unavailable and cannot be selected. LifeOS does not fetch/upload videos, verify copies or claim DaVinci Resolve project automation. Suggested shots come from the real editable plan and remain suggestions until footage is recorded.
- **Evening:** note what worked, what did not, memorable events and tomorrow's plan. Fields are optional. Save the day before closing Telegram.

Weekly summaries use recorded observations. They report sample counts and missing data, without filling gaps with zeros. Workout frequency comes from existing workout history when available. Weight/sleep trends, study minutes, filming days, journal completion and explicitly answered task adherence are shown across the experiment.

The full JSON export includes private notes, plans, meals, learning sessions, footage metadata and storyboard for manual editing preparation. Export stays on your device; choose a private destination. It does not fetch or upload video files or prove that footage is backed up. Weekly documentary summaries use only recorded filming/reflection observations, leaving absent days unknown.

## Morning and evening overviews

Telegram `/briefing`, `/evening` and `/documentary` work in the active owner's
private chat. The shared Mini App/web Daily Life views use the same recorded
sources. The morning overview distinguishes saved classes/deadlines/open tasks
and available sleep from optional study/filming suggestions. Stale LMS and
unavailable sources carry warnings; no class time, sleep value or completed
action is invented. Automatic AITU authorization remains blocked until an
institution-supported grant is available; a university login click alone does
not connect LifeOS. See [AITU authorization status](AITU_AUTH_DISCOVERY.md).

The evening overview reports recorded task completion, workouts, learning,
nutrition and documentary observations where available, with short optional
reflection questions. Suggestions for tomorrow remain drafts; neither overview
marks tasks completed or saves a changed plan automatically. Save your own
reflection and approved plan edits through the normal journal controls. These
overviews are deterministic and do not require a model or paid provider. Optional
AGATA analysis remains disabled; see [its integration boundary](AGATA_INTEGRATION.md).

## Reminders

Use the existing Reminders screen to create explicit check-in, workout or sleep-preparation reminders through its normal confirmation flow. Daily morning/evening delivery and optional hydration nudges have separate saved preferences for enablement, local times, quiet hours and health/filming inclusion. All automatic notifications default off, and health inclusion defaults off. The existing daily-digest/reminder workers handle delivery; no second scheduler is added. Experiment initialization creates no reminders, messages or opt-ins. Delivery depends on an active linked profile, configured worker and your chosen timezone. See [notification consent, quiet hours and revocation](DAILY_LIFE_NOTIFICATIONS.md).

## Persistence and recovery

The authenticated bot API owns `GET/PUT /api/tma/ideal-human/days`. A write sends `{day, expectedRevision}`. `user_id` comes exclusively from the existing authentication boundary. Each day is stored in `ideal_human_days` under `(user_id,date)`, with a monotonically increasing revision and an atomic service-only RPC. A stale write returns 409; the form retains edits and offers a deliberate reload of the saved version. Exact retries after a lost response return the already saved revision.

The additive migration `20261102120000_ideal_human_days.sql` copies recognizable legacy `user_settings.settings.ideal_human_days` entries without deleting or modifying that JSON or unrelated settings. RLS remains enabled; browsers have no direct table or RPC privileges. Optional meal macro/provenance fields and footage/storyboard metadata extend the same daily JSON record and revision checks; no second food or documentary database is introduced. Hydration, notification preferences, delivery bindings and AI accounting use the separate additive migrations documented in [Database](DATABASE.md). Workouts and LMS retain their existing databases and authentication. Apply only the reviewed pending migration set through the coordinated release procedure, preserving older observations.

Edits remain in memory during a failed save. The form warns before date changes, navigation or page exit that would discard unsaved work. A reload after a successful save reads Supabase. An offline reload cannot retrieve a server record; retry once connected. No credentials or private journal are written into URLs or persistent browser storage.

## Release and rollback

Read the [initial deployment report](IDEAL_HUMAN_DEPLOYMENT_REPORT.md) for that release's evidence and the [phase 2 report](OVERNIGHT_PHASE2_REPORT.md) for current production revision, backups, checks and remaining limits. Use the existing self-host deployment/publisher; never build directly into the live static directory before validation. Rollback restores prior application code and TMA entrypoint while retaining the additive journal/log tables, observations, delivery receipts and AI accounting. Stop incompatible notification workers rather than replaying old delivery behavior. Never reset a database or remove journal data to roll back code.
