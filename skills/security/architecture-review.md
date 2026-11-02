# Security Architecture Review Checklist

> Use before merging features that touch auth, APIs, data storage, or deployment.
> Informed by [Anthropic Cybersecurity Skills](https://github.com/mukul975/Anthropic-Cybersecurity-Skills).

## Review Triggers

Request a security architecture review when changing:

- `apps/bot/src/server.ts` (routing, auth, CORS)
- `packages/db/src/lifeos-store.ts` (new queries)
- `supabase/migrations/*` (RLS, policies, new tables)
- `apps/web` auth or data fetching
- `apps/tma/src/api/client.ts` (headers, tokens)
- Worker scripts with service role access
- Environment variable schema (`.env.example`)

## Layer 1: Trust Boundaries

| Question                                              | Pass criteria                                                                               |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Does browser code access service role?                | **No** — browser calls authenticated backend; web forwards its HttpOnly session server-side |
| Does TMA contain bot token or ingest secret?          | **No**                                                                                      |
| Are privileged consumers confined to trusted servers? | **Yes** — bot, reviewed workers and authorized operations only                              |
| Is user identity resolved before DB access?           | **Yes** — every write path                                                                  |

## Layer 2: Authentication

| Surface | Review item                                                                                      |
| ------- | ------------------------------------------------------------------------------------------------ |
| Webhook | Secret required in prod; timing-safe compare                                                     |
| TMA     | HMAC/freshness valid; active owner; dev bypass off                                               |
| Ingest  | Personal signature, credential hash, expiry/revocation and active owner; valid TMA alternative   |
| Web     | One-use link exchange; opaque live session; secure cookie, revocation and mutation Origin checks |
| Workers | Service role in env only, not in code                                                            |

## Layer 3: Authorization

```typescript
// REQUIRED pattern in store methods:
async getResource(userId: string, resourceId: string) {
  const { data, error } = await this.client
    .from("table")
    .select("*")
    .eq("user_id", userId)      // ← mandatory
    .eq("id", resourceId)
    .single();
}
```

| Check                                                                                                                            |     |
| -------------------------------------------------------------------------------------------------------------------------------- | --- |
| Every user-owned SELECT/UPDATE/DELETE filters resolved `user_id`; identity/global-reference/admin exceptions explicitly reviewed |     |
| No "admin" endpoints without separate auth                                                                                       |     |
| UUIDs in URLs cannot access other users' data                                                                                    |     |

## Layer 4: Data Handling

| Data type         | Rules                                            |
| ----------------- | ------------------------------------------------ |
| Health payloads   | Parse in core; don't echo raw_payload to clients |
| Finance receipts  | Store in Supabase Storage; signed URLs only      |
| Telegram messages | May contain PII — sanitize logs                  |
| Obsidian paths    | Always through `@lifeos/obsidian` sanitizer      |
| Error messages    | Through `sanitizeErrorMessage()`                 |

## Layer 5: Database & RLS

| Migration check                                |     |
| ---------------------------------------------- | --- |
| RLS enabled on new user tables                 |     |
| No public INSERT/UPDATE/DELETE policies        |     |
| `user_id` references `auth.users(id)`          |     |
| Indexes on `user_id` for query performance     |     |
| Sensitive columns not in `metadata` JSON blobs |     |

## Layer 6: API Design

| Check                                       |     |
| ------------------------------------------- | --- |
| Correct HTTP status codes (401/403/404/422) |     |
| Stable error codes in JSON body             |     |
| Body size limits enforced                   |     |
| No stack traces in responses                |     |
| CORS restricted in production               |     |
| Rate limiting considered                    |     |

## Layer 7: Secrets & Configuration

| Secret                                 | Where allowed                                        |
| -------------------------------------- | ---------------------------------------------------- |
| `SUPABASE_SERVICE_ROLE_KEY`            | bot, workers                                         |
| `TELEGRAM_BOT_TOKEN`                   | bot only                                             |
| `TELEGRAM_WEBHOOK_SECRET`              | bot only                                             |
| `LIFEOS_HEALTH_INGEST_JWT_SECRET`      | bot only                                             |
| `LIFEOS_WEB_SESSION_SECRET`            | bot only; never the web/browser bundle               |
| `OPENROUTER_API_KEY`, `GEMINI_API_KEY` | trusted backend only; no provider calls from browser |

Verify `.env.example` updated for new vars — placeholders only.

## Layer 8: Deployment

| Environment    | Checks                                                           |
| -------------- | ---------------------------------------------------------------- |
| Debian (bot)   | Service secrets private; dev auth false; webhook secret set      |
| Debian (web)   | No service role; live session validation, CSRF and cookie checks |
| Debian workers | Vault path explicit; reviewed least-privilege systemd units      |
| Local dev      | `.env` in `.gitignore`; no real secrets committed                |

## Layer 9: Testing

| Test type         | Location                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------- |
| Auth rejection    | `apps/bot/src/server.test.ts`                                                                 |
| Parser edge cases | `packages/core/src/*.test.ts`                                                                 |
| Path traversal    | `packages/obsidian/src/path.test.ts`                                                          |
| Store scoping     | Existing DB/store tests and isolated SQL role/concurrency harnesses; extend for changed paths |

New auth paths **must** have negative tests (invalid secret, wrong user, expired token).

## Review Sign-Off Template

```markdown
## Security Review: [feature name]

**Reviewer:**
**Date:**

- [ ] Trust boundaries verified
- [ ] Auth mechanism appropriate
- [ ] user_id scoping on all DB access
- [ ] No secrets in client bundles
- [ ] Error handling does not leak internals
- [ ] Tests cover auth failures
- [ ] docs/SECURITY.md updated if needed

**Risks accepted:**
**Follow-up tickets:**
```

## Known Architectural Debt (Track, Don't Ignore)

1. `server.ts` monolith — harder to audit all routes
2. `lifeos-store.ts` size — scoping bugs hide in volume
3. General webhook/TMA/ingest rate limiting is not a shared distributed app control; verify ingress separately from feature-specific limits.
4. TMA signed freshness is implemented, but stolen initData can replay within its 24-hour lifetime; live web/device credentials remain reusable until expiry/revocation.
5. Dashboard-wide restrictive CSP and automatic expired-credential metadata cleanup are not established controls; review them independently.

Resolved baseline gaps: webhook timing-safe comparison, signed TMA freshness,
exact API CORS origins and revocable Telegram-to-web authentication are already
implemented. Preserve them and their negative tests; do not reintroduce a
stateless/shared-secret shortcut or duplicate browser database access.

See `docs/PROJECT_AUDIT.md` for full issue registry.
