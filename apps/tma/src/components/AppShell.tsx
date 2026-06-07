import {
  Activity,
  Bell,
  Dumbbell,
  HeartPulse,
  Home,
  PlugZap,
  Settings2,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { ScreenId } from "../types";
import { cx } from "../lib/styles";

interface AppShellProps {
  screen: ScreenId;
  onScreenChange: (screen: ScreenId) => void;
  children: React.ReactNode;
}

const tabs: Array<{ id: ScreenId; label: string; icon: LucideIcon }> = [
  { id: "home", label: "Home", icon: Home },
  { id: "workout", label: "Workout", icon: Dumbbell },
  { id: "health", label: "Health", icon: HeartPulse },
  { id: "focus", label: "Focus", icon: Activity },
  { id: "sources", label: "Sources", icon: PlugZap },
  { id: "reminders", label: "Reminders", icon: Bell },
  { id: "mode", label: "Mode", icon: Settings2 },
];

export function AppShell({ screen, onScreenChange, children }: AppShellProps) {
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
            Live
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 pb-28 pt-4">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-white/[0.06] bg-graphite-950/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-md">
        <div className="mx-auto grid max-w-md grid-cols-7">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = screen === tab.id;

            return (
              <button
                aria-label={tab.label}
                className={cx(
                  "flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg py-1 text-[10px] font-medium transition active:scale-[0.98]",
                  active
                    ? "bg-white/[0.1] text-white"
                    : "text-zinc-600 hover:bg-white/[0.04] hover:text-zinc-400",
                )}
                key={tab.id}
                onClick={() => onScreenChange(tab.id)}
                type="button"
              >
                <Icon
                  className={cx(
                    "h-5 w-5",
                    active ? "text-cyan-400" : "text-zinc-600",
                  )}
                />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
