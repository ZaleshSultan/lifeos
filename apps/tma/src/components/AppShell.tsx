import { GraduationCap, HeartPulse, House, Settings2, Zap } from "lucide-react";
import type { ReactNode } from "react";
import type { ScreenId } from "../types";
import { cx } from "../lib/styles";
import {
  PRIMARY_SECTIONS,
  SECTION_SCREENS,
  sectionForScreen,
  type PrimarySection,
} from "../lib/navigation";

interface AppShellProps {
  screen: ScreenId;
  section?: PrimarySection;
  onScreenChange: (screen: ScreenId, section?: PrimarySection) => void;
  children: ReactNode;
  showNavigation?: boolean;
  statusLabel?: string;
}
const icons = {
  home: House,
  health: HeartPulse,
  study: GraduationCap,
  settings: Settings2,
};
export function AppShell({
  children,
  onScreenChange,
  screen,
  section = sectionForScreen(screen),
  showNavigation = true,
  statusLabel = "LifeOS",
}: AppShellProps) {
  const active = PRIMARY_SECTIONS.find((item) => item.id === section)!;
  return (
    <div className="lo-shell mx-auto flex min-h-screen w-full max-w-md flex-col">
      <header className="lo-header safe-shell sticky top-0 z-20 px-5">
        <div className="lo-header-inner flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="lo-brand-mark" aria-hidden="true">
              <Zap className="h-[19px] w-[19px]" strokeWidth={2.5} />
            </div>
            <div className="min-w-0">
              <div className="lo-brand-wordmark">
                lifeos<span className="lo-brand-dot">.</span>
              </div>
              <div className="lo-header-subtitle">{active.description}</div>
            </div>
          </div>
          <div className="lo-header-status" aria-label={statusLabel}>
            <span className="lo-status-light" aria-hidden="true" />
            <span>{statusLabel === "LifeOS" ? "LifeOS" : statusLabel}</span>
          </div>
        </div>
      </header>
      <main id="lifeos-main" className="lo-content flex-1 px-4 pb-32 pt-5">
        {showNavigation ? (
          <nav
            aria-label={`Внутри раздела «${active.label}»`}
            className="mb-5 flex flex-wrap gap-2"
          >
            {SECTION_SCREENS[section].map((item) => (
              <button
                key={item.screen}
                type="button"
                aria-current={screen === item.screen ? "page" : undefined}
                onClick={() => onScreenChange(item.screen, section)}
                className={cx(
                  "min-h-11 min-w-0 rounded-xl border px-3 py-2 text-xs font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300",
                  screen === item.screen
                    ? "border-cyan-300/25 bg-cyan-300/10 text-cyan-100"
                    : "border-white/10 bg-white/[0.03] text-zinc-300 hover:bg-white/[0.06]",
                )}
              >
                {item.label}
              </button>
            ))}
          </nav>
        ) : null}
        {children}
      </main>
      {showNavigation ? (
        <nav
          aria-label="Разделы LifeOS"
          className="lo-bottom-nav fixed inset-x-0 bottom-0 z-30"
        >
          <div
            className="lo-nav-inner"
            style={{ gridTemplateColumns: "repeat(4,minmax(0,1fr))" }}
          >
            {PRIMARY_SECTIONS.map((item) => {
              const Icon = icons[item.id];
              const selected = section === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-label={item.label}
                  aria-current={selected ? "page" : undefined}
                  className={cx(
                    "lo-nav-item focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300",
                    selected && "lo-nav-item--active",
                  )}
                  onClick={() => onScreenChange(item.id, item.id)}
                >
                  <span className="lo-nav-icon">
                    <Icon
                      className="h-[21px] w-[21px]"
                      strokeWidth={selected ? 2.35 : 1.9}
                      aria-hidden="true"
                    />
                  </span>
                  <span className="lo-nav-label">{item.label}</span>
                </button>
              );
            })}
          </div>
        </nav>
      ) : null}
    </div>
  );
}
