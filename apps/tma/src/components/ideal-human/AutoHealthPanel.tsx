import type { IdealHumanDay } from "../../../../../packages/core/src/ideal-human.js";
import { useDailyLife } from "../../api/daily-life";
import { buttonClass, panelClass } from "./Fields";
export function AutoHealthPanel({
  date,
  manual,
  onOpenHealth,
}: {
  date: string;
  manual: IdealHumanDay;
  onOpenHealth: () => void;
}) {
  const query = useDailyLife(date);
  return (
    <section className={`${panelClass} space-y-3`}>
      <h2 className="font-semibold text-white">Данные здоровья и источники</h2>
      <p className="text-xs text-zinc-400">
        Измерения показываются из существующей синхронизации. Ручные значения
        имеют приоритет. Просмотр не создаёт чек-ин.
      </p>
      {query.isLoading ? (
        <p className="text-xs text-zinc-400">Проверяем доступные измерения…</p>
      ) : query.isError ? (
        <p className="text-xs text-amber-200">
          Источник временно недоступен. Дневник можно сохранить отдельно.{" "}
          <button
            type="button"
            className="underline"
            onClick={() => void query.refetch()}
          >
            Повторить
          </button>
        </p>
      ) : query.data ? (
        <div className="grid grid-cols-2 gap-2">
          {(
            ["sleepMinutes", "weightKg", "steps", "workoutMinutes"] as const
          ).map((key) => {
            const row = query.data!.health[key];
            const local =
              key === "sleepMinutes"
                ? manual.sleepMinutes
                : key === "weightKg"
                  ? manual.weightKg
                  : null;
            const value = local ?? row?.value ?? null;
            return (
              <div
                key={key}
                className="min-w-0 rounded-lg bg-white/[0.03] p-2 text-xs text-zinc-300"
              >
                <span className="block text-zinc-500">
                  {
                    {
                      sleepMinutes: "Сон, мин",
                      weightKg: "Вес, кг",
                      steps: "Шаги",
                      workoutMinutes: "Активность, мин",
                    }[key]
                  }
                </span>
                <strong className="mt-1 block text-sm text-zinc-100">
                  {value === null ? "Нет данных" : value}
                </strong>
                <span className="mt-1 block break-words">
                  {local !== null
                    ? "Ручное поле дневника"
                    : row
                      ? `${row.source}${row.stale ? " · устарело" : ""}`
                      : "Источник не сообщил значение"}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
      {query.data?.healthSync ? (
        <div className="space-y-1 text-xs text-zinc-400">
          <p>
            Синхронизация устройства:{" "}
            {!query.data.healthSync.available
              ? "состояние недоступно"
              : query.data.healthSync.latestStatus === "success"
                ? "последняя отправка принята"
                : query.data.healthSync.latestStatus === "failed"
                  ? "последняя попытка завершилась ошибкой; проверь Android-мост"
                  : "отправок пока нет"}
            .
          </p>
          {query.data.healthSync.recentSuccessAt ? (
            <p>
              Успех среди последних пяти попыток:{" "}
              {new Intl.DateTimeFormat("ru-RU", {
                timeZone: "Asia/Almaty",
                dateStyle: "short",
                timeStyle: "short",
              }).format(new Date(query.data.healthSync.recentSuccessAt))}
            </p>
          ) : null}
          <p>
            Разрешения телефона и наличие новых измерений этим статусом не
            подтверждаются.
          </p>
        </div>
      ) : null}
      {query.data?.health.lastSyncAt ? (
        <p className="text-xs text-zinc-400">
          Метка обновления записей:{" "}
          {new Intl.DateTimeFormat("ru-RU", {
            timeZone: "Asia/Almaty",
            dateStyle: "short",
            timeStyle: "short",
          }).format(new Date(query.data.health.lastSyncAt))}
        </p>
      ) : null}
      <p className="text-xs text-zinc-400">
        Разрешения, фоновая синхронизация и ошибки устройства проверяются в
        Android-мосте на телефоне. LifeOS не предполагает доступ к датчикам.
      </p>
      <button
        type="button"
        className={`${buttonClass} w-full`}
        onClick={onOpenHealth}
      >
        Здоровье и состояние источников
      </button>
    </section>
  );
}
