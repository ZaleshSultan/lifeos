import {
  Activity,
  Bell,
  Dumbbell,
  HeartPulse,
  House,
  GraduationCap,
  LayoutDashboard,
  MoreHorizontal,
  PlugZap,
  Settings2,
  Sparkles,
  WalletCards,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import type { ScreenId } from "../types";
import { cx } from "../lib/styles";

interface AppShellProps {
  screen: ScreenId;
  onScreenChange: (screen: ScreenId) => void;
  children: ReactNode;
  showNavigation?: boolean;
  statusLabel?: string;
}

type NavigationItem = { id: ScreenId; label: string; icon: LucideIcon };

const primaryTabs: NavigationItem[] = [
  { id: "home", label: "Сегодня", icon: House },
  { id: "dashboard", label: "Дашборд", icon: LayoutDashboard },
  { id: "study", label: "Учёба", icon: GraduationCap },
  { id: "ai", label: "AI", icon: Sparkles },
];

const secondaryTabs: NavigationItem[] = [
  { id: "health", label: "Здоровье", icon: HeartPulse },
  { id: "workout", label: "Тренировки", icon: Dumbbell },
  { id: "focus", label: "Фокус", icon: Activity },
  { id: "finance", label: "Финансы", icon: WalletCards },
  { id: "sources", label: "Интеграции", icon: PlugZap },
  { id: "reminders", label: "Напоминания", icon: Bell },
  { id: "mode", label: "Режим", icon: Settings2 },
];

const screenNames: Partial<Record<ScreenId, string>> = {
  home: "Обзор дня",
  dashboard: "Академический дашборд",
  study: "Учебный центр",
  lms: "Подключение LMS",
  ai: "AI-помощник",
  workout: "Тренировки",
  health: "Здоровье",
  focus: "Фокус",
  finance: "Финансы",
  sources: "Интеграции",
  reminders: "Напоминания",
  mode: "Режим",
};

export function AppShell({
  children,
  onScreenChange,
  screen,
  showNavigation = true,
  statusLabel = "LifeOS",
}: AppShellProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const selectScreen = (next: ScreenId) => {
    onScreenChange(next);
    setMoreOpen(false);
    window.scrollTo({ top: 0, behavior: "auto" });
  };
  const activeGroup = screen === "lms" ? "study" : screen;
  const moreSelected = secondaryTabs.some((item) => item.id === screen);

  return (
    <div className="lo-shell mx-auto flex min-h-screen w-full max-w-md flex-col">
      <header className="lo-header safe-shell sticky top-0 z-20 px-5">
        <div className="lo-header-inner flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="lo-brand-mark" aria-hidden="true">
              <Zap className="h-[19px] w-[19px]" strokeWidth={2.5} />
            </div>
            <div className="min-w-0">
              <div className="lo-brand-wordmark">lifeos<span className="lo-brand-dot">.</span></div>
              <div className="lo-header-subtitle">{screenNames[screen] ?? "Личная система"}</div>
            </div>
          </div>
          <div className="lo-header-status" aria-label={statusLabel}>
            <span className="lo-status-light" aria-hidden="true" />
            <span>{statusLabel === "LifeOS" ? "в сети" : statusLabel}</span>
          </div>
        </div>
      </header>

      <main id="lifeos-main" className="lo-content flex-1 px-4 pb-32 pt-5">
        {children}
      </main>

      {showNavigation ? (
        <nav
          aria-label="Разделы LifeOS"
          onKeyDown={(event) => {
            if (event.key === "Escape") setMoreOpen(false);
          }}
          className="lo-bottom-nav fixed inset-x-0 bottom-0 z-30"
        >
          {moreOpen ? (
            <div id="more-sections" className="lo-more-panel" aria-label="Другие разделы">
              <div className="lo-more-heading">Другие разделы</div>
              <div className="lo-more-grid">
                {secondaryTabs.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    aria-current={screen === id ? "page" : undefined}
                    className={cx("lo-more-link", screen === id && "lo-more-link--active")}
                    onClick={() => selectScreen(id)}
                  >
                    <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="lo-nav-inner">
            {primaryTabs.map(({ id, label, icon: Icon }) => {
              const active = activeGroup === id;
              return (
                <button
                  key={id}
                  type="button"
                  aria-label={label}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "lo-nav-item",
                    active && "lo-nav-item--active",
                    id === "ai" && "lo-nav-item--ai",
                  )}
                  onClick={() => selectScreen(id)}
                >
                  <span className="lo-nav-icon">
                    <Icon className="h-[21px] w-[21px]" strokeWidth={active ? 2.35 : 1.9} aria-hidden="true" />
                  </span>
                  <span className="lo-nav-label">{label}</span>
                </button>
              );
            })}
            <button
              type="button"
              aria-label="Другие разделы"
              aria-controls="more-sections"
              aria-expanded={moreOpen}
              className={cx("lo-nav-item", (moreOpen || moreSelected) && "lo-nav-item--active")}
              onClick={() => setMoreOpen((open) => !open)}
            >
              <span className="lo-nav-icon"><MoreHorizontal className="h-[22px] w-[22px]" aria-hidden="true" /></span>
              <span className="lo-nav-label">Ещё</span>
            </button>
          </div>
        </nav>
      ) : null}
    </div>
  );
}
