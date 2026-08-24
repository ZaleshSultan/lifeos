# LifeOS Project Audit

**Date:** 2026-06-11 (original) — **re-verified 2026-08-24**
**Scope:** UX, security, architecture — based on codebase analysis for Skills integration.
**Status:** The 2026-06-11 findings below were checked against the actual code and
test/typecheck runs on 2026-08-24. Items marked ✅ RESOLVED were fixed since the
original audit; items marked still-open were re-confirmed as still present.
Nothing in this file describes production data, live sync status, or which
service is actually running right now — check `systemctl status lifeos-*` on
the server for that.

## 2026-08-24 re-verification summary

Ran `pnpm install`, `pnpm typecheck`, `pnpm test`, `pnpm format:check` for the
whole workspace, plus `apps/tma` and `apps/web` typecheck individually (the
root `pnpm typecheck` script only covers `apps/bot` and `packages/**` — see
ARCH-06), and the full Python worker suite via `workers/test_worker_suite.py`.

- **TypeScript:** `apps/bot` + `packages/**` clean via root `pnpm typecheck`.
  `apps/tma` and `apps/web` independently clean via their own `tsc --noEmit`.
  Before this pass, root typecheck had 12 errors (stale test doubles after a
  `createLifeEntityWithSync` atomic-RPC refactor, a missing `UserObsidianSettings`
  field on test fixtures, an invalid `type` import modifier, a null-narrowing
  gap, and a `Json` type mismatch) — all fixed.
- **Vitest:** 192/192 passing (was 18 failing — same root causes as above,
  plus two genuinely stale test fixtures: a hardcoded reminder date that had
  since passed, and a `user_id` mismatch check that was added to
  `/health/ingest` after the test was written).
- **Prettier:** `format:check` was failing on 32 files before any of the
  above fixes (pre-existing debt, confirmed against a clean baseline) — now
  clean.
- **Python workers:** 48/48 passing via `workers/test_worker_suite.py`
  (previously never run end-to-end in this repo's history — the original
  ChatGPT-assisted audit could only get `pnpm install` and `pytest` to run
  in its sandbox, not this).
- **AITU/Platonus mock fallback (new finding, not in original audit):** both
  `university_scraper.py` and `platonus_sync.py` silently substituted
  hardcoded mock grade data on any live-fetch failure, tagging it only in a
  buried `raw_json._is_mocked` field with the `sync_run` still marked
  `success`. Fixed: both now require an explicit `AITU_SYNC_MOCK_MODE` /
  `PLATONUS_SYNC_MOCK_MODE` env flag; without it a live failure raises and
  is recorded as a failed `sync_run` instead of masquerading as real data.
- **Hardcoded course code (new finding):** `getTmaAcademicSummary()` resolved
  the "summer course" dashboard card by looking up the literal code
  `DISCRETE-MATH-SUMMER-2026`. That course's `endsOn` (2026-08-15 in the test
  fixture) has already passed as of this re-verification date, meaning the
  card may currently be stale/empty on the live dashboard. Replaced with a
  generic `term ILIKE '%summer%'` + active-date-range query so it doesn't
  need a code edit every term.

## Status of the original 2026-06-11 findings

### Security

- **SEC-02 (initData replay, no `auth_date` check) — ✅ RESOLVED.** `server.ts`
  now checks `auth_date` against `TMA_INIT_DATA_MAX_AGE_SECONDS` /
  `TMA_INIT_DATA_MAX_FUTURE_SKEW_SECONDS`.
- **SEC-03 (webhook secret non-timing-safe compare) — ✅ RESOLVED.** The
  Telegram webhook secret check now uses the same `secureCompare()` helper
  as everything else.
- **SEC-04 (CORS wildcard) — ✅ RESOLVED (or never re-added).** No
  `Access-Control-Allow-Origin` header is set anywhere in `apps/bot/src`
  as of this re-check.
- **SEC-05 (dev auth bypass) — partially addressed.** `unsafeTmaDevAuthAllowed()`
  does check `process.env.NODE_ENV !== "production"` at request time, so the
  bypass cannot fire in production. The originally recommended remediation
  (fail _startup_ loudly if the bypass flag and `NODE_ENV=production` are
  both set) was not implemented — a misconfigured production deploy would
  just silently never hit the bypass path rather than refusing to boot.
  Still worth doing, but the actual vulnerability is closed.
- **SEC-01 (no web dashboard auth), SEC-06 (RLS bypass by service role),
  SEC-07 (no rate limiting), SEC-08 (receipt upload validation) — not
  re-checked this pass.** Original findings stand as unverified, not
  necessarily still true.

### Architecture

- **ARCH-06 (root tsconfig excludes web/tma) — still true**, confirmed above.
  Not currently hiding any real errors (both independently typecheck clean),
  but `pnpm typecheck` at the repo root gives a false sense of full coverage.
  Worth fixing so a future regression in web/tma doesn't slip through CI.
