# Railway Backend Deploy

This deploy target runs `apps/bot` as the LifeOS backend.

## Configure

In Railway, create a service from the repo and set the Dockerfile path:

```text
deploy/railway/Dockerfile
```

Set healthcheck path:

```text
/healthz
```

## Variables

```bash
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
SUPABASE_URL=https://PROJECT_REF.supabase.co
SUPABASE_ANON_KEY=replace-with-anon-key
SUPABASE_SERVICE_ROLE_KEY=replace-with-service-role-key
TELEGRAM_BOT_TOKEN=replace-with-telegram-token
TELEGRAM_WEBHOOK_PATH=/telegram/webhook
TELEGRAM_WEBHOOK_SECRET=replace-with-random-secret
TMA_URL=https://YOUR_TMA_HOST
LIFEOS_INGEST_SECRET=replace-with-random-secret
LIFEOS_DEFAULT_USER_ID=your-auth-user-uuid
LIFEOS_DEFAULT_TELEGRAM_USER_ID=your-telegram-user-id
ALLOW_UNSAFE_TMA_DEV_AUTH=false
```

## Deploy

```bash
railway login
railway link
railway up
railway logs
```

After deployment, configure Telegram:

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=https://YOUR_RAILWAY_DOMAIN/telegram/webhook" \
  -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"
```
