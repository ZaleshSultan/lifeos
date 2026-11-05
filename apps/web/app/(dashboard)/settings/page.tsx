import { ContextLink } from "@/components/ContextLink";
import { LmsStatus } from "@/components/LmsStatus";
import { AiRouterSettingsPanel } from "@/components/workspaces/AiRouterSettingsPanel";
import type { AiRouterSettingsSnapshot } from "../../../../../packages/core/src/ai-router-settings-view.js";
import { dashboardData } from "@/lib/dashboard-data";
import type { WebLmsConnection } from "@/lib/lms-contracts";
import { Bot, CalendarDays, CloudSun, ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";
import { MetricCard } from "@/components/MetricCard";
import { PageHeader } from "@/components/PageHeader";
import { SectionPanel } from "@/components/SectionPanel";
import {
  lifeosApi,
  type WebHomeSummary,
  type WebSessionStatus,
} from "@/lib/lifeos-api";

export default async function SettingsPage() {
  const [session, home] = await Promise.all([
    lifeosApi<WebSessionStatus>("/api/tma/session"),
    dashboardData<WebHomeSummary>("/api/tma/home"),
  ]);
  if (!session) redirect("/access");

  const [lmsConnection, routerSettings] = await Promise.all([
    dashboardData<WebLmsConnection>("/api/tma/lms/connection"),
    dashboardData<AiRouterSettingsSnapshot>("/api/tma/ai/router/settings"),
  ]);
  const google = session.integrations.google;
  const googleReady =
    google.connected &&
    google.status === "connected" &&
    google.calendarWriteEnabled !== false &&
    !google.reconnectRequired;

  return (
    <>
      <PageHeader
        kicker="Personal settings"
        summary="Эти статусы относятся только к текущему LifeOS-пользователю и его подключениям."
        title={
          session.displayName
            ? `Настройки · ${session.displayName}`
            : "Настройки"
        }
      />

      <section
        id="integrations"
        aria-label="Подключения и аккаунт"
        className="scroll-mt-24"
      >
        <h2 className="mb-4 text-lg font-semibold text-zinc-100">
          Подключения и аккаунт
        </h2>
        <div className="dashboard-grid">
          <MetricCard
            detail="Web-сессия привязана к тому же user_id, что и Telegram-профиль."
            icon={Bot}
            label="Telegram"
            tone="mint"
            value={session.integrations.telegram.connected ? "Linked" : "Off"}
          />
          <MetricCard
            detail={
              googleReady
                ? google.accountEmail || "Calendar events enabled"
                : google.reconnectRequired
                  ? "Нужно переподключить Google один раз"
                  : "Подключи Google в Mini App / Sources"
            }
            icon={CalendarDays}
            label="Google Calendar"
            tone={googleReady ? "mint" : "amber"}
            value={googleReady ? "Ready" : "Setup"}
          />
          <MetricCard
            detail={
              home?.weather
                ? "Используется в Web, Mini App и ежедневной сводке."
                : "Задай через /weather <город> в Telegram."
            }
            icon={CloudSun}
            label="Weather"
            tone="violet"
            value={home?.weather?.locationName ?? "Not set"}
          />
          <MetricCard
            detail="Защищённая сессия отзывается при выходе или блокировке. Для нового входа используй /web в Telegram."
            icon={ShieldCheck}
            label="Session"
            value="Scoped"
          />
        </div>

        <div className="mt-6">
          <LmsStatus connection={lmsConnection} work={null} />
        </div>
      </section>
      <section
        id="ai"
        aria-label="AI и приватность"
        className="mt-6 scroll-mt-24"
      >
        <AiRouterSettingsPanel initial={routerSettings} />
      </section>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <SectionPanel title="Уведомления и личные обзоры">
          <p className="text-sm leading-relaxed text-zinc-400">
            Напоминания, тихие часы и учебные категории включаются отдельно с
            твоего согласия.
          </p>
          <ContextLink
            href="/notifications"
            section="settings"
            className="mt-3 inline-flex min-h-11 items-center rounded-lg border border-white/15 px-3 text-sm text-cyan-200"
          >
            Настроить уведомления
          </ContextLink>
        </SectionPanel>
        <SectionPanel title="Внешний вид и язык">
          <p className="text-sm leading-relaxed text-zinc-400">
            Текущий интерфейс — на русском, в тёмной теме LifeOS. В Mini App
            оформление учитывает тему Telegram. Редактируемые подключения и
            разрешения собраны на этой странице.
          </p>
        </SectionPanel>
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <SectionPanel
          eyebrow="Weather"
          title={home?.weather?.locationName ?? "Город не выбран"}
        >
          <p className="text-sm leading-relaxed text-zinc-400">
            Чтобы изменить город, напиши боту <code>/weather Almaty</code>,{" "}
            <code>/weather Astana</code> или другой город. Настройка сохраняется
            отдельно для твоего аккаунта.
          </p>
        </SectionPanel>

        <SectionPanel eyebrow="Calendar" title="Reminder → Google Calendar">
          <p className="text-sm leading-relaxed text-zinc-400">
            {googleReady
              ? "Готово: новые reminders будут создавать события в твоём primary Google Calendar; snooze обновит время, cancel удалит событие."
              : google.reconnectRequired
                ? "Это старое read-only подключение. Открой Sources в Mini App и переподключи Google, чтобы разрешить создание событий."
                : "Открой Sources в Mini App и подключи Google. Без Google reminders всё равно продолжат работать в LifeOS и Telegram."}
          </p>
        </SectionPanel>
      </div>
    </>
  );
}
