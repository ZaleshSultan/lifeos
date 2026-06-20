# Authentication & Authorization Security

> LifeOS identity model and auth hardening.
> Informed by [Anthropic Cybersecurity Skills](https://github.com/mukul975/Anthropic-Cybersecurity-Skills).

## Identity Model

```
auth.users.id          ← canonical LifeOS user_id
       │
       ▼
public.profiles        ← telegram_user_id (unique)
       │
       ▼
All user-owned tables  ← user_id FK → auth.users(id)
```

**Rule:** Every write path must resolve to a `user_id` before touching the database.

## Auth Surfaces

### 1. Telegram Bot Webhook

**File:** `apps/bot/src/server.ts`

| Control | Implementation |
|---------|----------------|
| Endpoint | `POST /telegram/webhook` |
| Secret header | `X-Telegram-Bot-Api-Secret-Token` |
| Env var | `TELEGRAM_WEBHOOK_SECRET` |
| User resolution | `profiles.telegram_user_id` lookup |

**Hardening:**

```typescript
// Current (weak):
if (providedSecret !== options.webhookSecret)

// Recommended:
if (!secureCompare(providedSecret ?? "", options.webhookSecret))
```

Use signed HS256 Bearer tokens from TMA health sessions.

### 2. Telegram Mini App (TMA)

**File:** `apps/bot/src/server.ts` → `validateTelegramInitData()`

| Step | Check |
|------|-------|
| 1 | Parse `X-Telegram-Init-Data` header |
| 2 | Verify HMAC-SHA256 hash with bot token |
| 3 | Extract `user.id` from JSON `user` param |
| 4 | Resolve via `store.resolveTelegramUser(telegramUserId)` |
| 5 | Reject if not linked (`403`) |

**Gaps to close:**

| Gap | Fix |
|-----|-----|
| No `auth_date` check | Reject if `Date.now()/1000 - auth_date > 86400` |
| Dev bypass in prod | `ALLOW_UNSAFE_TMA_DEV_AUTH` must be `false` |
| Replay of stolen initData | Short TTL + optional server-side nonce cache |

**Client rule (`apps/tma/src/api/client.ts`):**

- Send `X-Telegram-Init-Data` on every API call.
- Never store or transmit bot token in frontend.

### 3. Health Ingest (Android Bridge)

| Control | Value |
|---------|-------|
| Header | `Authorization: Bearer <health-session-token>` |
| Comparison | `secureCompare()` ✓ (timing-safe) |
| Payload trust | Untrusted until `@lifeos/core` parsing |

### 4. Web Dashboard (Future)

**Current state:** No Supabase Auth session in `apps/web`.

**Required before production:**

1. Supabase Auth (email magic link or OAuth).
2. Session middleware in Next.js (`@supabase/ssr`).
3. New `/api/web/*` routes on bot validating Supabase JWT.
4. Map `auth.users.id` → same `user_id` as TMA/bot.
5. Never use service role in browser.

### 5. Python Workers

| Worker | Auth |
|--------|------|
| obsidian-mirror | `SUPABASE_SERVICE_ROLE_KEY` |
| reminder-worker | Service role + Telegram bot token |
| google-sync, ics-sync | Service role |

Workers run in trusted environments only (Arch server, not Vercel).

## Authorization Patterns

### Service Role + App-Layer Scoping

The bot uses `SUPABASE_SERVICE_ROLE_KEY`, bypassing RLS. Security depends entirely on:

```typescript
// Every store call must include userId from auth resolution
await store.getWorkout(user.userId, workoutId);
// NOT: await store.getWorkout(workoutId);
```

### RLS as Defense in Depth

RLS policies use `lifeos_is_owner(user_id)` for `authenticated` role. When web auth ships:

- Browser uses anon key + user JWT → RLS applies.
- Bot/workers keep service role → app-layer scoping.

### Dev Auth Bypass

```bash
ALLOW_UNSAFE_TMA_DEV_AUTH=true   # LOCAL ONLY
LIFEOS_DEFAULT_USER_ID=<uuid>
```

Returns fake user without valid initData. **Never enable in Railway/production.**

## Bootstrap / Single-User Setup

```bash
LIFEOS_DEFAULT_USER_ID=your-auth-user-uuid
LIFEOS_DEFAULT_TELEGRAM_USER_ID=your-telegram-user-id
```

`/start` links Telegram sender to profile when IDs match. This is intentional for single-user bootstrap — not multi-tenant auth.

## Auth Security Checklist

- [ ] `TELEGRAM_WEBHOOK_SECRET` set in production
- [ ] `ALLOW_UNSAFE_TMA_DEV_AUTH=false` in production
- [ ] `LIFEOS_HEALTH_INGEST_JWT_SECRET` is high-entropy random string
- [ ] No JWT/service role in `apps/web` or `apps/tma` bundles
- [ ] New API routes call auth resolver before store access
- [ ] `auth_date` validated on initData (when implemented)
- [ ] Webhook secret uses timing-safe compare (when implemented)
- [ ] Unlinked Telegram users get `403`, not `500` or data leak

## Secret Rotation

If compromised, rotate in order:

1. `SUPABASE_SERVICE_ROLE_KEY` (Supabase dashboard)
2. `TELEGRAM_BOT_TOKEN` (BotFather)
3. `TELEGRAM_WEBHOOK_SECRET` + re-register webhook
4. `LIFEOS_HEALTH_INGEST_JWT_SECRET` + issue health session tokens from TMA
