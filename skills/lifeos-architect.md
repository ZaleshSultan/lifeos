# LifeOS Architecture Rules

> Canonical architectural guidance for agents and contributors working in this monorepo.

## Monorepo Layout

```
lifeos-main/
├── apps/
│   ├── bot/          # Node HTTP — Telegram, TMA API, health ingest (trust boundary)
│   ├── tma/          # Vite React Telegram Mini App
│   ├── web/          # Authenticated Next.js dashboard
│   └── health-bridge/ # Kotlin Health Connect project/scaffold
├── packages/
│   ├── core/         # Pure domain logic — NO I/O
│   ├── db/           # Supabase client + LifeOSStore
│   └── obsidian/     # Path safety for vault mirror
├── workers/          # Python (outside pnpm workspace)
├── supabase/migrations/
├── docs/
└── skills/           # Agent skills (this folder)
```

**pnpm workspace:** `apps/*`, `packages/*` only. Workers use separate `requirements.txt`.

## Core Architectural Principles

### 1. Supabase Is Source of Truth

```
Telegram/TMA/Web → apps/bot → Supabase Postgres
Workers          → Supabase Postgres → Obsidian vault (mirror only)
```

- Obsidian is a **read mirror**, not authoritative.
- Health Connect is an **upstream source**, not storage.
- Never write user state only to Telegram URLs or local files.

### 2. Pure Core, Impure Boundaries

| Package            | Allowed                         | Forbidden                          |
| ------------------ | ------------------------------- | ---------------------------------- |
| `@lifeos/core`     | Pure functions, types, parsers  | `fetch`, Supabase, `fs`, env reads |
| `@lifeos/db`       | Supabase queries, store methods | HTTP, Telegram                     |
| `@lifeos/obsidian` | Path sanitization               | DB access                          |
| `apps/bot`         | HTTP, auth, orchestration       | Business logic duplication         |

Put domain rules in `packages/core`. Bot handlers call core, then persist via store.

### 3. Single Trust Boundary: `apps/bot`

All external input enters through:

- Telegram webhook
- TMA REST (`/api/tma/*`)
- Health ingest (`/health/ingest`)
- Web login exchange/logout (`/api/web/auth/*`); protected data reuses the authenticated `/api/tma/*` boundary

Bot holds `SUPABASE_SERVICE_ROLE_KEY`. Frontends never do.

### 4. Identity: `auth.users.id` = `user_id`

```sql
profiles.user_id        → auth.users(id)
profiles.telegram_user_id → unique external link
<all tables>.user_id    → auth.users(id)
```

Resolve identity at API boundary. Pass `userId` string to every store method.

### 5. Life Entity Kernel

Every capture becomes:

1. Structured row(s) in domain tables (`tasks`, `workouts`, `health_daily`, etc.)
2. Optional `life_entities` timeline row
3. Optional `obsidian_sync_queue` entry for mirror

See `docs/LIFEOS_KERNEL.md`.

## Code Conventions

### TypeScript / ESM

- `"type": "module"` in all Node packages
- Import with `.js` extension in compiled output paths
- Path aliases in root `tsconfig.json` for `@lifeos/*`

### Environment Variables

Use helpers from `@lifeos/core/env`:

```typescript
optionalEnv("KEY");
integerEnv("PORT", 3000);
urlEnv("BACKEND_URL");
```

Document new vars in relevant `.env.example`.

### API Response Shape (TMA)

```typescript
// Success
{ data: T }

// Error
{ error: string, message?: string }
```

### Testing

- Vitest colocated: `*.test.ts` next to source
- Bot HTTP security: `apps/bot/src/server.test.ts`
- Run: `pnpm test` from root

### Formatting

- Prettier (no ESLint config in repo)
- Match surrounding style in edits

## Module Boundaries

### When to Add a New Package

- Shared UI emerges → `@lifeos/ui` (not yet created)
- New external integration → consider `packages/<integration>`

### When to Add a Migration

