import { useHealthQuery } from "../api/hooks";
import { ErrorPanel, LoadingPanel } from "../components/AsyncState";
import { HealthBridgeConnection } from "../components/HealthBridgeConnection";

const card = "rounded-[18px] border border-white/[0.08] bg-[#151517] p-4";
const label = "text-sm text-zinc-400";
const numerals = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });

function measure(n: number | null | undefined, unit = "") {
  return n == null ? "—" : [numerals.format(n), unit].filter(Boolean).join(" ");
}
function duration(minutes: number | null | undefined) {
  if (minutes == null) return "—";
  const rounded = Math.round(minutes);
  const h = Math.floor(rounded / 60),
    m = rounded % 60;
  return [h ? h + " ч" : "", m || !h ? m + " мин" : ""]
    .filter(Boolean)
    .join(" ");
}
function Measures({ items }: { items: string[][] }) {
  return (
    <dl className="divide-y divide-white/[0.07]">
      {items.map(([name, value]) => (
        <div
          key={name}
          className="flex items-baseline justify-between gap-3 py-2.5"
        >
          <dt className={label}>{name}</dt>
          <dd className="text-right text-sm font-semibold tabular-nums text-white">
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function HealthScreen() {
  const query = useHealthQuery();
  if (!query.data)
    return query.isLoading ? (
      <LoadingPanel title="Загружаем показатели…" />
    ) : (
      <ErrorPanel
        title="Не удалось загрузить показатели здоровья"
        detail={query.error?.message}
        onRetry={() => void query.refetch()}
      />
    );
  const health = query.data;
  const weekly = health.weekly;
  const keyMetrics = [
    ["Сон", duration(health.sleepMinutes)],
    ["Шаги", measure(health.steps)],
    ["Пульс в покое", measure(health.restingHeartRate, "уд/мин")],
    ["Активная энергия", measure(health.activeEnergyKcal, "ккал")],
    ["Средний пульс", measure(health.averageHeartRate, "уд/мин")],
    ["Кислород в крови", measure(health.spo2Avg, "%")],
    ["Тренировки", duration(health.workoutMinutes)],
  ];
  const missingNames: Record<string, string> = {
    sleep: "сон",
    steps: "шаги",
    resting_heart_rate: "пульс в покое",
    resting_hr: "пульс в покое",
    sleep_minutes: "сон",
    workout_minutes: "тренировки",
    spo2: "кислород в крови",
    active_energy_kcal: "активная энергия",
    hrv: "вариабельность пульса",
  };
  const missing = Object.entries(health.missingMetrics ?? {})
    .filter(([, v]) => v)
    .map(([name]) => missingNames[name] ?? name.replaceAll("_", " "));
  return (
    <div className="min-w-0 space-y-4">
      <header>
        <h1 className="text-[27px] font-bold text-white">Здоровье</h1>
        <p className={"mt-1 " + label}>
          {[health.date, health.sourceLabel].filter(Boolean).join(" · ")}
        </p>
      </header>
      <section className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">За день</h2>
          {health.hasMetrics && (
            <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-xs text-zinc-300">
              Полнота данных {measure(health.dataCompletenessScore, "%")}
            </span>
          )}
        </div>
        {health.hasMetrics || keyMetrics.some(([, v]) => v !== "—") ? (
          <Measures items={keyMetrics} />
        ) : (
          <p className={"mt-2 " + label}>
            Пока нет записей за этот день. Подключи часы или добавь данные в
            Telegram командой /health_log.
          </p>
        )}
      </section>
      {weekly || health.trends?.length ? (
        <section className={card}>
          <h2 className="text-lg font-semibold">За неделю</h2>
          {weekly && (
            <Measures
              items={[
                ["Среднее количество шагов", measure(weekly.avgSteps)],
                ["Средняя длительность сна", duration(weekly.avgSleepMinutes)],
                [
                  "Средний пульс в покое",
                  measure(weekly.avgRestingHeartRate, "уд/мин"),
                ],
                ["Всего тренировок", duration(weekly.totalWorkoutMinutes)],
              ]}
            />
          )}
          {!!health.trends?.length && (
            <details className="border-t border-white/[0.08]">
              <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-[#89aaff]">
                По дням
              </summary>
              <table className="w-full text-sm text-zinc-300">
                <thead>
                  <tr>
                    <th scope="col" className="text-left">
                      Дата
                    </th>
                    <th scope="col">Шаги</th>
                    <th scope="col" className="text-right">
                      Сон
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {health.trends.map((day) => (
                    <tr key={day.date}>
                      <th scope="row" className="py-1.5 text-left font-normal">
                        {day.date}
                      </th>
                      <td className="text-center tabular-nums">
                        {measure(day.steps)}
                      </td>
                      <td className="text-right tabular-nums">
                        {duration(day.sleepMinutes)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </section>
      ) : null}
      <details className={card}>
        <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">
          Источники и подключение часов
        </summary>
        {!!health.sources?.length && (
          <Measures
            items={health.sources.map((s) => [
              s.label,
              s.latestMetricAt?.slice(0, 10) ?? "Нет записей",
            ])}
          />
        )}
        {missing.length > 0 && (
          <p className={"mb-3 " + label}>Нет данных: {missing.join(", ")}.</p>
        )}
        <HealthBridgeConnection />
      </details>
    </div>
  );
}
