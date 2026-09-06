You're working in the `lifeos` monorepo (TypeScript, pnpm workspace:
`apps/bot`, `apps/tma`, `apps/web`, `packages/core`, `packages/db`,
Supabase Postgres, Python workers under `workers/`).

# Task: Agata integration, Phase A — LifeOS-side API only

Agata is a separate voice-assistant project (Python, runs on a different,
Windows machine). This phase does NOT touch Agata's codebase at all — that's
a separate follow-up phase once this one ships and is verified. This phase
only builds the LifeOS-side surface Agata will eventually call over HTTP.

## Why a separate namespace, not the existing `/api/tma/*` routes

`/api/tma/*` authenticates via Telegram initData (see
`resolveTmaSessionIdentity` in `apps/bot/src/server.ts`) - Agata isn't a
Telegram client, so it can't produce that. Build a new, separate namespace
`/api/agata/*` authenticated by a static API key instead, scoped to exactly
the operations Agata needs and nothing else (no arbitrary Supabase access,
no admin operations, no user management).

## Auth

- New config field `lifeosAgataApiKey` (env var `LIFEOS_AGATA_API_KEY`),
  following the exact pattern of `telegramWebhookSecret` /
  `lifeosHealthIngestJwtSecret` already in `apps/bot/src/server.ts` (look at
  how those are threaded from `options.config?.xxx` through
  `ResolvedBotServerOptions`).
- Every `/api/agata/*` request must include a header `X-Agata-Api-Key`
  matching that value, compared via the existing `secureCompare()` helper
  already defined in `server.ts` (do not write a new comparison function -
  use the existing one, it exists specifically to avoid timing attacks on
  secret comparison, see SEC-03 in `docs/PROJECT_AUDIT.md`).
- If the key is missing or doesn't match: `401` with
  `{ "error": "agata_unauthorized" }`. If `lifeosAgataApiKey` isn't
  configured on the server at all: `503` with
  `{ "error": "agata_not_configured" }` (fail closed, not open - don't let
  an unset env var silently disable auth).
- There is currently only one LifeOS user (see `LIFEOS_DEFAULT_USER_ID` /
  `lifeosDefaultUserId` used elsewhere in this file for the single-tenant
  deployment). Resolve the acting user the same way `resolveTmaSessionIdentity`'s
  dev-bypass path does (`options.defaultUserId`) rather than inventing a new
  per-request user resolution mechanism - Agata calls act on behalf of
  whichever single user this server is configured for.

## Endpoints to add

All under `/api/agata/`, all requiring the API key above. Response envelope:
match the existing `tmaData({...})` helper's shape for consistency (check
what that wraps responses in) unless there's a reason not to - note the
discrepancy if there is one rather than guessing.

### `GET /api/agata/today`

Combines: today's class schedule (from `course_schedules` joined to
`study_courses`, filtered to today's day-of-week - use the server's
configured timezone, check how other "today" boundaries in this file compute
day-of-week, e.g. around `zonedMidnightUtc`, rather than using UTC's day
which can be wrong for Kazakhstan's timezone), today's upcoming reminders
(`listUpcomingReminders`, already exists), and any `assessment_items` whose
`due_at` falls within the next 48 hours (so Agata can proactively mention an
approaching deadline, not just today's literal date). Shape:

```json
{
  "data": {
    "classes": [
      { "courseTitle": "...", "courseCode": "...", "startTime": "09:00:00", "endTime": "10:30:00", "room": "..." }
    ],
    "reminders": [
      { "message": "...", "remindAt": "2026-09-01T09:00:00.000Z" }
    ],
    "upcomingDeadlines": [
      { "courseTitle": "...", "title": "...", "dueAt": "...", "assessmentType": "..." }
    ]
  }
}
```

This needs a new store method (there is currently no bulk "all of a user's
courses" or "today's schedule across all courses" method - only
`listCourseSchedules(userId, studyCourseId)`, scoped to one course at a
time). Add whatever new method(s) you need in `packages/db/src/lifeos-store.ts`
following the existing method/type conventions in that file - a single
joined query is preferable to N+1 (list courses, then loop calling
per-course methods).

### `GET /api/agata/deadlines`

All `assessment_items` with `status != 'graded'` and a non-null `due_at`,
ordered by `due_at` ascending, across all the user's courses. Same
"need a new cross-course store method" note as above.

### `POST /api/agata/reminder`

Body: `{ "message": string, "remindAt": string (ISO 8601) }`. Validate the
same way `/api/tma/reminders`' POST handler already does (reject a past
`remindAt`, reject a missing/blank message) - reuse that validation logic
rather than duplicating it if it's easily extracted, otherwise duplicate it
exactly rather than writing a subtly different version. Calls the existing
`store.createReminder(...)` with `channel: "telegram"` (reminders still
notify via the existing Telegram delivery path - this phase does not add a
new delivery channel) and `metadataJson: { source: "agata" }` so it's
distinguishable from TMA/bot-created reminders in the data. Response:
`{ "data": { "id": "...", "message": "...", "remindAt": "..." } }`.

## Explicitly out of scope for this phase

- Anything in the actual Agata (Python/Windows) codebase - no new files
  there, no `tools/lifeos.py`, nothing. That's Phase B, after this ships and
  is verified independently.
- A dedicated "study session" / "study block" table or endpoint. The
  current schema (`study_courses` / `course_schedules` / `assessment_items`,
  from the Academic Engine Phase 1 migration) has no such table. Don't add
  one in this phase - if a study-block concept is needed later, treat it as
  a reminder for now (Agata can call `POST /api/agata/reminder` with an
  appropriate message) rather than inventing new schema here.
- Any write operation beyond creating a reminder (no editing/deleting
  reminders, no writing to `assessment_items` or `study_courses`, no
  marking things done).
- Rate limiting, request logging/audit trail for this namespace, or any
  admin/management UI for the API key itself.
- Changes to `apps/tma`, `apps/web`, or any Python worker.

## Required verification before you consider this done

Run these and show the actual output - not a summary claiming they pass:

```
pnpm typecheck
pnpm test
```

Add unit tests for the three endpoints (auth rejection on missing/wrong
key, the 503 on unconfigured key, each endpoint's happy path, the POST
validation rejection cases) following the existing test patterns in
`apps/bot/src/server.test.ts` (mock store objects, `fetch()` against a
`listen()`-started test server - look at how the existing `/api/tma/*`
tests in that file are structured and match that style exactly). Add
store-method unit tests in `packages/db/src/lifeos-store.test.ts` following
the `FakeSupabaseClient` pattern already there (see the `course_schedules
methods` / `assessment_items methods` describe blocks added in the Academic
Engine Phase 1 work for the exact shape to match, including seeding a
parent `study_courses` fixture row - the ownership-check helpers added in
that phase mean a test that doesn't seed the parent row will fail with
"Study course not found", not a useful assertion, so seed the fixture).

## Deliverable

Route handlers in `apps/bot/src/server.ts` (or a new file if this file is
already very large and you want to keep the new namespace self-contained -
check its current line count first and use your judgment, but if you split
it out, wire it in the same way the existing route dispatch does, not as a
parallel/separate server), the new store method(s) with types, config
threading for `lifeosAgataApiKey`, and unit tests. Nothing else. If
something in this spec turns out to be wrong once you actually look at the
current codebase (e.g. `tmaData()` doesn't shape the way assumed here, or a
relevant helper already exists under a different name), follow what's
actually there and note the discrepancy rather than guessing silently.
