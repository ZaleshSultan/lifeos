# OWASP Alignment for LifeOS

> Informed by [Anthropic Cybersecurity Skills](https://github.com/mukul975/Anthropic-Cybersecurity-Skills).
> Maps OWASP Top 10 (2021) to LifeOS components.

## Threat Surface Overview

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ Telegram Bot │  │     TMA      │  │  Web Dashboard│
│   Webhook    │  │  initData    │  │  (no auth yet)│
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │                 │                  │
       └─────────────────┼──────────────────┘
                         ▼
              ┌─────────────────────┐
              │    apps/bot         │
              │  (service role DB)  │
              └──────────┬──────────┘
                         ▼
              ┌─────────────────────┐
              │  Supabase Postgres  │
              │  RLS (bypassed by   │
              │   service role)     │
              └─────────────────────┘
```

## OWASP Top 10 Mapping

### A01: Broken Access Control

| Risk in LifeOS | Mitigation |
|----------------|------------|
| Service role bypasses RLS | Enforce `user_id` scoping in every `SupabaseLifeOSStore` method |
| TMA user resolved via Telegram ID | Reject unlinked users (`403 telegram_user_not_linked`) |
| Web dashboard has no auth | **Block public deploy** until Supabase session auth is added |
| IDOR on `/api/tma/*` routes | Always filter by resolved `user.userId`, never trust client IDs alone |

**Audit action:** Review new store methods for missing `user_id` filter.

### A02: Cryptographic Failures

| Risk | Mitigation |
|------|------------|
| Secrets in repo | Only `.env.example` placeholders; see `docs/SECURITY.md` |
| Telegram initData HMAC | `validateTelegramInitData` uses HMAC-SHA256 — correct |
| Webhook secret comparison | **Gap:** uses `!==` not `timingSafeEqual` — fix in `server.ts` |
| TLS in transit | Enforce HTTPS on Railway/Vercel/Telegram endpoints |

### A03: Injection

| Vector | Mitigation |
|--------|------------|
| SQL injection | Supabase client parameterized queries; no raw SQL in app code |
| Obsidian path traversal | `@lifeos/obsidian` path sanitizer blocks `..` segments |
| Telegram message parsing | Parsers in `@lifeos/core` — validate before persist |
| JSON body bombs | 1 MB limit in `readJsonBody` |

### A04: Insecure Design

| Gap | Recommendation |
|-----|----------------|
| No `auth_date` freshness on initData | Reject initData older than 24h (Telegram recommends checking) |
| CORS `*` on all JSON responses | Restrict to known TMA/web origins in production |
| Single-tenant bootstrap env vars | Document that multi-tenant requires auth redesign |
| No rate limiting | Add per-IP limits on webhook, TMA, ingest |

### A05: Security Misconfiguration

| Check | Status |
|-------|--------|
| `ALLOW_UNSAFE_TMA_DEV_AUTH=false` in prod | **Critical** — verify deploy env |
| `TELEGRAM_WEBHOOK_SECRET` set | Required in production |
| RLS enabled on user tables | Yes (migrations) |
| Service role only in bot/workers | Yes — never in browser |

### A06: Vulnerable Components

- Run `pnpm audit` regularly.
- Pin Node 22 in Dockerfile.
- Update `@supabase/supabase-js` and `@twa-dev/sdk` on security advisories.

### A07: Identification & Authentication Failures

| Surface | Auth mechanism |
|---------|----------------|
| Telegram webhook | `X-Telegram-Bot-Api-Secret-Token` |
| TMA API | `X-Telegram-Init-Data` HMAC |
| Health ingest | JWT Bearer token from TMA health session |
| Web dashboard | **Not implemented** |
| Python workers | `SUPABASE_SERVICE_ROLE_KEY` |

### A08: Software & Data Integrity

- Webhook processes Telegram updates — validate schema before writes.
- Health ingest treats payloads as untrusted until parsed by `@lifeos/core`.
- Obsidian worker writes atomically; never deletes vault files.

### A09: Security Logging & Monitoring

| Practice | LifeOS status |
|----------|---------------|
| Sanitize errors before client response | `sanitizeErrorMessage` in bot |
| Avoid logging initData/tokens | Documented in `docs/SECURITY.md` |
| Health check endpoint | `GET /healthz` exists |
| Audit trail for finance | Finance v2 migrations add SSOT patterns |

### A10: Server-Side Request Forgery

- Bot does not fetch user-supplied URLs in current slice.
- Future Google/ICS sync workers: validate redirect targets, allowlist domains.

## Priority Remediation Queue

1. **P0:** Web dashboard auth before public Vercel deploy
2. **P0:** `ALLOW_UNSAFE_TMA_DEV_AUTH=false` in all production envs
3. **P1:** initData `auth_date` freshness validation
4. **P1:** Webhook secret timing-safe comparison
5. **P1:** CORS origin allowlist
6. **P2:** Rate limiting on public endpoints
7. **P2:** Receipt image validation (type, size, dimensions)

## Compliance Notes

LifeOS stores personal health, finance, and location-adjacent data. Even as a single-user system:

- Treat all user data as sensitive PII.
- Do not expose raw payloads in API responses to browsers.
- Rotate `SUPABASE_SERVICE_ROLE_KEY` if any deploy machine is compromised.
