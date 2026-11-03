# AI execution safety

LifeOS keeps deterministic planning, reminders, the journal and manual finance flows usable when external AI is disabled or unavailable. The existing Gemini service and backend OpenRouter calls now pass through one backend governor; no provider is enabled by this change.

## Boundary and accounting

The backend constructs one `AiGovernor` with the trusted Supabase accounting adapter. Before any governed provider operation, it atomically reserves estimated input plus maximum output tokens in `ai_execution_reservations`. PostgreSQL enforces user, feature and global UTC-day token/cost limits under one transaction lock. Request IDs deduplicate execution across processes and restarts. A task ID has a durable iteration ceiling, including operations across features. Duplicate requests are refused rather than executed a second time; no private model result is stored as a retry cache.

Reservations are conservative: failures, timeouts and cancellations do not refund potentially billed work. When the provider reports a larger token count, the stored count constrains subsequent reservations. Unknown usage stays unknown. The ledger contains owner, generated correlation/task IDs, feature, counters, estimated cost and status timestamps only; it contains no prompts, conversations, images, cookies, credentials or model responses. Browser roles have no table/RPC access and RLS remains enabled. Missing migrations, storage failure and invalid accounting replies stop external execution before a provider call.

Input accounting uses UTF-8 byte counts as a conservative text estimate, not an exact tokenizer. The existing OpenRouter image path replaces a bounded, single inline image with a 32,768-token reservation estimate rather than counting base64 as text. Image/model pricing and actual tokenization can vary. Output limits are passed to providers and reported overages are rejected and counted. Rate-derived costs are **estimates**, not verified bills or a guarantee of provider spending caps. Set provider-side hard quotas separately through the provider account when available.

The existing assistant executes at most one classified, allowlisted tool for each request. No autonomous tool loop is added. Sensitive writes keep their explicit confirmation and existing atomic receipts. Model text never selects arbitrary SQL, shell commands, user identity or HTTP destinations.

## Process controls

- Two concurrent external operations by default, with a 20-second total governor deadline. Caller cancellation and shutdown propagate AbortSignal.
- A provider that ignores cancellation retains its concurrency slot until its promise settles; it cannot silently free capacity for more paid work.
- Gemini uses the shorter of its configured timeout and the governor deadline. The governor observes the actual SDK promise, including model discovery, so an internal timeout cannot release a still-running request's slot. Late discovery cannot start a generation after cancellation.
- Three consecutive provider failures open the process-local circuit for 60 seconds by default. A successful operation resets the failure counter.
- The governor does not retry operations. The optional [model router](AI_MODEL_ROUTER.md) can perform explicitly authorized, bounded fallback inside one conservative reservation. An explicit new request consumes a new reservation; repeating the same request ID never calls the provider again.
- OpenRouter transport allows only `https://openrouter.ai/api/v1/chat/completions`, refuses redirects, bounds request/response sizes, clamps output and strips untrusted destinations from the interface.
- Existing Gemini per-minute/day/context limits remain in addition to durable reservations, and SDK retries remain limited to one attempt.

Durable token/cost/iteration limits are shared by all connected backend processes. Concurrency and circuit state are process-local; multiple replicas therefore multiply the concurrency limit. External billing can continue after an upstream provider ignores cancellation. Do not claim that aborting the local request guarantees a billing refund.

## Configuration

The optional controls are read on process startup. Invalid safety settings fail closed for external AI without preventing core LifeOS startup.

