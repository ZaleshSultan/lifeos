# Deployment

Deployment is intentionally split by runtime.

## Supabase

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

Required backend variables:

```bash
SUPABASE_URL=https://PROJECT_REF.supabase.co
SUPABASE_ANON_KEY=replace-with-anon-key
SUPABASE_SERVICE_ROLE_KEY=replace-with-service-role-key
```

## Railway Backend

Railway should run `apps/bot` as the backend HTTP service. The Dockerfile is at `deploy/railway/Dockerfile`.

Set service variables:

```bash
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
SUPABASE_URL=https://PROJECT_REF.supabase.co
SUPABASE_ANON_KEY=replace-with-anon-key
SUPABASE_SERVICE_ROLE_KEY=replace-with-service-role-key
TELEGRAM_BOT_TOKEN=replace-with-token
TELEGRAM_WEBHOOK_PATH=/telegram/webhook
TELEGRAM_WEBHOOK_SECRET=replace-with-random-secret
TMA_URL=https://YOUR_TMA_HOST
LIFEOS_HEALTH_INGEST_JWT_SECRET=replace-with-random-secret
LIFEOS_ADMIN_TELEGRAM_IDS=123456789
LIFEOS_SIGNUP_MODE=pending_approval
# Legacy/dev bootstrap only:
LIFEOS_DEFAULT_USER_ID=your-auth-user-uuid
LIFEOS_DEFAULT_TELEGRAM_USER_ID=your-telegram-user-id
ALLOW_UNSAFE_TMA_DEV_AUTH=false
```

Deploy:

```bash
railway login
railway init
railway up
```

Railway builds from a Dockerfile when configured, then starts the resulting container. See Railway deployment docs: https://docs.railway.com/deployments/reference and CLI deploy docs: https://docs.railway.com/cli/deploying.

## Telegram Webhook

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=https://YOUR_RAILWAY_DOMAIN/telegram/webhook" \
  -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"
```

## Vercel Web Dashboard

Use Vercel for `apps/web`.

Recommended project settings:

- Framework: Next.js
- Root Directory: `apps/web`
- Install Command: `corepack pnpm install --frozen-lockfile`
- Build Command: `corepack pnpm --filter @lifeos/web build`
- Output Directory: `.next`

Environment variables:

```bash
NEXT_PUBLIC_WEB_APP_URL=https://YOUR_WEB_DOMAIN
NEXT_PUBLIC_LIFEOS_API_BASE_URL=https://YOUR_RAILWAY_DOMAIN
LIFEOS_API_BASE_URL=https://YOUR_RAILWAY_DOMAIN
```

Vercel environment variables are configured per Production, Preview, and Development environment. See Vercel env docs: https://vercel.com/docs/environment-variables.

## TMA Hosting

Build and deploy `apps/tma` as a static HTTPS app:

```bash
corepack pnpm --filter @lifeos/tma build
```

Then set `TMA_URL` on Railway and configure the Telegram BotFather web app URL.

TMA requests require Telegram WebApp `initData` in `X-Telegram-Init-Data`. Do not enable `ALLOW_UNSAFE_TMA_DEV_AUTH` outside local development.

## Arch Obsidian Worker

Clone or sync the repository to the server, configure `workers/obsidian-mirror/.env`, initialize dashboards, and enable the systemd service.

## Next Standalone Notes

The web app uses `output: "standalone"` for Docker-compatible builds. Next.js emits `.next/standalone` plus a minimal `server.js`, while `public` and `.next/static` must be copied when serving outside Vercel. Official reference: https://nextjs.org/docs/14/app/api-reference/next-config-js/output.
