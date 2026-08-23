# LifeOS Architecture Rules

> Canonical architectural guidance for agents and contributors working in this monorepo.

## Monorepo Layout

```
lifeos-main/
├── apps/
│   ├── bot/          # Node HTTP — Telegram, TMA API, health ingest (trust boundary)
│   ├── tma/          # Vite React Telegram Mini App
│   ├── web/          # Next.js dashboard (scaffold)
│   └── health-bridge/ # Android Kotlin scaffold
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
- Future web API (`/api/web/*`)

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
- Deploy on Arch with systemd unit from `workers/*/lifeos-*.service.example`

## Deployment Topology

| Component       | Target                         | Package                   |
| --------------- | ------------------------------ | ------------------------- |
| Backend         | Railway                        | `apps/bot`                |
| Web dashboard   | Vercel                         | `apps/web`                |
| TMA static      | Vercel or bot `TMA_STATIC_DIR` | `apps/tma` build          |
| Obsidian mirror | Arch Linux                     | `workers/obsidian-mirror` |
| Reminders       | Arch Linux                     | `workers/reminder-worker` |

## Phase Boundaries (Do Not Skip)

Current acceptance slice (from `docs/ARCHITECTURE.md`):

- ✅ Telegram capture, tasks, workouts
- ✅ TMA workout/focus/finance flows
- ✅ Health ingest + scoring
- ✅ Supabase persistence + Obsidian queue
- ❌ Production web dashboard auth
- ❌ Android production build
- ❌ `/api/web/*` summary endpoints

Do not add web auth shortcuts (anon RLS reads from browser) — implement properly through bot.

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
