# Optional free-only AI routing

Issue #59 extends the existing LifeOS Model Router and `AiGovernor`. This is implemented preparation, not a claim of live free-provider access or model quality. Deterministic LifeOS, manual transcripts, journals and notification scheduling remain independent of AI. No keys, provider consent, production flags or financial authorization are granted by this document.

## Status and activation boundary

`LIFEOS_AI_ROUTER_FREE_PROFILE_ENABLED=false` is the default. With this optional profile enabled, external candidates must be verified fixed Gemini/OpenRouter models with `billing:'free'` and known zero token/request/modality costs. Paid and ChatGPT-plan candidates cannot enter selection or fallback, even if the older paid opt-in exists. The existing router flag, owner provider/category consent, operator limits and global governor kill switch remain enforced. When the profile is off, previously approved paid-capable routing retains its existing semantics.

A requested free profile also suppresses legacy provider bypass: if the main router is still disabled or its configuration is invalid, external calls pause instead of restoring an older paid Gemini/OpenRouter path. Merely enabling the free profile does not authorize any provider call.

The source adds no provider, private-data or real-inference activation. The public examples are unbound and show unknown extra fees as null, which blocks execution. Actual project/account eligibility and endpoint privacy remain unverified. The owner must explicitly approve each provider and data category before a live test, including a zero-priced test. A configured key or a public pricing page is not account eligibility or privacy permission.

## Routing and shared quotas

Keep the existing deterministic rule first. For an approved external workload, the existing owner `tierModels` order can be Gemini free, then an approved fixed OpenRouter `:free` model, then deterministic/manual fallback. All candidates remain on the same billing path. Manual selection never silently substitutes another model.

Two Gemini references do not create two project quotas, and three OpenRouter references do not create three account quotas. Protected credential metadata identifies a shared **opaque quota alias**. References for an overlapping owner/provider/feature scope must use the same alias. Distinct projects can only be configured for disjoint workloads; automated account/project cycling is not a fallback strategy. Raw account/project identifiers and key values are never returned to the browser.

The additive `ai_provider_attempts` bookkeeping belongs to an already reserved `ai_execution_reservations` execution. The same existing governor/accounting lock enforces at most three ordered attempts and the original execution's reserved-token bound. Atomic RPCs pool requests/tokens across owners/keys/models sharing a provider quota alias, including unsuccessful attempts and cancellations with uncertain acceptance. This is not a second agent framework or independent AI spending budget. No failure refunds quota or potentially billed work.

Application quota caps can only tighten during one provider day; a new provider day can accept a newly reviewed cap. Gemini request days use `America/Los_Angeles`, including 23/25-hour DST days. OpenRouter days use UTC. Minute request/token windows are rolling. The existing user/feature/global token, money, iteration, deadline, cancellation and concurrency controls still apply.

Zero model pricing does not lower an existing operator accounting floor. A positive conservative governor price floor can block a zero-money-cap request, and earlier unpriced reservations can keep a scope blocked until its normal accounting reset. Review those limits before activation; never erase receipts, change owner identities or silently reduce global safeguards to make a free trial pass. Reservation estimates and provider invoices remain distinct.

A normalized 429 persists its quota-domain cooldown before fallback. Both integer seconds and an HTTP `Retry-After` date are honored; missing/invalid values use a conservative wait. Very long valid waits require owner/operator review rather than truncation. All keys/models in the exhausted provider are skipped for that request. Only a distinct, already permitted provider can be tried after policy-revision and capability/privacy/cost checks. There is no timed automatic retry. A rejected 401 can use another explicitly scoped key within the same quota; 403, ambiguous acceptance, malformed output, cancellation or revoked consent stops dispatch. Free requests use explicit one-model HTTP attempts for auditable quota accounting rather than hidden OpenRouter model chains.

## Protected reference example

The following is a non-activated example for `LIFEOS_AI_ROUTER_CREDENTIALS_JSON`. Replace the UUID only in protected server configuration. These are five references, not key values or five allowances. The small numeric values are chosen application safety caps, not assertions about the account's actual provider quota. Missing `freeTier` evidence deliberately leaves these routes blocked.

