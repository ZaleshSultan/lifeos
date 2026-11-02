# OWASP Alignment for LifeOS

> Maps OWASP Top 10 (2021) to inspected LifeOS code. Local controls override historical upstream examples; implementation is not evidence that every deployment setting was verified.

## Trust boundary and topology

Telegram webhook, signed TMA requests, authenticated web sessions and personal health credentials enter `apps/bot`. Web requests pass through the Next.js server; browsers never receive service-role credentials or access Supabase directly. The bot resolves the active owner before user-data operations. Trusted workers and operations tools also hold privileged credentials, so RLS does not replace application scoping.

The current installation is Debian/systemd with Cloudflare Tunnel, bot/API/TMA on local port 3000, Next.js `/web` on 3001, Supabase and a local Obsidian mirror. Railway/Vercel/Arch assets are historical or alternative targets, not current deployment evidence. See [architecture](../../docs/ARCHITECTURE.md) and [operations](../../docs/OPERATIONS.md).

## A01: Broken access control

- Pass resolved `userId` into every user-owned store read/mutation; a guessed resource ID must never establish authority. Identity lookup, public reference data and separately authorized administration have different reviewed boundaries.
- TMA validates Telegram HMAC and current profile status. Session/registration status can be returned after valid Telegram authentication without exposing protected domain records.
- Telegram `/web` creates a one-use, at-most-120-second login link. Exchange creates an opaque, revocable session stored only by hash; backend and Next.js check expiry/revocation and active owner on protected requests.
- Web interactions use an explicit method/resource allowlist and cookie-derived backend authorization. Sensitive LMS session mutations remain Telegram-only; safe LMS reads may use the authorized web session.
- RLS and service-only grants are defense in depth. Review actual schema/ACLs after migrations rather than assuming every legacy table is protected identically.

## A02: Cryptographic failures

- Webhook comparison uses `secureCompare` with `timingSafeEqual`; duplicate/malformed secret headers are rejected.
- TMA uses HMAC-SHA256. Health tokens use signed HS256 plus a persisted credential hash, expiry/revocation and active-owner checks. No shared ingest secret is embedded in Android.
- Web session secrets and login links are stored as SHA-256 hashes. Cookies are HttpOnly, SameSite=Lax and Secure in production; private responses use no-store/no-referrer.
- Existing OAuth/LMS grants use application-side encryption. Android token encryption is implemented in source with Keystore AES-GCM; Android runtime verification remains separate.
- Protect real `.env`, database dumps and encryption keys. Never commit secrets, expose them through browser bundles, or print token-bearing service commands. Public ingress uses HTTPS; verify actual certificates/proxy settings during each release.

## A03: Injection

- Validate structured input through core parsers and scoped Supabase queries/RPCs. No model accepts arbitrary SQL, shell or caller-selected HTTP destinations.
- Treat provider replies, academic titles, notes and mail as untrusted data. React escapes displayed text; Telegram HTML must be escaped before transmission.
- Obsidian routing rejects traversal, symlinks and foreign roots. JSON input is bounded at one MiB; image handling has its own byte/type/dimension bounds.

## A04: Insecure design

Implemented controls include signed TMA `auth_date` freshness (24-hour maximum age, five-minute future skew), exact production CORS origins, active-profile checks, atomic mutation receipts, revision conflicts and per-photo consent/review. CORS is transport policy, never authentication. Stolen initData remains replayable within its accepted lifetime; there is no single-use nonce for every TMA request.

AI calls share durable token/cost/task reservations and process-local concurrency/circuit controls. Missing accounting fails closed. These are configurable estimates/limits, not a verified provider billing cap. [AI execution safety](../../docs/AI_EXECUTION_SAFETY.md).

## A05: Security misconfiguration

Production startup rejects unsafe TMA dev auth and a missing/invalid webhook secret. CORS config accepts exact HTTPS origins; loopback HTTP is allowed only outside production. Check real environment, service permissions, native Supabase auth settings and schema drift at deployment. A config loader is not evidence that unrelated ingress policies were installed.

## A06: Vulnerable components

Run the runtime dependency audit and appropriate tests/builds. Review development-only advisories independently; do not disable controls or force unsupported dependency overrides merely to obtain a clean report.

## A07: Identification and authentication failures

| Surface            | Implemented authentication                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Telegram webhook   | Exactly one valid webhook secret header, timing-safe match                                                                |
| TMA API            | Telegram HMAC, signed freshness and linked active profile                                                                 |
| Web dashboard      | One-time Telegram login exchange; live opaque-session hash lookup and revocation                                          |
| Health ingest      | Personal signed token plus durable credential/owner checks; valid TMA authentication is also accepted by the ingest route |
| Workers/operations | Trusted server credentials, guarded legacy single-user workers                                                            |

Explicit invalid web/health credentials do not fall through to another identity. Logout revokes before clearing the cookie; blocking invalidates existing web/device credentials. Rotation of the web signing secret alone does not revoke exchanged sessions.

## A08: Software and data integrity

Backups require integrity checks and isolated restore evidence before production changes. Keep application rollback separate from database recovery; never replace newer data with an old snapshot during an app rollback. Durable idempotency/conflict checks protect retried writes. Obsidian remains a mirror, with fenced delivery and atomic managed-note writes.

## A09: Logging and monitoring

Use stable public errors and selected safe metadata. Never log Authorization, Cookie, initData, login query strings, raw health records, private photos or provider prompts. Review HTTP/proxy/APM logs as well as application logs. `/healthz` and existing operational monitoring provide distinct health evidence; do not represent public HTTP 200 alone as proof of every worker or database workflow.

## A10: Server-side request forgery

Keep provider/Telegram destinations fixed, reject credential forwarding through redirects and review every new outbound integration. Legacy ICS reads operator-configured URLs and remains guarded; it is not a validated arbitrary-user URL fetch service. Do not claim universal SSRF protection or a global destination allowlist without inspecting the particular adapter.

## Remaining review priorities

1. Preserve owner-scoped queries, credential revocation and consent/confirmation tests on every new path.
2. General webhook/API/ingest rate limiting is not implemented as a shared distributed limiter. Existing LMS/assistant/provider controls cover their own operations only; verify actual ingress protection separately.
3. TMA replay within the freshness window, copied live browser/device credentials and requests authorized before revocation remain explicit limits.
4. A restrictive dashboard-wide CSP, credential metadata cleanup, external offsite backup/key recovery and physical Android behavior require their own verified evidence; do not mark them complete from unrelated checks.

See [security](../../docs/SECURITY.md), [web sessions](../../docs/WEB_SESSIONS.md) and [threat model](threat-modeling.md).
