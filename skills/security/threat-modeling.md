# Threat Modeling for LifeOS

> STRIDE-based review of implemented boundaries and remaining risks. Use with [architecture](../../docs/ARCHITECTURE.md), [security](../../docs/SECURITY.md) and current release evidence.

## System and assets

Untrusted Telegram messages, TMA/WebView input, web browsers, Android measurements and provider output reach the `apps/bot` trust boundary. Next.js holds the browser cookie server-side and forwards authorized requests through a narrow proxy. `packages/core` validates pure rules, `packages/db` owns scoped persistence, Supabase is authoritative and Obsidian is a mirror.

The current host is Debian/systemd behind Cloudflare Tunnel. Bot/API/TMA and Next.js run separately, as do reminder/digest/LMS/mirror workers. Supabase is remote. Prior Railway/Vercel/Arch descriptions are historical alternatives, not the active topology.

Sensitive assets include health/finance/academic history, private journals/photos, OAuth/LMS grants, session/device token hashes, privileged backend credentials, encrypted backups and backup decryption keys. Browser code must not receive service-role/bot/provider credentials. Android receives only its personal health credential; there is no shared APK ingest secret.

## Telegram webhook

| Threat                                  | Existing controls                                                             | Residual risk/review                                                                               |
| --------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Spoofed update/secret comparison attack | Production secret required; exactly one valid header; timing-safe comparison  | A stolen secret can forge delivery; rotate and inspect downstream owner/admin checks               |
| Malicious command text                  | Core parsing, active profile, private-chat/owner checks for private workflows | Review every new command/callback; text is never SQL/shell authority                               |
| Flooding                                | One-MiB body bound and selected feature limits                                | No general shared webhook rate limiter or Telegram IP allowlist is established by current app code |

## TMA API

| Threat                 | Existing controls                                         | Residual risk/review                                                          |
| ---------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Forged identity        | Telegram HMAC and linked active profile                   | Never trust body/query owner IDs                                              |
| Stolen initData replay | Signed `auth_date`: age ≤24 hours, future skew ≤5 minutes | Replay within that window remains possible; no request-wide nonce protocol    |
| Cross-user access      | Resolved `userId` required in user-owned store operations | Service-role mistakes bypass RLS; test negative ownership paths               |
| Cross-origin API reads | Exact configured CORS origins and validated preflights    | CORS cannot authenticate a caller or protect a stolen bearer outside browsers |
| Unsafe local bypass    | Production startup rejects `ALLOW_UNSAFE_TMA_DEV_AUTH`    | Keep local defaults and production environments separate                      |

## Health ingest

| Threat                       | Existing controls                                                              | Residual risk/review                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Stolen/extracted phone token | Personal HS256 token, durable hash, expiry/revocation and active-profile check | Copied credentials work until revoked/expired; revoke the affected device, not historical data          |
| Payload owner substitution   | Owner comes from auth; conflicting supplied identity rejected                  | Valid device credentials can still submit incorrect measurements; provenance is not sensor authenticity |
| Replay/duplicates            | Stable daily/workout/sample upserts                                            | Authorized corrected snapshots may update their source; this is not a per-payload nonce system          |
| Malformed/oversize data      | One-MiB JSON bound and core validation                                         | Review raw-payload retention; return projections rather than raw records                                |

The route also accepts valid Telegram initData. Invalid explicit bearer credentials fail closed. Credential issue/revoke is authenticated and owner-scoped; blocking revokes credentials. Android Keystore/HTTPS-only/no-redirect implementation exists in source, but build/device behavior must be verified separately.

## Web dashboard

| Threat                                           | Existing controls                                                                                           | Residual risk/review                                                                                          |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Public data scraping/stale authenticated layouts | Next proxy checks protected HTML/RSC requests; backend independently resolves live session and active owner | Availability dependency; data already rendered cannot be retracted                                            |
| Login-link replay/session fixation               | Random signed link expires within 120 seconds; atomic one-use exchange for a new opaque session             | Forwarded links or link scanners can use/burn them; redact initial login URLs                                 |
| Copied cookie                                    | Hash-only server storage, expiry, logout and profile-block revocation                                       | Copied active tokens remain usable until expiry/revocation                                                    |
| CSRF                                             | HttpOnly/SameSite cookie; exact Origin on logout and bridge mutations; method/resource allowlist            | New browser mutation routes must adopt the same checks                                                        |
| XSS/provider text                                | React escaping; no raw HTML rendering for model text; cookie HttpOnly                                       | Do not claim a dashboard-wide restrictive CSP is implemented; an XSS can still act through the user's session |
| Frontend credential leakage                      | Server-only cookie forwarding; no service-role access from browser                                          | Public backend URLs are not secrets; actual credentials and response projections require bundle/log checks    |

There is no browser Supabase JWT login requirement in the current design. Web reuses owned `/api/tma/*` contracts through its server proxy; LMS credential mutations remain Telegram-only. [Web session model](../../docs/WEB_SESSIONS.md).

## Database, mirror and workers

- **Elevation/tampering:** service-role access bypasses RLS. Parameterized queries, owner filters, service-only RPC grants and concurrency tests are required. Review native Auth/ACL drift and new migrations against real roles.
- **Disclosure:** token hashes, encrypted grant columns and private backups are still sensitive. Keep trusted service environments private and redact diagnostic exceptions.
- **Mirror traversal/destruction:** server-owned per-user vault roots, symlink/path checks, atomic managed-note writes and fenced queue delivery protect the mirror. It is never the canonical database and the worker must not delete notes.
- **Worker compromise:** Debian host/service compromise can expose privileged data. Verify systemd permissions and rotate compromised credentials. Legacy Google/ICS/monthly workers remain guarded single-user modes; do not relabel them multi-user-safe.
- **Notification leaks/duplicates:** minimize private text, respect opt-in/quiet hours and existing delivery receipts. A provider timeout can leave delivery outcome unknown; do not blindly resend.
- **Recovery failure:** encrypted backup integrity is insufficient without a matching isolated restore and recoverable key. App rollback must never restore an older database over populated history.

## Optional AI and external accounts

Provider output, images, mail, notes and memories cannot grant authority. Keep bounded schema, fixed destinations, explicit writes/confirmations and transactional receipts. Shared durable budgets protect token/cost/task accounting; process-local concurrency/circuits multiply with replicas. Abort may not stop provider billing. Meal analysis needs per-photo consent and separate reviewed save, with manual fallback. AGATA/creator capabilities remain disabled until real contract/account authorization exists; never infer shell, database, email-send or account access from a model suggestion.

## Maintenance

Revisit this model when adding an auth surface, API/mutation, provider, outbound URL, account grant, worker, browser storage mechanism or deployment component. Distinguish code controls, synthetic tests, actual production verification and physical-device evidence. General endpoint rate limiting, dashboard CSP and expired-credential metadata cleanup remain separate follow-up items; avoid claiming protections based on a historical checklist.
