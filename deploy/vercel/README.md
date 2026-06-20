# Vercel Web Dashboard Deploy

This deploy target runs `apps/web`.

## Project Settings

- Framework Preset: Next.js
- Root Directory: `apps/web`
- Install Command: `corepack pnpm install --frozen-lockfile`
- Build Command: `corepack pnpm --filter @lifeos/web build`
- Output Directory: `.next`

## Variables

```bash
NEXT_PUBLIC_WEB_APP_URL=https://YOUR_WEB_DOMAIN
NEXT_PUBLIC_LIFEOS_API_BASE_URL=https://YOUR_RAILWAY_DOMAIN
LIFEOS_API_BASE_URL=https://YOUR_RAILWAY_DOMAIN
```

## CLI Flow

```bash
npm i -g vercel
vercel login
vercel link
vercel env pull
vercel deploy
vercel --prod
```

For production deployments, confirm that `LIFEOS_API_BASE_URL` points to the Railway backend and that no server-only secrets are exposed with a `NEXT_PUBLIC_` prefix.
