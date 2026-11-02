# API Security Guidelines

> Applies to the existing Node HTTP backend and Next.js web bridge. Read [authentication](auth-security.md) and the current [architecture](../../docs/ARCHITECTURE.md) before changing trust boundaries.

## Route boundaries

| Route family                                | Authentication / access                                                                                    | Input and transport                                                                       |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `GET /healthz`                              | Public safe health projection                                                                              | No user records or secrets                                                                |
| `POST /telegram/webhook`                    | Exactly one valid webhook secret header, timing-safe match                                                 | Bounded JSON, production secret required                                                  |
| `/api/tma/*`                                | Valid signed Telegram initData or live opaque web session where allowed; active profile for protected data | One-MiB JSON cap, exact configured CORS origins                                           |
| LMS session mutations                       | Genuine Telegram initData only                                                                             | Owner-bound encrypted credentials and validated leases                                    |
| `POST /health/ingest`, `/api/health/ingest` | Registered personal health Bearer credential or valid TMA initData                                         | Core validation; no shared APK ingest secret                                              |
| `POST /api/web/auth/exchange`               | Signed issued one-use login token                                                                          | Creates a new opaque session; no general web summary API duplication                      |
| `POST /api/web/auth/logout`                 | Caller web session                                                                                         | Durable revocation; no other user's session selected by client ID                         |
| `/web/api/bridge/*`                         | Next server reads HttpOnly cookie and backend independently validates it                                   | Explicit method/resource allowlist, exact Origin on mutations, bounded JSON, no redirects |
| `/tma/*`                                    | Public static shell/assets                                                                                 | Protected data remains behind backend auth                                                |

Session/registration status are explicit exceptions: valid Telegram callers can discover their pending/unregistered/blocked state without reading protected records. Safe LMS connection/work reads may use web auth; credentials cannot. Do not broaden these exceptions when adding routes.

## Authentication and ownership first

Call the existing auth resolver before accessing user data. Pass only its resolved `user.userId` into store methods. Body/query IDs are resource selectors, not authority. Explicit invalid Authorization must fail closed rather than fall back to Telegram/dev identity. Native Supabase identity remains canonical, but the current web design does not require browser Supabase JWTs or direct browser database reads.

Keep business validation in pure core and persistence/RPC access in the DB package. Extract route modules for substantive additions rather than expanding the server monolith. Sensitive writes retain their backend confirmation and atomic idempotency/revision checks.

## Requests and responses

- Preserve `{ data: T }` and stable `{ error: code, message?: safeText }` envelopes. Never return stack traces, raw provider/database diagnostics, cookies or private configuration.
- Bound JSON before parsing, reject unsupported enums/types/dates, and validate resource identifiers. Use the existing per-adapter image type/size/dimension checks; this is not a universal file-security guarantee.
- Return health projections rather than `raw_payload`. Return private receipt content through its authorized existing boundary; never expose storage keys or vault paths.
- Private API responses are no-store. Do not describe authenticated health/finance summaries as publicly cacheable. Static hashed assets may be immutable while HTML remains fresh.
- Validate wrong methods explicitly. Existing route matching can return 404 where no handler exists; do not falsely claim every wrong-method path already returns 405.

## CORS and browser CSRF

`cors.ts` implements exact `LIFEOS_CORS_ALLOWED_ORIGINS`, direct same-origin handling and validated preflights for TMA/health API families. Production configuration accepts exact HTTPS origins; local loopback HTTP is permitted only outside production. There is no wildcard API origin policy. A TLS-terminating proxy must configure its actual public frontend origin; forwarded headers do not establish trust.

CORS is transport policy, not authentication. Backend ownership checks are required for non-browser clients too. The Next web bridge forwards only cookie-derived identity, refuses caller-supplied backend URLs/identity headers, checks exact Origin on mutations and rejects cross-site mutation fetches. Logout also checks Origin. Preserve these rules on new web routes; SameSite alone does not protect against all sibling-host requests.

## Limits and external calls

Existing Gemini/assistant/LMS controls apply to their own operations. The shared AI governor reserves durable token/cost/task budgets, bounds provider concurrency/time/output, propagates cancellation and fails closed without accounting. OpenRouter/Telegram adapters use fixed destinations and reject redirects. Consent is required before external meal-photo analysis, and its result stays a draft until reviewed save.

There is no repository-wide distributed rate limiter for every webhook/TMA/health endpoint. Do not claim Cloudflare ingress rate controls exist without inspecting actual configuration. Review general authenticated abuse/endpoint throttling separately from AI cost budgets. Legacy operator-configured ICS feeds need their own outbound URL/redirect review before being exposed to users.

## Verification and operations

The current deployment is Debian/systemd with Cloudflare Tunnel, not a presumed Railway/Vercel deployment. Verify the actual service/build SHA, environment, backup/restore and rollback evidence before release.

For substantive changes run TypeScript/unit/API checks, relevant worker/migration tests and frontend builds/browser scenarios. Negative coverage includes expired/future initData, invalid/revoked/blocked identities, wrong owners, invalid-origin CSRF, oversized bodies, concurrent/retried writes, provider failures and sanitized errors. Existing coverage lives in bot security/route tests, web bridge/proxy/login/logout tests and isolated SQL/browser harnesses. Keep runtime verification claims separate from fixture results.

See [web dashboard](../../docs/WEB_DASHBOARD.md), [health contract](../../docs/HEALTH_BRIDGE_CONTRACT.md), [AI safety](../../docs/AI_EXECUTION_SAFETY.md) and [operations](../../docs/OPERATIONS.md).
