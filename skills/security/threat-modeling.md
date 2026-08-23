# Threat Modeling for LifeOS

> STRIDE-based threat model for the LifeOS personal OS.
> Informed by [Anthropic Cybersecurity Skills](https://github.com/mukul975/Anthropic-Cybersecurity-Skills).

## System Boundaries

```
                    TRUST BOUNDARY
    Untrusted                          Trusted
┌─────────────────┐              ┌──────────────────────┐
│ Telegram users  │──────────────│ apps/bot             │
│ TMA WebView     │   HTTPS      │ packages/db (store)  │
│ Android bridge  │──────────────│ packages/core        │
│ Web browsers    │              │ Python workers       │
└─────────────────┘              └──────────┬───────────┘
                                            │
                                   ┌────────▼───────────┐
                                   │ Supabase Postgres  │
                                   │ Supabase Storage   │
                                   └────────┬───────────┘
                                            │
                                   ┌────────▼───────────┐
                                   │ Obsidian vault     │
                                   │ (local Arch server)│
                                   └────────────────────┘
```

## Assets

| Asset                              | Sensitivity         | Location                 |
| ---------------------------------- | ------------------- | ------------------------ |
| Health metrics (HRV, sleep, steps) | High (PHI-adjacent) | `health_*` tables        |
| Finance data (spend, receipts)     | High                | `finance_*` tables       |
| Telegram captures & tasks          | Medium              | `life_entities`, `tasks` |
| Workout logs                       | Medium              | `workouts`               |
| Obsidian mirror notes              | Medium              | Local vault              |
| Service role key                   | Critical            | Bot/worker env only      |
| Bot token                          | Critical            | Bot env only             |
| Ingest secret                      | High                | Bot + Android env        |

## STRIDE Analysis

### Telegram Webhook (`POST /telegram/webhook`)

| Threat                        | Type      | Scenario                        | Mitigation                         |
| ----------------------------- | --------- | ------------------------------- | ---------------------------------- |
| Fake webhook calls            | Spoofing  | Attacker POSTs without secret   | `TELEGRAM_WEBHOOK_SECRET` header   |
| Secret brute force            | Elevation | Timing attack on secret compare | Use `secureCompare()`              |
| Command injection via message | Tampering | Malicious `/cap` text           | Parser validation in core          |
| Webhook flooding              | DoS       | High-volume fake updates        | Rate limit + Telegram IP allowlist |

### TMA API (`/api/tma/*`)

| Threat                 | Type            | Scenario                                      | Mitigation                     |
| ---------------------- | --------------- | --------------------------------------------- | ------------------------------ |
| Forged initData        | Spoofing        | Attacker crafts fake HMAC                     | HMAC validation with bot token |
| Stolen initData replay | Replay          | Intercepted initData reused                   | Add `auth_date` TTL check      |
| Cross-user data access | Elevation       | Guess UUID in URL                             | Scope all queries by `user_id` |
| CORS abuse             | Info disclosure | Malicious site calls API with stolen initData | Origin allowlist               |
| Dev auth bypass        | Elevation       | `ALLOW_UNSAFE_TMA_DEV_AUTH` in prod           | Env validation on startup      |

### Health Ingest (`POST /health/ingest`)

| Threat              | Type      | Scenario                      | Mitigation                        |
| ------------------- | --------- | ----------------------------- | --------------------------------- |
| Fake health data    | Tampering | Spoofed recovery scores       | Ingest secret + parser validation |
| Payload injection   | Tampering | Malformed JSON crashes server | 1 MB limit + schema validation    |
| Replay old payloads | Replay    | Resubmit yesterday's data     | Idempotent upsert by date+user    |

### Web Dashboard (`apps/web`)

| Threat                 | Type            | Scenario                        | Mitigation                      |
| ---------------------- | --------------- | ------------------------------- | ------------------------------- |
| Unauthenticated access | Info disclosure | Public Vercel URL exposes shell | Add Supabase auth before deploy |
| XSS in dashboard       | Tampering       | Injected script steals session  | React escaping + CSP headers    |
| Backend URL exposure   | Info disclosure | `LIFEOS_BACKEND_URL` in client  | Server-side fetch only          |

### Database (Supabase)

| Threat                          | Type            | Scenario                             | Mitigation                    |
| ------------------------------- | --------------- | ------------------------------------ | ----------------------------- |
| RLS bypass via service role bug | Elevation       | Missing user_id filter               | Code review + store tests     |
| SQL injection                   | Tampering       | Unsanitized query                    | Parameterized Supabase client |
| Key leak from logs              | Info disclosure | Error logs contain connection string | `sanitizeErrorMessage`        |

### Obsidian Worker

| Threat          | Type        | Scenario                              | Mitigation                       |
| --------------- | ----------- | ------------------------------------- | -------------------------------- |
| Path traversal  | Tampering   | `../../../etc/passwd` in entity title | `@lifeos/obsidian` sanitizer     |
| Vault wipe      | Destruction | Worker deletes notes                  | Worker never deletes — by design |
| Queue poisoning | Tampering   | Malicious entity in sync queue        | Sanitize at write time in bot    |

### Python Workers (reminder, sync)

| Threat                           | Type            | Scenario                         | Mitigation                        |
| -------------------------------- | --------------- | -------------------------------- | --------------------------------- |
| Service role on compromised host | Elevation       | Arch server breached             | Least privilege, key rotation     |
| Telegram message leak            | Info disclosure | Reminder contains sensitive text | Minimize content in notifications |

## Attack Scenarios (Prioritized)

### Scenario 1: Public Dashboard Scraping

**Likelihood:** High (if Vercel deployed)  
**Impact:** Low today (placeholder data), High when APIs wired  
**Mitigation:** Implement web auth before `/api/web/*`

### Scenario 2: initData Interception in Telegram WebView

**Likelihood:** Medium  
**Impact:** High (full API access as victim)  
**Mitigation:** `auth_date` TTL, HTTPS only, short session tokens (future)

### Scenario 3: Store Method Missing user_id Filter

**Likelihood:** Medium (on new code)  
**Impact:** Critical (cross-tenant data leak)  
**Mitigation:** Mandatory `userId` param on all store methods; PR review checklist

### Scenario 4: Ingest Secret Leak from Android APK

**Likelihood:** Low-Medium  
**Impact:** High (fake health data)  
**Mitigation:** Certificate pinning (future), rotate secret, per-device keys (future)

## Threat Model Maintenance

Re-run this analysis when:

- Adding `/api/web/*` routes
- Enabling multi-user support
- Adding OAuth (Google calendar sync)
- Shipping Android bridge to Play Store
- Exposing any endpoint without authentication

## References

- `docs/SECURITY.md` — operational security
- `skills/security/owasp.md` — OWASP mapping
- `skills/security/auth-security.md` — auth controls
