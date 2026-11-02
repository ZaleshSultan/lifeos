# Optional AGATA boundary

Issue [#25](https://github.com/ZaleshSultan/lifeos/issues/25) is **PARTIAL**. External AGATA analysis and personal-data access are **BLOCKED** until a real service, account authorization and authenticated transport are verified. Deterministic LifeOS and its existing optional Gemini/OpenRouter workflows remain independent.

## Audited implementation

The phase 2 checkout contains no implemented `/api/agata/*` routes, AGATA API-key configuration or AGATA outbound provider. The old `CODEX_PROMPT_agata_phase_a_v2.md` is a historical proposal, including a reminder write, rather than evidence of deployed endpoints. Earlier architecture wording describing an existing authenticated read-only consumer was inaccurate. Requests to those proposed personal-data endpoints continue to return 404.

The separate [AGATA repository](https://github.com/ZaleshSultan/agata) and its [README](https://github.com/ZaleshSultan/agata/blob/main/README.md) were inspected read-only through GitHub on November 3, 2026. The README describes a Windows Python voice assistant using local Ollama. The inspected repository did not establish a deployed, authenticated LifeOS-compatible HTTP service. No AGATA process, vision endpoint, voice integration, TLS identity or negotiated API was verified. No AGATA software or model was installed on the LifeOS server, and no personal records or images were sent to it.

`GET /api/tma/agata/capabilities` is the only new operational surface. It requires the existing signed Telegram or live web session and active profile. Its uncached, credential-free v1 projection reports:

```json
{
  "data": {
    "version": 1,
    "enabled": false,
    "connected": false,
    "state": "verified_service_required",
    "personalDataApi": "not_implemented",
    "outboundAnalysis": "disabled",
    "operations": [],
    "proposedDraftOperations": ["summarize_verified_facts"],
    "writesAllowed": false,
    "credentialsShared": false
  }
}
```

There is no connect action or automatic fallback to AGATA. Query overrides and unsupported operations are rejected. This capability response makes no Supabase personal-data read, provider call or database write.

## Proposed draft contract

`packages/core/src/agata.ts` provides strict, pure v1 request/response validation for a future `summarize_verified_facts` adapter. This is a proposed payload contract, with no network transport or enabled analysis operation. It accepts at most 20 short facts with local references such as `fact-1`, a bounded correlation ID, and a fixed operation/version. It rejects unknown fields, arbitrary destinations, internal ID fields, unsupported operations and oversized inputs.

A response must match the request ID/version/operation, reference only supplied fact IDs, contain bounded draft text and explicitly require review. Tool calls, credential fields, false review flags and extra fields are rejected. The validator cannot prove that model prose is factual or remove every sensitive detail from supplied text. Future callers must minimize and review facts before disclosure and display generated prose as untrusted suggestions. Text can never authorize tools or change LifeOS state.

The fixture request/response test validates that proposed contract without contacting a model. Actual-server HTTP tests verify authenticated capability access, inactive/unlinked user rejection, query/method restrictions, no personal-data reads/writes and no invented personal-data endpoints. These tests do not prove interoperability with an AGATA deployment.

## Requirements before enabling a service

1. Verify an owner-approved AGATA service and its exact HTTPS endpoint, TLS certificate, API version, supported operation and health behavior. Do not infer a vision endpoint from a folder name or README.
2. Provision separate, revocable server-only authentication. Use mTLS or signed requests/responses with a bounded timestamp, nonce/replay checks and key rotation. Never share Supabase credentials, Telegram auth, LMS sessions or health ingest tokens.
3. Allowlist the exact destination and operation; reject redirects, bound bodies and deadlines, and validate correlated responses. Unknown API versions fail closed. No request may select arbitrary HTTP, SQL, shell or filesystem operations.
4. Route calls through the existing backend AI governor: durable owner/feature budgets, cancellation, concurrency/time/iteration limits, circuit breaker and emergency shutdown. Keep the adapter disabled until these protections and outage tests are wired to the real transport.
5. Obtain task-specific data consent, minimize context, retain no raw prompts/images in audit logs, and require separate approval for any future validated LifeOS write. There is no AGATA write capability in this release.
6. Test signatures, replay, wrong owner, cancellation, outages, version skew and real service compatibility with an isolated identity before deployment. Preserve manual and deterministic fallback when AGATA is unavailable.

No new secret, account connection, schema migration or enabled external inference is required for the capability-only release. The operational blocker is a verified, authorized AGATA service and negotiated authenticated transport; setting an arbitrary URL or API key cannot enable one.