- **ARCH-05 (workers outside pnpm workspace, no unified test command) —
  still true**, though `workers/test_worker_suite.py` already exists as a
  single entry point across all workers; it's just not wired into `pnpm test`
  or CI.
- **ARCH-01/02 (god modules `server.ts` ~3500 lines, `lifeos-store.ts` ~9600
  lines) — still true**, grew rather than shrank since the original audit.
- **ARCH-03, ARCH-04, ARCH-07 — not re-checked this pass.**

### UX

**Not re-checked this pass** — UX-01 through UX-06 were about the web
dashboard and TMA nav, neither of which was touched in this session.
Treat as unverified rather than resolved.

---

## Original audit (2026-06-11, unedited below)

## Executive Summary

LifeOS has a **mature Telegram + TMA + bot backend vertical slice** with strong documentation (`docs/SECURITY.md`, `docs/ARCHITECTURE.md`). The web dashboard is a polished scaffold without live data or auth. Security is well-documented but has **specific implementation gaps** (initData replay, webhook timing-safe compare, CORS wildcard). Architecture concentrates complexity in two large files (`server.ts`, `lifeos-store.ts`).

---

## UX Issues

### UX-01: Web Dashboard Non-Functional (High)

**Location:** `apps/web/app/(dashboard)/*`  
**Finding:** All pages show placeholder copy (“API pending”). Only `GET /healthz` is wired via `lib/system-status.ts`.  
**Impact:** Dashboard provides no operational value despite production-ready visual design.  
**Recommendation:** Implement `/api/web/*` routes on bot + wire Server Components. Follow `skills/ui-ux/dashboard-guidelines.md`.

### UX-02: TMA Bottom Nav Cramped (Medium)

**Location:** `apps/tma/src/components/AppShell.tsx` — `grid-cols-8`, `text-[10px]`  
**Finding:** Eight tabs with labels on a 320–390px viewport cause truncation and low tap precision.  
**Recommendation:** Icons-only below 360px, or regroup into 4 primary + “More”. See `skills/ui-ux/mobile-ux.md`.

### UX-03: Hardcoded “Live” Badge (Low)

**Location:** `apps/tma/src/components/AppShell.tsx` line 51–53  
**Finding:** Badge always shows “Live” regardless of API health.  
**Recommendation:** Bind to `/healthz` or remove until health polling exists.

### UX-04: Duplicated Design System (Medium)

**Location:** `apps/web/tailwind.config.ts`, `apps/tma/tailwind.config.ts`  
**Finding:** Identical `graphite`/`signal` tokens and similar components (`MetricCard` vs `MetricTile`) with no shared package.  
**Recommendation:** Extract `@lifeos/ui` when web APIs stabilize. Until then, keep tokens in sync manually.

### UX-05: Limited TMA Deep Linking (Low)

**Location:** `apps/tma/src/main.tsx` — in-memory `ScreenId` state  
**Finding:** Most navigation is `useState`; only `?screen=` and `?workoutId=` supported.  
**Recommendation:** Expand URL params for shareable states (finance, reminders).

### UX-06: Missing Android Health Bridge (Medium)

**Location:** README references `apps/android-health-bridge`; repo has `apps/health-bridge` scaffold only  
**Finding:** Documentation promises installable bridge not present in repo.  
**Recommendation:** Align README with `docs/ANDROID_HEALTH_BRIDGE_PLAN.md` status or add the app.

---

## Security Issues

### SEC-01: No Web Dashboard Authentication (Critical)

**Location:** `apps/web`  
**Finding:** No Supabase client, session middleware, or protected routes. Public Vercel deploy exposes dashboard shell.  
**Recommendation:** Implement Supabase Auth + `/api/web/*` with JWT validation before public deploy. See `skills/security/auth-security.md`.

### SEC-02: initData Replay — No auth_date Check (High)

**Location:** `apps/bot/src/server.ts` → `validateTelegramInitData()`  
**Finding:** HMAC validated but `auth_date` freshness not checked. Stolen initData reusable until Telegram rotates it.  
**Recommendation:** Reject if `Date.now()/1000 - auth_date > 86400`.

### SEC-03: Webhook Secret Non-Timing-Safe Compare (Medium)

**Location:** `apps/bot/src/server.ts` line 1976 — `providedSecret !== options.webhookSecret`  
**Finding:** Ingest secret uses `secureCompare()`; webhook uses plain `!==`.  
**Recommendation:** Use existing `secureCompare()` helper.

### SEC-04: CORS Wildcard (Medium)

**Location:** `apps/bot/src/server.ts` — `Access-Control-Allow-Origin: *`  
**Finding:** Any origin can call TMA APIs from browser if initData is obtained.  
**Recommendation:** Allowlist `TMA_ORIGIN` and `WEB_ORIGIN` in production.

### SEC-05: Dev Auth Bypass Risk (Critical if misconfigured)

