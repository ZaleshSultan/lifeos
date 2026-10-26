# Revocable Telegram-to-web authentication

## Verified root cause

On `main-v2`, `/web` signed a deterministic 30-day bearer token containing a
user ID and timestamps. `/login` checked `/api/tma/session`, then put the same
URL credential into `lifeos_web_session`. Nothing tracked consumption or
revocation. `/logout` only expired the browser cookie, so a copied cookie or
login URL remained usable. Protected TMA resource routes already checked the
current profile status; the session-status path accepted signed web tokens
without requiring an active profile. Older audit text saying there was no web
authentication predates this implementation.

## Flow and trust boundaries

1. An active Telegram user sends `/web` in a private bot chat. The bot generates
   an HMAC-SHA256 login token with a random 256-bit nonce, explicit `web_login`
   purpose, owner, issuance time and at most 120 seconds of validity. It stores
   only the SHA-256 token hash before sending the existing `/web/login?token=...`
   URL. Group chats receive instructions to use a private chat.
2. Next.js sends that credential in the Authorization header of
   `POST /api/web/auth/exchange`. The bot verifies the signature, purpose and
   timestamps before calling the database. The database checks issuance, owner,
   current active profile, expiry and unused status.
3. One transaction consumes the login token and inserts the hash of a new
   cryptographically random 256-bit session secret. Concurrent exchanges have
   one winner. Insert failures roll back consumption. The session expires after
   an absolute 30 days; there is no sliding refresh.
4. Next.js sets the new opaque secret in the existing host-only
   `lifeos_web_session` cookie: HttpOnly, SameSite=Lax, Path=/, Secure in
   production, bounded expiry. Its uncached 303 response redirects to `/web/today`
   without credentials, with `Referrer-Policy: no-referrer`. Failures use a generic
   clean `/web/access?error=invalid` redirect and set no session cookie.
5. The Next.js `proxy.ts` checks all protected requests, including RSC navigation,
   against the backend with caching disabled. Existing backend `/api/tma/*`
   endpoints keep their response contracts and accept the new session via
   `Authorization: Bearer`. Both backend web identity resolvers check persistent
   revocation/expiry and current profile status for every request. Invalid web
   credentials cannot fall through to the dev identity or a second identity.
   Telegram initData flows and Telegram-only LMS restrictions remain unchanged.
6. Same-origin `POST /web/logout` calls `POST /api/web/auth/logout`. The backend
   revokes the caller's session, then Next.js expires the cookie. Logout is
   idempotent. If revocation is unavailable, return 503 and keep the cookie for
   retry rather than report a successful logout. GET cannot log out.

The bot remains the only application service accessing session tables. No
service-role key or signing secret is added to Next.js/browser configuration.
The hash-to-user lookup is an identity resolution operation at the auth
boundary. Resource queries and revocation use that resolved `user_id`; caller
query/body IDs never establish identity. Database errors are replaced with
fixed messages; auth handlers never log credentials, request URLs or bodies.

## Migration and revocation

`20261022142222_secure_web_sessions.sql` is additive and creates:

- `web_login_tokens`: token hash, owner, creation/expiry/consumption timestamps.
- `web_sessions`: session hash, owner, creation/expiry/revocation timestamps.
- Service-only, security-invoker issuance, exchange, lookup and revocation RPCs.
- A profile-status trigger invalidating all existing sessions and unused login
  links when an account becomes non-active. Reapproving it does not revive them.

Both tables have RLS, no browser policies/privileges, explicit service-role
grants and indexes on owner and expiry. Functions revoke default PUBLIC/anon/
authenticated execution. Profile locking orders issuance/exchange against status
changes, so blocking cannot leave behind a newly issued live session.

Administrators can revoke one user's sessions without deleting user data:

```sql
update public.web_sessions
set revoked_at = clock_timestamp()
where user_id = '<auth-user-uuid>' and revoked_at is null;
```

For a compromised account, blocking its profile also consumes unused links.
Rotating `LIFEOS_WEB_SESSION_SECRET` invalidates outstanding links but does not
revoke already exchanged sessions; revoke those separately. No automatic
cleanup job is installed. Expired/consumed/revoked metadata may be purged later
under an explicitly chosen retention policy.

## Deployment requirements (not executed by this task)

1. Review and apply the additive migration before deploying the new bot. No
   existing data or migrations need rewriting. Test first against staging.
2. Keep `LIFEOS_WEB_SESSION_SECRET` high-entropy (e.g. 32 random bytes) on the bot
   only. Set `LIFEOS_WEB_URL` and `NEXT_PUBLIC_WEB_APP_URL` to the same public web
   base including `/web`. Next.js requires a server-side `LIFEOS_API_BASE_URL`.
   Use HTTPS on public and backend connections and `NODE_ENV=production`;
   `ALLOW_UNSAFE_TMA_DEV_AUTH` must remain false in production.
3. Roll out bot and web together, draining old bot replicas. Old stateless
   cookies and outstanding old links intentionally stop working; users send
   `/web` again. Do not run old/new authorization implementations concurrently
   or roll back to accepting reusable signed sessions.
4. At ingress/CDN/APM, omit query strings for `/web/login` and redact
   Authorization, Cookie, Set-Cookie and Telegram reply payloads. Do not enable
   request/response dumps. The initial login URL necessarily carries a bearer
   credential; no application redirect or subsequent URL carries it.
5. Smoke-test `/web`, replay rejection, logout, blocking and cross-user access
   before opening traffic. If deployment fails, keep authentication disabled
   rather than restore stateless token acceptance.

## Validation and limits

Run `pnpm typecheck`, `pnpm test`, `pnpm --filter @lifeos/web build`,
`pnpm --filter @lifeos/tma build`,
`node scripts/test-web-session-smoke.mjs`, and
`bash scripts/test-web-session-migration.sh`. The SQL script creates and removes
its own disposable PostgreSQL container; it never reads project DB credentials.
It verifies actual grants/RLS, expiry, replay, owner isolation, rollback,
block/unblock invalidation, exchanges on eight concurrent connections and a
concurrent exchange versus profile block. The production Next.js smoke test uses
a local mock backend and a clean environment to verify cookie flags, redirects,
HTML/RSC authorization, replay, CSRF, blocking, logout and token-free logs. CI
runs these checks and both frontend builds.

Revocation takes effect on the next authorization check. It cannot retract
already rendered content or cancel a request already authorized before the
revocation committed. Live checks add a database/backend availability dependency
and latency; outages fail closed. An unconsumed link is a bearer credential for
up to two minutes: forwarding it, Telegram/browser compromise, or a link scanner
can use/burn it. A copied active session remains usable until expiry/revocation.
There is no new distributed rate limiter or expired-row cleanup scheduler in
this change. These operational protections remain follow-up work.

Implementation references: [Supabase database API privileges](https://supabase.com/docs/guides/api/securing-your-api)
and [Next.js request proxy](https://nextjs.org/docs/app/api-reference/file-conventions/proxy).
