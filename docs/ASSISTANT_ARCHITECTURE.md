# LifeOS assistant integration

## Design and assessment

LifeOS remains authoritative. Its Gemini service, deterministic planner, study
calculator and syllabus profiles, Moodle session encryption and sync workers,
Telegram commands, and reminder delivery are reused through their current
boundaries. Academic formulas and grade notification deduplication are unchanged.

The reference repository, `alinur527/personal-assistant`, was inspected locally
at `bfc0a0427a66032dfb7676c3e1190e383f3b1b29`. Its Brain, registry, provider, tools,
core contracts, memory/audit store, foundation migration and daily delivery
claim/retry mechanism informed this design. No top-level license grants source
reuse; this integration uses original code and copies no reference modules.

```text
Telegram private message / existing TMA AI screen
  -> existing active-profile authentication
  -> deterministic Russian/English intent router
  -> bounded tool schema + server-owned permissions
  -> existing LifeOS services / separate assistant persistence
  -> validated result + source freshness

Unsupported planning question -> existing optional Gemini service + planner validation
TMA explicit write -> preview -> signed confirmation -> atomic mutation + durable receipt
Telegram explicit write command -> atomic mutation + durable receipt
```

Core contains only pure routing, validation and types. The bot orchestrates
authorized tools. The DB package owns per-user memory, minimal action metadata
and transactional idempotency. Browser code never accesses Supabase directly.

## Capability boundaries

READ tools cover classes, deadlines, saved Moodle grades and recorded changes,
course forecasts, tasks, reminders, calendar events and known availability.
Forecasts call the existing study calculator; missing scores stay unknown.
Availability reuses the current planner, including class, calendar and scheduled
task commitments and its fail-closed handling of incomplete inputs.

WRITE tools cover explicit dated reminders and explicit memory remember,
update and archive requests. Memory categories are preference, goal, constraint,
learning and fact. Memory does not alter academic, calendar or task records.
Permanent deletion is DESTRUCTIVE and requires its separately enabled flag plus
an explicit command. TMA additionally requires a signed confirmation; a private
Telegram command itself is consent. SENSITIVE tools are disabled; health and finance retain
their existing workflows. Memories and tool results are not sent to Gemini.

No tool accepts user identity, permission grants, SQL, shell commands, filesystem
paths or arbitrary HTTP destinations. Conversation history and source text are
never authority to execute a write. Confirmation is issued by the backend and
bound to user, source, request and exact action, with an expiry.

## Persistence and scheduling

Memory is opt-in per write, owner-scoped, searchable, updateable, archivable and
deletable. Conversations are not stored. Credential-shaped and sensitive memory
content is rejected. Audit rows contain action names, status and timing rather
than prompts, complete conversations or memory contents.

A unique per-user idempotency key and atomic Postgres mutation/receipt prevent
duplicates even if the process stops after commit and before response delivery.
Reminder rows use the existing queue and worker. No daily scheduler is added:
LifeOS's existing digest and claim/retry delivery remain authoritative.

See [assistant operations](ASSISTANT_ROLLOUT.md) for rollout, flags, verification,
limitations and rollback instructions. Hosted migration and deployment require
the normal explicit operator approval.
