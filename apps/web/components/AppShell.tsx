"use client";
import {
  BookOpenCheck,
  CalendarDays,
  CheckSquare,
  CircleDollarSign,
  Clapperboard,
  Video,
  Dumbbell,
  HeartPulse,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Bell,
  Settings,
  Utensils,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { cx } from "@/lib/styles";
import type { SystemStatus } from "@/lib/system-status";

function SignOutButton({ mobile = false }: { mobile?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const inFlight = useRef(false);
  async function signOut() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(false);
    try {
      const response = await fetch("/web/logout", {
        method: "POST",
        mode: "cors",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "follow",
      });
      const destination = new URL(response.url);
      if (
        !response.ok ||
        !response.redirected ||
        destination.origin !== window.location.origin ||
        destination.pathname !== "/web/access"
      )
        throw new Error("logout_unavailable");
      window.location.assign("/web/access");
    } catch {
      setError(true);
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <form
      action="/web/logout"
      method="post"
      className="mt-3"
      onSubmit={(event) => {
        event.preventDefault();
        void signOut();
      }}
    >
      <button
        type="submit"
        disabled={busy}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-white/15 px-3 text-sm text-zinc-200 disabled:opacity-50"
      >
        <LogOut className="h-4 w-4" />
        {busy ? "Закрываем сессию…" : mobile ? "Выйти из LifeOS" : "Выйти"}
      </button>
      {error ? (
        <p role="alert" className="mt-2 text-xs leading-relaxed text-rose-200">
          Не удалось выйти. Повтори попытку; сессия не считается закрытой.
        </p>
      ) : null}
    </form>
  );
}

const navItems: Array<{ href: string; label: string; icon: LucideIcon }> = [
  { href: "/today", label: "Сегодня", icon: LayoutDashboard },
  { href: "/planner", label: "Задачи и план", icon: CheckSquare },
  { href: "/calendar", label: "Календарь", icon: CalendarDays },
  { href: "/study", label: "Учёба", icon: BookOpenCheck },
  { href: "/workouts", label: "Тренировки", icon: Dumbbell },
  { href: "/health", label: "Здоровье", icon: HeartPulse },
  { href: "/nutrition", label: "Еда и вода", icon: Utensils },
  { href: "/finance", label: "Финансы", icon: CircleDollarSign },
  { href: "/ai", label: "AI помощник", icon: MessageSquare },
  { href: "/ideal-human", label: "Ideal Human", icon: Clapperboard },
  { href: "/creator", label: "Creator", icon: Video },
  { href: "/notifications", label: "Напоминания", icon: Bell },
  { href: "/settings", label: "Настройки", icon: Settings },
];
const mobileItems = [navItems[0], navItems[1], navItems[3], navItems[9]];

export function AppShell({
  children,
  systemStatus,
  userName,
}: {
  children: React.ReactNode;
  systemStatus: SystemStatus;
  userName?: string | null;
}) {
  const pathname = usePathname().replace(/^\/web(?=\/|$)/, "") || "/today";
  const [moreOpen, setMoreOpen] = useState(false);
  const navigation = (mobile = false) =>
    navItems.map(({ href, label, icon: Icon }) => (
      <Link
        key={href}
        href={href}
        prefetch={false}
        aria-current={pathname === href ? "page" : undefined}
        onClick={() => setMoreOpen(false)}
        className={cx(
          "flex min-h-11 min-w-0 items-center gap-3 rounded-lg px-3 text-sm transition-colors",
          pathname === href
            ? "bg-cyan-400/10 text-cyan-200"
            : "text-zinc-300 hover:bg-white/[0.05] hover:text-white",
          mobile && "border border-white/[0.06]",
        )}
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 break-words">{label}</span>
      </Link>
    ));
  return (
    <div className="min-h-screen">
      <a
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-cyan-300 focus:p-3 focus:text-zinc-950"
        href="#lifeos-main"
      >
        К содержимому
      </a>
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-white/[0.08] bg-graphite-950 px-3 py-5 xl:flex">
        <Link
          href="/today"
          className="mb-5 flex min-h-11 items-center gap-3 px-3 text-lg font-semibold text-white"
        >
          <Zap className="h-6 w-6 text-cyan-300" />
          LifeOS
        </Link>
        <nav
          aria-label="Разделы LifeOS"
          className="min-h-0 flex-1 space-y-1 overflow-y-auto"
        >
          {navigation()}
        </nav>
        <div className="mt-4 border-t border-white/[0.08] px-3 pt-4">
          <p className="truncate text-sm text-zinc-100">
            {userName || "Мой LifeOS"}
          </p>
          <p className="mt-1 text-xs text-zinc-400">{systemStatus.label}</p>
          <SignOutButton />
        </div>
      </aside>
      <div className="xl:pl-60">
        <header className="sticky top-0 z-30 flex min-h-16 items-center justify-between gap-3 border-b border-white/[0.08] bg-graphite-950/95 px-4 backdrop-blur-md xl:hidden">
          <Link
            href="/today"
            className="flex items-center gap-2 font-semibold text-white"
          >
            <Zap className="h-5 w-5 text-cyan-300" />
            LifeOS
          </Link>
          <span className="min-w-0 truncate text-xs text-zinc-300">
            {userName}
          </span>
          <span
            className={cx(
              "shrink-0 rounded-full border px-2 py-1 text-[11px]",
              systemStatus.online
                ? "border-emerald-300/20 text-emerald-200"
                : "border-amber-300/20 text-amber-200",
            )}
          >
            {systemStatus.shortLabel}
          </span>
        </header>
        <main
          id="lifeos-main"
          className="mx-auto min-h-screen max-w-7xl px-4 pb-32 pt-6 md:px-6 md:pt-8 xl:pb-12"
        >
          {children}
        </main>
        <nav
          aria-label="Быстрая навигация"
          onKeyDown={(event) => {
            if (event.key === "Escape") setMoreOpen(false);
          }}
          className="fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.08] bg-graphite-950/95 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md xl:hidden"
        >
          {moreOpen ? (
            <section
              id="web-more-nav"
              className="max-h-[70vh] overflow-y-auto border-b border-white/[0.08] p-4"
            >
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-zinc-100">
                  Все разделы
                </h2>
                <button
                  aria-label="Закрыть разделы"
                  type="button"
                  className="grid h-11 w-11 place-items-center text-zinc-200"
                  onClick={() => setMoreOpen(false)}
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">{navigation(true)}</div>
              <SignOutButton mobile />
            </section>
          ) : null}
          <div className="mx-auto grid max-w-xl grid-cols-5 px-2 pt-2">
            {mobileItems.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                prefetch={false}
                aria-label={label}
                aria-current={pathname === href ? "page" : undefined}
                className={cx(
                  "flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg px-1 text-center text-[10px]",
                  pathname === href
                    ? "bg-cyan-300/10 text-cyan-200"
                    : "text-zinc-400",
                )}
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
                <span className="min-w-0 break-words">{label}</span>
              </Link>
            ))}
            <button
              type="button"
              aria-label="Все разделы"
              aria-controls="web-more-nav"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen(!moreOpen)}
              className={cx(
                "flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg text-[10px]",
                moreOpen ? "bg-white/10 text-white" : "text-zinc-400",
              )}
            >
              <Menu className="h-5 w-5" />
              <span>Ещё</span>
            </button>
          </div>
        </nav>
      </div>
    </div>
  );
}
