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
- `/status` - backend status.

## `/start` Bootstrap

`/start` reports the sender's Telegram user id and checks `profiles.telegram_user_id`.

If these env vars are set and the sender id matches, the bot attempts to upsert the profile link:

```bash
LIFEOS_DEFAULT_USER_ID=your-auth-user-uuid
LIFEOS_DEFAULT_TELEGRAM_USER_ID=your-telegram-user-id
```

If the profile cannot be written, usually because the referenced `auth.users` row does not exist yet, the bot replies with the exact SQL needed to create/update the profile row.

## Interaction Principles

- Commands should respond with short, actionable messages.
- Long state belongs in Supabase and backend APIs, not Telegram URLs.
- `/workout` must not serialize full workout state into the TMA URL.
- `/workout` creates or loads the active workout, ensures default exercises/sets exist, and sends a TMA button.
- User resolution is by Telegram user id through `profiles.telegram_user_id`.
- Unknown users should receive a clear registration/configuration message.

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
