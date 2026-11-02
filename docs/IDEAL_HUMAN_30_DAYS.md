# IDEAL HUMAN · 30 days

**Start:** 2026-11-03 (day 1). **Finish:** 2026-12-02 (day 30). Local time: Asia/Almaty.
No backfilled achievements and no invented footage. The 2026 series is documentary, not an inflexible streak system.

## Deliverable

A private Telegram Mini App screen called **IDEAL HUMAN** accessed from Today and More. It records body weight, sleep, rough calories/protein, training/recovery category, energy, neuroscience/cybernetics, English, programming, filming minutes, footage backup confirmation, and honest reflections. Data is stored on the server in the authenticated user's `user_settings.settings.ideal_human_days` JSON by date. No new database migration is needed. No public sharing; the metric CSV export omits notes and private learning/filming text.

This release reuses existing Workout (actual exercises and sets), Health (Health Connect where connected), Study (AITU assignments and LMS), and LifeOS's daily digest/reminder infrastructure. **The Ideal Human daily form is manually entered; it does not claim to automatically calculate food totals, import exercise sets, sync videos or send new reminders.**

## Day zero / day one preparation

1. Before filming, use current Health/Workout/Study pages to verify that all needed integrations and existing workout program are functional. Do not reset, replace or bulk-modify existing LifeOS data.
2. Record a starting morning weight under comparable conditions, and measure sleep only from actual data; no guessed baseline. Take a reproducible English baseline test; repeat the same procedure on day 30.
3. In the Ideal Human screen, select day 1 and save actual measurements and notes at the end of November 3. Keep blank anything that was not measured.
4. Film Samsung S23+ landscape at 4K/30, 1× main lens; check 15 seconds of sound, then copy originals and verify the copied files. Keep private projects and family matters out of frame.
5. For strength training: prioritize technique and recovery, avoid heavy lifts with back discomfort until medically cleared. No aggressive weight gain promises or automatic calorie targets.

## Daily rhythm (adapt around AITU commitments)

- Morning: note sleep and comparable weight when measured; view Study deadlines and Today's tasks.
- During day: actual classes, study, English, science study topic + takeaway, and workout/rest as appropriate.
- Evening (3–5 minutes): note food estimates only where defensible; record filming and backup; save the daily entry and a true highlight or difficulty.
- Make progress even on partial days. **No mandatory perfect streak.**

Weekly editorial checkpoints: **Nov 9 (day 7), Nov 16 (day 14), Nov 23 (day 21), Dec 2 (day 30)**. Compare trends using recorded values, not fabricated data; for body weight use averages of comparable morning weights. Notes are private and not exported with metrics.

## Technical boundaries

- Frontend: `apps/tma/src/screens/IdealHumanScreen.tsx`, `apps/tma/src/api/ideal-human.ts`.
- API: `GET/PUT /api/tma/ideal-human/days` after the existing TMA user authentication in `server.ts`; `user_id` always comes from authenticated identity and never the body.
- Domain: `packages/core/src/ideal-human.ts` validates 30 allowed dates and caps values/strings.
- Persistence: `packages/db/src/lifeos-store.ts` under `user_settings`, preserving other settings keys.
- Caveat: this is a short-run 30-day log using the existing JSON settings pattern (same strategy as workout programs). Concurrent writes to different `user_settings` keys can theoretically overwrite each other; a dedicated table/atomic RPC is the preferred follow-up if expanding beyond a single-user experiment.
- Before deploy: `corepack pnpm typecheck && corepack pnpm test && corepack pnpm --filter @lifeos/tma build`; manually verify on mobile, TMA re-auth, owner isolation, blank fields, invalid dates, CSV export, and no data leaks. Do not merge or deploy before tests and backup/rollback review.
- This branch is based on `codex/overnight-stabilization-20261031`, **not** the stale `main-v2`; check the actually deployed SHA before release to avoid rolling back later fixes.
