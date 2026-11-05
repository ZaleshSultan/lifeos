import {
  Bell,
  CircleHelp,
  Link2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { lazy, Suspense } from "react";
import { LoadingPanel } from "../components/AsyncState";
import type { ScreenId } from "../types";
const Router = lazy(() =>
  import("../components/AiRouterSettingsPanel").then((module) => ({
    default: module.AiRouterSettingsPanel,
  })),
);
export function SettingsScreen({
  onNavigate,
  onDirtyChange,
}: {
  onNavigate: (screen: ScreenId) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const groups = [
    {
      icon: Link2,
      title: "Подключения",
      detail: "Управляй источниками и проверяй свежесть данных.",
      actions: [
        { screen: "sources" as const, label: "Интеграции" },
        { screen: "lms" as const, label: "AITU LMS" },
      ],
    },
    {
      icon: Bell,
      title: "Уведомления",
      detail: "Напоминания и сводки включаются только с твоего согласия.",
      actions: [
        {
          screen: "reminders" as const,
          label: "Напоминания и ежедневные сводки",
        },
        { screen: "study" as const, label: "Учебные уведомления" },
      ],
    },
    {
      icon: SlidersHorizontal,
      title: "Личный режим",
      detail: "Настрой нагрузку и доступные режимы LifeOS.",
      actions: [{ screen: "mode" as const, label: "Режим дня" }],
    },
  ];
  return (
    <div className="space-y-4">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-cyan-200">
          Твой LifeOS
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-white">Настройки</h1>
        <p className="mt-2 text-sm text-zinc-300">
          Подключения, согласия и предпочтения собраны вместе.
        </p>
      </header>
      {groups.map(({ icon: Icon, title, detail, actions }) => (
        <section
          key={title}
          className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4"
        >
          <h2 className="flex items-center gap-2 text-base font-semibold text-white">
            <Icon className="h-4 w-4 text-cyan-200" />
            {title}
          </h2>
          <p className="mt-2 text-sm text-zinc-300">{detail}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {actions.map((action) => (
              <button
                key={action.screen}
                type="button"
                onClick={() => onNavigate(action.screen)}
                className="min-h-11 rounded-xl border border-white/15 px-3 py-2 text-sm text-cyan-100 hover:bg-white/[0.06]"
              >
                {action.label}
              </button>
            ))}
          </div>
        </section>
      ))}
      <section className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
        <h2 className="flex items-center gap-2 text-base font-semibold text-white">
          <Sparkles className="h-4 w-4 text-cyan-200" />
          AI и приватность
        </h2>
        <p className="mt-2 text-sm text-zinc-300">
          Просмотр настроек не отправляет запрос модели. Разрешения провайдеров
          и категорий данных выбираются отдельно.
        </p>
        <div className="mt-3">
          <Suspense fallback={<LoadingPanel title="Загружаем настройки AI…" />}>
            <Router onDirtyChange={onDirtyChange} />
          </Suspense>
        </div>
      </section>
      <section className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
        <h2 className="flex items-center gap-2 text-base font-semibold text-white">
          <ShieldCheck className="h-4 w-4 text-cyan-200" />
          Аккаунт и доступ
        </h2>
        <p className="mt-2 text-sm text-zinc-300">
          Личные данные доступны через твой Telegram-профиль. Статусы
          подключений и диагностика находятся в интеграциях.
        </p>
        <p className="mt-3 flex items-start gap-2 text-xs text-zinc-400">
          <CircleHelp className="h-4 w-4 shrink-0" />
          Внешний вид следует теме Telegram. Несохранённые формы остаются в этом
          сеансе при переключении разделов.
        </p>
      </section>
    </div>
  );
}
