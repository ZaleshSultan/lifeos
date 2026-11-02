# Authentication & Authorization Security

## Identity and trust boundary

`auth.users.id` is the canonical LifeOS owner, linked through `profiles.user_id` and unique `profiles.telegram_user_id`. Resolve identity and current profile status at the backend boundary before domain reads/writes. User-owned store methods accept the resolved `userId`; query/body resource IDs never establish identity. Supabase is authoritative and browsers never access it with service-role credentials.

The active infrastructure is Debian/systemd behind the existing Cloudflare Tunnel. Trusted bot/workers hold service credentials; browser apps receive public configuration only. Native Supabase Auth remains the identity root, but current browser login uses LifeOS opaque sessions rather than a Supabase browser JWT.

## Telegram webhook

`POST /telegram/webhook` requires exactly one valid `X-Telegram-Bot-Api-Secret-Token` header and `secureCompare` timing-safe matching. Production configuration/direct server creation reject a missing/invalid secret and unsafe TMA dev authentication. Local servers without a secret return an unavailable webhook rather than accepting unauthenticated updates. Keep `TELEGRAM_WEBHOOK_SECRET` private and re-register the webhook when rotating it.

## Telegram Mini App

`validateTelegramInitData()` verifies the Telegram HMAC with the bot token, requires signed `auth_date` no older than 86,400 seconds and no more than 300 seconds in the future, then resolves the linked profile. Protected operations require active status. Valid signed callers may read their unregistered/pending/blocked session status or register pending approval without receiving protected domain data.

Send `X-Telegram-Init-Data` on API requests; never embed the bot token in a frontend. Freshness bounds replay but does not make each request single-use. TMA initData can be replayed within its accepted lifetime if stolen. LMS credential validation/store/delete operations require genuine Telegram authentication; safe LMS status/work reads may use a valid web session. Do not broaden that exception to credentials.

`ALLOW_UNSAFE_TMA_DEV_AUTH=true` is local-only. Production startup rejects it; never deploy it as an authentication workaround. Invalid explicit web credentials cannot fall through to a Telegram/dev identity.

## Revocable Telegram-to-web login

The private Telegram `/web` command issues a random, signed, purpose-bound login link lasting at most 120 seconds. Its SHA-256 hash is stored before transmission. `POST /api/web/auth/exchange` atomically consumes that link and creates a new opaque random session, stored only by hash, with absolute 30-day expiry.

Next.js stores the session in `lifeos_web_session` with HttpOnly, SameSite=Lax, host-only Path=/ and Secure in production. Login redirects remove credentials; auth/private responses use no-store/no-referrer. Next proxy validates every protected HTML/RSC request, and backend `/api/tma/*` authorization independently checks the persistent session, expiry/revocation and active owner.

Interactive web requests pass through an explicit resource/method allowlist. Cookie-derived identity is forwarded server-side; caller Authorization/identity headers cannot replace it. Mutations and logout require the exact configured public Origin. Logout revokes server-side before clearing the cookie; failure retains the cookie for retry. Profile blocking invalidates sessions and outstanding links; reapproval does not revive them.

A copied live session remains usable until expiry/revocation. Rotating `LIFEOS_WEB_SESSION_SECRET` invalidates login links, not exchanged sessions; revoke those separately. No distributed general rate limiter or automatic expired-row cleanup is implied. See [web sessions](../../docs/WEB_SESSIONS.md) and [dashboard boundary](../../docs/WEB_DASHBOARD.md).

## Personal health credentials

`POST /health/ingest` and `/api/health/ingest` accept a personal HS256 Bearer token or valid TMA initData. Device tokens have at most 30-day validity, random nonce and scope; backend verification checks signature, expiry, persisted SHA-256 credential hash, revocation and the active owner. Explicit invalid Bearer tokens cannot fall through to another identity.

Authenticated Mini App Health issues the token once; storage contains its hash, not the token. Device list/revoke APIs are owner-scoped. Blocking revokes all credentials, and reapproval does not restore them. Android sends no configurable user ID or shared ingest secret. Keystore encryption/HTTPS-only/no-redirect source exists, but APK/physical-device verification is separate. Payloads remain untrusted until parsed by core.

## Authorization, RLS and workers

The backend service role bypasses RLS, so every user-owned query/mutation must filter the resolved owner. RLS, restricted profile columns and service-only token/RPC privileges provide defense in depth; they never excuse omitted application ownership checks. Browser web sessions do not grant direct Supabase table access.

Workers run only in trusted service environments. Per-user reminders/mirror routing and guarded legacy single-user integrations have different scopes. Never infer multi-user safety from service-role credentials alone. Keep shared secrets, OAuth/LMS grants, health tokens and vault paths out of frontend bundles/API projections/logs; issuing a personal health token once to its authenticated connection UI is the explicit exception.

## Bootstrap and review

`LIFEOS_DEFAULT_USER_ID` plus `LIFEOS_DEFAULT_TELEGRAM_USER_ID` support an intentional local/single-user `/start` link. Production registration remains pending-approval; admin operations require profile/admin-ID authorization. Never merge identities or move historical records as an auth workaround.

For changes, test invalid/expired/future credentials, revoked sessions/devices, blocked/reapproved profiles, wrong owners, concurrent login exchange, CSRF and invalid-credential fallback. Keep auth tests and [security operations](../../docs/SECURITY.md) current. Rotate only implicated credentials with their dependent services; preserve encryption keys needed for existing encrypted data and backups.
