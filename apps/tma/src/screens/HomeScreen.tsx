import { MonthlyReviewSection } from "../components/MonthlyReviewSection";
import {
  ChevronRight,
  CloudSun,
  Dumbbell,
  Plus,
  RefreshCw,
} from "lucide-react";
import { useState } from "react";
import {
  useHomeQuery,
  useStartGoogleOAuthMutation,
} from "../api/hooks";
import { todayQueryKey, useTodayQuery } from "../api/planning";
import { useQueryClient } from "@tanstack/react-query";
import type { TmaSessionStatus } from "../api/types";
import { ErrorPanel, LoadingPanel } from "../components/AsyncState";
import { TodayPanel, formatPlanTime } from "../components/TodayPanel";
import { integrationCardsForSession } from "../lib/session-status";

interface HomeScreenProps {
  onOpenCapture?: () => void;
  onOpenWorkout: () => void;
  onOpenDailyLife?: () => void;
  onOpenAi: (date: string) => void;
  session: TmaSessionStatus;
}

const cardClass =
  "rounded-[18px] border border-white/[0.08] bg-[#151517] px-4 py-3";
const linkClass = "min-h-11 text-sm font-semibold text-[#89aaff]";

function Agenda({
  date,
  onOpenAi,
}: Pick<HomeScreenProps, "onOpenAi"> & { date: string }) {
  const [expanded, setExpanded] = useState(false);
  const query = useTodayQuery(date);
  if (!query.data) {
    return query.isLoading ? (
      <LoadingPanel title="Загружаем план дня…" />
    ) : (
      <ErrorPanel
        title="Не удалось загрузить план дня"
        onRetry={() => void query.refetch()}
      />
    );
  }
  const { plan, events, reminders } = query.data;
  const now = Date.now();
  const items = [
    ...events.map((item) => ({ ...item, kind: "Событие" })),
    ...plan.blocks.map((item) => ({ ...item, kind: "План" })),
    ...reminders.map((item) => ({
      title: item.title,
      startsAt: item.remindAt,
      endsAt: item.remindAt,
      kind: "Напоминание",
    })),
  ]
    .filter((item) => Date.parse(item.endsAt) >= now)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
    .slice(0, 3);
  return (
    <section aria-label="План дня" className={cardClass}>
      <h2 className="text-lg font-semibold text-white">Ближайшее</h2>
      {items.length ? (
        <ol className="mt-1 divide-y divide-white/[0.07]">
          {items.map((item, i) => (
            <li
              key={i}
              className="grid grid-cols-[3.4rem_minmax(0,1fr)] items-baseline gap-2 py-3"
            >
              <time
                dateTime={item.startsAt}
                className="text-sm font-semibold tabular-nums text-[#89aaff]"
              >
                {formatPlanTime(item.startsAt, plan.timezone)}
              </time>
              <div className="min-w-0">
                <p className="break-words text-sm font-medium text-white">
                  {item.title}
                </p>
                <p className="mt-0.5 text-xs text-zinc-400">{item.kind}</p>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="py-3 text-sm text-zinc-400">
          До конца дня ничего не запланировано.
        </p>
      )}
      <details
        onToggle={(event) => setExpanded(event.currentTarget.open)}
        className="border-t border-white/[0.07]"
      >
        <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-[#89aaff]">
          План и календарь
        </summary>
        {expanded && <TodayPanel date={date} onOpenAi={onOpenAi} />}
      </details>
    </section>
  );
}

function Connections({ session }: Pick<HomeScreenProps, "session">) {
  const google = useStartGoogleOAuthMutation();
  const status = {
    connected: "Подключено",
    disconnected: "Нет связи",
    disabled: "Выключено",
    not_configured: "Не настроено",
    error: "Ошибка",
  };
  return (
    <ul className="divide-y divide-white/[0.07]">
      {integrationCardsForSession(session).map((item) => (
        <li
          key={item.title}
          className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 py-1 text-sm"
        >
          <span>{item.title}</span>
          {item.action === "connect_google" ? (
            <button
              className={linkClass}
              type="button"
              disabled={google.isPending}
              onClick={() => google.mutate()}
            >
              {google.isPending ? "Открываем…" : "Подключить Google"}
            </button>
          ) : (
            <span className="text-zinc-400">{status[item.status]}</span>
          )}
        </li>
      ))}
      {google.isError && (
        <li role="alert" className="py-2 text-sm text-rose-300">
          Не удалось подключить Google. Попробуй ещё раз.
        </li>
      )}
    </ul>
  );
}

export function HomeScreen({
  onOpenCapture,
  onOpenWorkout,
  onOpenDailyLife,
  onOpenAi,
  session,
}: HomeScreenProps) {
  const query = useHomeQuery();
  const client = useQueryClient();
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  if (!query.data)
    return query.isLoading ? (
      <LoadingPanel title="Загружаем твой день…" />
    ) : (
      <ErrorPanel
        title="Не удалось загрузить главную"
        detail={query.error?.message}
        onRetry={() => void query.refetch()}
      />
    );
  const home = query.data;
  const date = new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    weekday: "long",
    timeZone: "UTC",
  }).format(new Date(home.localDate + "T12:00:00Z"));
  return (
    <div className="min-w-0 space-y-4">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[27px] font-bold text-white">Сегодня</h1>
          <p className="mt-1 text-sm text-zinc-400 first-letter:uppercase">
            <time dateTime={home.localDate}>{date}</time>
          </p>
        </div>
        <button
          type="button"
          aria-label="Обновить обзор"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/10 text-zinc-300"
          disabled={query.isFetching}
          onClick={() => {
            void query.refetch();
            void client.invalidateQueries({
              queryKey: [...todayQueryKey, home.localDate],
            });
          }}
        >
          <RefreshCw size={17} aria-hidden="true" />
        </button>
      </header>
      {home.weather && (
        <p className="flex flex-wrap items-center gap-x-2 text-sm text-zinc-400">
          <CloudSun size={17} aria-hidden="true" />
          <span className="min-w-0 break-words">
            {home.weather.locationName}
          </span>
          {home.weather.temperatureC != null && (
            <strong className="text-white">
              {Math.round(home.weather.temperatureC)}°
            </strong>
          )}
          <span>{home.weather.weatherLabel}</span>
        </p>
      )}
      {onOpenCapture && (
        <button
          type="button"
          onClick={onOpenCapture}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#a9c1ff] px-4 text-sm font-bold text-[#111725]"
        >
          <Plus size={18} aria-hidden="true" />
          Записать мысль
        </button>
      )}
      <Agenda date={home.localDate} onOpenAi={onOpenAi} />
      {home.activeWorkout && (
        <button
          type="button"
          onClick={onOpenWorkout}
          className={
            cardClass + " flex min-h-14 w-full items-center gap-3 text-left"
          }
        >
          <Dumbbell
            size={20}
            aria-hidden="true"
            className="shrink-0 text-[#89aaff]"
          />
          <span className="min-w-0 flex-1">
            <strong className="block break-words text-base">
              {home.activeWorkout.title}
            </strong>
            <span className="text-sm text-zinc-400">
              Продолжить тренировку · {home.activeWorkout.progressPercent}%
            </span>
          </span>
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      )}
      <div className={cardClass + " divide-y divide-white/[0.07]"}>
        {onOpenDailyLife && (
          <button
            type="button"
            onClick={onOpenDailyLife}
            className="flex min-h-11 w-full items-center justify-between text-sm font-semibold"
          >
            Дневник дня <ChevronRight size={16} aria-hidden="true" />
          </button>
        )}
        <MonthlyReviewSection />
        <details
          onToggle={(event) => setConnectionsOpen(event.currentTarget.open)}
        >
          <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">
            Подключённые сервисы
          </summary>
          {connectionsOpen && <Connections session={session} />}
        </details>
      </div>
    </div>
  );
}
