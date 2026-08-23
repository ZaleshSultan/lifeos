# LifeOS Agent Instructions

This file configures AI agents (Cursor, Claude Code, etc.) working in the LifeOS monorepo.
Skills live in `./skills/` and are loaded by reference — read the relevant skill before making changes.

## Project Overview

LifeOS is a **personal operating system** monorepo:

- **Backend:** `apps/bot` — Node HTTP server (Telegram, TMA API, health ingest)
- **TMA:** `apps/tma` — Telegram Mini App (Vite + React)
- **Web:** `apps/web` — Next.js dashboard
- **Core:** `packages/core` (pure domain), `packages/db` (Supabase store), `packages/obsidian`
- **Workers:** Python services in `workers/` (Obsidian mirror, reminders, sync)
- **Database:** Supabase Postgres with RLS

**Source of truth:** Supabase. Obsidian is a mirror. Frontends never hold service-role keys.

## Upstream Skill Repositories

LifeOS skills are adapted from these upstream projects:

| Domain       | Upstream                                                                                              | Local path                   |
| ------------ | ----------------------------------------------------------------------------------------------------- | ---------------------------- |
| UI/UX        | [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)       | `skills/ui-ux/`              |
| Security     | [mukul975/Anthropic-Cybersecurity-Skills](https://github.com/mukul975/Anthropic-Cybersecurity-Skills) | `skills/security/`           |
| Architecture | LifeOS-specific                                                                                       | `skills/lifeos-architect.md` |

Local skills **override** upstream guidance when they conflict with project conventions.

---

## Skills Index

### Architecture (always read first)

| Skill            | Path                                                       | When to use                                           |
| ---------------- | ---------------------------------------------------------- | ----------------------------------------------------- |
| LifeOS Architect | [`skills/lifeos-architect.md`](skills/lifeos-architect.md) | Any change — monorepo layout, boundaries, conventions |

### UI/UX

| Skill                | Path                                                                           | When to use                                         |
| -------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------- |
| Design Principles    | [`skills/ui-ux/design-principles.md`](skills/ui-ux/design-principles.md)       | Visual design, tokens, components, accessibility    |
| Dashboard Guidelines | [`skills/ui-ux/dashboard-guidelines.md`](skills/ui-ux/dashboard-guidelines.md) | `apps/web` pages, MetricCard, AppShell, data wiring |
| Mobile UX            | [`skills/ui-ux/mobile-ux.md`](skills/ui-ux/mobile-ux.md)                       | `apps/tma` screens, Telegram SDK, touch targets     |

### Security

| Skill               | Path                                                                               | When to use                                  |
| ------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------- |
| OWASP Alignment     | [`skills/security/owasp.md`](skills/security/owasp.md)                             | Security review, vulnerability assessment    |
| Auth Security       | [`skills/security/auth-security.md`](skills/security/auth-security.md)             | Telegram initData, webhook, ingest, web auth |
| API Security        | [`skills/security/api-security.md`](skills/security/api-security.md)               | New routes in `server.ts`, CORS, rate limits |
| Threat Modeling     | [`skills/security/threat-modeling.md`](skills/security/threat-modeling.md)         | New features, deployment changes, data flows |
| Architecture Review | [`skills/security/architecture-review.md`](skills/security/architecture-review.md) | Pre-merge security checklist                 |

---

## Agent Rules

### Must Do

1. **Read `skills/lifeos-architect.md`** before any structural change.
2. **Keep `packages/core` pure** — no I/O, no Supabase imports.
3. **Scope all DB access by `user_id`** — resolved at API auth boundary.
4. **Never commit secrets** — only `.env.example` placeholders.
5. **Never put service-role keys in browser apps** (`apps/web`, `apps/tma`).
6. **Match existing patterns** — `MetricCard`, `SectionPanel`, `tmaData()` envelope, `cx()` helper.
7. **Run checks:** `pnpm typecheck && pnpm test` after substantive changes.
8. **Minimize scope** — do not refactor unrelated code.

### Must Not Do

1. Do not change business logic unless explicitly requested.
2. Do not delete existing files.
3. Do not add Express/Fastify or new frameworks without discussion.
4. Do not enable `ALLOW_UNSAFE_TMA_DEV_AUTH` in production configs.
5. Do not expose raw health payloads or internal IDs in API responses.
6. Do not store workout/full state in Telegram URLs.

### Task Routing

```
User request
    │
    ├─ UI in apps/web ──────→ skills/ui-ux/dashboard-guidelines.md
    ├─ UI in apps/tma ──────→ skills/ui-ux/mobile-ux.md
    ├─ Visual/tokens ───────→ skills/ui-ux/design-principles.md
    ├─ New API route ───────→ skills/security/api-security.md
    │                          + skills/lifeos-architect.md
    ├─ Auth changes ────────→ skills/security/auth-security.md
    ├─ Security review ─────→ skills/security/architecture-review.md
    │                          + skills/security/owasp.md
    ├─ Domain logic ────────→ packages/core (+ docs/LIFEOS_KERNEL.md)
    ├─ Database/migrations ─→ packages/db + docs/DATABASE.md
    └─ New worker ──────────→ workers/ + docs/SECURITY.md
```

---

## Key Documentation

| Doc                                              | Purpose                                |
| ------------------------------------------------ | -------------------------------------- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)   | Runtime topology, identity, deployment |
| [`docs/SECURITY.md`](docs/SECURITY.md)           | Secrets, RLS, operational hygiene      |
| [`docs/DATABASE.md`](docs/DATABASE.md)           | Migrations, tables, bootstrap          |
| [`docs/BOT_UX.md`](docs/BOT_UX.md)               | Telegram command patterns              |
| [`docs/PROJECT_AUDIT.md`](docs/PROJECT_AUDIT.md) | Known UX/security/architecture issues  |

---

## Environment & Commands

```bash
# Install
corepack pnpm install

# Checks
corepack pnpm typecheck
corepack pnpm test

# Dev servers
corepack pnpm --filter @lifeos/bot dev
corepack pnpm --filter @lifeos/web dev
corepack pnpm --filter @lifeos/tma dev
```

Copy `.env.example` → `.env` / `.env.local` per app before running.

---

## Acceptance Boundary

This phase stabilizes Telegram + TMA + health ingest + Obsidian mirror.
**Not in scope yet:** production web auth, `/api/web/*` endpoints, Android production build.

Do not ship partial workarounds for these — follow skills and docs for proper implementation.
