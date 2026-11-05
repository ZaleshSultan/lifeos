"use client";
import {
  GraduationCap,
  HeartPulse,
  House,
  LogOut,
  Settings2,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import React, { useEffect, useRef, useState } from "react";
import { cx } from "../lib/styles";
import type { SystemStatus } from "../lib/system-status";
import {
  WEB_MODULES,
  WEB_SECTIONS,
  webNavigationHref,
  webPathname,
  webSection,
} from "../lib/navigation";
import { DraftSessionProvider } from "../../tma/src/lib/retained-draft";

function SignOutButton({ mobile = false }: { mobile?: boolean }) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const inFlight = useRef(false);
  async function signOut() {
    if (!ready || inFlight.current) return;
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
      window.dispatchEvent(new Event("lifeos:signed-out"));
      window.location.assign("/web/access");
    } catch {
      setError(true);
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="mt-3" aria-busy={!ready || busy}>
      <button
        type="button"
        disabled={!ready || busy}
        onClick={() => void signOut()}
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
    </div>
  );
}

const icons = {
  home: House,
  health: HeartPulse,
  study: GraduationCap,
  settings: Settings2,
};
export function AppShell({
  children,
  systemStatus,
  userName,
  draftOwner,
}: {
  children: React.ReactNode;
  systemStatus: SystemStatus;
  userName?: string | null;
  draftOwner: number;
}) {
  const pathname = webPathname(usePathname());
  const search = useSearchParams().toString();
  const section = webSection(
    pathname,
    new URLSearchParams(search).get("section"),
  );
  const active = WEB_SECTIONS.find(({ id }) => id === section)!;
  const primaryLinks = (mobile = false) =>
    WEB_SECTIONS.map(({ id, href, label }) => {
      const Icon = icons[id];
      return (
        <Link
          key={id}
          href={webNavigationHref(href, search, id)}
          prefetch={false}
          aria-current={section === id ? "page" : undefined}
          className={cx(
            mobile
              ? "flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 text-center text-[10px]"
              : "flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm",
            section === id
              ? "bg-cyan-300/10 text-cyan-200"
              : "text-zinc-400 hover:bg-white/[0.05] hover:text-white",
          )}
        >
          <Icon className={mobile ? "h-5 w-5" : "h-4 w-4"} aria-hidden="true" />
          <span>{label}</span>
        </Link>
      );
    });
  return (
    <DraftSessionProvider owner={draftOwner}>
      <div className="min-h-screen">
        <a
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-cyan-300 focus:p-3 focus:text-zinc-950"
          href="#lifeos-main"
        >
          К содержимому
        </a>
        <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-white/[0.08] bg-graphite-950 px-3 py-5 xl:flex">
          <Link
            href={webNavigationHref("/today", search, "home")}
            className="mb-5 flex min-h-11 items-center gap-3 px-3 text-lg font-semibold text-white"
          >
            <Zap className="h-6 w-6 text-cyan-300" />
            LifeOS
          </Link>
          <nav aria-label="Основные разделы LifeOS" className="space-y-1">
            {primaryLinks()}
          </nav>
          <div className="mt-5 min-h-0 flex-1 overflow-y-auto border-t border-white/[0.08] pt-4">
            <p className="px-3 text-xs leading-relaxed text-zinc-400">
              {active.description}
            </p>
            <nav
              aria-label={`Модули раздела «${active.label}»`}
              className="mt-3 space-y-1"
            >
              {WEB_MODULES[section].map(({ href, label }) => (
                <Link
                  key={href}
                  href={webNavigationHref(href, search, section)}
                  prefetch={false}
                  aria-current={pathname === href ? "page" : undefined}
                  className={cx(
                    "flex min-h-11 items-center rounded-lg px-3 text-sm",
                    pathname === href
                      ? "bg-white/[0.06] text-cyan-100"
                      : "text-zinc-400 hover:bg-white/[0.04] hover:text-white",
                  )}
                >
                  {label}
                </Link>
              ))}
            </nav>
          </div>
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
              href={webNavigationHref("/today", search, "home")}
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
            <nav
              aria-label={`Внутри раздела «${active.label}»`}
              className="mb-6 flex flex-wrap gap-2 xl:hidden"
            >
              {WEB_MODULES[section].map(({ href, label }) => (
                <Link
                  key={href}
                  href={webNavigationHref(href, search, section)}
                  prefetch={false}
                  aria-current={pathname === href ? "page" : undefined}
                  className={cx(
                    "flex min-h-11 min-w-0 items-center rounded-xl border px-3 py-2 text-xs",
                    pathname === href
                      ? "border-cyan-300/25 bg-cyan-300/10 text-cyan-100"
                      : "border-white/10 bg-white/[0.03] text-zinc-300",
                  )}
                >
                  {label}
                </Link>
              ))}
            </nav>
            {children}
            {section === "settings" ? (
              <div className="mt-6 xl:hidden">
                <SignOutButton mobile />
              </div>
            ) : null}
          </main>
          <nav
            aria-label="Основные разделы LifeOS"
            className="fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.08] bg-graphite-950/95 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md xl:hidden"
          >
            <div className="mx-auto grid max-w-xl grid-cols-4 gap-1 px-2 pt-2">
              {primaryLinks(true)}
            </div>
          </nav>
        </div>
      </div>
    </DraftSessionProvider>
  );
}
