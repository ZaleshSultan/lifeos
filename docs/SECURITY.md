# Security

## Secrets

Never commit real values for:

- `SUPABASE_SERVICE_ROLE_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `LIFEOS_INGEST_SECRET`
- Android bridge endpoint secrets

Only `.env.example` placeholder values belong in the repository.

## Frontend Boundary

Browser apps may use public URLs and public client identifiers only. They must not contain Supabase service-role keys, ingest secrets, bot tokens, or vault paths.

## Supabase

- RLS stays enabled.
- Avoid public insert/update/delete policies.
- Prefer service-role access only from backend and trusted worker environments.
- Rotate service-role keys if a local machine or deployment target is compromised.

## Telegram

- Use `TELEGRAM_WEBHOOK_SECRET`.
- Do not use polling in production.
- Keep TMA URLs short and resolve sensitive state through backend APIs.
- Validate TMA `X-Telegram-Init-Data` with `TELEGRAM_BOT_TOKEN`.
- Require `profiles.status = 'active'` before protected bot/TMA operations.
- Restrict `/pending`, `/approve`, `/block`, `/users`, and `/obsidian_*`
  management commands to profile admins or IDs listed in
  `LIFEOS_ADMIN_TELEGRAM_IDS`.
- Keep `ALLOW_UNSAFE_TMA_DEV_AUTH=false` except for local development.

## Health Ingest

- Require `x-lifeos-ingest-secret`.
- Treat Health Connect payloads as untrusted input until parsed.
- Store raw payloads only when useful and avoid adding secrets to `raw_payload`.

## Obsidian Worker

- Multi-user routing uses `public.user_obsidian_settings.vault_path`.
- Admins manage settings with `/obsidian_set_vault <telegram_id> <vault_path>`,
  `/obsidian_enable <telegram_id>`, `/obsidian_disable <telegram_id>`, and
  `/obsidian_status <telegram_id>`.
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
- Do not describe Google, ICS, or standalone monthly review integrations as
  multi-user-safe until they use per-user source ownership and output routing.
- Obsidian mirror is multi-user-safe only when using `user_obsidian_settings`,
  not the legacy global vault fallback.

## Operational Hygiene

- Use least-privilege deploy tokens where platforms support them.
- Keep production, preview, and local env values separate.
- Review logs before sharing, since webhook payloads can contain personal data.
