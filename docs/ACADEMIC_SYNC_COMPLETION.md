# Academic sync completion — 2026-09-24

Base: `main-v2`, commit `c7b1ecd`.

This change closes the Moodle grade ingestion gap described in the August–September handoff. It does not claim that the entire LifeOS roadmap is finished.

## Delivered

- Parse Moodle's `th.item` title, separate weight/grade/range columns and comma decimals. Skip category and course aggregates. Keep ungraded items as `NULL`, including through the Web Services path and database writes. Never assume an unknown maximum is 100.
- Use Moodle course/item identities instead of ASCII title slugs. Identical names with different item IDs remain separate; renaming an identified item updates it. Unicode title hashes are the fallback only when the report exposes no ID; ambiguous duplicate fallback identities fail the snapshot.
- Write linked live grades into existing `assessment_items` alongside `source_events` and `academic_records`. Preserve weights, due dates, due-date provenance, syllabus dates and notes. No schema changes or new migrations.
- Match by `external_course_key = moodle:<course-id>`, then a unique exact normalized title among unlinked active courses owned by this user. No translations or fuzzy guesses. Unmatched grades remain visible in the legacy records, with a warning identifying the course to link.
- Fail incomplete course fetches and unrecognized/missing grade reports before missing-record reconciliation. Moodle and Platonus only retire their own grade events.
- Explicit Moodle mock mode uses separate identities and never updates real assessments or retires live grade events. The multi-user worker always disables mocks.
- Fix the master worker's import path and both outdated settings constructors. Record failed fetches in `sync_runs`; keep updates scoped to the configuration owner. Never reuse the legacy owner's SSO cookie for other users.
- Show latest synced grades grouped by course in the TMA Home Academic card, distinguishing zero, ungraded and demo data. Refresh reloads academic data too. The API filters retired source records while retaining manual entries.
- Root `pnpm typecheck` now covers bot/packages, TMA and web. `pnpm test:workers` and `pnpm test:all` include the Python suite and the previously untested master entrypoint.

## Update an existing installation

Apply the commit/patch to the current `main-v2` working copy after reviewing local changes. Existing `.env` files, SSO credentials, tables, schedules and systemd definitions are preserved.

From the repository root, use the virtual environment for the worker you actually run:

```bash
# Legacy single-user AITU worker:
workers/university-sync/aitu-parser/.venv/bin/python -m pip install -r workers/university-sync/aitu-parser/requirements.txt

# Or the multi-user LMS worker:
workers/university-sync/.venv/bin/python -m pip install -r workers/university-sync/requirements.txt
```

Do not run both workers for the same account concurrently. `academic_records` still uses the pre-existing read-then-write persistence contract; no new transaction or uniqueness migration was added here.

Run the checks with that Python environment activated:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm typecheck
corepack pnpm test:all
corepack pnpm --filter @lifeos/tma build
```

For the current self-host TMA deployment, build with its existing base path using `bash scripts/build-tma-selfhost.sh`. Deploy/restart the bot to load the updated academic API and restart **the LMS service actually in use** (`lifeos-university-sync` or `lifeos-lms-grades-worker`). If Platonus is also running, restart it to load platform-scoped reconciliation. No database migration is needed.

A one-shot legacy sync uses the existing `.env`:

```bash
workers/university-sync/aitu-parser/.venv/bin/python workers/university-sync/aitu-parser/university_scraper.py sync-once
```

Run it while its daemon is stopped to avoid overlapping writes. A successful complete sync marks the old `academic:grade:*` events missing; rows are retained for history rather than deleted. The updated API excludes them from current grades.

## Link Russian schedule titles to English Moodle courses

The code cannot safely infer a translation, teacher or trimester. A warning such as `No unambiguous study course for moodle:123 (...)` supplies the actual Moodle ID. Check that course against the LMS and your schedule.

```bash
# Inspect this user's study courses and current links:
workers/university-sync/aitu-parser/.venv/bin/python workers/university-sync/aitu-parser/university_scraper.py list-courses

# Example only: replace 123 with the verified Moodle course ID.
workers/university-sync/aitu-parser/.venv/bin/python workers/university-sync/aitu-parser/university_scraper.py link-course --moodle-course-id 123 --course-code DMS52-EN
```

The command changes only `external_course_key` on one active owned course. It refuses ambiguous codes or replacing another existing link. For the multi-user worker, use the target user's scoped configuration; never link courses through another user's legacy environment. After linking, the next successful sync fills assessments without creating duplicate study courses.

## Validation and limits

Verified in this workspace: 245 TypeScript tests, 78 Python worker tests, type checks for all three application areas, and both TMA and web production builds. Regression tests cover the TH/weight/grade layout, real zero versus unknown, Unicode and duplicate names, repeated sync and renames, manual-field preservation, cross-user matching, partial fetch failures, platform isolation, mock isolation and the actual master-worker imports/settings.

The tests use synthetic HTML fixtures and in-memory database/HTTP doubles. A live Moodle session, production Supabase/PostgREST writes, production RLS and systemd deployment were not exercised in this workspace. Check a real one-shot sync after installation and confirm `assessment_items` for each explicitly linked course.

The academic summary now reads records in batches of 100 using an immutable ID cursor, checks source ownership/status per batch, and returns all current records plus manual entries, newest updated first. A page containing only retired records does not stop loading. Failures on any page fail the request instead of returning a partial list. This removes the previous 50-record display limit without changing the API or schema; restart `lifeos-bot` to load the backend change. It is still a current-grades view, not a full course-history screen.

## Remaining LifeOS work

The repository's `AGENTS.md` acceptance boundary still excludes production web auth, `/api/web/*` and Android production delivery. The web remains a scaffold. The attached Academic OS plan also has unfinished work: connect readings and grade calculations to course screens, materialize class sessions from term/schedule data, add study planning and syllabus ingestion, then integrate Agata later. These need separate complete slices against the current schema; they were not silently added to this stabilization change.
