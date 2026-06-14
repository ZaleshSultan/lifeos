# LifeOS UI/UX Design Principles

> Adapted for LifeOS from [UI/UX Pro Max Skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill).
> Applies to `apps/web`, `apps/tma`, and Telegram bot reply copy.

## Product Context

LifeOS is a **personal operating system** — not a marketing site. Users interact through:

- **Telegram bot** — fastest capture surface (commands, short replies).
- **Telegram Mini App (TMA)** — dense mobile workflows (workout, focus, finance).
- **Web dashboard** — desktop command center (today, health, finance, study).

Design for **clarity under cognitive load**, not visual novelty.

## Visual Language (Current System)

Both `apps/web` and `apps/tma` converge on a shared dark “graphite” theme:

| Token | Value | Usage |
|-------|-------|-------|
| `graphite-950` | `#05070b` | Page background |
| `graphite-900`–`800` | `#090d14`–`#111927` | Elevated surfaces |
| `signal.cyan` | `#22d3ee` | Primary accent, active nav |
| `signal.mint` | `#4ade80` | Success, health-positive |
| `signal.amber` | `#fbbf24` | Deadlines, warnings |
| `signal.rose` | `#fb7185` | Errors, destructive |
| `signal.violet` | `#a78bfa` | Mode, finance |

### Panel Pattern

```tsx
// Standard content panel — reuse everywhere
className="rounded-xl border border-white/[0.08] bg-white/[0.03]"
```

### Typography

- Font: **Inter** (system fallback stack in `tailwind.config.ts`).
- Labels: `text-[11px] font-semibold uppercase tracking-widest text-zinc-500`.
- Values: `text-[26px] font-semibold tabular-nums text-white`.
- Body: `text-[13px] leading-relaxed text-zinc-600`.

## Core Principles

### 1. Actionable Over Decorative

Every screen answers: *“What should I do next?”*

- Bot replies: short, command-oriented (see `docs/BOT_UX.md`).
- TMA screens: primary action visible without scroll.
- Web dashboard: KPI cards link to detail views when APIs exist.

### 2. Consistent Component Vocabulary

| Component | Web | TMA | Purpose |
|-----------|-----|-----|---------|
| `AppShell` | Sidebar + bottom nav | 8-tab bottom nav | Navigation chrome |
| `MetricCard` / `MetricTile` | ✓ | ✓ | KPI display |
| `SectionPanel` | ✓ | inline panels | Grouped content |
| `PageHeader` | ✓ | screen titles | Context + summary |
| `LoadingPanel` / `ErrorPanel` | — | ✓ | Async states |

**Rule:** When adding UI in one app, check the sibling app for an existing pattern before inventing new ones.

### 3. Signal Colors Map to Domain Meaning

| Tone | Domain |
|------|--------|
| `cyan` | Default, system, focus |
| `mint` | Health, completion, queue |
| `amber` | Deadlines, pending |
| `rose` | Errors, alerts |
| `violet` | Mode, finance |

Do not use signal colors purely for decoration.

### 4. Icons: Lucide Only

- Use `lucide-react` — never emojis as functional icons.
- Icon size: `h-4 w-4` (nav), `h-5 w-5` (TMA tabs), `h-[18px]` (metric cards).
- Active state: accent color (`text-cyan-400`).

### 5. Motion & Interaction

- Transitions: `transition-all duration-150` (nav), `duration-200` (cards).
- Press feedback on mobile: `active:scale-[0.98]` on buttons.
- Loading: skeleton pulse in `LoadingPanel` — never blank screens.
- Respect `prefers-reduced-motion` for new animations.

### 6. Accessibility Baseline

- All icon-only buttons need `aria-label` (TMA bottom nav does this correctly).
- Text contrast: `text-zinc-500` on `#05070b` — verify 4.5:1 for body copy; bump to `zinc-400` if failing.
- Focus rings on interactive elements in web dashboard.
- Error messages must be human-readable, not error codes alone.

## Anti-Patterns for LifeOS

| Avoid | Why | Instead |
|-------|-----|---------|
| Bright gradients / “AI purple” aesthetics | Conflicts with calm personal-OS tone | Graphite + single accent |
| Full workout state in Telegram URLs | Security + URL length | Short TMA URL, state in Supabase |
| Hardcoded “Live” badges | Misleading when API is down | Bind to `/healthz` or remove |
| 8 cramped nav labels on small phones | Illegible at `text-[10px]` | Icons-first or grouped nav |
| Placeholder copy in production | Erodes trust | “No data yet” + action CTA |
| Duplicating design tokens ad hoc | Drift between web/TMA | Extract shared tokens (future `@lifeos/ui`) |

## Pre-Delivery Checklist

- [ ] Uses existing `cx()` helper from `lib/styles.ts`
- [ ] Panel borders use `border-white/[0.08]`, not raw hex
- [ ] Clickable elements have hover + active states
- [ ] Async data uses loading/error states (TMA `AsyncState`)
- [ ] Mobile safe areas: `pb-[max(0.75rem,env(safe-area-inset-bottom))]`
- [ ] No secrets or internal IDs exposed in UI
- [ ] Health mode labels use public names: Recovery Mode, Normal-Light, Normal, High Performance

## Upstream Reference

For industry-specific palettes, landing patterns, and extended checklists, consult the upstream [UI/UX Pro Max Skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) repository. LifeOS skills here override upstream when they conflict with project conventions.
