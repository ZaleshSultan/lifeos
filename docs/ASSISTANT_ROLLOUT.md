# Assistant rollout and rollback

## Delivered behavior

The existing Telegram bot and TMA AI screen share one assistant Brain. Russian
and English requests route first through a deterministic, schema-checked tool
registry. Read tools use saved university classes, Moodle work/grades, recorded
grade notifications, the existing study calculator, active tasks, reminders and
calendar commitments. Availability reuses the deterministic planner.

Memory is separate from academic and calendar records. Users explicitly save,
update, search, view, archive or delete facts, preferences, goals, constraints and
learning preferences. Keys identify memories without exposing database IDs.
No conversations are automatically persisted. Memory and tool results stay local
to LifeOS and do not become Gemini context. Action receipts retain no content.

TMA changes require a backend-issued confirmation token bound to the authenticated
user, source, original text/date, request ID and exact action. Tokens expire after
ten minutes. Retry uses the same request ID; mutation and receipt commit in one
Postgres transaction. Telegram's explicit validated write command is consent and
its update ID is the idempotency key. Failed READ attempts may be recorded without
their content; successful mutations have atomic receipts.

Sensitive health/finance tools are disabled. Existing health/finance workflows,
Moodle credentials/encryption, grade notifications/deduplication, academic
formulas, Gemini planning and reminder/digest workers retain their boundaries.
There is no second provider or scheduler.

## New migration

`supabase/migrations/20261011084249_assistant_brain_persistence.sql` adds:

- `assistant_memories`: user-owned keys, category, content and lifecycle timestamps.
- `assistant_actions`: minimal user-scoped status/receipt metadata and unique request keys.
- `assistant_execute_mutation`: service-role-only, SECURITY INVOKER RPC atomically
  performing memory mutations or inserting into the existing reminder queue.

RLS is enabled. Browser roles cannot write the tables or execute the RPC. An
owner SELECT policy protects memory reads as defense in depth; clients continue
using the authenticated bot boundary. All service-role calls explicitly scope
the authenticated user. Existing migrations are unchanged.

## Environment

Only backend environment variables are used; placeholders live in
`apps/bot/.env.example` and the root `.env.example`.

| Variable                                  | Default | Purpose                                                                                     |
| ----------------------------------------- | ------- | ------------------------------------------------------------------------------------------- |
| `LIFEOS_ASSISTANT_ENABLED`                | `false` | Enables deterministic assistant tools and explicit memory.                                  |
| `LIFEOS_ASSISTANT_CONFIRMATION_SECRET`    | empty   | Backend-only random secret of at least 32 characters; required for TMA writes.              |
| `LIFEOS_ASSISTANT_MEMORY_DELETE_ENABLED`  | `false` | Enables explicit permanent memory deletion. Archive remains available.                      |
| `LIFEOS_ASSISTANT_CLASSIFICATION_ENABLED` | `false` | Optional classification of ambiguous public read queries using the existing Gemini service. |

Deterministic tools need the existing server-side Supabase configuration, not a
Gemini key. Optional classification and planning still require existing
`LIFEOS_AI_ENABLED=true`, `GEMINI_API_KEY` and the existing Gemini model/usage
settings. Classification shares their quotas, timeouts and model check. No new
provider key is introduced. Never use browser-prefixed variables for these secrets.

## Operator rollout — approval required

No hosted migration, deployment, service restart or production setting change
was performed as part of this implementation.

1. Review the diff, additive migration and verification report. Back up through
   the existing database release procedure.
2. After explicit release approval, apply the new migration through the normal
   approved Supabase migration process. Do not run the disposable test fixture
   against a hosted database.
3. Release backend/TMA code with `LIFEOS_ASSISTANT_ENABLED=false`. Confirm existing
   commands, Gemini planning, Moodle sync and reminder delivery remain healthy.
