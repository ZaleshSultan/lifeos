# LifeOS Mobile & TMA UX Guidelines

> Applies to `apps/tma` (Telegram Mini App) and mobile layouts in `apps/web`.
> Informed by [UI/UX Pro Max Skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill).

## TMA Context

The Telegram Mini App is opened from a **short bot URL**. Users expect:

- Instant load inside Telegram WebView
- Thumb-reachable navigation
- Haptic feedback on key actions
- No account login screens (auth via `initData`)

## Layout Constraints

| Constraint             | Value                         | Source             |
| ---------------------- | ----------------------------- | ------------------ |
| Max content width      | `max-w-md` (448px)            | `AppShell.tsx`     |
| Bottom nav height      | `min-h-14` per tab            | TMA `AppShell`     |
| Content bottom padding | `pb-28`                       | Clears fixed nav   |
| Safe area              | `env(safe-area-inset-bottom)` | iOS notch/home bar |
| Header                 | Sticky, `backdrop-blur-md`    | `safe-shell` class |

## Navigation Model

### Current: 8-Tab Bottom Bar

```
Home | Workout | Health | Focus | Finance | Sources | Reminders | Mode
```

**Known issue:** `grid-cols-8` with `text-[10px]` labels is cramped on narrow phones.

### Recommended Patterns

| Pattern                           | When to use                |
| --------------------------------- | -------------------------- |
| Icons-only below 360px            | Reduce label truncation    |
| Primary 4 + “More” drawer         | If nav exceeds 5 items     |
| `aria-label` on every icon button | Already implemented — keep |
| Deep links via `?screen=`         | Home, workout screens      |

Screen state is in-memory (`useState<ScreenId>`). Prefer URL params for shareable states:

```
?tma.example.com/?screen=workout&workoutId=uuid
```

## Telegram SDK Integration

Use `@twa-dev/sdk` for:

- `WebApp.initData` → sent as `X-Telegram-Init-Data` header
- `WebApp.themeParams` → map to CSS variables where possible
- `WebApp.HapticFeedback` → confirm set completion, expense save
- `WebApp.expand()` → use full viewport height

**Never** log or display raw `initData` in UI.

## Async State Pattern

All data screens must use TanStack Query + `AsyncState` components:

```tsx
const { data, isLoading, isError, refetch } = useHomeQuery();

if (isLoading) return <LoadingPanel title="Loading home..." />;
if (isError)
  return <ErrorPanel title="Could not load" onRetry={() => refetch()} />;
```

### Error Copy Guidelines

| Error code                 | User message                         |
| -------------------------- | ------------------------------------ |
| `telegram_user_not_linked` | “Link your Telegram in /start first” |
| `database_not_configured`  | “Backend is starting up — try again” |
| Network failure            | “Check connection and retry”         |

## Touch Targets

- Minimum tap target: **44×44px** (`min-h-14` on nav buttons).
- Primary actions: `h-11` buttons with `active:scale-[0.98]`.
- List rows: full-width tap area, not just text.

## Screen-Specific UX

### Workout

- Large set-completion buttons
- Rest timer visible without scroll
- Persist state to backend on every set — not on screen exit

### Focus

- Single prominent score ring (`ProgressRing`)
- Mode influence explained in one line

### Finance

- Receipt capture: camera-first on mobile
- Show processing state during OCR
- Confirm amount before save

### Reminders

- Swipe or tap to complete (when implemented)
- Show next fire time in local timezone

## Web Dashboard Mobile (`apps/web`)

Mobile web uses bottom tab bar (5 items) — less dense than TMA:

- `pb-28` content padding
- `safe-area-inset-bottom` on nav
- Sidebar hidden below `xl` breakpoint

Keep parity: same route names and icon semantics as desktop sidebar.

## Mock Data Guard

`VITE_ALLOW_MOCK_DATA` gates mock fallback in `api/client.ts`.

- **Development:** mocks OK for UI iteration.
- **Production:** must be `false` — users must see real errors, not fake data.

## Mobile Pre-Delivery Checklist

- [ ] Tested at 320px and 390px widths in Telegram WebView
- [ ] Bottom nav does not obscure primary CTA
- [ ] `LoadingPanel` shown during all network fetches
- [ ] `ErrorPanel` with retry on all screens
- [ ] No horizontal scroll on any screen
- [ ] Haptic feedback on destructive/confirm actions
- [ ] `initData` never in console logs or error reports
- [ ] “Live” badge reflects actual API health (or removed)

## Performance

- Code-split screens if bundle grows (Vite dynamic `import()`).
- Prefetch home data on app mount.
- Image uploads: compress before base64 JSON POST (finance receipts).
- Respect Telegram’s WebView memory limits — avoid large inline images.
