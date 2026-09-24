import {
  Activity,
  Bell,
  Dumbbell,
  HeartPulse,
  Home,
  GraduationCap,
  MoreHorizontal,
  PlugZap,
  Settings2,
  WalletCards,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import type { ScreenId } from "../types";
import { cx } from "../lib/styles";

interface AppShellProps {
  screen: ScreenId;
  onScreenChange: (screen: ScreenId) => void;
  children: React.ReactNode;
  showNavigation?: boolean;
  statusLabel?: string;
}

const tabs: Array<{ id: ScreenId; label: string; icon: LucideIcon }> = [
  { id: "home", label: "Главная", icon: Home },
  { id: "study", label: "Учёба", icon: GraduationCap },
  { id: "workout", label: "Тренировки", icon: Dumbbell },
  { id: "health", label: "Здоровье", icon: HeartPulse },
  { id: "focus", label: "Фокус", icon: Activity },
  { id: "finance", label: "Финансы", icon: WalletCards },
  { id: "sources", label: "Источники", icon: PlugZap },
  { id: "reminders", label: "Напоминания", icon: Bell },
  { id: "mode", label: "Режим", icon: Settings2 },
];

export function AppShell({
  children,
  onScreenChange,
  screen,
  showNavigation = true,
  statusLabel = "LifeOS",
}: AppShellProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col">
      <header className="safe-shell sticky top-0 z-20 border-b border-white/[0.06] bg-graphite-950/90 px-4 pb-3 backdrop-blur-md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-cyan-400/25 bg-cyan-400/10">
              <Zap className="h-4 w-4 text-cyan-400" />
            </div>
            <div>
              <div className="text-xs font-semibold tracking-tight text-white">
                LifeOS
              </div>
              <div className="text-[11px] font-medium text-zinc-600">
                Telegram Mini App
              </div>
            </div>
          </div>
          <div className="rounded-full border border-emerald-400/20 bg-emerald-400/[0.08] px-2.5 py-1 text-[11px] font-medium text-emerald-400">
            {statusLabel}
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 pb-28 pt-4">{children}</main>

      {showNavigation ? (
        <nav
          aria-label="Разделы LifeOS"
          onKeyDown={(event) => {
            if (event.key === "Escape") setMoreOpen(false);
          }}
          className="fixed inset-x-0 bottom-0 z-30 border-t border-white/[0.06] bg-graphite-950/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-md"
        >
          {moreOpen ? (
            <div
              id="more-sections"
              className="mx-auto mb-2 grid max-w-md grid-cols-2 gap-2 rounded-xl border border-white/[0.08] bg-graphite-900 p-2"
            >
              {tabs.slice(4).map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    aria-current={screen === tab.id ? "page" : undefined}
                    className={cx(
                      "flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 text-sm active:scale-[0.98]",
                      screen === tab.id
                        ? "bg-cyan-400/10 text-cyan-200"
                        : "text-zinc-300 hover:bg-white/[0.06]",
                    )}
                    onClick={() => {
                      onScreenChange(tab.id);
                      setMoreOpen(false);
                    }}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {tab.label}
                  </button>
                );
              })}
            </div>
          ) : null}
          <div className="mx-auto grid max-w-md grid-cols-5">
            {tabs.slice(0, 4).map((tab) => {
              const Icon = tab.icon;
              const active = screen === tab.id;

              return (
                <button
                  aria-label={tab.label}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg py-1 text-[10px] font-medium transition active:scale-[0.98]",
                    active
                      ? "bg-white/[0.1] text-white"
                      : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-300",
                  )}
                  key={tab.id}
                  onClick={() => {
                    onScreenChange(tab.id);
                    setMoreOpen(false);
                  }}
                  type="button"
                >
                  <Icon
                    className={cx(
                      "h-5 w-5",
                      active ? "text-cyan-400" : "text-zinc-400",
                    )}
                  />
                  <span>{tab.label}</span>
                </button>
              );
            })}
            <button
              aria-label="Другие разделы"
              aria-expanded={moreOpen}
              aria-controls="more-sections"
              className={cx(
                "flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg py-1 text-[10px] font-medium active:scale-[0.98]",
                moreOpen || tabs.slice(4).some((tab) => tab.id === screen)
                  ? "bg-white/[0.1] text-cyan-300"
                  : "text-zinc-400",
              )}
              onClick={() => setMoreOpen((open) => !open)}
              type="button"
            >
              <MoreHorizontal className="h-5 w-5" />
              <span>Ещё</span>
            </button>
          </div>
        </nav>
      ) : null}
    </div>
  );
}