| Variable                                   | Default / meaning                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------ |
| `LIFEOS_AI_KILL_SWITCH`                    | `false`; `true` stops new calls and the governor shutdown method aborts running work |
| `LIFEOS_AI_EXECUTION_TIMEOUT_MS`           | `20000`, maximum `120000`                                                            |
| `LIFEOS_AI_EXECUTION_MAX_CONCURRENT`       | `2` per process                                                                      |
| `LIFEOS_AI_MAX_REQUEST_TOKENS`             | `100000` reserved tokens per call                                                    |
| `LIFEOS_AI_EXECUTION_MAX_OUTPUT_TOKENS`    | `8192` maximum; individual operations may request less                               |
| `LIFEOS_AI_USER_DAILY_TOKENS`              | `200000` per owner / UTC day                                                         |
| `LIFEOS_AI_FEATURE_DAILY_TOKENS`           | `100000` per owner / feature / UTC day                                               |
| `LIFEOS_AI_GLOBAL_DAILY_TOKENS`            | `1000000` across owners / UTC day                                                    |
| `LIFEOS_AI_MAX_TASK_ITERATIONS`            | `3` per owner / task ID                                                              |
| `LIFEOS_AI_CIRCUIT_FAILURES`               | `3`                                                                                  |
| `LIFEOS_AI_CIRCUIT_COOLDOWN_MS`            | `60000`                                                                              |
| `LIFEOS_AI_USER_DAILY_COST_MICROS`         | Unset; optional estimated cost cap in USD millionths                                 |
| `LIFEOS_AI_FEATURE_DAILY_COST_MICROS`      | Unset; optional owner/feature estimated cap                                          |
| `LIFEOS_AI_GLOBAL_DAILY_COST_MICROS`       | Unset; optional global estimated cap                                                 |
| `LIFEOS_AI_ESTIMATED_INPUT_MICROS_PER_1K`  | Unset; operator-supplied conservative input rate                                     |
| `LIFEOS_AI_ESTIMATED_OUTPUT_MICROS_PER_1K` | Unset; operator-supplied conservative output rate                                    |

No price is invented. If a monetary cap is set but either price rate is absent, the call is blocked. Enabling a money cap after unpriced reservations already exist also blocks that accounting scope until the next UTC day. Token limits always apply. Validate configured rates against every enabled model and keep them current; the global rates should conservatively cover the enabled providers.

For emergency shutdown, set `LIFEOS_AI_KILL_SWITCH=true` in the existing protected bot environment file and restart only the bot through the documented deployment process. Do not echo environment contents. The server's safe status projection exposes safety state without prompts, keys or user records. Disabling provider credentials/features remains an additional opt-out; no provider billing settings are changed automatically.

## Migration and rollback

`20261103020000_ai_execution_budget.sql` is additive. Apply only after backup, isolated validation and the normal release checks. Old academic, financial, health and journal rows are untouched. Application rollback must retain the accounting table and reservations. Do not delete receipts to restore spending capacity, and do not restore an old database snapshot over current data.

`bash scripts/test-ai-budget-migration.sh` creates an isolated offline PostgreSQL 15 container with synthetic owners only. It tests grants/RLS, ownership, duplicate requests, token and estimated-cost caps, task loops, conservative failure accounting and eight concurrent global reservations. Unit tests cover cancellation, providers ignoring abort, missing accounting, malformed replies, circuit opening, partial metering, output overages and fixed-destination transport. No billable provider calls are used by tests.

## Legacy monthly review

The standalone Python monthly-review worker has no shared-governor gateway. Its optional direct OpenRouter path now fails closed even when the legacy AI flag and key are present, returning the deterministic report with `shared_ai_governor_required`. It makes no request to a configured arbitrary base URL. Its original single-user opt-in guard remains enforced. This is a safe fallback, not a claim that worker AI generation is connected or production-verified.

## Unified model router extension

The [router](AI_MODEL_ROUTER.md) retains this governor and ledger. Trusted model
pricing can raise the configured conservative price estimate; it cannot lower an
operator floor. Owner request/day ceilings only tighten operator limits. Router
metadata uses service-only reservation/finish RPCs, so absent migrations stop
provider dispatch. Final provider/model/key aliases, observed usage and cost-source
labels contain no prompts or credentials. Reported higher costs constrain future
requests; failed work is never refunded. Plan usage is a distinct billing path,
not an API credit balance, and remains prepared until consent/eligibility is verified.