4. Configure a backend confirmation secret, then enable `LIFEOS_ASSISTANT_ENABLED`
   in the intended environment. Keep classification and permanent deletion off
   for the initial deterministic rollout.
5. Check owner isolation, classes, grades and a forecast against Study. Try one
   memory write/list/update/archive and a dated reminder. TMA must preview before
   confirmation; repeating confirmation must not create another row. Verify
   delivery through the existing general reminder worker.
6. Enable optional classification or permanent deletion only after separately
   accepting their behavior. Every memory write and deletion still needs a direct
   user request; TMA still needs signed confirmation.

Examples (English and Russian):

```text
What are my classes tomorrow?
Какая следующая пара?
Show Moodle grades
What do I need to score in DBMS to finish with 70?
Сколько нужно набрать по DBMS чтобы получить 70?
Show tasks
Find 60 minutes free tomorrow
Напомни завтра в 19:00 повторить DBMS
Remember preference answers.style: I prefer short answers
Запомни learning study.review: Мне помогает повторение утром
Show memories
Покажи память
Search memories for morning
Update memory answers.style preference: I prefer detailed answers
Archive memory answers.style
Show archived memories
Delete memory answers.style
```

Keys use lowercase ASCII letters/numbers, `_`, `-` and `.` (maximum 80 characters).
An unkeyed remember command receives a stable content-derived key shown in the
result; use that key in an explicit update to correct the same fact.
Credentials and recognized sensitive content cannot be written as memory.

## Disable and rollback

Set `LIFEOS_ASSISTANT_ENABLED=false` through the approved configuration process.
The existing Gemini status/chat route and planner continue using `LIFEOS_AI_*`;
assistant flags do not disable Gemini. Pending assistant confirmations stop
working. Ordinary Telegram commands and finance/health workflows remain available.

For code rollback, revert the dedicated integration commit and release through
the normal approved procedure. Keep the additive tables/RPC in place: the prior
code does not use them. Do not drop memory or receipts automatically. Reminders
already created are ordinary existing reminder rows and continue to deliver;
cancel unwanted ones using existing reminder controls. Database erasure requires
an explicitly approved, owner-aware retention procedure.

## Limits and verification scope

- Results use saved/synced data. Unknown freshness is displayed as unknown;
  this assistant does not perform live Moodle or calendar network reads.
- Grade changes read the existing last-seven-days notification ledger, including
  sent notifications. With notifications disabled or missing history, this is
  not an exhaustive change log. It does not mark notifications read or sent.
- Forecasts use the saved calculator scenario and unchanged central formulas.
  Unsaved TMA draft edits and unimported Moodle grades do not become scores.
  Missing scores stay unknown; forecasts are what-if calculations.
- Availability covers the existing 09:00–21:00 planning window and known class,
  calendar and scheduled-task commitments. Missing/truncated commitment data
  blocks verified availability. Travel and unscheduled tasks are not guarantees.
- Archived-memory view includes active and archived records, clearly labeled.
  Permanent deletion removes the current memory row; database backups follow
  the operator's retention policy and are outside this feature's control.
- Expired confirmations require a fresh request. After an uncertain write result,
  check reminders/memory before creating a fresh request ID. Within the valid
  confirmation window, committed reminder retries remain safe even after due time.
- Sensitive text detection is conservative pattern-based validation, not an
  absolute semantic guarantee. Gemini receives only the current permitted
  planning message in assistant mode; memory/tool history is excluded. Do not
  intentionally enter credentials or raw private records into a planning prompt.
- Limits are bounded per process (30 assistant requests/minute/user, 50 concurrent
  active users, 2000 tracked minute buckets); Gemini retains its separate existing
  per-process quotas. This is not a distributed rate limiter.
- Tests use mock provider/Telegram clients and a disposable local PostgreSQL.
  No live Gemini, Telegram delivery, hosted Supabase, Moodle or production release
  is verified. See [verification report](ASSISTANT_IMPLEMENTATION_REPORT.md).
