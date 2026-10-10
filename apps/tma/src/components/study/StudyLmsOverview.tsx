import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link2, Plus, RefreshCw } from "lucide-react";
import {
  LmsError,
  createManualLmsWork,
  lmsWorkQueryKey,
  useLmsConnectionQuery,
  useLmsWorkQuery,
  type LmsWorkCategory,
  type LmsWorkItem,
  type LmsWorkSummary,
  type ManualLmsWorkInput,
} from "../../api/lms";
import { todayQueryKey } from "../../api/planning";
import { telegram } from "../../telegram";
import { ErrorPanel, LoadingPanel } from "../AsyncState";
import {
  lmsConnectionLabels,
  lmsDateLabel,
  lmsFeatureLabel,
  manualDeadlineInstant,
} from "./lms-model";

const categories: Array<{ id: LmsWorkCategory; label: string; empty: string }> =
  [
    {
      id: "upcoming",
      label: "Ближайшие дедлайны",
      empty: "Нет подтверждённых ближайших дедлайнов в доступных данных.",
    },
    {
      id: "overdue",
      label: "Просроченная работа",
      empty: "Нет подтверждённой просроченной работы в доступных данных.",
    },
    {
      id: "submitted_ungraded",
      label: "Сдано, но не оценено",
      empty: "Нет заданий с подтверждённой сдачей без оценки.",
    },
    {
      id: "graded",
      label: "Оценённая работа",
      empty: "Подтверждённые оценки пока не загружены.",
    },
    {
      id: "exams",
      label: "Экзамены и рубежный контроль",
      empty: "Подтверждённые экзамены и рубежный контроль пока не загружены.",
    },
    {
      id: "unknown",
      label: "Неизвестно / не синхронизировано",
      empty:
        "Отдельных записей с неизвестным статусом нет. Отсутствие данных не подтверждает отсутствие заданий.",
    },
  ];

const submissionLabels: Record<LmsWorkItem["submissionStatus"], string> = {
  not_submitted: "Не сдано",
  submitted: "Сдано",
  graded: "Оценено",
  unknown: "Статус сдачи неизвестен",
};

const kindLabels: Record<LmsWorkItem["kind"], string> = {
  assignment: "Задание",
  quiz: "Тест",
  exam: "Экзамен",
  midterm: "Рубежный контроль",
  unknown: "Тип неизвестен",
};

function WorkItem({ item, timezone }: { item: LmsWorkItem; timezone: string }) {
  return (
    <li className="min-w-0 space-y-2 py-3">
      <p className="break-words text-sm font-medium text-white">{item.title}</p>
      {item.courseTitle ? (
        <p className="break-words text-xs text-zinc-400">{item.courseTitle}</p>
      ) : null}
      <div className="flex flex-wrap gap-2 text-xs text-zinc-300">
        <span>{kindLabels[item.kind] ?? "Тип неизвестен"}</span>
        <span>·</span>
        <span>
          {submissionLabels[item.submissionStatus] ?? "Статус сдачи неизвестен"}
        </span>
        <span>·</span>
        <span>
          {item.source === "manual"
            ? "Введено вручную"
            : item.source === "moodle"
              ? "Moodle"
              : "Источник неизвестен"}
        </span>
      </div>
      <p className="text-xs text-zinc-300">
        Срок: {lmsDateLabel(item.dueAt, timezone)}
      </p>
      {item.startsAt ? (
        <p className="text-xs text-zinc-300">
          Начало: {lmsDateLabel(item.startsAt, timezone)}
        </p>
      ) : null}
      {item.endsAt ? (
        <p className="text-xs text-zinc-300">
          Окончание: {lmsDateLabel(item.endsAt, timezone)}
        </p>
      ) : null}
      <p className="text-xs tabular-nums text-zinc-300">
        Оценка:{" "}
        {item.score === null
          ? "неизвестна"
          : item.maxScore === null
            ? item.score
            : `${item.score} / ${item.maxScore}`}
        {item.percentage !== null ? ` · ${item.percentage}%` : ""}
      </p>
    </li>
  );
}

