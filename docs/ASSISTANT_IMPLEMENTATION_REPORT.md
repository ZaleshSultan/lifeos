# Personal Assistant Brain implementation report

## Scope and baseline

Work started from a clean `study-forecast-preview` at
`b4510cf1e26dfc163247bd38f9844f89f304a2b5`, matching
`origin/feat/study-forecast-dashboard`. Changes are isolated on
`feat/personal-assistant-brain`; the PR targets the existing study branch so its
diff contains this integration only. Baseline typecheck and 712 Vitest tests in
53 files passed before implementation.

The reference repository was studied at
`bfc0a0427a66032dfb7676c3e1190e383f3b1b29`. Source reuse permission was unclear,
so the implementation is original. The design and overlap assessment are in
[ASSISTANT_ARCHITECTURE.md](ASSISTANT_ARCHITECTURE.md).

## Delivered changes

- `packages/core`: pure Russian/English deterministic routing, strict bounded
  tool contracts, permission classes, credential/privacy filters, local date
  handling and reminder time validation, including DST ambiguity rejection.
- `apps/bot/src/assistant`: one Brain and authorized registry for saved classes,
  deadlines, Moodle grades and recorded changes, existing study forecasts,
  tasks, reminders, calendar and known availability. Missing scores stay
  unknown; existing calculator formulas remain authoritative.
- `packages/db/src/assistant-store.ts`: separate owner-scoped memory and minimal
  action audit. Atomic mutation/receipt persistence prevents duplicate writes
  across retries and process failures. Memory supports explicit remember,
  search, list, update, archive and separately enabled permanent deletion.
- Existing Telegram and TMA AI routes use the same Brain. Private Telegram write
  commands express consent; TMA previews changes and requires a signed,
  user/request/action-bound confirmation. Retries retain their request identity.
  Current commands and quick finance handling retain their behavior.
- Existing Gemini planning remains the fallback for permitted planning queries.
  Optional read-only classification reuses that service's client and quotas.
  Memories, earlier conversation and tool results are excluded from provider
  history in assistant mode. Health/finance assistant tools remain disabled.
- The existing TMA AI screen shows results, source freshness, confirmation,
  errors and retry controls. No unrelated screen redesign was introduced.
- New unit, HTTP/auth, regression and disposable PostgreSQL tests cover routing,
  schemas, ownership, prompt injection, confirmation binding, forecasts, known
  commitments, reminders, deletion, rollback and concurrent retries. The SQL
  runner is included in CI.

`server.ts` and `lifeos-store.ts` receive small integration hooks. Existing LMS
authentication/encryption, syllabus formulas, grade notification deduplication
and worker scheduling logic were not replaced or modified. Reminder writes use
the existing queue and delivery worker; no competing scheduler/provider exists.

## Migration and configuration

Exactly one new additive migration:

`supabase/migrations/20261011084249_assistant_brain_persistence.sql`

It adds `assistant_memories`, `assistant_actions` and the service-role-only
`assistant_execute_mutation` RPC. Both tables have RLS; browser table writes and
RPC execution are revoked. Existing migrations are unchanged.

Backend-only configuration, documented in both `.env.example` files:

| Variable                                  | Default | Purpose                                                            |
| ----------------------------------------- | ------- | ------------------------------------------------------------------ |
| `LIFEOS_ASSISTANT_ENABLED`                | `false` | Enables the Brain and deterministic tools.                         |
| `LIFEOS_ASSISTANT_CONFIRMATION_SECRET`    | empty   | Random secret of at least 32 characters, required for TMA writes.  |
| `LIFEOS_ASSISTANT_MEMORY_DELETE_ENABLED`  | `false` | Enables explicit permanent deletion.                               |
| `LIFEOS_ASSISTANT_CLASSIFICATION_ENABLED` | `false` | Enables optional Gemini classification for supported public reads. |

Existing Supabase backend settings are reused. Existing `LIFEOS_AI_*` and
`GEMINI_API_KEY` settings continue governing Gemini; deterministic tools do not
require Gemini credentials. No real credentials were added or changed.

## Verification

| Check                                             | Actual result                                                                                                                                                                                                                      |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `corepack pnpm typecheck`                         | Passed; core/bot, TMA and Web TypeScript checks completed.                                                                                                                                                                         |
| `corepack pnpm test`                              | Passed: **951 tests in 60 files**, including existing regressions.                                                                                                                                                                 |
| `corepack pnpm test:workers`                      | Passed: **208 tests**, using the isolated Python environment described below.                                                                                                                                                      |
| `corepack pnpm --filter @lifeos/tma build`        | Passed; Vite reported its main-chunk size warning at 548.71 kB.                                                                                                                                                                    |
| `corepack pnpm --filter @lifeos/web build`        | Passed.                                                                                                                                                                                                                            |
| `bash supabase/tests/test-assistant-migration.sh` | Passed in disposable PostgreSQL 15: schema/grants, RLS/owner isolation, credential rejection, CRUD/archive/permanent deletion, retry/no resurrection, denied browser mutations, atomic rollback and simultaneous reminder retries. |
| `git diff --check`                                | Passed.                                                                                                                                                                                                                            |

Worker tests ran with
`PATH=/tmp/lifeos-assistant-worker-tests/bin:$PATH corepack pnpm test:workers`.
The temporary environment installed the existing university/ICS requirements;
its initially resolved SoupSieve 3.0.1 failed ordinary CSS selectors. Pinning
SoupSieve to 2.7 in that temporary environment made all 208 tests pass, and
`pip check` passed. Repository dependency files and service environments were
not changed. A fresh unconstrained worker dependency install may need the same
dependency compatibility follow-up.

An intermediate Vitest run concurrent with both builds exceeded an existing
HTTP test's five-second timeout. After builds finished, the complete suite
passed without changing that test or its timeout. Final test/build logs were
retained locally under `/tmp/lifeos-assistant-*.log`; these temporary logs are
not committed.

## Release boundary and remaining limits

No hosted migration, deployment, service restart, production environment change
or live provider call was performed. Tests exercise mocked external clients and
real disposable local PostgreSQL, not production integrations.

See [ASSISTANT_ROLLOUT.md](ASSISTANT_ROLLOUT.md) for the feature-flagged rollout,
examples, disable procedure, rollback and detailed limits. Explicit operator
approval is still required to apply the hosted migration, deploy code, restart
services or enable production flags. Disabling `LIFEOS_ASSISTANT_ENABLED` leaves
the existing Gemini assistant available under its existing configuration. Code
rollback reverts the dedicated integration commit while retaining additive
memory/audit tables and any already-created ordinary reminders.

Sensitive-data filtering is heuristic; limits are per process. Results depend
on saved/synced data, and grade changes use the existing seven-day notification
ledger. Forecasts use saved calculator scenarios, not unsaved drafts or invented
scores. Availability covers known commitments in the existing planning window.
