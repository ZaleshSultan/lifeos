# LifeOS Web Dashboard Guidelines

> Applies to `apps/web` — Next.js 16 App Router dashboard.
> Informed by [UI/UX Pro Max Skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) dashboard patterns.

## Dashboard Role

The web dashboard is the **desktop command center** for LifeOS. It complements (does not replace) Telegram capture and the TMA.

| Route | Purpose | Data source (target) |
|-------|---------|----------------------|
| `/today` | Daily operating queue, focus, mode | `/api/web/home` (planned) |
| `/health` | Recovery mode, ingest status | `/api/web/health` (planned) |
| `/finance` | Monthly spend, categories | `/api/web/finance` (planned) |
| `/study` | Academic sources, courses | `/api/web/academic` (planned) |
| `/settings` | System status, env hints | `GET /healthz` (live today) |

**Current state:** Pages are scaffold UI with placeholder copy (“API pending”). New work should wire real backend endpoints without changing visual structure.

## Layout Architecture

### AppShell (`components/AppShell.tsx`)

```
┌─────────────────────────────────────────────────────┐
│  Desktop (xl+): fixed sidebar w-56                  │
│  Mobile: top header + bottom tab bar (5 items)      │
├─────────────────────────────────────────────────────┤
│  Main content: max-width container, pb-28 mobile    │
└─────────────────────────────────────────────────────┘
```

### Responsive Breakpoints

| Breakpoint | Navigation | Content |
|------------|------------|---------|
| `< xl` | Bottom tab bar (5 routes) | Full width, `pb-28` for tab clearance |
| `≥ xl` | Fixed left sidebar | Content area with left margin |

### Page Structure

Every dashboard page should follow:

```tsx
<>
  <PageHeader kicker="..." title="..." summary="..." />
  <div className="dashboard-grid">
    <MetricCard ... />
  </div>
  <div className="mt-6 grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
    <SectionPanel ... />
    <SectionPanel ... />
  </div>
</>
```

## Component Usage Rules

### PageHeader

- `kicker`: domain label (e.g. “Command Center”, “Recovery”).
- `title`: page name.
- `summary`: one sentence explaining value — not marketing fluff.

### MetricCard

- Max 4–6 cards per page row (`dashboard-grid` handles responsive columns).
- `value`: live data or honest empty state (“—”, “No data”).
- `detail`: explains data provenance (“from Telegram captures”, “last ingest”).
- Assign `tone` by domain (see `design-principles.md`).

### SectionPanel

- `eyebrow`: short category label.
- `title`: section heading.
- List rows: `rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3`.
- Hover on interactive rows: `hover:bg-white/[0.04]`.

## Data Fetching Patterns

### Today (Server Components)

```tsx
// Preferred pattern when /api/web/* exists:
export default async function TodayPage() {
  const data = await getTodaySummary(); // server-side fetch to bot backend
  return ( ... );
}
```

### Settings / System Status (Current)

`lib/system-status.ts` fetches `GET /healthz` from `LIFEOS_BACKEND_URL`. Reuse this pattern for connectivity indicators.

### Rules

1. **Never** embed `SUPABASE_SERVICE_ROLE_KEY` in web app.
2. All user data flows through `apps/bot` API routes with session auth (when implemented).
3. Use Server Components for initial load; Client Components only for interactivity.
4. Show skeleton or “unavailable” when backend is down — not fake data.

## Empty & Error States

| State | Pattern |
|-------|---------|
| No data | Neutral panel: “Nothing captured yet” + link to Telegram `/cap` |
| API pending | Current badge style is OK for dev; replace with real data in prod |
| Backend down | Rose-tinted banner referencing settings page |
| Loading | Skeleton cards matching `MetricCard` dimensions |

## Navigation Guidelines

Current nav items (do not add without architectural review):

1. Today
2. Health
3. Finance
4. Study
5. Settings

**Do not** mirror TMA’s 8-tab density on web — desktop has room for sidebar grouping if more routes are needed.

## System Status Footer

Sidebar/footer shows backend connectivity from `systemStatus`. Extend with:

- Last health ingest timestamp
- Obsidian queue depth (when API exists)
- Telegram bot link status

## Future: Shared Design Package

`apps/web` and `apps/tma` duplicate tokens in separate `tailwind.config.ts` files. When extracting `@lifeos/ui`:

1. Move `graphite` + `signal` colors to shared preset.
2. Export `MetricCard`, `SectionPanel`, `PageHeader`.
3. Keep app-specific shells (`AppShell`) in each app.

## Dashboard Pre-Delivery Checklist

- [ ] Page uses `PageHeader` + `MetricCard` + `SectionPanel` trinity
- [ ] No hardcoded fake metrics in production builds
- [ ] `dashboard-grid` responsive at 375px, 768px, 1280px
- [ ] Active nav state matches `pathname` (web) — not hardcoded
- [ ] Settings page documents how to connect Telegram + backend URL
- [ ] All external links open in new tab with `rel="noopener noreferrer"`
