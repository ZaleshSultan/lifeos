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
- Keep `ALLOW_UNSAFE_TMA_DEV_AUTH=false` except for local development.

## Health Ingest

- Require `x-lifeos-ingest-secret`.
- Treat Health Connect payloads as untrusted input until parsed.
- Store raw payloads only when useful and avoid adding secrets to `raw_payload`.

## Obsidian Worker

- `OBSIDIAN_VAULT_PATH` must be an explicit local path.
- Path traversal is blocked by sanitizer code.
- Worker writes atomically and must not delete files.

## Operational Hygiene

- Use least-privilege deploy tokens where platforms support them.
- Keep production, preview, and local env values separate.
- Review logs before sharing, since webhook payloads can contain personal data.
