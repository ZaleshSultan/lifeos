# Unified AI Model Router

Issue [#31](https://github.com/ZaleshSultan/lifeos/issues/31), implemented incrementally from November 3, 2026. Capture extensions are tracked by [Issue #54](https://github.com/ZaleshSultan/lifeos/issues/54).

**November 4 candidate status:** production still runs application **`7ca304bf07b835a57cda004fc0dead2638dba607`**. The Nighthawk 2 native-speech/extraction lifecycle is source implementation with mock/focused coverage, **not deployed or live-provider verified**. Full source QA, exact file/artifact manifest, fresh recovery evidence, promotion and deployed smoke results are **PENDING**. Initial focused results (85 core, 194 baseline speech/router, 21 shared UI tests and an initial isolated SQL check) do not establish full release readiness. Historical deployment evidence remains in [Universal Capture Assistant](UNIVERSAL_CAPTURE_ASSISTANT.md#historical-v1-verified-release--november-3-2026) and the release report.

The router extends LifeOS's existing durable AI governor. Deterministic planning,
manual journals, finance rules and the assistant's allowlisted tools remain usable
without a provider. A model cannot grant permissions, choose another owner, issue
SQL, run a shell, or approve a proposed change.

## Implementation and connection status

| Component                | Implemented behavior                                                                                                        | Live status                                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Policy and settings      | Auto/manual selection, ordered tiers, capabilities, provider/privacy consent, cost ceilings and bounded fallback            | Mock/unit verification; deployment evidence is in the release report                                        |
| Gemini                   | Existing key integration plus the unified fixed-destination adapter                                                         | No live inference tested for this feature                                                                   |
| OpenRouter               | Multiple models on one key, approved `models` arrays, provider/price/privacy filters and separately scoped optional keys    | No live inference tested for this feature                                                                   |
| Direct OpenAI API        | Fixed official API endpoint and API-key billing                                                                             | Unconfigured unless an operator explicitly supplies a scoped API key                                        |
| Direct Anthropic API     | Fixed official Messages endpoint, Console API keys only                                                                     | Optional and unconfigured; subscription OAuth tokens are rejected                                           |
| ChatGPT plan usage       | Official local OAuth companion, encrypted owner/host-bound transfer, refresh/revoke and strict Responses completion helpers | Prepared helpers; runtime adapter/catalog wiring, owner consent and eligibility verification remain pending |
| Capture voice            | Candidate native OpenAI `gpt-transcribe`, duration pricing and shared-governor execution                                    | Mock tested; production transcription/router/paid gates off; real STT unverified                            |
| Capture model extraction | Candidate constrained proposals through existing router, with separate per-record consent                                   | Mock tested, default disabled; no live model request verified                                               |
| Gemini/OpenRouter speech | Official-documentation research for future adapters                                                                         | Prepared research only; no implemented speech transport or real quality test                                |
| `openrouter/auto`        | Documented optional future path                                                                                             | Blocked: its variable-price catalog entry is not a priced approved model                                    |

A configured key is **not** a successful connectivity or inference test. Settings
say `configured_unverified`; no background paid diagnostic runs. Real requests or
connection tests require explicit owner authorization. No paid request or browser
OAuth flow was initiated during implementation.

## Selection and privacy

Core policy lives in `packages/core/src/ai-model-router.ts`, without I/O. Explicit
workload categories map tagging/deterministic tasks to rules, lightweight
classification to fast, planning/document extraction to balanced, reasoning/code
to advanced, and food images to vision. These are policy labels, not objective
claims about model intelligence. The assistant's existing command classification remains
deterministic when routing is enabled. The separate capture extraction/speech
operations described below use the existing `classification` credential and
governor feature scope; that name is not permission for ordinary chat or tools.

Automatic mode uses the owner's ordered shortlist, current capabilities,
availability, privacy permissions and price ceilings. A previous conversation
model is a hint, never authority: it is revalidated against the current owner,
tier, task, capabilities, credential scope and settings. Manual mode keeps the
selected model and does not silently choose another model.

Every external data category needs explicit permission for the chosen provider.
Planning uses the existing redacted context and requires general/university
consent. Finance needs general/finance consent; meal photos need general/health
consent plus the existing per-photo confirmation. Existing sensitive-data and
write-confirmation boundaries still apply. Capture external extraction and speech
require all four privacy categories (`general`, `university`, `health`, `finance`)
because one capture can mix them. Model extraction sends the capture text plus
bounded permitted planning context (reference date/timezone, known-schedule
status, commitments, deadlines and warnings); it does not append saved health
facts or raw memory/preferences. The per-record disclosure includes that planning
context. Claiming a remote model is "local" does not waive consent.

General text-route fallback defaults off and is bounded to at most three client attempts. It cannot
cross API/free/ChatGPT-plan billing paths. A provider change needs the owner's
explicit setting and consent for that provider. Before each new outbound attempt,
settings are reread; a changed revision stops dispatch. Capture native speech
uses one provider attempt without automatic retry, key rotation or post-dispatch
provider fallback. Capture model failure can keep deterministic proposals with an
explicit warning rather than silently spend on another model. Cancellation cannot
undo data already accepted by a provider or guarantee a billing refund.

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

## Capture voice activation: owner and operator steps

This section describes preparation and the remaining activation sequence. It is
not authorization to enable a flag, spend money, use an existing Gemini key for
voice, or reuse a subscription token. The candidate native adapter accepts only
OpenAI **`gpt-transcribe`** at the fixed
`https://api.openai.com/v1/audio/transcriptions` endpoint. ChatGPT plan allowance,
ordinary API billing and legitimate native Claude Code development use remain
separate. No ChatGPT/Codex/Claude OAuth token is used as its API key.

1. Obtain the owner's explicit financial authorization for the intended provider,
   data categories, request/daily limits and bounded real test. Keep router/paid
   and capture extraction/transcription flags off while reviewing configuration.
   Provider/browser consent cannot be inferred from a model suggestion or an
   existing key. The separate official ChatGPT connection still needs its own
   explicit browser consent and eligibility check.
2. Store a legitimate API key in protected server environment storage. Add only a
   reference in `LIFEOS_AI_ROUTER_CREDENTIALS_JSON`, scoped to the actual canonical
   owner and `classification`. Do not put the key in either browser, a URL, this
   manifest, git, a test fixture or public evidence.
3. Verify the actual provider model, account availability, capabilities, current
   price and data-processing policy from official sources. Add an owner-bound
   catalog row to `LIFEOS_AI_ROUTER_MODELS_JSON`. Audio-only rows use **null token
   prices**, not invented zero token prices; their positive duration rate supplies
   the cost estimate. Metadata expires after at most 30 days and fails closed
   when stale; verify earlier after an announced change.
4. Save owner settings with `openai` allowed, tier `voice` allowed and the row ID in
   `tierModels.voice`. In manual mode the selected model must also be that approved
   voice model. Grant the chosen provider privacy consent for **all four** data
   categories and explicitly set `spending.paidCallsAuthorized`. An unrelated
   chat credential or permission is insufficient.
5. Set operator and owner per-request/daily money caps and shared governor
   user/feature/global budgets to an explicitly approved amount that covers the
   full conservative reservation. Token, output, concurrency and circuit limits
   must also permit the operation. The owner cannot raise an operator cap.
6. Only after authorization, current configuration review, source QA and safe
   release verification may the operator activate the needed router/paid and
   capture feature gates. A model-extraction gate is separate from transcription;
   enabling either does not authorize a request. Keep unrelated features off.
7. On an eligible owned capture, obtain fresh record-specific consent using the
   current capture revision and stable request ID. The server binds the operation
   to owner/capture/revision, settings/policy and a short-lived durable lease,
   rechecking those permissions before download/dispatch. A result stays an
   unchecked review draft. Real provider success must be verified separately
   before changing documentation from `configured_unverified` to working.

Credential-reference example, **not an activated configuration**. Replace the
owner placeholder only with the canonical owner resolved at the existing auth
boundary; `env` names a protected value and does not contain one:

```json
[
  {
    "id": "capture-speech-owner",
    "provider": "openai",
    "ownerUserId": "REPLACE_WITH_CANONICAL_OWNER_UUID",
    "features": ["classification"],
    "env": "LIFEOS_OPENAI_KEY_CAPTURE_SPEECH"
  }
]
```

Matching audio-only catalog example; the timestamp placeholder is intentionally
invalid until a fresh official-source review has actually happened:

```json
[
  {
    "id": "capture-speech-native",
    "label": "OpenAI capture speech",
    "provider": "openai",
    "model": "gpt-transcribe",
    "tiers": ["voice"],
    "capabilities": ["audio"],
    "billing": "api",
    "inputCostMicrosPer1k": null,
    "outputCostMicrosPer1k": null,
    "audioCostMicrosPerMinute": 4500,
    "verifiedAt": "REPLACE_WITH_ACTUAL_REVIEW_ISO_TIMESTAMP",
    "source": "https://developers.openai.com/api/docs/models/gpt-transcribe",
    "credentialIds": ["capture-speech-owner"],
    "providerOnly": []
  }
]
```

The official [model page](https://developers.openai.com/api/docs/models/gpt-transcribe)
and [pricing table](https://developers.openai.com/api/docs/pricing) list
**USD 0.0045/minute** at the November 4 review. The catalog uses USD millionths,
so `audioCostMicrosPerMinute:4500` reserves the entire **120-second** application
limit: **9000 microUSD (USD 0.009)** at that rate, regardless of sender duration
metadata. The adapter rejects a rate below its reviewed minimum. The shared
governor reserves the **larger** of the duration estimate and its configured
token-price floor, so 9000 is not a promise of the final reservation, provider
invoice or sufficient budget. Missing provider usage remains unknown and retains
the conservative reservation; it is not counted as free. Failed/ambiguous work is
not automatically refunded.

These controls remain disabled in the source examples and current deployment:

```dotenv
LIFEOS_AI_ROUTER_ENABLED=false
LIFEOS_AI_ROUTER_PAID_REQUESTS_ENABLED=false
LIFEOS_CAPTURE_AI_EXTRACTION_ENABLED=false
LIFEOS_CAPTURE_TRANSCRIPTION_ENABLED=false
```

`LIFEOS_AI_ROUTER_MAX_REQUEST_COST_MICROS` and
`LIFEOS_AI_ROUTER_MAX_DAILY_COST_MICROS` are operator ceilings; saved
`spending.maxRequestCostMicros`/`maxDailyCostMicros` can only tighten them.
Zero/unavailable budget blocks dispatch. No step in this implementation changed
production flags, owner spending/privacy settings or provider credentials.

## Capture external lifecycle and safety

`AiModelRouter.prepareSpeech` selects from the owner voice shortlist using
classification-scoped credentials, all four privacy categories, current metadata
and paid consent. It prepares a **single** bounded execution through the existing
`AiGovernor`. `transcribeCaptureVoice` is that execution boundary, including
Telegram download; no second agent framework or automatic worker dispatch exists.
The existing governor keeps token/cost/user/feature/global limits, idempotency,
concurrency, timeout, circuit and cancellation protections.

The candidate validates the complete bounded Ogg/Opus stream, including
single-stream sequence, headers, CRC and packet-derived duration, before provider
dispatch. The limit is 5 MiB/120 seconds; sender duration alone is insufficient.
No media executable is launched. Audio stays in memory and server-only Telegram
references expire within 24 hours; references, tokenized URLs and file IDs do not
enter browser projections, router receipts or public logs. Owned byte arrays are
cleared after processing, although native multipart creates a transient Blob copy
managed by the runtime; there is no guarantee of zeroing every garbage-collected
copy.

The fixed native request uses an extension-bearing `voice.ogg` multipart file,
`model:gpt-transcribe` and JSON response format. The adapter does not accept an
arbitrary endpoint, audio URL/path or upload to a persistent Files API. It bounds
response bytes/transcript size and validates safe text/optional language codes.
It does not invent an unsupported `max_output_tokens` parameter for the native
transcription API. See the [official transcription reference](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create).
No real RU/KZ/EN transcription accuracy was tested.

The owned capture API adds three fixed POST resources; the existing authenticated
web bridge allowlists those exact methods/paths:

- `/api/tma/captures/:id/correct`: `{expectedRevision,instruction}`; bounded
  deterministic correction, stable pending IDs, successful receipts preserved,
  no implicit approval. Unclear/no-op corrections return
  `capture_correction_unclear`.
- `/api/tma/captures/:id/reject`: `{expectedRevision,actionId}`; pending proposal
  rejection without touching already approved records.
- `/api/tma/captures/:id/external`:
  `{expectedRevision,requestId,mode:"model"|"transcription",confirmed:true}`;
  explicit one-operation consent and durable claim before governed work.

After claim, the API returns actual `processing` while a bounded existing
executor continues. Server-persisted `processingStage` is `extracting` or
`transcribing`; `transcriptSource` is `manual` or `provider` only when saved that
way. An already-present transcript cannot be sent for repeat transcription.
Polling reads durable results. Cancel uses the current revision on the existing
`/cancel` endpoint; archive/delete/stop also abort work. Revision/lease fencing
prevents a late completion from resurrecting cancelled/deleted history.
Previously succeeded actions block another external pass. No automatic paid
retry or restart redispatch occurs.

Model extraction uses constrained text/JSON proposals through the existing router,
with source and bounded permitted planning context disclosed at consent. Saved
health facts and raw memory/preferences are omitted. All four data-category
permissions remain necessary. The same `classification` credential/governor scope
applies; a route with `chatgpt_plan` billing is not accepted by this capture path.
Provider/model output cannot create tools, SQL, shell commands, owner changes,
automatic memories or action approvals. Failed/invalid extraction can retain the
deterministic baseline with `capture_model_fallback`; it never silently retries
another paid provider. Safe failure and manual-transcript review remain usable.

Optional action presentation/provenance fields are stored separately from
executable arguments. The additive candidate v2 projection supplies them without
changing the old v1 public RPC shape. Full candidate migration/rollback and
production evidence remain pending; additive compatibility is not permission to
skip a matching backup/isolated restore.

## Speech alternatives and existing nutrition review

| Option                          | Preparation                                                                                                                         | Implemented/live status                                     |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Native OpenAI `gpt-transcribe`  | Fixed native multipart transport; duration metadata; governor/consent/cancel tests                                                  | Candidate mock tested, disabled; no real owner audio result |
| Gemini `gemini-3.5-transcribe`  | Official documentation covers multilingual audio; future inline adapter must force `store:false` and avoid persistent Files/history | Research only; no adapter or quality test                   |
| OpenRouter native transcription | Official endpoint research; privacy/routing/timeout differences require a dedicated review                                          | Research only; no adapter/model-price/quality verification  |

Primary references are [Gemini transcription](https://aistudio.google.com/docs/transcribe),
[Interactions lifecycle](https://aistudio.google.com/docs/interactions-overview)
and [OpenRouter transcription](https://openrouter.ai/blog/tutorials/transcription-on-openrouter/).
Existing chat keys do not authorize voice. In particular, OpenRouter's speech
endpoint does not apply chat provider order/fallback/sort controls, so a future
adapter must fail closed when required provider pinning cannot be enforced. No
chat-shaped workaround is presented as a working STT integration.

The existing web/TMA meal-photo workflow remains separate: capability check,
local image preparation, explicit per-photo external-analysis consent, estimated
editable draft and separate explicit confirmation through existing nutrition
storage. Unknown macros stay unknown and an estimate is not a measurement. No new
photo inbox, vision request or meal write was performed by this candidate work.

Read the [capture guide](UNIVERSAL_CAPTURE_ASSISTANT.md#owner-activation-and-the-outstanding-real-test)
for the outstanding genuine Telegram/owner-consent/three-card/DBMS-only/replay,
cancellation and manual-fallback acceptance sequence. Source fixtures and mock
responses do not replace it.

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