- New persistent entity type
- New column with integrity constraints
- RLS policy changes

Never edit applied migrations — add new timestamped files.

### When to Add a Worker

- Background job that should not block HTTP (reminders, mirror, sync)
- Requires service role + long-running process
- Deploy on the current Debian host with reviewed systemd units from `workers/*/lifeos-*.service.example`; older Arch examples are historical

## Deployment Topology

| Component     | Current target                        | Package                |
| ------------- | ------------------------------------- | ---------------------- |
| Backend + TMA | Debian/systemd, loopback port 3000    | `apps/bot`, `apps/tma` |
| Web dashboard | Debian/systemd, port 3001, `/web`     | `apps/web`             |
| Workers       | Debian/systemd                        | `workers/*`            |
| Public HTTPS  | Existing Cloudflare Tunnel            | `lifeos.zalewko.me`    |
| Database      | Existing Supabase PostgreSQL with RLS | `packages/db`          |

See `docs/OPERATIONS.md` for the current topology and verified release reports for
the deployed SHA. Railway/Vercel and Arch/Tailscale guides describe alternative or
historical installations; never infer production from an old example or default branch.

## Acceptance Scope and Verification

The original stabilization slice covers Telegram, TMA, health ingest, Supabase
and the Obsidian queue. The explicitly authorized November 3 overnight mission
extends it to authenticated web workspaces and the Android Health Connect
application. Previous web-auth/Android exclusions are historical. Web sessions
use the trusted bot boundary and an HttpOnly cookie; no anon browser read shortcut
or service-role exposure is acceptable. Android build/install evidence must remain
separate from physical Health Connect permission, scheduled-sync and phone tests.
The audited release host lacks the Android/JDK/Gradle-wrapper toolchain; no
installable APK or successful phone sync is implied by the source audit.
External campus/creator authorization remains blocked unless an actual supported
grant and user consent are available; a sign-in link does not establish a connection.

## Anti-Patterns

| Don't                                  | Do instead                            |
| -------------------------------------- | ------------------------------------- |
| Import `@lifeos/db` from TMA/web       | Call bot API                          |
| Put SQL in bot handlers                | Use `SupabaseLifeOSStore` methods     |
| Duplicate parsers in apps              | Import from `@lifeos/core`            |
| Store state in Telegram deep links     | Supabase + short TMA URL              |
| Add Express/Fastify without discussion | Extend `server.ts` or propose ADR     |
| Create `@lifeos/ui` prematurely        | Match web/tma patterns manually first |

## File Size Guidance

Known large files — extend carefully, prefer extraction when adding >100 lines:

- `apps/bot/src/server.ts` (~2000 lines)
- `packages/db/src/lifeos-store.ts` (~8500 lines)

When adding routes: group by domain in separate handler modules imported by `server.ts`.

## Documentation Map

| Topic         | Doc                              |
| ------------- | -------------------------------- |
| Topology      | `docs/ARCHITECTURE.md`           |
| Security      | `docs/SECURITY.md`               |
| Database      | `docs/DATABASE.md`               |
| Bot UX        | `docs/BOT_UX.md`                 |
| TMA           | `docs/TMA.md`                    |
| Kernel        | `docs/LIFEOS_KERNEL.md`          |
| Finance       | `docs/FINANCE_MODULE.md`         |
| Health bridge | `docs/HEALTH_BRIDGE_CONTRACT.md` |
| Audit issues  | `docs/PROJECT_AUDIT.md`          |

## Agent Workflow

When implementing a feature:

1. Read `skills/lifeos-architect.md` (this file)
2. If UI work → `skills/ui-ux/*`
3. If auth/API/security → `skills/security/*`
4. Check relevant `docs/*.md`
5. Pure logic → `packages/core`
6. Persistence → `packages/db` store method
7. HTTP surface → `apps/bot`
8. Frontend → `apps/tma` or `apps/web`
9. Update tests; do not change unrelated business logic
