import { ContextLink } from "@/components/ContextLink";
import { Activity, HeartPulse, Moon, RotateCw } from "lucide-react";
import { MetricCard } from "@/components/MetricCard";
import { PageHeader } from "@/components/PageHeader";
import { SectionPanel } from "@/components/SectionPanel";
import { TrendChart } from "@/components/TrendChart";
import { dashboardData, dateTime } from "@/lib/dashboard-data";
import type { HealthSummary } from "../../../../tma/src/api/types";
export default async function HealthPage() {
  const data = await dashboardData<HealthSummary>("/api/tma/health");
  return (
    <>
      <PageHeader
        kicker={data?.date ?? "Health Connect"}
        title="Здоровье и восстановление"
        summary="Реальные измерения из существующего Health Connect потока. Неизвестные значения остаются пустыми."
      />
      <nav
        aria-label="Действия для здоровья"
        className="mb-6 grid gap-3 sm:grid-cols-3"
      >
        {[
          {
            href: "/workouts",
            title: "Движение",
            detail: "Текущая тренировка и история",
          },
          {
            href: "/nutrition",
            title: "Еда и вода",
            detail: "Питание, гидратация и ручные записи",
          },
          {
            href: "/ideal-human?section=health",
            title: "Дневник",
            detail: "Самочувствие и наблюдения по дням",
          },
        ].map((item) => (
          <ContextLink
            key={item.href}
            href={item.href}
            section="health"
            className="min-h-20 rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 hover:border-cyan-300/25"
          >
            <span className="block text-sm font-medium text-cyan-100">
              {item.title}
            </span>
            <span className="mt-1 block text-xs leading-relaxed text-zinc-400">
              {item.detail}
            </span>
          </ContextLink>
        ))}
      </nav>
      {data ? (
        <>
          <div className="dashboard-grid">
            <MetricCard
              label="Сон"
              icon={Moon}
              value={
                data.sleepMinutes == null
                  ? "—"
                  : `${(data.sleepMinutes / 60).toFixed(1)} ч`
              }
              detail={data.sourceLabel ?? "Источник не указан"}
            />
            <MetricCard
              label="Шаги"
              icon={Activity}
              value={
                data.steps == null ? "—" : data.steps.toLocaleString("ru-RU")
              }
              detail={`Измеренный день: ${data.date}`}
              tone="mint"
            />
            <MetricCard
              label="Пульс в покое"
              icon={HeartPulse}
              value={
                data.restingHeartRate == null
                  ? "—"
                  : `${data.restingHeartRate} уд/мин`
              }
              detail="Показывается только при наличии измерения."
              tone="rose"
            />
            <MetricCard
              label="Полнота данных"
              icon={RotateCw}
              value={
                data.hasMetrics
                  ? `${data.dataCompletenessScore}%`
                  : "Нет измерений"
              }
              detail={
                data.recommendation ||
                "Проверь подключение телефона и разрешения Health Connect."
              }
              tone="amber"
            />
          </div>
          <div className="mt-6 grid gap-5 lg:grid-cols-2">
            <SectionPanel title="Тренд сна">
              <TrendChart
                title="Продолжительность сна"
                unit="ч"
                points={(data.trends ?? []).map((point) => ({
                  date: point.date,
                  value:
                    point.sleepMinutes === null
                      ? null
                      : Math.round((point.sleepMinutes / 60) * 10) / 10,
                }))}
              />
            </SectionPanel>
            <SectionPanel title="Активность">
              <TrendChart
                title="Шаги"
                unit="шагов"
                points={(data.trends ?? []).map((point) => ({
                  date: point.date,
                  value: point.steps,
                }))}
              />
            </SectionPanel>
            <SectionPanel title="Источники и свежесть">
              <div className="space-y-3">
                {data.sources?.length ? (
                  data.sources.map((source) => (
                    <div
                      key={source.source}
                      className="rounded-lg border border-white/[0.08] p-3"
                    >
                      <p className="text-sm text-zinc-100">{source.label}</p>
                      <p className="mt-1 text-xs text-zinc-400">
                        Последнее измерение: {dateTime(source.latestMetricAt)}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-zinc-400">
                    Источник и свежесть пока не подтверждены.
                  </p>
                )}
              </div>
            </SectionPanel>
            <SectionPanel title="Недостающие данные">
              <p className="text-sm text-zinc-300">
                {Object.entries(data.missingMetrics ?? {})
                  .filter(([, missing]) => missing)
                  .map(([name]) => name)
                  .join(", ") ||
                  "Подробный список отсутствующих разрешений не получен."}
              </p>
              <p className="mt-3 text-xs leading-relaxed text-zinc-400">
                Для автоматической доставки нужен установленный и разрешённый
                Android-компонент. Данные телефона не возникают из web-сессии;
                manual записи Ideal Human сохраняются отдельно и не
                перезаписываются.
              </p>
            </SectionPanel>
          </div>
        </>
      ) : (
        <SectionPanel title="Измерения пока недоступны">
          <p className="text-sm text-zinc-300">
            Проверь подключение и обнови страницу. Ранее сохранённые данные
            остаются в LifeOS.
          </p>
        </SectionPanel>
      )}
    </>
  );
}
