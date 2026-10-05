import {
  Activity,
  CalendarClock,
  CheckCircle2,
  CloudSun,
  RefreshCw,
  Settings2,
} from "lucide-react";
import { redirect } from "next/navigation";
import { MetricCard } from "@/components/MetricCard";
import { PageHeader } from "@/components/PageHeader";
import { SectionPanel } from "@/components/SectionPanel";
import { lifeosApi, type WebHomeSummary } from "@/lib/lifeos-api";

export default async function TodayPage() {
  const home = await lifeosApi<WebHomeSummary>("/api/tma/home");
  if (!home) redirect("/access");

  const weather = home.weather;
  const temp =
    weather?.temperatureC === null || weather?.temperatureC === undefined
      ? "—"
      : `${Math.round(weather.temperatureC)}°`;

  return (
    <>
      <PageHeader
        kicker={home.localDate}
        summary={home.modeReason}
        title={home.displayName ? `Сегодня · ${home.displayName}` : "Сегодня"}
      />

      <div className="dashboard-grid">
        <MetricCard
          detail="Персональный focus score из твоего LifeOS профиля."
          icon={Activity}
          label="Focus"
          tone="mint"
          value={home.focusScore ?? "n/a"}
        />
        <MetricCard
          detail={home.modeReason}
          icon={Settings2}
          label="Mode"
          tone="violet"
          value={home.modeLabel}
        />
        <MetricCard
          detail={
            weather
              ? `${weather.weatherLabel}; ${weather.minTemperatureC ?? "—"}…${weather.maxTemperatureC ?? "—"}°C`
              : "Задай город в Telegram: /weather Astana"
          }
          icon={CloudSun}
          label={weather?.locationName ?? "Weather"}
          tone="amber"
          value={temp}
        />
        <MetricCard
          detail="Очередь синхронизации именно этого пользователя."
          icon={RefreshCw}
          label="Sync"
          value={home.pendingSyncCount ?? 0}
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <SectionPanel eyebrow="Personal" title="Твоя web-сессия">
          <div className="space-y-2 text-sm text-zinc-400">
            <div className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              Данные изолированы по LifeOS user_id.
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3">
              <CalendarClock className="h-4 w-4 text-cyan-400" />
              Напоминания могут синхронизироваться с личным Google Calendar.
            </div>
          </div>
        </SectionPanel>

        <SectionPanel eyebrow="Weather" title={weather?.locationName ?? "Город не выбран"}>
          {weather ? (
            <div>
              <div className="text-4xl font-semibold text-white">{temp}</div>
              <p className="mt-2 text-sm text-zinc-400">
                {weather.weatherLabel}
                {weather.precipitationProbabilityPercent !== null
                  ? ` · вероятность осадков ${Math.round(weather.precipitationProbabilityPercent)}%`
                  : ""}
              </p>
            </div>
          ) : (
            <p className="text-sm leading-relaxed text-zinc-500">
              Напиши боту <code>/weather город</code>. Настройка хранится отдельно для каждого пользователя.
            </p>
          )}
        </SectionPanel>
      </div>
    </>
  );
}
