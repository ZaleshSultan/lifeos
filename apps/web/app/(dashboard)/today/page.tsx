import { ChevronRight, CloudSun, Plus } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BriefingPanel, DocumentaryPanel } from "@/components/DailyLifePanels";
import { MonthlyReviewSection } from "../../../../tma/src/components/MonthlyReviewSection";
import { WorkspaceRefresh } from "@/components/WorkspaceRefresh";
import { dashboardData } from "@/lib/dashboard-data";
import type { WebTodaySummary } from "@/lib/dashboard-contracts";
import { lifeosApi } from "@/lib/lifeos-api";
import type { HomeSummary } from "../../../../tma/src/api/types";
import type { DailyLifeSummary } from "../../../../../packages/core/src/daily-life.js";

const card = "rounded-[18px] border border-white/[0.08] bg-[#151517] px-4 py-3";
const rowLink =
  "flex min-h-12 items-center justify-between gap-3 py-2 text-sm font-semibold hover:text-[#adc4ff]";

function Upcoming({ today }: { today: WebTodaySummary | null }) {
  if (!today) {
    return (
      <section className={card}>
        <h2 className="text-lg font-semibold">Ближайшее</h2>
        <p className="mt-2 text-sm text-zinc-400">
          Не удалось загрузить план дня.
        </p>
        <Link className={rowLink} href="/calendar">
          Открыть календарь <ChevronRight size={16} aria-hidden="true" />
        </Link>
      </section>
    );
  }
  const time = new Intl.DateTimeFormat("ru-RU", {
    timeZone: today.plan.timezone,
    hour: "2-digit",
    minute: "2-digit",
  });
  const now = Date.now();
  const items = [
    ...today.events.map((event) => ({
      ...event,
      kind: "Событие",
      href: "/calendar",
    })),
    ...today.plan.blocks.map((block) => ({
      ...block,
      kind: "План",
      href: "/planner",
    })),
    ...today.reminders.map((r) => ({
      title: r.title,
      startsAt: r.remindAt,
      endsAt: r.remindAt,
      kind: "Напоминание",
      href: "/notifications",
    })),
  ]
    .filter(
      (item) =>
        Number.isFinite(Date.parse(item.startsAt)) &&
        Date.parse(item.endsAt) >= now,
    )
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
    .slice(0, 3);
  return (
    <section className={card}>
      <h2 className="text-lg font-semibold">Ближайшее</h2>
      {items.length ? (
        <ol className="mt-1 divide-y divide-white/[0.07]">
          {items.map((item, index) => (
            <li key={index}>
              <Link
                href={item.href}
                className="grid min-h-12 grid-cols-[3.5rem_minmax(0,1fr)] items-baseline gap-2 py-3 text-sm hover:text-[#adc4ff]"
              >
                <time
                  dateTime={item.startsAt}
                  className="font-semibold tabular-nums text-[#90adff]"
                >
                  {time.format(new Date(item.startsAt))}
                </time>
                <span className="min-w-0">
                  <strong className="block break-words">{item.title}</strong>
                  <span className="text-xs text-zinc-400">{item.kind}</span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      ) : (
        <p className="py-3 text-sm text-zinc-400">
          До конца дня ничего не запланировано.
        </p>
      )}
      <Link
        className={rowLink + " border-t border-white/[0.07] text-[#90adff]"}
        href="/calendar"
      >
        План и календарь <ChevronRight size={16} aria-hidden="true" />
      </Link>
    </section>
  );
}

export default async function TodayPage() {
  const home = await lifeosApi<HomeSummary>("/api/tma/home");
  if (!home) redirect("/access");
  const dateParam = encodeURIComponent(home.localDate);
  const [today, daily] = await Promise.all([
    dashboardData<WebTodaySummary>(`/api/tma/today?date=${dateParam}`),
    dashboardData<DailyLifeSummary>(
      `/api/tma/daily-life/summary?date=${dateParam}`,
    ),
  ]);
  const date = new Intl.DateTimeFormat("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(home.localDate + "T12:00:00Z"));
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold leading-tight tracking-tight">
            Сегодня
          </h1>
          <p className="mt-1 text-sm text-zinc-400 first-letter:uppercase">
            <time dateTime={home.localDate}>{date}</time>
          </p>
        </div>
        <WorkspaceRefresh label="Обновить обзор" />
      </header>
      {home.weather && (
        <p className="flex flex-wrap items-center gap-x-2 text-sm text-zinc-400">
          <CloudSun size={17} aria-hidden="true" />
          <span>{home.weather.locationName}</span>
          {home.weather.temperatureC != null && (
            <strong className="text-white">
              {Math.round(home.weather.temperatureC)}°
            </strong>
          )}
          <span>{home.weather.weatherLabel}</span>
        </p>
      )}
      <Link
        href="/capture"
        className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#a9c1ff] px-4 text-sm font-bold text-[#111725] hover:bg-[#c0d0ff]"
      >
        <Plus size={18} aria-hidden="true" /> Записать мысль
      </Link>
      <Upcoming today={today} />
      {home.activeWorkout && (
        <Link href="/workouts" className={card + " " + rowLink}>
          <span>
            <strong className="block break-words">
              {home.activeWorkout.title}
            </strong>
            <span className="text-sm font-normal text-zinc-400">
              Продолжить тренировку · {home.activeWorkout.progressPercent}%
            </span>
          </span>
          <ChevronRight size={16} aria-hidden="true" />
        </Link>
      )}
      <div className={card + " divide-y divide-white/[0.07]"}>
        <Link className={rowLink} href="/ideal-human">
          Дневник дня <ChevronRight size={16} aria-hidden="true" />
        </Link>
        <Link className={rowLink} href="/planner">
          Мои задачи <ChevronRight size={16} aria-hidden="true" />
        </Link>
        <Link className={rowLink} href="/nutrition">
          Еда и вода <ChevronRight size={16} aria-hidden="true" />
        </Link>
        <MonthlyReviewSection />
        <details>
          <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">
            Обзор дня и записи
          </summary>
          {daily ? (
            <div className="space-y-3 pb-3">
              <p className="text-sm text-zinc-400">
                {[
                  daily.hydration && `Вода — ${daily.hydration.totalMl} мл`,
                  `Приёмов пищи — ${daily.nutrition.mealCount}${daily.nutrition.incomplete ? " (неполные данные)" : ""}`,
                  daily.health.sleepMinutes &&
                    `Сон — ${Math.floor(daily.health.sleepMinutes.value / 60)} ч ${daily.health.sleepMinutes.value % 60} мин`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {daily.sourceWarnings.map((warning, index) => (
                <p key={index} className="text-sm text-amber-200">
                  {warning}
                </p>
              ))}
              <div className="grid min-w-0 gap-3 md:grid-cols-2">
                <BriefingPanel view={daily.morning} />
                <BriefingPanel view={daily.evening} />
              </div>
              <DocumentaryPanel summary={daily} />
            </div>
          ) : (
            <p className="pb-3 text-sm text-zinc-400">
              Не удалось загрузить записи дня.
            </p>
          )}
        </details>
      </div>
    </div>
  );
}