export function LmsWorkDetails({ summary }: { summary: LmsWorkSummary }) {
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
        <h2 className="text-sm font-semibold text-white">
          Работа из LMS и ручные записи
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-zinc-400">
          Последняя успешная синхронизация:{" "}
          {lmsDateLabel(
            summary.lastSyncSuccessAt,
            summary.timezone,
            "Ещё не было",
          )}
          .
        </p>
        <p className="mt-1 text-xs leading-relaxed text-zinc-400">
          Последняя попытка:{" "}
          {lmsDateLabel(
            summary.lastSyncAttemptAt,
            summary.timezone,
            "Ещё не было",
          )}{" "}
          · {summary.timezone}
        </p>
        <p className="mt-3 text-xs leading-relaxed text-zinc-400">
          Отсутствие оценки не означает, что работа не сдана. Неизвестные даты и
          статусы не заменяются предположениями.
        </p>
        {summary.stale ? (
          <p
            role="status"
            className="mt-3 text-sm leading-relaxed text-amber-200"
          >
            Данные могут быть устаревшими. Проверь подключение и запусти
            синхронизацию.
          </p>
        ) : null}
        {summary.truncated ? (
          <p className="mt-2 text-xs leading-relaxed text-amber-200">
            Показана часть записей: достигнут лимит загрузки.
          </p>
        ) : null}
        {summary.warnings.map((warning, index) => (
          <p
            key={index}
            className="mt-2 text-xs leading-relaxed text-amber-200"
          >
            {lmsFeatureLabel(warning)}
          </p>
        ))}
        {summary.unsupportedFeatures.length ? (
          <div className="mt-3">
            <p className="text-xs font-medium text-amber-200">
              Не удалось получить из LMS:
            </p>
            <ul className="mt-1 space-y-1 text-xs leading-relaxed text-zinc-300">
              {summary.unsupportedFeatures.map((feature, index) => (
                <li key={index}>{lmsFeatureLabel(feature)}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      {categories.map((category) => {
        const items = summary.items.filter(
          (item) => item.category === category.id,
        );
        return (
          <details
            key={category.id}
            open={
              (category.id === "upcoming" || category.id === "overdue") &&
              items.length > 0
            }
            className="rounded-xl border border-white/[0.08] bg-white/[0.03]"
          >
            <summary className="min-h-11 cursor-pointer break-words rounded-xl p-4 text-sm font-semibold text-white hover:bg-white/[0.03]">
              {category.label}{" "}
              <span className="font-normal text-zinc-400">
                ({items.length})
              </span>
            </summary>
            {items.length > 0 ? (
              <ul className="divide-y divide-white/[0.06] px-4 pb-2">
                {items.map((item, index) => (
                  <WorkItem
                    key={index}
                    item={item}
                    timezone={summary.timezone}
                  />
                ))}
              </ul>
            ) : (
              <p className="px-4 pb-4 text-xs leading-relaxed text-zinc-400">
                {category.empty}
              </p>
            )}
          </details>
        );
      })}
    </div>
  );
}

export function ManualLmsWorkForm() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [courseTitle, setCourseTitle] = useState("");
  const [kind, setKind] = useState<ManualLmsWorkInput["kind"]>("assignment");
  const [submissionStatus, setSubmissionStatus] =
    useState<ManualLmsWorkInput["submissionStatus"]>("unknown");
  const [due, setDue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const timezone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  const mutation = useMutation({
    mutationFn: (input: ManualLmsWorkInput) => createManualLmsWork(input),
    retry: false,
    gcTime: 0,
    async onSuccess() {
      setTitle("");
      setCourseTitle("");
      setDue("");
      setSubmissionStatus("unknown");
      setSaved(true);
      telegram.hapticImpact("light");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: lmsWorkQueryKey }),
        queryClient.invalidateQueries({ queryKey: todayQueryKey }),
      ]);
    },
    onError(failure) {
      setError(
        failure instanceof LmsError
          ? failure.message
          : "Не удалось добавить запись. Попробуй снова.",
      );
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || mutation.isPending) return;
    setError(null);
    setSaved(false);
    try {
      const dueAt = manualDeadlineInstant(due);
      mutation.mutate({
        title: title.trim(),
        ...(courseTitle.trim() ? { courseTitle: courseTitle.trim() } : {}),
        kind,
        submissionStatus,
        dueAt,
      });
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Проверь дату и время.",
      );
    }
  }

  const fieldClass =
    "mt-2 min-h-11 w-full min-w-0 max-w-full rounded-lg border border-white/[0.08] bg-graphite-900 px-3 py-3 text-base text-white disabled:opacity-50";
  return (
    <section className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="manual-study-work"
        onClick={() => setOpen(!open)}
        className="flex min-h-11 w-full items-center gap-2 text-left text-sm font-medium text-cyan-200 hover:text-cyan-100 active:scale-[0.98]"
      >
        <Plus className="h-4 w-4 shrink-0" />
        Добавить вручную
      </button>
      <p className="mt-1 text-xs leading-relaxed text-zinc-400">
        Для недоступных страниц Moodle. Ручные записи не меняют данные LMS.
      </p>
      {open ? (
        <form
          id="manual-study-work"
          onSubmit={submit}
          className="mt-4 space-y-3"
        >
          <label className="block text-sm text-zinc-200">
            Название
            <input
              required
              maxLength={240}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={mutation.isPending}
              className={fieldClass}
            />
          </label>
          <label className="block text-sm text-zinc-200">
            Предмет (необязательно)
            <input
              maxLength={240}
              value={courseTitle}
              onChange={(event) => setCourseTitle(event.target.value)}
              disabled={mutation.isPending}
              className={fieldClass}
            />
          </label>
          <label className="block text-sm text-zinc-200">
            Тип
            <select
              value={kind}
              onChange={(event) =>
                setKind(event.target.value as ManualLmsWorkInput["kind"])
              }
              disabled={mutation.isPending}
              className={fieldClass}
            >
              <option value="assignment">Задание</option>
              <option value="quiz">Тест</option>
              <option value="exam">Экзамен</option>
              <option value="midterm">Рубежный контроль</option>
            </select>
          </label>
          <label className="block text-sm text-zinc-200">
            Статус сдачи
            <select
              value={submissionStatus}
              onChange={(event) =>
                setSubmissionStatus(
                  event.target.value as ManualLmsWorkInput["submissionStatus"],
                )
              }
              disabled={mutation.isPending}
              className={fieldClass}
            >
              <option value="unknown">Неизвестно</option>
              <option value="not_submitted">Не сдано</option>
              <option value="submitted">Сдано</option>
            </select>
          </label>
          <label className="block text-sm text-zinc-200">
            Срок (необязательно)
            <input
              type="datetime-local"
              value={due}
              onChange={(event) => setDue(event.target.value)}
              disabled={mutation.isPending}
              aria-describedby="manual-study-timezone"
              className={fieldClass}
            />
          </label>
          <p
            id="manual-study-timezone"
            className="break-words text-xs leading-relaxed text-zinc-400"
          >
            Время устройства: {timezone}. Оставь поле пустым, если срок
            неизвестен.
          </p>
          <button
            disabled={!title.trim() || mutation.isPending}
            type="submit"
            className="min-h-11 w-full rounded-lg bg-cyan-300 px-3 text-sm font-semibold text-graphite-950 hover:bg-cyan-200 active:scale-[0.98] disabled:opacity-50"
          >
            {mutation.isPending ? "Добавляем…" : "Добавить запись"}
          </button>
        </form>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-sm leading-relaxed text-rose-200">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="mt-3 text-sm text-emerald-200">
          Ручная запись добавлена.
        </p>
      ) : null}
    </section>
  );
}

