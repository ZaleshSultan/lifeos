# LifeOS planning and optional Gemini assistance

Supabase remains authoritative. `packages/core/src/planner.ts` produces
deterministic daily candidates and validates AI schedule proposals. `apps/bot`
authenticates users, reads bounded owned data and optionally calls the official
`@google/genai` SDK. TMA Today shows commitments, proposals, priorities, reminders
and seven-day task activity. Existing Home widgets and OpenRouter finance and
monthly review flows remain available.

Agata is an independent external authenticated read-only consumer, outside this
implementation. No Agata UI, agent, worker, write API or project changes are added.
The old Agata prompt file is not an implementation instruction.

## Configuration and model verification

Backend-only placeholders in the root and bot environment examples:

```dotenv
GEMINI_API_KEY=
LIFEOS_AI_ENABLED=false
LIFEOS_AI_TEXT_MODEL=gemini-3.8-flash
LIFEOS_AI_LIVE_MODEL=gemini-3.1-flash-live-preview
LIFEOS_AI_LIVE_ENABLED=false
```

Never put the key in frontend environments or use VITE*/NEXT_PUBLIC* prefixes.
No actual secrets or deployment settings were changed.

Official model documentation checked on 2026-10-10:

- [Gemini 3.8 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash): text model with structured outputs.
- [Gemini 3.1 Flash Live Preview](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-live-preview): legacy Live preview.
- [Gemini 3.8 Live](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live): newer Live model, separately configurable.

Before generation, `models.get` checks the configured account's model for
`generateContent`; success is cached for ten minutes. Status only reports
configuration readiness. Actual access is checked on the first question.
Tests use injected clients; no real API key or paid request was used.

## Authenticated API

All routes require valid Telegram initData and an active profile before reading
data. Identity comes from authentication. Responses use the existing TMA
envelopes and `Cache-Control: no-store`.

| Method and route                     | Result                                                                       |
| ------------------------------------ | ---------------------------------------------------------------------------- |
| `GET /api/tma/today?date=YYYY-MM-DD` | Deterministic plan, calendar, reminders, seven-day task counts and AI status |
| `GET /api/tma/ai/status`             | Configuration readiness without a provider call                              |
| `POST /api/tma/ai/chat`              | Read-only assistance and validated schedule proposals                        |

Planning dates are the user's local today through thirty days ahead. Chat accepts
`{ messages: [{ role: "user", text: "..." }], date?: "YYYY-MM-DD" }`, at most twelve
messages of two thousand characters, with a final user message and a 32 KiB body.
Extra ownership, action or confirmation flags are rejected. AI write routes do
not exist, even with `confirmed: true`. Nothing is persisted by AI. Use existing
manual controls to confirm changes. A future write workflow requires a separate
explicit approval step and revalidation.

## Planning and analytics

The planner works without AI. Ranking uses task priority, existing mode weights
and deadlines. Calendar/class commitments and elapsed time are excluded. Unknown
task durations have labeled thirty-minute estimates; invalid durations or
deadlines remain unscheduled. Every AI proposal is checked for known tasks,
duration, overlaps, deadlines, timezone/window bounds and duplicate tasks.

Working hours are currently an explicit 09:00–21:00 assumption, not a saved user
preference. Timetables expand within stored active course dates in the user's
timezone. Future dates use the current mode; future mode transitions are not
forecast. Weekly contexts are independent daily candidates, not a saved weekly
distribution. A response cannot propose the same task on multiple days.

Queries cap actionable tasks at 200, source events at 500, reminders at 200,
projects/courses at 100 each, schedules at 999 and assessments at 500. Truncated
inputs, malformed commitments or scheduled tasks lacking durations produce
warnings and block unverified availability. Unsynced calendars remain unknown.

Weekly and rolling thirty-day activity count actual task creation/completion
timestamps, including completions of older tasks. They are not inferred grades,
focus hours or productivity scores. History queries cap each creation/completion
selection at 1000 rows; incomplete history is labeled and has no completion-rate
claim. The existing monthly review keeps its optional OpenRouter provider.

## Privacy and reliability

The DB projection excludes notes, descriptions, grades, raw payloads, credentials,
health measurements and finance records. Every user-owned query filters user_id;
course child queries use IDs obtained from the authenticated owner's course query.
Provider context uses temporary references rather than DB UUIDs/user IDs.

Health/finance categories and recognizable sensitive titles are excluded. Named
task titles are limited to nonsensitive academic/project/work domains. Other task
titles, project names, reminder names and nonacademic calendar names are masked; occupied times
still block planning. Email, URL, UUID and common credential patterns are redacted.
Anything the user types in chat is sent, as disclosed before submission. Free-text
classification is not an absolute semantic guarantee.

Context contains a short task priority list, bounded daily windows/candidates,
project priorities and aggregate activity. Omitted records are disclosed. Provider
output is strictly parsed, and tool calls, unexpected media, malformed or
truncated responses and invalid schedules are rejected before presentation.
Exact clock times are reserved for structured suggestions; recognizable clock
times in explanation prose are rejected so they cannot bypass validation.
Natural-language reasoning is model-generated and cannot be fully verified
mechanically; structured schedules are always checked deterministically.

The SDK uses aborts, a timeout, bounded output tokens and one attempt per call.
Safe errors cover disabled/missing/invalid credentials, timeout, quota, usage
limits, unsupported models, invalid responses and provider failure. There is no
provider logging or conversation/context persistence. TMA retains conversation
only in screen memory, clears it on exit/Clear, and aborts client requests on
exit/Clear. Google's retention follows the user's Gemini API agreement/settings.

Default limits: six requests/minute/user, forty/day/user, two hundred/day globally,
four concurrent calls. Environment examples document timeout/context/output and
tracked-user limits too. Counters are per process and reset on restart. Multiple
replicas need a shared limiter for deployment-wide billing caps. Provider quotas
still apply. AI failure never disables the planner or existing LifeOS functions.

Malformed optional AI settings disable AI safely instead of stopping backend
startup. Strict configuration parsing remains independently testable.

## Prepared and deferred work

Live model/flag configuration is separate. No voice session, microphone UI or
ephemeral-token endpoint is implemented. Live status remains unavailable even if
the reserved flag is enabled. Future Live support must use the supported protocol,
backend mediation/ephemeral credentials, interruption, termination, permissions,
client handling and independent limits. Voice remains independent from Agata.

Saved working hours, explicit health/finance sharing consent, broader productivity
metrics when tracked data exists, and confirmed AI writes remain future work.
Production web auth, `/api/web/*`, Android delivery and deployment remain excluded.

## Validation

Run `corepack pnpm typecheck`, `corepack pnpm test`, and
`corepack pnpm --filter @lifeos/tma build`. CI runs these on Node 22. Vitest uses
at most two workers to avoid timer starvation on small machines. Tests cover
timezones/DST, invalid proposals, ownership/context filtering, disabled and
misconfigured AI, provider failures, limits, read-only routes and TMA behavior.
