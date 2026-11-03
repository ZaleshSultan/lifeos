# Unified AI Model Router

Issue [#31](https://github.com/ZaleshSultan/lifeos/issues/31), November 3, 2026.

The router extends LifeOS's existing durable AI governor. Deterministic planning,
manual journals, finance rules and the assistant's allowlisted tools remain usable
without a provider. A model cannot grant permissions, choose another owner, issue
SQL, run a shell, or approve a proposed change.

## Implementation and connection status

| Component            | Implemented behavior                                                                                                        | Live status                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Policy and settings  | Auto/manual selection, ordered tiers, capabilities, provider/privacy consent, cost ceilings and bounded fallback            | Mock/unit verification; deployment evidence is in the release report                   |
| Gemini               | Existing key integration plus the unified fixed-destination adapter                                                         | No live inference tested for this feature                                              |
| OpenRouter           | Multiple models on one key, approved `models` arrays, provider/price/privacy filters and separately scoped optional keys    | No live inference tested for this feature                                              |
| Direct OpenAI API    | Fixed official API endpoint and API-key billing                                                                             | Unconfigured unless an operator explicitly supplies a scoped API key                   |
| Direct Anthropic API | Fixed official Messages endpoint, Console API keys only                                                                     | Optional and unconfigured; subscription OAuth tokens are rejected                      |
| ChatGPT plan usage   | Official local OAuth companion, encrypted owner/host-bound transfer, refresh/revoke and strict Responses completion helpers | Prepared, not connected; browser consent and integration eligibility remain unverified |
| Voice                | Policy tier/capability representation                                                                                       | No audio transport or live voice feature enabled                                       |
| `openrouter/auto`    | Documented optional future path                                                                                             | Blocked: its variable-price catalog entry is not a priced approved model               |

A configured key is **not** a successful connectivity or inference test. Settings
say `configured_unverified`; no background paid diagnostic runs. Real requests or
connection tests require explicit owner authorization. No paid request or browser
OAuth flow was initiated during implementation.

## Selection and privacy

Core policy lives in `packages/core/src/ai-model-router.ts`, without I/O. Explicit
workload categories map tagging/deterministic tasks to rules, lightweight
classification to fast, planning/document extraction to balanced, reasoning/code
to advanced, and food images to vision. These are policy labels, not objective
claims about model intelligence. The assistant's existing classification remains
deterministic when routing is enabled.

Automatic mode uses the owner's ordered shortlist, current capabilities,
availability, privacy permissions and price ceilings. A previous conversation
model is a hint, never authority: it is revalidated against the current owner,
tier, task, capabilities, credential scope and settings. Manual mode keeps the
selected model and does not silently choose another model.

Every external data category needs explicit permission for the chosen provider.
Planning uses the existing redacted context and requires general/university
consent. Finance needs general/finance consent; meal photos need general/health
consent plus the existing per-photo confirmation. Existing sensitive-data and
write-confirmation boundaries still apply. Claiming a remote model is "local"
does not waive consent.

Fallback defaults off and is bounded to at most three client attempts. It cannot
cross API/free/ChatGPT-plan billing paths. A provider change needs the owner's
explicit setting and consent for that provider. Before each new outbound attempt,
settings are reread; a changed revision stops dispatch. This cannot undo data
already accepted by a provider or guarantee a billing refund.

OpenRouter model arrays are one HTTP operation using approved models only. Atomic
grouping requires the same credential and identical provider/privacy restrictions.
Price reservations cover the componentwise input/output price ceiling. Requests
set data collection deny, ZDR filtering by default, explicit fallback behavior,
required-parameter support and maximum token/request prices. Provider account
settings still matter: OpenRouter documents that Safety Retention endpoints may
remain eligible under some account policies. The filter is not a legal guarantee
about every recipient's retention practices.

## Spending and receipts

The existing `AiGovernor` remains the only execution governor. It reserves before
provider work, deduplicates request IDs, enforces task iterations and user/feature/
global limits, propagates cancellation, limits output, and retains its existing
concurrency/circuit protections. Providers ignoring cancellation retain capacity
until their actual promise settles.

The router can tighten the owner's daily/request cost ceiling; it cannot reduce
an operator price floor or raise an operator cap. Sequential fallback reserves a
conservative bound for all permitted attempts. An internal OpenRouter model chain
creates one reservation, not one ledger charge for each candidate. Failed or
ambiguous work is not refunded. HTTP 404/503 may use explicitly allowed model
fallback; ambiguous network/body failures stop. HTTP 429 and 403 never rotate
keys. A rejected HTTP 401 can rotate only through the explicitly ordered,
owner/feature-scoped key list, with fallback enabled and the same total bound.

The original `ai_execution_reservations` ledger stores final served model,
provider, safe credential alias, billing path, attempt count, usage and cost
source. No prompts, images, response bodies, keys or OAuth tokens enter this
metadata. Estimated reservations remain conservative even if reported cost is
smaller. Observed higher costs constrain later reservations. Actual provider cost
and a cost calculated from reported tokens are labelled separately. Costs are USD
millionths and estimates are not an external provider billing cap.

Completed replies show actual model/provider, billing path, cost source, latency,
privacy and whether fallback occurred. Failed/partial replies are not represented
as completed answers. Web/TMA keep continuity hints outside the message history;
outbound messages contain only roles/text. Settings show the latest 20 owned
routed receipts, including finance operations. A finance adapter's legacy protocol
name is not used as proof of the served model.

## Operator configuration

All new controls default disabled/zero in `apps/bot/.env.example`:

- `LIFEOS_AI_ROUTER_ENABLED=false` controls the execution router.
- `LIFEOS_AI_ROUTER_PAID_REQUESTS_ENABLED=false` is the operator paid-call gate.
- `LIFEOS_AI_ROUTER_MAX_REQUEST_COST_MICROS=0` and
  `LIFEOS_AI_ROUTER_MAX_DAILY_COST_MICROS=0` are conservative money ceilings.
- `LIFEOS_AI_ROUTER_MAX_OUTPUT_TOKENS=2048` stays under the shared governor limit.
- `LIFEOS_AI_ROUTER_CREDENTIALS_JSON=[]` and
  `LIFEOS_AI_ROUTER_MODELS_JSON=[]` contain server-only configuration metadata. When the model variable is absent, four public catalog examples are visible but disabled, without any credential bindings. Setting an explicit empty array removes those examples.

Existing `LIFEOS_AI_ENABLED`, finance AI and meal-vision opt-outs remain enforced.
The owner must separately authorize paid calls and privacy scopes in saved
settings; checking a box never grants another user's access to operator keys.
A malformed requested router configuration pauses external work instead of
silently restoring legacy billing. When the router is explicitly disabled, its
settings are preparation; the previous server
AI configuration remains authoritative and the UI explains that boundary.

Credentials reference approved environment variable names, not key values:

```json
[
  {
    "id": "personal",
    "provider": "openrouter",
    "ownerUserId": "REPLACE_WITH_CANONICAL_OWNER_UUID",
    "features": ["chat"],
    "env": "OPENROUTER_API_KEY"
  }
]
```

A second project can use `LIFEOS_OPENROUTER_KEY_SECOND`. Equivalent provider
prefixes are `LIFEOS_GEMINI_KEY_*`, `LIFEOS_OPENAI_KEY_*` and
`LIFEOS_ANTHROPIC_KEY_*`. One OpenRouter key already accesses multiple models;
extra keys are for explicit owner/project/workload separation or permitted
rotation, not circumventing quotas. Keys stay in protected server environment
storage. No raw key input, upload, return-after-save or arbitrary base URL exists
in the web/TMA settings API. API-key variables reject JWT/subscription tokens;
Anthropic additionally requires its Console API-key format. Native Claude Code
credentials are never read.

A model manifest entry looks like this (a non-activated example verified against
OpenRouter's public catalog on November 3; recheck before use):

```json
[
  {
    "id": "or-flash",
    "label": "OpenRouter Gemini Flash",
    "provider": "openrouter",
    "model": "google/gemini-3.8-flash",
    "tiers": ["fast", "balanced", "vision"],
    "capabilities": ["text", "json", "vision"],
    "billing": "api",
    "inputCostMicrosPer1k": 825,
    "outputCostMicrosPer1k": 4125,
    "verifiedAt": "2026-11-03T15:06:03Z",
    "source": "https://openrouter.ai/api/v1/models",
    "credentialIds": ["personal"],
    "providerOnly": [],
    "sort": "price",
    "requireZdr": true
  }
]
```

Catalog evidence includes `openai/gpt-5.4-mini` at 750/4500 and
`openai/gpt-6.1-sol` at 2000/10000 USD millionths per 1,000 input/output tokens in
the checked OpenRouter snapshot. These are examples, not preferred models or live
account availability. Capabilities/prices must be verified for the actual route,
including long-context overrides, before activation. Metadata expires after at
most 30 days and is checked again at dispatch; review announced price changes
sooner. Unknown/stale prices or unsupported models fail closed. The public
catalog advertised `openrouter/auto` prices as `-1`, so it is not accepted as a
fixed-price route. Other dynamic `openrouter/` router aliases are also blocked
until their model, privacy and price bounds can be enforced.

## API and schema

Authenticated owner routes:

- `GET/PUT /api/tma/ai/router/settings`: safe snapshot and revision-CAS updates.
- `POST /api/tma/ai/router/preview`: policy preview, zero provider requests.
- Existing `/api/tma/ai/chat` remains the read-only assistant boundary.

The Next bridge allowlists only those resource/method pairs, preserves exact
Origin checks and forwards cookie-derived identity. No credential, OAuth proxy,
arbitrary execution or user-selected owner endpoint is exposed.

Migration `20261103040000_ai_router_settings.sql` adds owner settings with RLS,
service-only access, active-profile checks and atomic revision updates.
`20261103050000_ai_router_accounting.sql` extends the existing ledger/RPCs; old
callers keep their original contracts. New router reservations require the new
RPC before work, so a missing migration stops dispatch. Terminal receipts cannot
be relabelled across billing paths or overwrite earlier usage; legacy receipts
cannot be adopted as router receipts. Unknown plan monetary usage remains
unknown and cannot be treated as API credits.

Run `pnpm typecheck`, `pnpm run test --maxWorkers=1`, and
`bash scripts/test-ai-router-migrations.sh`. The SQL script uses an offline,
disposable PostgreSQL container with synthetic owners; provider unit tests use
mock responses. Browser fixture APIs are separate from actual production checks.
No test needs a provider key, subscription token or billable inference.

## Rollout and rollback

Verify the current production SHA and matching encrypted backup/isolated restore,
then rehearse both additive migrations against an isolated copy of that verified
archive. Preserve existing factual projections and keep provider activation off.
Publish staged web/TMA artifacts only after checks, retaining immutable assets.
Production smoke uses marked temporary owners for settings/CAS, offline previews
and authenticated UI; it must not enable billable calls or authorize OAuth.

New meal provenance values need a compatible rollback reader in both backend and
compiled frontends. The prepared fallback therefore rebuilds the prior release
with only that reader expansion. A fallback must set the existing AI kill switch
before restart, so reverting routing cannot silently restore legacy Gemini
billing or bypass newer privacy choices. Keep all settings, reservations, reviewed
meals and original data; never restore an old database over production. See the
release report for the exact prepared source/build hashes and actual checks.

## Official connections

[ChatGPT plan connection preparation](CHATGPT_PLAN_CONNECTION.md) documents the
local companion, protected VM transfer, consent and remaining eligibility limits.
Identity sign-in and permission to use a ChatGPT plan are separate. ChatGPT plan
allowance is not an OpenAI API-key balance and grants no conversation access.
No production browser callback or imported native Codex/Claude token is used.

Primary references: [OpenAI overview](https://developers.openai.com/siwc/token-sharing-open-source),
[official sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in),
[VM transfer](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms),
[plan request limits](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations),
[OpenRouter fallback](https://openrouter.ai/docs/guides/routing/model-fallbacks),
[provider filters](https://openrouter.ai/docs/guides/routing/provider-selection),
[public catalog](https://openrouter.ai/api/v1/models), and
[Claude Code legal boundary](https://code.claude.com/docs/en/legal-and-compliance).