```json
[
  {
    "id": "gemini-primary",
    "provider": "gemini",
    "ownerUserId": "REPLACE_WITH_CANONICAL_OWNER_UUID",
    "features": ["classification"],
    "env": "LIFEOS_GEMINI_KEY_PRIMARY",
    "quota": {
      "domain": "owner-gemini-project",
      "requestsPerMinute": 1,
      "requestsPerDay": 1,
      "tokensPerMinute": 2000,
      "tokensPerDay": 2000
    }
  },
  {
    "id": "gemini-secondary",
    "provider": "gemini",
    "ownerUserId": "REPLACE_WITH_CANONICAL_OWNER_UUID",
    "features": ["classification"],
    "env": "LIFEOS_GEMINI_KEY_SECONDARY",
    "quota": {
      "domain": "owner-gemini-project",
      "requestsPerMinute": 1,
      "requestsPerDay": 1,
      "tokensPerMinute": 2000,
      "tokensPerDay": 2000
    }
  },
  {
    "id": "openrouter-a",
    "provider": "openrouter",
    "ownerUserId": "REPLACE_WITH_CANONICAL_OWNER_UUID",
    "features": ["classification"],
    "env": "LIFEOS_OPENROUTER_KEY_A",
    "quota": {
      "domain": "owner-openrouter-account",
      "requestsPerMinute": 1,
      "requestsPerDay": 10,
      "tokensPerMinute": 2000,
      "tokensPerDay": 20000
    }
  },
  {
    "id": "openrouter-b",
    "provider": "openrouter",
    "ownerUserId": "REPLACE_WITH_CANONICAL_OWNER_UUID",
    "features": ["classification"],
    "env": "LIFEOS_OPENROUTER_KEY_B",
    "quota": {
      "domain": "owner-openrouter-account",
      "requestsPerMinute": 1,
      "requestsPerDay": 10,
      "tokensPerMinute": 2000,
      "tokensPerDay": 20000
    }
  },
  {
    "id": "openrouter-c",
    "provider": "openrouter",
    "ownerUserId": "REPLACE_WITH_CANONICAL_OWNER_UUID",
    "features": ["classification"],
    "env": "LIFEOS_OPENROUTER_KEY_C",
    "quota": {
      "domain": "owner-openrouter-account",
      "requestsPerMinute": 1,
      "requestsPerDay": 10,
      "tokensPerMinute": 2000,
      "tokensPerDay": 20000
    }
  }
]
```

After explicit approval and actual eligibility/terms checks, a protected reference may receive `freeTier:{eligibility:'verified_free',verifiedAt:<actual ISO verification time>,source:<official HTTPS page>,dataPolicy:'public_only'|'no_training_zdr'}`. This is a trusted operator attestation, not an automatically queried provider status. Both this evidence and the free model metadata expire after 24 hours. Never invent an account verification time from the public catalog time. A paid Gemini project cannot be labelled a free project merely because the same model has a free price tier.

A free model row additionally needs `freeCosts:{request:0,image:0|null,audio:0|null}` from reviewed evidence. Unknown costs stay null and block any modality that uses them. Vision capability requires a verified zero image cost; audio capability requires verified zero audio cost. Current free-profile code does not implement audio transport. OpenRouter candidates must be fixed `:free` IDs, have a reviewed nonempty `providerOnly` shortlist and keep `requireZdr:true`. Transport requests also require supported parameters, deny data collection, ZDR and zero request/token price ceilings. If no compliant endpoint exists, manual processing remains available; privacy is not relaxed to get a response.

## Private-data and language limits

Google's unpaid-service terms allow product improvement/human review and prohibit sensitive/confidential/personal input outside their stated regional exception. This owner is not verified to qualify for that exception. Consent does not replace provider terms. Free Gemini therefore accepts only an in-memory proof issued for fixed server-owned RU/KK/EN public format probes. It cannot receive arbitrary owner chat, LMS data, health information, personal voice or captures. Neither a JSON `publicPrompt` flag, source instruction nor model output can issue that proof. The model still needs actual owner/provider consent even for a public probe.

OpenRouter's current public metadata offers fixed zero-token-price text/vision candidates. Language and nutrition quality are not verified by their names or modality flags. A provider may still be unavailable because of its account limits, privacy settings or endpoint capability support. Use approved RU/KK/EN live examples only after separate consent; routine tests use mocks.

Structured capture, meal and LifeOS-answer operations use closed backend-selected JSON Schema presets on compatible free-provider transports, followed by strict local validation. Models cannot select arbitrary schemas, tools, SQL, URLs, owners or executable task references. Capture proposals remain unchecked and require the existing separate confirmation. Native schema output is not authority to write data or a guarantee of truthful content.

