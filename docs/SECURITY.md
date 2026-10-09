# Security

## Secrets

Never commit real values for:

- `SUPABASE_SERVICE_ROLE_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `LIFEOS_HEALTH_INGEST_JWT_SECRET`
- Android bridge endpoint secrets

Only `.env.example` placeholder values belong in the repository.

## Frontend Boundary

Browser apps may use public URLs and public client identifiers only. They must not contain Supabase service-role keys, per-user health session tokens, bot tokens, or vault paths.

## Supabase

- RLS stays enabled.
- Avoid public insert/update/delete policies.
- Prefer service-role access only from backend and trusted worker environments.
- Rotate service-role keys if a local machine or deployment target is compromised.

### Study PDF signed uploads

The backend checks course ownership before signing an immutable
`user_id/course_id/sha256.pdf` path in the private `lifeos-study-syllabi` bucket.
Large PDFs use 6 MiB binary TUS chunks. Signed uploads use
`/storage/v1/upload/resumable/sign` with `x-signature` on POST, HEAD and PATCH;
the plain `/resumable` route instead requires a JWT in `Authorization`.
See the [Supabase signed TUS example](https://github.com/supabase/supabase/blob/master/examples/storage/resumable-upload-signed-uppy/index.html)
and [Storage acceptance tests](https://github.com/supabase/storage/blob/master/acceptance/specs/tus.test.ts).

TUS requests carry no `Authorization` or backend `apikey`: the signed token
authorizes that object. The SDK handles the backend API key when creating the
signature; both `sb_secret_...` and legacy service-role JWT keys can be used in
`SUPABASE_SERVICE_ROLE_KEY`. Never treat a signed upload token or opaque secret
key as an Auth JWT. [Supabase API key formats](https://supabase.com/docs/guides/getting-started/api-keys#known-limitations).
Resume URLs must stay on the same Storage origin and signed route; obsolete
unsigned checkpoints start a fresh signed session without deleting objects.
Full downloaded bytes are checked against SHA-256 and length before DB
registration; repeated imports preserve existing documents and versions.

For the Russian C1 HTTP 400 incident, the JWT route was receiving only
`x-signature`, so Storage parsed an empty Bearer as a JWT (`Invalid Compact JWS`,
role `anon`). This is a client routing fix; do not reapply migrations `00300` or
`00400`, change bucket privacy, or rotate/change env for this fix. After operator
approval, retry from the repository root:

```bash
corepack pnpm exec tsx scripts/import-study-syllabi.ts --env apps/bot/.env --course 'K(RUSSIAN)L51-RU' --apply
```

## Telegram

- Use `TELEGRAM_WEBHOOK_SECRET`.
- Do not use polling in production.
- Keep TMA URLs short and resolve sensitive state through backend APIs.
- Validate TMA `X-Telegram-Init-Data` with `TELEGRAM_BOT_TOKEN`.
- Require `profiles.status = 'active'` before protected bot/TMA operations.
- Allow `GET /api/tma/session` for unregistered, pending, and blocked users
  only after valid Telegram initData; it returns account/integration status but
  no protected LifeOS data.
- `POST /api/tma/register` may create a pending profile for an unknown
  Telegram user after valid initData. Blocked users cannot re-register.
- Restrict `/pending`, `/approve`, `/block`, `/users`, and `/obsidian_*`
  management commands to profile admins or IDs listed in
  `LIFEOS_ADMIN_TELEGRAM_IDS`.
- Keep `ALLOW_UNSAFE_TMA_DEV_AUTH=false` except for local development.

## Google OAuth

- TMA users start OAuth through `GET /api/tma/integrations/google/start`, which
  requires a validated active Telegram profile.
- OAuth callback state is HMAC-signed with `GOOGLE_OAUTH_STATE_SECRET` and
  bound to the LifeOS `user_id`; the callback never trusts a query-string
  `user_id`.
- Tokens are encrypted application-side before being stored in
  `public.user_oauth_connections` and are for service-role backend/worker
  access only. Configure `LIFEOS_OAUTH_TOKEN_ENCRYPTION_KEY` before enabling
  Google OAuth.
- The token table revokes direct `anon`/`authenticated` access. The
  `safe_user_oauth_connections` view contains only token-free metadata and
  filters rows through `lifeos_is_owner(user_id)`.
- TMA/session responses may include `status`, scopes, timestamps, and account
  email, but must never include `access_token` or `refresh_token`.
- Legacy plaintext OAuth token rows must be rotated/reconnected; new writes
  are blocked by app-side encryption and database `enc:v1:` constraints.

## Health Ingest

- Require `Authorization: Bearer <health-session-token>`.
- Treat Health Connect payloads as untrusted input until parsed.
- Store raw payloads only when useful and avoid adding secrets to `raw_payload`.

## Obsidian Worker

- Multi-user routing uses `public.user_obsidian_settings.vault_path`.
- Admins manage settings with `/obsidian_set_vault <telegram_id> <vault_path>`,
  `/obsidian_enable <telegram_id>`, `/obsidian_disable <telegram_id>`, and
  `/obsidian_status <telegram_id>`.
- TMA receives only path-free Obsidian status (`enabled`, `configured`,
  `status`, `mode`, pending queue count), never `vault_path`.
- Vault paths are validated as non-empty absolute POSIX/Windows paths and must
  not contain traversal segments.
- Telegram status replies mask vault paths instead of echoing full local paths.
- `OBSIDIAN_VAULT_PATH` is legacy/dev fallback only and is ignored unless
  `LIFEOS_ENABLE_LEGACY_SINGLE_USER_OBSIDIAN=true`.
- Each configured `vault_path` must be an explicit local path for that user.
- Path traversal is blocked by sanitizer code.
- Worker writes atomically and must not delete files.
- Queue rows without connected settings are deferred without writing.

## Legacy Single-user Workers

- Keep `LIFEOS_ENABLE_LEGACY_SINGLE_USER_GOOGLE_SYNC=false`,
  `LIFEOS_ENABLE_LEGACY_SINGLE_USER_ICS_SYNC=false`,
  `LIFEOS_ENABLE_LEGACY_SINGLE_USER_MONTHLY_REVIEW=false`, and
  `LIFEOS_ENABLE_LEGACY_SINGLE_USER_OBSIDIAN=false` in multi-user production.
- Enable a legacy flag only for local/dev or an explicitly accepted single-user
  deployment.
- Do not describe the Google sync worker, ICS, or standalone monthly review
  integrations as multi-user-safe until they use per-user source ownership and
  output routing. Google OAuth management is per-user, but
  `workers/google-sync` remains guarded legacy until its next migration.
- Obsidian mirror is multi-user-safe only when using `user_obsidian_settings`,
  not the legacy global vault fallback.

## Operational Hygiene

- Use least-privilege deploy tokens where platforms support them.
- Keep production, preview, and local env values separate.
- Review logs before sharing, since webhook payloads can contain personal data.
