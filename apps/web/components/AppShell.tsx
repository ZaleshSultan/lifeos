"use client";

import {
  Bell,
  BookOpen,
  Calculator,
  CalendarDays,
  CheckSquare,
  Crosshair,
  Dumbbell,
  HeartPulse,
  House,
  Inbox,
  LayoutGrid,
  ListChecks,
  LogOut,
  MessageSquare,
  PlugZap,
  Settings,
  Settings2,
  Utensils,
  Video,
  WalletCards,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

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

type Destination = { href: string; label: string; icon: LucideIcon };
const primary: Destination[] = [
  { href: "/today", label: "Сегодня", icon: House },
  { href: "/study", label: "Учёба", icon: BookOpen },
  { href: "/scholarship", label: "Стипендия", icon: Calculator },
];
const sections: { title: string; items: Destination[] }[] = [
  {
    title: "Дела",
    items: [
      { href: "/capture", label: "Входящие", icon: Inbox },
      { href: "/planner", label: "Задачи и план", icon: CheckSquare },
      { href: "/calendar", label: "Календарь", icon: CalendarDays },
      { href: "/notifications", label: "Напоминания", icon: Bell },
      { href: "/focus", label: "Фокус", icon: Crosshair },
      { href: "/mode", label: "Режим", icon: Settings2 },
    ],
  },
  {
    title: "Самочувствие",
    items: [
      { href: "/ideal-human", label: "Привычки", icon: ListChecks },
      { href: "/nutrition", label: "Еда и вода", icon: Utensils },
      { href: "/health", label: "Здоровье", icon: HeartPulse },
      { href: "/workouts", label: "Тренировки", icon: Dumbbell },
    ],
  },
  {
    title: "Сервисы",
    items: [
      { href: "/ai", label: "AI-помощник", icon: MessageSquare },
      { href: "/finance", label: "Финансы", icon: WalletCards },
      { href: "/sources", label: "Интеграции", icon: PlugZap },
      { href: "/creator", label: "Creator", icon: Video },
      { href: "/settings", label: "Настройки", icon: Settings },
    ],
  },
];

export function AppShell({
  children,
  online,
  userName,
}: {
  children: React.ReactNode;
  online: boolean;
  userName?: string | null;
}) {
  const pathname = usePathname().replace(/^\/web(?=\/|$)/, "") || "/today";
  const menu = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  function close() {
    menu.current?.close();
  }
  useEffect(() => {
    close();
  }, [pathname]);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    function onResize() {
      if (desktop.matches) close();
    }
    desktop.addEventListener("change", onResize);
    return () => desktop.removeEventListener("change", onResize);
  }, []);
  function link({ href, label, icon: Icon }: Destination) {
    return (
      <Link
        key={href}
        href={href}
        prefetch={false}
        onClick={close}
        aria-current={href === pathname ? "page" : undefined}
      >
        <Icon size={18} aria-hidden="true" />
        <span>{label}</span>
      </Link>
    );
  }
  const groupedLinks = sections.map(({ title, items }) => (
    <section key={title} aria-label={title}>
      <h2>{title}</h2>
      <div className="web-links">{items.map(link)}</div>
    </section>
  ));
  const brand = (
    <Link href="/today" prefetch={false} className="web-brand">
      <Zap size={19} aria-hidden="true" />
      LifeOS
    </Link>
  );
  return (
    <div className="web-shell">
      <a className="web-skip" href="#lifeos-main">
        К содержимому
      </a>
      <aside className="web-sidebar">
        {brand}
        <nav aria-label="Разделы LifeOS">
          <div className="web-links web-primary">{primary.map(link)}</div>
          {groupedLinks}
        </nav>
        <div className="web-account">
          <span>{userName || "LifeOS"}</span>
          <SignOutButton />
        </div>
      </aside>
      <header className="web-mobile-head">
        {brand}
        <span>{userName || ""}</span>
      </header>
      <main id="lifeos-main" className="web-main">
        {children}
        {!online && (
          <p role="status" className="web-offline">
            Нет связи с сервером
          </p>
        )}
      </main>
      <nav aria-label="Быстрая навигация" className="web-bottom">
        {primary.map(link)}
        <button
          type="button"
          aria-label="Все разделы"
          aria-expanded={open}
          aria-controls="web-more-nav"
          aria-haspopup="dialog"
          data-active={open || !primary.some((item) => item.href === pathname)}
          onClick={() => {
            menu.current?.showModal();
            setOpen(true);
          }}
        >
          <LayoutGrid size={18} aria-hidden="true" />
          <span>Ещё</span>
        </button>
      </nav>
      <dialog
        ref={menu}
        id="web-more-nav"
        aria-label="Все разделы"
        className="web-menu"
        onClick={(e) => {
          if (e.currentTarget === e.target) close();
        }}
        onClose={() => setOpen(false)}
      >
        <div className="web-menu-body">
          <div className="web-menu-head">
            <h2>Ещё</h2>
            <button aria-label="Закрыть разделы" type="button" onClick={close}>
              <X size={20} />
            </button>
          </div>
          {groupedLinks}
          <SignOutButton mobile />
        </div>
      </dialog>
    </div>
  );
}
