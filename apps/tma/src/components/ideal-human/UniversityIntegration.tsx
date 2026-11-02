import { BookOpen } from "lucide-react";
import { useStudyQuery } from "../../api/study";
import { useLmsConnectionQuery, useLmsWorkQuery } from "../../api/lms";
import { idealHumanLocalDate } from "../../../../../packages/core/src/ideal-human.js";
import { lmsConnectionLabels, lmsDateLabel } from "../study/lms-model";
import { ErrorPanel, LoadingPanel } from "../AsyncState";
import { Fold, buttonClass } from "./Fields";

const weekdays = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

export function UniversityIntegration({
  date,
  onOpenStudy,
}: {
  date: string;
  onOpenStudy: () => void;
}) {
  const study = useStudyQuery();
  const work = useLmsWorkQuery();
  const connection = useLmsConnectionQuery();
  const classes = (study.data?.courses ?? [])
    .flatMap((course) =>
      course.schedules
        .filter(
          (schedule) =>
            schedule.dayOfWeek ===
              weekdays[new Date(`${date}T12:00:00Z`).getUTCDay()] &&
            (!course.startsOn || course.startsOn <= date) &&
            (!course.endsOn || course.endsOn >= date),
        )
        .map((schedule) => ({ course: course.title, ...schedule })),
    )
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  const fallback = (study.data?.records ?? [])
    .filter(
      (item) =>
        item.dueAt &&
        Number.isFinite(Date.parse(item.dueAt)) &&
        idealHumanLocalDate(new Date(item.dueAt)) >= date &&
        !["completed", "done"].includes(item.valueText?.toLowerCase() ?? ""),
    )
    .sort((a, b) => a.dueAt!.localeCompare(b.dueAt!))
    .slice(0, 6);
  const items = (work.data?.items ?? [])
    .filter((item) =>
      ["upcoming", "overdue", "exams", "unknown"].includes(item.category),
    )
    .sort((a, b) =>
      (a.dueAt ?? a.startsAt ?? "9999").localeCompare(
        b.dueAt ?? b.startsAt ?? "9999",
      ),
    )
    .slice(0, 8);
  const dateLabel = new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
  return (
    <Fold
      title="Университет и дедлайны"
      open
      detail="Сохранённые данные AITU / LifeOS. Актуальность зависит от последней синхронизации."
    >
      <p className="text-xs leading-relaxed text-zinc-400">
        LMS:{" "}
        {connection.data
          ? lmsConnectionLabels[connection.data.state]
          : connection.isLoading
            ? "проверяем подключение…"
            : "состояние подключения недоступно"}
        .
      </p>
      <p className="text-xs leading-relaxed text-zinc-400">
        Последняя успешная синхронизация:{" "}
        {lmsDateLabel(
          work.data?.lastSyncSuccessAt ??
            connection.data?.lastSyncSuccessAt ??
            null,
          "Asia/Almaty",
          "не подтверждена",
        )}
        .
      </p>
      {work.data?.stale || work.data?.truncated ? (
        <p className="text-xs text-amber-200">
          {work.data.stale
            ? "Данные могут быть устаревшими. Проверь актуальные задания и расписание в AITU."
            : "Показана только часть записей LMS."}
        </p>
      ) : null}
      {connection.isError ? (
        <ErrorPanel
          title="Не удалось проверить подключение LMS"
          onRetry={() => void connection.refetch()}
        />
      ) : null}
      <h3 className="text-sm font-semibold text-white">Занятия {dateLabel}</h3>
      <p className="text-xs text-amber-100">
        Сохранённое расписание; проверь актуальность в AITU.
      </p>
      {study.isLoading ? (
        <LoadingPanel title="Загружаем сохранённое расписание…" />
      ) : study.isError ? (
        <ErrorPanel
          title="Расписание временно недоступно"
          detail="Дневник можно сохранить отдельно."
          onRetry={() => void study.refetch()}
        />
      ) : classes.length ? (
        classes.map((item) => (
          <div
            key={`${item.course}-${item.id}`}
            className="rounded-lg border border-white/[0.08] p-3"
          >
            <p className="break-words text-sm font-medium text-zinc-100">
              {item.course}
            </p>
            <p className="mt-1 text-xs text-zinc-400">
              {item.startTime.slice(0, 5)}–{item.endTime.slice(0, 5)}
              {item.room ? ` · ${item.room}` : ""}
              {item.sessionType ? ` · ${item.sessionType}` : ""}
            </p>
          </div>
        ))
      ) : (
        <p className="text-xs text-zinc-400">
          В сохранённых данных нет занятий на этот день. Время не подставляется
          автоматически.
        </p>
      )}
      <h3 className="text-sm font-semibold text-white">
        Ближайшие задания и экзамены
      </h3>
      {work.isLoading ? (
        <p className="text-xs text-zinc-400">Проверяем работы LMS…</p>
      ) : null}
      {work.isError ? (
        <ErrorPanel
          title="Не удалось загрузить работы LMS"
          detail="Ниже доступны ранее сохранённые дедлайны, если они есть."
          onRetry={() => void work.refetch()}
        />
      ) : null}
      {items.length ? (
        items.map((item, index) => (
          <div
            key={`${item.courseTitle}-${item.title}-${index}`}
            className="rounded-lg border border-white/[0.08] p-3"
          >
            <p className="break-words text-sm font-medium text-zinc-100">
              {item.title}
            </p>
            <p className="mt-1 break-words text-xs text-zinc-400">
              {item.courseTitle ?? "Курс не указан"} ·{" "}
              {item.category === "overdue"
                ? "просрочено по данным LMS"
                : item.category === "exams"
                  ? "экзамен / рубежный контроль"
                  : item.category === "unknown"
                    ? "статус неизвестен"
                    : "предстоит"}
            </p>
            <p className="mt-1 text-xs text-zinc-400">
              {item.dueAt
                ? `Дедлайн: ${lmsDateLabel(item.dueAt, "Asia/Almaty")}`
                : item.startsAt
                  ? `Начало: ${lmsDateLabel(item.startsAt, "Asia/Almaty")}`
                  : "Дата не определена"}
              {item.source === "manual" ? " · ручная запись" : ""}
            </p>
          </div>
        ))
      ) : fallback.length ? (
        <>
          <p className="text-xs text-zinc-400">
            Ранее сохранённые дедлайны; проверь актуальность в LMS.
          </p>
          {fallback.map((item) => (
            <div
              key={item.id}
              className="rounded-lg border border-white/[0.08] p-3"
            >
              <p className="break-words text-sm font-medium text-zinc-100">
                {item.title}
              </p>
              <p className="mt-1 break-words text-xs text-zinc-400">
                {item.courseTitle} · {lmsDateLabel(item.dueAt, "Asia/Almaty")}
              </p>
            </div>
          ))}
        </>
      ) : !work.isLoading ? (
        <p className="text-xs text-zinc-400">
          Нет подтверждённых ближайших дедлайнов в доступных данных. Это не
          означает, что заданий нет.
        </p>
      ) : null}
      <button
        type="button"
        className={`${buttonClass} w-full`}
        onClick={onOpenStudy}
      >
        <BookOpen className="h-4 w-4" /> Открыть учёбу и AITU
      </button>
    </Fold>
  );
}
