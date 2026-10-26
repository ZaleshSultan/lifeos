# Security hardening phase 2

This change depends on [PR #5](https://github.com/ZaleshSultan/lifeos/pull/5),
which remains open. Branch `codex/security-hardening-phase-2` is stacked on
`codex/security-web-sessions` at `efaacbd1fded650d422c8080ca4236da2e16c0db`.
Do not merge the stack out of order. After #5 merges, retarget to `main-v2`,
check the resulting diff and rerun CI. No production database was inspected or
changed, and no application was deployed during implementation.

## Verified findings

| Finding                                                                                     | Severity                                                  | Evidence and boundary                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Webhook authentication skipped when the configured secret was absent                        | High                                                      | The old handler only compared the secret inside `if (options.webhookSecret)`. Configuration and direct server construction allowed production startup without it.                                                                                                              |
| Wildcard CORS on all JSON and receipt-image responses                                       | Medium                                                    | Arbitrary browser origins could read authenticated responses if they possessed an API credential. CORS never substituted for authentication.                                                                                                                                   |
| Profile owner could edit security fields                                                    | High, conditional on native Supabase authenticated access | The existing owner policy restricted rows, while legacy Supabase grants permitted updates to every column, plus insert/delete. The disposable full-schema fixture reproduced self-promotion, self-reactivation, metadata and Telegram identity edits before the new migration. |
| Unrestricted cleanup SECURITY DEFINER RPC                                                   | Medium                                                    | `purge_expired_google_oauth_state_nonces()` inherited PUBLIC EXECUTE. It can delete expired/consumed nonces across users, not active login credentials. The entity-creation RPC also had a NULL-sensitive claim guard and implicit PUBLIC EXECUTE.                             |
| Health JWT remained authorized after account blocking and could not be individually revoked | High                                                      | Ingestion trusted signature/expiry/userId without reading current profile status or a persisted credential.                                                                                                                                                                    |

The profile finding is **not evidence of a deployed compromise**. Telegram
registration creates Supabase identities using random passwords; Telegram and
web login do not hand out native Supabase JWTs. Native Auth signup settings and
production ACL drift were not inspected. The new SQL protection is useful even
if browser table grants are currently disabled. Application administration uses
trusted service-role paths after Telegram admin checks, not JWT user_metadata.

## Implemented boundaries

- Production configuration and direct server construction require a valid
  webhook secret and reject unsafe TMA dev authentication. The real process's
  production mode cannot be overridden with a development config object.
  Local/test servers may omit the secret, but their webhook returns 503.
- Webhooks accept only POST, exactly one syntactically valid secret header,
  and a timing-safe matching value. Missing/wrong/duplicate headers return 401;
  oversize bodies return 413. Authenticated malformed updates retain the existing
  200 acknowledgement to avoid retry storms. Logs contain update metadata and
  fixed error codes, not raw exceptions or payloads.
- API responses use `Cache-Control: no-store`, `Vary: Origin`, `nosniff` and
  `Referrer-Policy: no-referrer`. TMA preflights allow GET/POST/PUT/PATCH/DELETE;
  health preflights allow POST. Allowed headers are Authorization, Content-Type
  and X-Telegram-Init-Data. Web auth exchange/logout remain server-to-server.
  No credentialed CORS or wildcard origin is enabled. Auth is still required.
- Profiles retain owner RLS. Browser roles can SELECT their profile and UPDATE
  only `display_name`, `timezone`, `locale`. Role/status/Telegram linkage,
  metadata, identity and registration/deletion remain service-owned. Existing
  column grants are removed as well as table grants. Browser TRUNCATE,
  REFERENCES and TRIGGER grants on public tables are removed.
- Existing service-only web, LMS, reminder and bank-reconciliation RPC grants
  remain enforced. OAuth cleanup is service-only; entity creation retains its
  owner check with NULL-safe rejection. Definer search paths put pg_temp last.
  OAuth/LMS safe views already filter by caller identity and remain functional.
- Health tokens keep the existing signed Bearer protocol and 30-day maximum
  lifetime. Each issuance has a 256-bit random nonce and a separate device
  management handle. Only SHA-256 hashes persist in the database. Both current
  profile status and durable credential status are checked on every ingestion;
  outages fail closed with 503. Invalid credentials return 401, cross-user
  payloads 403. Body limits and both existing payload formats are preserved.
- Profile blocking revokes all health devices in the same transaction. Issuance
  takes a profile row lock, so racing issuance cannot survive a committed block.
  Reapproval does not resurrect old credentials. Explicit invalid Bearer auth
  never falls back to Telegram identity. Web session design is unchanged.

## Additive migrations and deployment order

Apply after all existing migrations, including PR #5's
`20261022142222_secure_web_sessions.sql`, in filename order:

1. `20261023025757_harden_profile_privileges.sql`: profile column privileges,
   browser grant cleanup, restricted RPC grants and definer guard/search paths.
2. `20261023030408_revocable_health_credentials.sql`: service-only
   `health_ingest_credentials`, five service-only invoker functions, owner index,
   expiry index, and a profile status trigger. RLS enabled; browser roles have
   no table or function grants; service_role has SELECT/INSERT/UPDATE, no DELETE.

No existing migration files were edited. Existing user data is retained.
Migrations must run as the existing migration owner with privilege to manage
these objects. Deployment remains an operator action:

1. Review/merge #5 before phase 2, take the normal backup, apply migrations.
2. Set `TELEGRAM_WEBHOOK_SECRET` to a cryptographically random Telegram-compatible
   value (`openssl rand -hex 32`), and configure the same value as `secret_token`
   when registering Telegram's webhook. Never put it in a URL or logs.
3. Set `LIFEOS_CORS_ALLOWED_ORIGINS` to exact comma-separated browser origins,
   without paths or trailing slashes, e.g. `https://lifeos.example.com`.
   Include the public TMA origin when TLS terminates at a reverse proxy.
   Additional Vercel/preview origins must be listed explicitly. Non-production
   can list HTTP localhost origins. No wildcard, credentials or `null` origin.
   Empty configuration permits direct same-origin traffic and requests without
   Origin; forwarded headers are not trusted to establish the browser origin.
   Next.js internal server fetches and Android calls do not require CORS grants.
4. Deploy the new backend consistently across replicas, retaining the existing
   `LIFEOS_HEALTH_INGEST_JWT_SECRET`. Do not leave old backend instances serving
   health requests during cutover: they still accept stateless credentials.
5. Reconnect Android devices using a newly generated token from TMA's existing
   Health Connect connection screen. Previously issued stateless tokens return
   401 after cutover. There is deliberately no legacy authorization fallback.
   No Android application update or Bearer/body format change is required.
6. Verify `/web`, login/logout, blocked access, TMA and a synthetic device sync in
   staging. If rollback is needed, keep health ingestion unavailable rather than
   restore an old backend that accepts revoked/stateless tokens. Leave additive
   tables in place; do not delete user data to roll back.

## Device management API

All routes require an active TMA/web identity at the existing API boundary:

- `POST /api/tma/health/ingest-token`: same response envelope and token fields,
  plus `deviceId`; the raw token is returned once, never stored or logged.
- `GET /api/tma/health/devices`: up to 100 most recent device handles and
  created/expiry/revocation timestamps; no token or hash.
- `DELETE /api/tma/health/devices/:deviceId`: idempotent owner-scoped revocation;
  foreign/nonexistent handles yield the same success response and change nothing.
  The next authenticated ingestion using a revoked device fails.

The TMA connection UI continues to issue/copy tokens. Device-list/revoke APIs
are available for clients/operators; a device-management UI is not added here.
To rotate, issue a new credential, update that device, then revoke its old handle.
Blocking the account through the existing admin path revokes every device.

## Verification

All test data is synthetic. The SQL harness creates a fresh local PostgreSQL 15
Docker container, loads **every migration** with realistic anon/authenticated/
service_role roles and legacy grants, reproduces the pre-fix escalation, applies
the fix and checks real permissions. It exercises profile privilege changes,
private task/health/timeline CRUD isolation, safe views, service RPC grants,
health expiry/revocation/block-unblock and concurrent issue-versus-block.

Final local results (2026-10-23):

| Check                                        | Result                                                      |
| -------------------------------------------- | ----------------------------------------------------------- |
| `pnpm typecheck`                             | Passed                                                      |
| `pnpm test`                                  | 635 tests, 52 files passed                                  |
| `pnpm --filter @lifeos/tma build`            | Passed; existing >500 kB chunk warning                      |
| `pnpm --filter @lifeos/web build`            | Passed                                                      |
| `node scripts/test-web-session-smoke.mjs`    | Passed against built Next.js and a local mock backend       |
| `pnpm test:workers`                          | 205 tests passed in isolated venv                           |
| `bash scripts/test-lms-migration.sh`         | Passed                                                      |
| `bash scripts/test-web-session-migration.sh` | Passed, including eight concurrent exchanges and block race |
| `bash scripts/test-security-migrations.sh`   | Passed, full schema/roles plus health block race            |

Initial worker execution failed because the host Python lacked `bs4`; installing
the repository requirements into the temporary venv resolved it. An initial LMS
SQL run reached its old readiness limit before Docker PostgreSQL was ready; the
harness now fails explicitly on readiness timeout, waits up to 120 seconds and
uses the same TCP endpoint for readiness and queries. All three SQL suites
passed after that change. No outstanding local test failures remain.

Reproduce with:

```sh
pnpm typecheck
pnpm test
pnpm --filter @lifeos/tma build
pnpm --filter @lifeos/web build
node scripts/test-web-session-smoke.mjs
pnpm test:workers
bash scripts/test-lms-migration.sh
bash scripts/test-web-session-migration.sh
bash scripts/test-security-migrations.sh
```

Worker tests need the repository's university-sync and ics-sync requirements.
Local validation installs them in an isolated temporary virtual environment;
CI installs the same requirements. The new full-schema SQL test runs in CI.

## Remaining limits

- A stolen device credential is reusable until expiry or revocation. Snapshot
  retries remain valid and idempotent; this is not a per-payload nonce protocol.
- A request authorized before a concurrent block/revoke can finish its current
  write. New requests recheck durable authorization; issuance/block is serialized.
- Service-role credentials remain highly privileged. Native Supabase project
  settings, deployed privilege drift, proxy/header logs, rate limits and HTTPS
  configuration need operator verification; no production secrets were used.
- No hardware Health Connect sync, Android build, Telegram live webhook delivery
  or hosted Supabase/PostgREST integration was run. Android compatibility is
  checked against its source contract and synthetic HTTP regression tests.
- Keep backend/proxy request logging free of Authorization, initData and login
  query strings. Add credential retention cleanup and endpoint rate limiting as
  operational follow-up; no user data cleanup was performed here.

Implementation references: [Supabase column privileges](https://supabase.com/docs/guides/database/postgres/column-level-security)
and [Telegram webhook secret contract](https://core.telegram.org/bots/api#setwebhook).
