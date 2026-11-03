import Link from "next/link";
import { BriefingPanel, DocumentaryPanel } from "@/components/DailyLifePanels";
import { dashboardData } from "@/lib/dashboard-data";
import type { DailyLifeSummary } from "../../../../../packages/core/src/daily-life.js";
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

  const daily = await dashboardData<DailyLifeSummary>(
    `/api/tma/daily-life/summary?date=${home.localDate}`,
  );
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

      <Link
        href="/capture"
        className="mb-4 block min-h-14 rounded-xl border border-cyan-300/25 bg-cyan-300/[0.06] p-4"
      >
        <p className="font-semibold text-white">Записать мысль</p>
        <p className="mt-1 text-sm leading-relaxed text-zinc-300">
          Идеи, ссылки и расшифровки в одном месте. Действия сохраняются только
          после твоего выбора и подтверждения.
        </p>
      </Link>
      <Link
        href="/ideal-human"
        className="mb-6 block rounded-xl border border-cyan-300/25 bg-cyan-300/[0.05] p-5"
      >
        <p className="text-lg font-semibold text-white">
          Ideal Human
          {daily?.dayNumber
            ? ` — Day ${daily.dayNumber}/30`
            : " — дневник эксперимента"}
        </p>
        <p className="mt-2 text-sm text-zinc-300">
          Гибкий день, вес и сон, питание, учёба и документальный фильм.
        </p>
      </Link>
      {daily ? (
        <div className="mb-6 grid gap-5 lg:grid-cols-2">
          <BriefingPanel view={daily.morning} />
          <BriefingPanel view={daily.evening} />
          <DocumentaryPanel summary={daily} />
          <SectionPanel title="Сегодня в записях">
            <div className="space-y-3 text-sm text-zinc-300">
              <p>
                Вода:{" "}
                {daily.hydration === null
                  ? "нет данных"
                  : `${daily.hydration.totalMl} мл`}
              </p>
              <p>
                Питание: {daily.nutrition.mealCount} записанных приёмов пищи
                {daily.nutrition.incomplete ? " · неполные данные" : ""}
              </p>
              <p>
                Сон:{" "}
                {daily.health.sleepMinutes === null
                  ? "нет измерения"
                  : `${(daily.health.sleepMinutes.value / 60).toFixed(1)} ч · ${daily.health.sleepMinutes.source}`}
              </p>
              {daily.sourceWarnings.map((warning, index) => (
                <p key={index} className="text-xs text-amber-100">
                  {warning}
                </p>
              ))}
              <div className="flex flex-wrap gap-3">
                <Link
                  href="/planner"
                  className="inline-flex min-h-11 items-center rounded-lg border border-white/15 px-3"
                >
                  Мои задачи
                </Link>
                <Link
                  href="/nutrition"
                  className="inline-flex min-h-11 items-center rounded-lg border border-white/15 px-3"
                >
                  Записать еду и воду
                </Link>
              </div>
            </div>
          </SectionPanel>
        </div>
      ) : (
        <div className="mb-6 rounded-lg border border-white/[0.08] p-4 text-sm text-zinc-400">
          Обзор дня пока недоступен. Остальные модули работают через свои
          сохранённые данные.
        </div>
      )}
      <div className="dashboard-grid">
        <MetricCard
          detail="Персональный focus score из твоего LifeOS профиля."
          icon={Activity}
          label="Focus"
          tone="mint"
          value={String(home.focusScore ?? "n/a")}
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
          value={
            home.pendingSyncCount === undefined
              ? "—"
              : String(home.pendingSyncCount)
          }
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

        <SectionPanel
          eyebrow="Weather"
          title={weather?.locationName ?? "Город не выбран"}
        >
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
            <p className="text-sm leading-relaxed text-zinc-400">
              Напиши боту <code>/weather город</code>. Настройка хранится
              отдельно для каждого пользователя.
            </p>
          )}
        </SectionPanel>
      </div>
    </>
  );
}
