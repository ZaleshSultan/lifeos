# API Security Guidelines

> Applies to `apps/bot/src/server.ts` HTTP API surface.
> Informed by [Anthropic Cybersecurity Skills](https://github.com/mukul975/Anthropic-Cybersecurity-Skills).

## API Route Map

| Route family | Auth | Body limit | CORS |
|--------------|------|------------|------|
| `GET /healthz` | None | — | `*` |
| `POST /telegram/webhook` | Webhook secret | Telegram payload | — |
| `/api/tma/*` | Init data HMAC | 1 MB JSON | `*` |
| `POST /health/ingest` | Ingest secret | Health payload | `*` |
| `GET /tma/*` | None (static) | — | `*` |
| `/api/web/*` | **Not implemented** | — | — |

## Request Handling Rules

### 1. Authentication First

Every `/api/tma/*` handler must:

```typescript
const auth = await resolveTmaUser(request, options);
if (!auth.ok) {
  writeJson(response, auth.statusCode, { error: auth.error });
  return;
}
const { user } = auth;
// All subsequent store calls use user.userId
```

Never parse route params before auth resolution.

### 2. Response Envelope

**Success:**

```json
{ "data": { ... } }
```

**Error:**

```json
{ "error": "error_code", "message": "Optional human text" }
```

- Use stable `error` codes for client handling.
- Use `sanitizeErrorMessage()` before including `message` — redact secrets.
- Never return stack traces to clients.

### 3. Input Validation

| Input | Validation |
|-------|------------|
| JSON body | `readJsonBody` with 1 MB cap |
| UUIDs | Validate format before DB lookup |
| Enums | Match against `@lifeos/core` types |
| Dates | ISO 8601 parse with fallback reject |
| Base64 images (finance) | Size check, magic bytes if possible |
| Telegram text | Length limits in command handlers |

### 4. Output Filtering

- Do not return `SUPABASE_SERVICE_ROLE_KEY`, internal queue IDs unless needed.
- Strip `raw_payload` from health API responses unless debug mode.
- Finance receipts: return signed URLs with TTL, not storage paths.

## CORS Policy

**Current:** `Access-Control-Allow-Origin: *`

**Production recommendation:**

```typescript
const allowedOrigins = [
  process.env.TMA_ORIGIN,      // e.g. https://tma.example.com
  process.env.WEB_ORIGIN,      // e.g. https://dashboard.example.com
];
// Reflect origin only if in allowlist
```

Wildcard CORS + stolen initData = cross-origin API abuse from malicious pages.

## Rate Limiting (Recommended)

| Endpoint | Suggested limit |
|----------|-----------------|
| `/telegram/webhook` | Telegram controls rate; add 429 on burst |
| `/api/tma/*` | 100 req/min per telegram_user_id |
| `/health/ingest` | 10 req/hour per device |
| `/healthz` | Unlimited |

Implement at reverse proxy (Railway) or in-memory token bucket in `server.ts`.

## HTTP Method Discipline

- `GET` — read-only, idempotent, cacheable summaries.
- `POST` — creates, actions (complete set, save expense).
- `PUT/PATCH` — updates (when added).
- `DELETE` — soft-delete preferred for life entities.

Return `405` for wrong methods — already handled by route matching.

## Static TMA Hosting

When `TMA_STATIC_DIR` is set, bot serves built TMA assets at `/tma/*`.

- No directory listing.
- `Content-Type` set correctly.
- Cache static assets with long `max-age`; `index.html` short cache.

## Adding New API Routes

Checklist for every new route in `server.ts`:

1. [ ] Auth mechanism defined (initData / JWT / secret / none)
2. [ ] `user_id` scoped if user data involved
3. [ ] Input validated in handler or `@lifeos/core`
4. [ ] Error responses use envelope format
5. [ ] No secrets in response body
6. [ ] Test added to `server.test.ts`
7. [ ] Documented in relevant `docs/*.md`

## Planned `/api/web/*` Routes

When implementing web dashboard APIs:

```
GET  /api/web/home      → today summary
GET  /api/web/health    → recovery mode + ingest
GET  /api/web/finance   → monthly rollup
GET  /api/web/study     → academic sources
```

Auth: Supabase JWT in `Authorization: Bearer <token>`, validated server-side.

**Do not** duplicate TMA routes for web — share store methods, different auth resolver.

## Security Testing

Existing: `apps/bot/src/server.test.ts` covers webhook secret, initData, ingest.

Add tests for:

- Expired initData rejection
- Oversized body rejection
- Unlinked user 403
- IDOR attempts (user A's ID in user B's session)