The free profile rejects operations without a registered backend schema. The older finance/document adapter has no new free-mode schema preset in this phase and therefore stays unavailable under that profile; deterministic/manual finance remains usable. Approved older API routing is unchanged when the free profile is off.

## Settings and recovery

The existing shared web/TMA AI settings show the optional free-only profile, prepared/unverified provider state, zero-cost badges, local daily request reservations and cooldown/review status. Local counters are conservative LifeOS usage, **not the remaining quota of an entire provider account**; actual provider remaining capacity stays unknown until an explicitly approved metadata diagnostic is performed. Recent model/provider receipts remain in the existing owner-scoped ledger.

Keep `LIFEOS_AI_ROUTER_ENABLED`, paid requests, capture extraction/transcription and meal vision OFF during preparation. A real trial needs its own provider/category consent, current account/model/endpoint evidence, strict zero-price caps and one bounded operation approval. The existing `LIFEOS_AI_KILL_SWITCH=true` stops new governed operations and cancels active work through the established process. Cancellation cannot undo transmitted data or guarantee a provider refund. If a purported free response reports a positive cost, the domain is paused for review; no automatic fallback is attempted after that ambiguous billing event.

Application rollback retains provider attempts/cooldowns and existing execution receipts. Disable the free profile and router/provider-dependent features or apply the existing kill switch before old code runs; never drop quota rows, erase receipts, change aliases to recover capacity, or restore an older production database over newer records. No database migration may be applied before fresh encrypted backup, matching actual isolated restore, rehearsal and compatible artifact rollback checks.

## Optional speech and photo status

The existing paid native OpenAI STT adapter remains separate and OFF. Gemini 3.5 Transcribe documentation advertises a free tier, automatic language detection/code switching, RU/KK/EN and OGG/Opus input, but a compliant personal-audio route and actual account eligibility are not established. Its Interactions transport is not implemented here. OpenRouter audio-input metadata does not establish transcription support, language accuracy or private-audio retention. Retain manual transcripts. Do not enable paid STT or send an owner's audio as a diagnostic.

Existing MealPhotoReview remains the only food-photo flow, with consent, editable estimated calories/macros and separate confirmation. A free image-capable model is preparation metadata, not a live vision result or nutritional measurement. Health-image consent and compliant endpoint/privacy evidence are required before a trial.

## Public evidence and verification

The public OpenRouter catalog was fetched without credentials on November 4, 2026 at 07:57:29 UTC: 455 entries, 14 fixed `:free` entries with zero prompt/completion prices. Prepared candidates include `xingchen-agi/xing4.0-29b-a4b:free` for structured text and `nvidia/nemotron-3.5-super-vl:free` for structured vision. Their endpoint metadata did not establish ZDR/privacy policy. Example metadata never binds a key or authorizes use. Source hashes and full research remain private operational evidence.

Current OpenRouter documentation constants specify 20 RPM and 50 RPD below its purchased-credit threshold, with a higher documented tier. Those constants are not a promise of account availability. Gemini's active limits depend on project/model/tier and must be checked through the approved account. No account status call or real inference was performed for this preparation.

Primary sources: [Gemini rates](https://aistudio.google.com/docs/rate-limits), [pricing](https://aistudio.google.com/docs/pricing), [unpaid-data terms](https://aistudio.google.com/docs/terms#data-use-unpaid), [Flash-Lite capabilities](https://aistudio.google.com/docs/models/gemini-3.5-flash-lite), [transcription](https://aistudio.google.com/docs/transcribe), [OpenRouter models](https://openrouter.ai/api/v1/models), [limits](https://openrouter.ai/docs/api_reference/limits), [official quota constants](https://raw.githubusercontent.com/OpenRouterTeam/docs/main/snippets/exports/constants.mdx), [structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs).

Run focused unit tests for free-only selection, five-reference pooling, 401/429/cancellation/consent failure, stale/unknown prices, malicious JSON and provider unavailability. `bash scripts/test-ai-provider-quotas.sh` uses a disposable network-none PostgreSQL container to verify grants/RLS, existing-execution binding, conservative request/token limits, owner isolation, durable cooldown, Pacific/UTC/DST boundaries and two eight-connection concurrency groups. It reads no production environment and sends no notifications or provider requests. Repository typecheck/unit/build/security/browser and exact-head CI remain release gates; implementation presence alone is not deployment evidence.
