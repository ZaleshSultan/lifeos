# Telegram Bot UX

The Telegram bot is the fastest input surface for LifeOS.

## Implemented Commands

- `/start` - onboarding and current availability.
- `/help` - command list.
- `/cap` - quick capture.
- `/task` - task creation.
- `/deadline` - deadline capture.
- `/today` - today timeline preview.
- `/focus` - focus score surface.
- `/health` - latest health mode surface.
- `/healthsync_status` - latest health ingest run status.
- `/mode` - mode capture.
- `/review` - review note capture.
- `/spend` - expense capture.
- `/finance` - finance summary.
- `/workout` - current workout creation/fetch plus TMA open button.
- `/pending` - admin-only pending user list.
- `/approve <telegram_id>` - admin-only approval.
- `/block <telegram_id>` - admin-only block.
- `/users` - admin-only Telegram user list.
- `/obsidian_status <telegram_id>` - admin-only Obsidian settings status.
- `/obsidian_set_vault <telegram_id> <vault_path>` - admin-only per-user vault path setup.
- `/obsidian_enable <telegram_id>` - admin-only Obsidian enable.
- `/obsidian_disable <telegram_id>` - admin-only Obsidian disable.
- `/status` - backend status.

## `/start` Onboarding

`/start` checks `profiles.telegram_user_id` and profile status:

- `active` - welcome back and show `/help`.
- `pending` - tell the user the access request is waiting for approval.
- `blocked` - deny access.
- unknown - create a Supabase Auth user and `profiles` row with `status = 'pending'`, `role = 'user'`, Telegram display metadata, then notify admins from `LIFEOS_ADMIN_TELEGRAM_IDS`.

Admins approve with `/approve <telegram_id>`. Protected commands only run for `status = 'active'`.
The TMA mirrors the same lifecycle through `GET /api/tma/session`: unknown users
see onboarding, pending users see the waiting state, blocked users see a simple
blocked message, and active users see dashboard/integration status.

Set:

```bash
LIFEOS_ADMIN_TELEGRAM_IDS=123456789,987654321
LIFEOS_SIGNUP_MODE=pending_approval
```

The legacy single-user bootstrap still exists for local/dev recovery. If these env vars are set and the sender id matches, the bot attempts to upsert that one profile as active/admin:

```bash
LIFEOS_DEFAULT_USER_ID=your-auth-user-uuid
LIFEOS_DEFAULT_TELEGRAM_USER_ID=your-telegram-user-id
```

If the profile cannot be written, usually because the referenced `auth.users` row does not exist yet, the bot replies with the exact SQL needed to create/update the profile row.

## Obsidian Admin Flow

Admins configure per-user Obsidian routing through Telegram commands:

```text
/obsidian_set_vault 123456789 /srv/lifeos-vaults/user-a
/obsidian_enable 123456789
/obsidian_status 123456789
```

`/obsidian_set_vault` resolves the Telegram id through `profiles.telegram_user_id`
and stores a normalized absolute vault path in `user_obsidian_settings`.
`/obsidian_enable` only works for active users after a vault path exists.
`/obsidian_disable` sets `enabled=false` and `status=disconnected`. Non-admins
receive a generic denial and cannot inspect another user's settings.
After `/obsidian_set_vault` and `/obsidian_enable`, active users see the
path-free Obsidian status card in the TMA dashboard.

## Interaction Principles

- Commands should respond with short, actionable messages.
- Long state belongs in Supabase and backend APIs, not Telegram URLs.
- `/workout` must not serialize full workout state into the TMA URL.
- `/workout` creates or loads the active workout, ensures default exercises/sets exist, and sends a TMA button.
- User resolution is by Telegram user id through `profiles.telegram_user_id`.
- Unknown users should receive a pending approval registration message.

## Health Mode Labels

Bot replies use the public labels:

- `recovery` -> Recovery Mode
- `maintenance` -> Normal-Light
- `baseline` -> Normal
- `growth` -> High Performance

## Webhook Setup

Use a random Telegram webhook secret and set:

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=https://YOUR_BACKEND_DOMAIN/telegram/webhook" \
  -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"
```

The backend validates `X-Telegram-Bot-Api-Secret-Token` when configured.
