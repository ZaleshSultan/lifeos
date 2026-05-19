"use client";

import {
  Activity,
  BookOpenCheck,
  CircleDollarSign,
  HeartPulse,
  LayoutDashboard,
  Settings,
  Zap,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/lib/styles";
import type { SystemStatus } from "@/lib/system-status";

interface AppShellProps {
  children: React.ReactNode;
  systemStatus: SystemStatus;
}

const navItems: Array<{
  href: string;
  label: string;
  icon: LucideIcon;
}> = [
  { href: "/today", label: "Today", icon: LayoutDashboard },
  { href: "/health", label: "Health", icon: HeartPulse },
  { href: "/finance", label: "Finance", icon: CircleDollarSign },
  { href: "/study", label: "Study", icon: BookOpenCheck },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppShell({ children, systemStatus }: AppShellProps) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen">
      {/* ── Desktop Sidebar ─────────────────────────────────── */}
      <aside className="fixed inset-y-0 left-0 hidden w-56 flex-col border-r border-white/[0.06] bg-graphite-950 px-3 py-5 xl:flex">
        {/* Brand */}
        <div className="mb-6 flex items-center gap-2.5 px-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-cyan-400/25 bg-cyan-400/10">
            <Zap className="h-3.5 w-3.5 text-cyan-400" />
          </div>
          <span className="text-sm font-semibold tracking-tight text-white">
            LifeOS
          </span>
        </div>

        {/* Nav items */}
        <nav className="flex-1 space-y-0.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cx(
                  "group flex h-8 items-center gap-2.5 rounded-md px-2 text-sm font-medium transition-all duration-150",
                  active
                    ? "bg-white/[0.08] text-white"
                    : "text-zinc-500 hover:bg-white/[0.05] hover:text-zinc-200",
                )}
              >
                <Icon
                  className={cx(
                    "h-4 w-4 shrink-0 transition-colors",
                    active
                      ? "text-cyan-400"
                      : "text-zinc-600 group-hover:text-zinc-400",
                  )}
                />
                <span className="flex-1">{item.label}</span>
                {active && (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Status footer */}
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span
              className={cx(
                "h-1.5 w-1.5 shrink-0 rounded-full",
                systemStatus.online ? "bg-emerald-400" : "bg-amber-400",
              )}
            />
            <span className="min-w-0 truncate text-xs font-medium text-zinc-400">
              {systemStatus.label}
            </span>
          </div>
          <p className="mt-1 text-[11px] tabular-nums text-zinc-600">
            {systemStatus.checkedAt}
          </p>
        </div>
      </aside>

      <div className="xl:pl-56">
        {/* ── Mobile Header ────────────────────────────────── */}
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-white/[0.06] bg-graphite-950/90 px-4 py-3 backdrop-blur-md xl:hidden">
          <div className="flex items-center gap-2.5">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-cyan-400/25 bg-cyan-400/10">
              <Zap className="h-3 w-3 text-cyan-400" />
            </div>
            <span className="text-sm font-semibold tracking-tight text-white">
              LifeOS
            </span>
          </div>
          <div
            className={cx(
              "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium",
              systemStatus.online
                ? "border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-400"
                : "border-amber-400/20 bg-amber-400/[0.08] text-amber-400",
            )}
          >
            <span
              className={cx(
                "h-1.5 w-1.5 shrink-0 rounded-full",
                systemStatus.online ? "bg-emerald-400" : "bg-amber-400",
              )}
            />
            {systemStatus.shortLabel}
          </div>
        </header>

        {/* ── Main Content ─────────────────────────────────── */}
        <main className="mx-auto min-h-screen max-w-6xl px-4 pb-28 pt-6 md:px-6 md:pt-8 xl:pb-12">
          {children}
        </main>

        {/* ── Mobile Bottom Nav ────────────────────────────── */}
        <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-white/[0.06] bg-graphite-950/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-md xl:hidden">
          <div className="mx-auto grid max-w-sm grid-cols-5">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-label={item.label}
                  className={cx(
                    "flex flex-col items-center gap-1 py-1 text-[10px] font-medium transition-colors duration-150",
                    active ? "text-white" : "text-zinc-600 hover:text-zinc-400",
                  )}
                >
                  <div
                    className={cx(
                      "flex h-8 w-8 items-center justify-center rounded-lg transition-all",
                      active ? "bg-white/[0.1]" : "",
                    )}
                  >
                    <Icon
                      className={cx("h-4 w-4", active ? "text-cyan-400" : "")}
                    />
                  </div>
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}