export function StudyLmsOverview({
  onOpenConnection,
}: {
  onOpenConnection: () => void;
}) {
  const query = useLmsWorkQuery();
  const connectionQuery = useLmsConnectionQuery();
  return (
    <section
      className="min-w-0 space-y-3"
      aria-label="AITU LMS и учебная работа"
    >
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
        <button
          type="button"
          onClick={onOpenConnection}
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-cyan-400/25 bg-cyan-400/10 px-3 text-sm font-medium text-cyan-200 hover:bg-cyan-400/15 active:scale-[0.98]"
        >
          <Link2 className="h-4 w-4 shrink-0" />
          AITU LMS Connection
        </button>
        <p className="mt-2 text-xs text-zinc-400">
          {connectionQuery.data
            ? (lmsConnectionLabels[connectionQuery.data.state] ??
              "Состояние неизвестно")
            : connectionQuery.isLoading
              ? "Проверяем подключение…"
              : "Состояние подключения недоступно"}
        </p>
        <button
          type="button"
          disabled={query.isFetching || connectionQuery.isFetching}
          onClick={() => {
            void query.refetch();
            void connectionQuery.refetch();
          }}
          className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm text-zinc-300 hover:bg-white/[0.06] active:scale-[0.98] disabled:opacity-50"
        >
          <RefreshCw className="h-4 w-4" />
          Обновить работу и статус
        </button>
      </div>
      {query.isLoading ? (
        <LoadingPanel title="Загружаем учебную работу…" />
      ) : query.data ? (
        <LmsWorkDetails summary={query.data} />
      ) : (
        <ErrorPanel
          title="Учебная работа недоступна"
          detail={
            query.error instanceof LmsError
              ? query.error.message
              : "Проверь подключение и попробуй снова."
          }
          onRetry={() => void query.refetch()}
        />
      )}
      {query.isError && query.data ? (
        <p role="status" className="text-sm leading-relaxed text-amber-200">
          Не удалось обновить работу. Показаны ранее загруженные данные.
        </p>
      ) : null}
      <ManualLmsWorkForm />
    </section>
  );
}
