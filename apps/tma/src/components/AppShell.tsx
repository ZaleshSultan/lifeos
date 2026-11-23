import {
  Activity,
  Bell,
  BookOpen,
  Calculator,
  Crosshair,
  Dumbbell,
  HeartPulse,
  House,
  Inbox,
  LayoutGrid,
  ListChecks,
  PlugZap,
  Settings2,
  Sparkles,
  WalletCards,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import type { ScreenId } from "../types";

interface AppShellProps {
  screen: ScreenId;
  onScreenChange: (screen: ScreenId) => boolean | void;
  children: ReactNode;
  showNavigation?: boolean;
}
type Destination = { id: ScreenId; label: string; icon: LucideIcon };

const primary: Destination[] = [
  { id: "home", label: "Сегодня", icon: House },
  { id: "study", label: "Учёба", icon: BookOpen },
  { id: "dashboard", label: "Стипендия", icon: Calculator },
  { id: "workout", label: "Тренировки", icon: Dumbbell },
];
const groups: { title: string; items: Destination[] }[] = [
  {
    title: "Дела",
    items: [
      { id: "capture", label: "Входящие", icon: Inbox },
      { id: "reminders", label: "Напоминания", icon: Bell },
      { id: "focus", label: "Фокус", icon: Crosshair },
      { id: "mode", label: "Режим", icon: Settings2 },
    ],
  },
  {
    title: "Самочувствие",
    items: [
      { id: "daily-life", label: "День и вода", icon: Activity },
      { id: "ideal-human", label: "Привычки", icon: ListChecks },
      { id: "health", label: "Здоровье", icon: HeartPulse },
    ],
  },
  {
    title: "Сервисы",
    items: [
      { id: "ai", label: "AI-помощник", icon: Sparkles },
      { id: "finance", label: "Финансы", icon: WalletCards },
      { id: "sources", label: "Интеграции", icon: PlugZap },
    ],
  },
];

export function AppShell({
  children,
  onScreenChange,
  screen,
  showNavigation = true,
}: AppShellProps) {
  const menu = useRef<HTMLDialogElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const activePrimary = screen === "lms" ? "study" : screen;
  const isSecondary = !primary.some((item) => item.id === activePrimary);
  function navigate(id: ScreenId) {
    if (onScreenChange(id) === false) return;
    if (menu.current?.open) menu.current.close();
    if (id === screen) window.scrollTo({ top: 0, behavior: "auto" });
  }
  return (
    <div className="lo-shell">
      <header className="lo-header safe-shell">
        <div className="lo-header-inner">
          <span className="lo-brand">
            <Zap size={16} strokeWidth={2} aria-hidden="true" />
            LifeOS
          </span>
        </div>
      </header>
      <main id="lifeos-main" className="lo-content">
        {children}
      </main>
      {showNavigation && (
        <>
          <nav aria-label="Разделы LifeOS" className="lo-bottom-nav">
            <div className="lo-nav-inner">
              {primary.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  aria-current={activePrimary === id ? "page" : undefined}
                  className="lo-nav-item"
                  onClick={() => navigate(id)}
                >
                  <Icon size={20} aria-hidden="true" />
                  <span>{label}</span>
                </button>
              ))}
              <button
                type="button"
                className="lo-nav-item"
                data-active={isSecondary || menuOpen}
                aria-label="Другие разделы"
                aria-controls="more-sections"
                aria-haspopup="dialog"
                aria-expanded={menuOpen}
                onClick={() => {
                  menu.current?.showModal();
                  setMenuOpen(true);
                }}
              >
                <LayoutGrid size={20} aria-hidden="true" />
                <span>Ещё</span>
              </button>
            </div>
          </nav>
          <dialog
            id="more-sections"
            ref={menu}
            className="lo-menu"
            aria-labelledby="lo-menu-title"
            onClose={() => setMenuOpen(false)}
            onClick={(e) => {
              if (e.target === e.currentTarget) menu.current?.close();
            }}
          >
            <div className="lo-menu-body">
              <div className="lo-menu-header">
                <h2 id="lo-menu-title">Ещё</h2>
                <button
                  type="button"
                  aria-label="Закрыть меню"
                  onClick={() => menu.current?.close()}
                >
                  <X size={20} />
                </button>
              </div>
              {groups.map((group) => (
                <section key={group.title} aria-label={group.title}>
                  <h3>{group.title}</h3>
                  <div className="lo-menu-grid">
                    {group.items.map(({ id, label, icon: Icon }) => (
                      <button
                        key={id}
                        type="button"
                        aria-current={screen === id ? "page" : undefined}
                        onClick={() => navigate(id)}
                      >
                        <Icon size={17} aria-hidden="true" />
                        {label}
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </dialog>
        </>
      )}
    </div>
  );
}