**Location:** `ALLOW_UNSAFE_TMA_DEV_AUTH` in `apps/bot/src/config.ts`  
**Finding:** Bypasses initData validation when true. Documented as dev-only but not enforced at startup.  
**Recommendation:** Fail startup if `NODE_ENV=production` and bypass is true.

### SEC-06: Service Role Bypasses RLS (Medium — by design)

**Location:** `packages/db/src/client.ts`, all bot store calls  
**Finding:** All authorization is application-layer. Bug in `user_id` filter = full data exposure.  
**Recommendation:** Mandatory `userId` param on store methods; PR review checklist in `skills/security/architecture-review.md`.

### SEC-07: No Rate Limiting (Medium)

**Location:** All public endpoints in `server.ts`  
**Finding:** Webhook, TMA, ingest lack throttling.  
**Recommendation:** Per-IP or per-user rate limits at Railway proxy or in-process.

### SEC-08: Receipt Upload Validation (Low)

**Location:** TMA finance flow — base64 JSON in request body  
**Finding:** 1 MB body limit helps but no image type/dimension validation documented.  
**Recommendation:** Validate magic bytes and max dimensions server-side.

---

## Architecture Issues

### ARCH-01: God Module — server.ts (~2000 lines) (Medium)

**Location:** `apps/bot/src/server.ts`  
**Finding:** All routing, auth, and handlers in one file.  
**Recommendation:** Extract domain handlers (`tma-workout.ts`, `tma-finance.ts`) imported by server.

### ARCH-02: God Module — lifeos-store.ts (~8500 lines) (Medium)

**Location:** `packages/db/src/lifeos-store.ts`  
**Finding:** All persistence in single class.  
**Recommendation:** Split by domain (health, finance, workout) behind `LifeOSStore` facade.

### ARCH-03: Web API Gap (High)

**Location:** `docs/ARCHITECTURE.md` vs `server.ts`  
**Finding:** Docs state web reads through backend APIs; no `/api/web/*` routes exist.  
**Recommendation:** Add web route family with Supabase JWT auth when web auth ships.

### ARCH-04: Frontends Decoupled from Core Types (Medium)

**Location:** `apps/tma/src/api/types.ts` — not imported from `@lifeos/core`  
**Finding:** API contracts duplicated; drift risk between core and TMA types.  
**Recommendation:** Export shared types from `@lifeos/core` when stable.

### ARCH-05: Workers Outside pnpm Workspace (Low)

**Location:** `workers/*`  
**Finding:** No unified `pnpm test` for Python workers.  
**Recommendation:** Add CI job for `workers/common/lifeos_sync_test.py` and worker lint.

### ARCH-06: Root tsconfig Excludes Web/TMA (Low)

**Location:** Root `tsconfig.json`  
**Finding:** `pnpm typecheck` may not cover `apps/web` and `apps/tma`.  
**Recommendation:** Add web/tma to root typecheck script or document per-app requirement.

### ARCH-07: Single-Tenant Bootstrap Assumptions (Info)

**Location:** `LIFEOS_DEFAULT_USER_ID`, `LIFEOS_DEFAULT_TELEGRAM_USER_ID`  
**Finding:** Intentional for personal OS; multi-tenant needs auth redesign.  
**Recommendation:** Document limitation; no action for current phase.

---

## Recommendations Priority Matrix

| Priority | ID         | Action                                    |
| -------- | ---------- | ----------------------------------------- |
| P0       | SEC-01     | Web auth before public dashboard deploy   |
| P0       | SEC-05     | Enforce dev auth bypass off in production |
| P1       | SEC-02     | initData `auth_date` validation           |
| P1       | SEC-03     | Timing-safe webhook secret compare        |
| P1       | UX-01      | Wire web dashboard to `/api/web/*`        |
| P1       | SEC-04     | CORS origin allowlist                     |
| P2       | SEC-07     | Rate limiting                             |
| P2       | UX-02      | TMA nav density fix                       |
| P2       | ARCH-01/02 | Modularize server.ts and store            |
| P3       | UX-03–06   | Polish items                              |

---

## Positive Findings

- Comprehensive `docs/SECURITY.md` and security tests in `server.test.ts`
- Correct Telegram initData HMAC implementation
- JWT-only health ingest tokens scoped to authenticated TMA users
- RLS enabled on user tables in migrations
- Pure `@lifeos/core` boundary respected
- Obsidian path traversal protection in `@lifeos/obsidian`
- Consistent dark design language across web and TMA
- TanStack Query + `AsyncState` pattern in TMA

---

## Related Skills

Issues map to skills for remediation guidance:

| Category      | Skill                        |
| ------------- | ---------------------------- |
| UX            | `skills/ui-ux/*`             |
| Security      | `skills/security/*`          |
| Architecture  | `skills/lifeos-architect.md` |
| Agent routing | `AGENTS.md`                  |
