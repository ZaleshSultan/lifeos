"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, CalendarDays, GraduationCap, RefreshCw } from "lucide-react";
import {
  ACADEMIC_TIMEZONE,
  type AcademicEvent,
} from "../../../../../packages/core/src/academic-concierge.js";
import type {
  AcademicSnapshot,
  AcademicTransport,
} from "../../api/study-concierge";
import { cx } from "../../lib/styles";
import {
  AcademicEventCard,
  AcademicEventEditor,
  AcademicEventSummary,
} from "./AcademicEventReview";
import { AcademicImportPanel } from "./AcademicImportPanel";
import {
  AcademicPreferencesForm,
  AcademicScheduleVerificationForm,
} from "./AcademicPreferencesForm";
import { AcademicRoomMap } from "./AcademicRoomMap";
import {
  academicButton,
  academicCalendarDate,
  academicCountdown,
  academicDateTime,
  academicError,
  academicPanel,
  academicWarning,
} from "./academic-ui";

const tabs = [
  ["exams", "Экзамены AITU"],
  ["personal", "Личные экзамены"],
  ["calendar", "Календарь"],
  ["assignments", "Задания LMS"],
  ["settings", "Уведомления"],
  ["import", "Импорт"],
] as const;
type Tab = (typeof tabs)[number][0];
function requestedAcademicTab(): Tab {
  const value =
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("academicTab");
  return tabs.some(([id]) => id === value) ? (value as Tab) : "exams";
}

function moodleAssignmentUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    return u.protocol === "https:" &&
      u.hostname === "lms.astanait.edu.kz" &&
      !u.username &&
      !u.password &&
      !u.port &&
      u.pathname === "/mod/assign/view.php" &&
      /^\d+$/.test(u.searchParams.get("id") ?? "") &&
      [...u.searchParams.keys()].every((key) => key === "id") &&
      !u.hash
      ? u.href
      : null;
  } catch {
    return null;
  }
}

/** Shared owner-scoped academic review. External AI and delivery are never dispatched here. */
export function AcademicConcierge({
  transport,
  initial,
  errorMessage,
  onSnapshot,
  onDirtyChange,
}: {
  transport: AcademicTransport;
  initial: AcademicSnapshot | null;
  errorMessage: (error: unknown) => string;
  onSnapshot?: (snapshot: AcademicSnapshot) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [snapshot, setSnapshot] = useState(initial);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>(requestedAcademicTab);
  const [now, setNow] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [parts, setParts] = useState({
    settings: false,
    schedule: false,
    import: false,
  });
  const [editing, setEditing] = useState<AcademicEvent | null>(null);
  const [decision, setDecision] = useState<{
    event: AcademicEvent;
    action: "confirm" | "cancel";
  } | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [generation, setGeneration] = useState(0);
  const inFlight = useRef(false);
  const dirty =
    parts.settings ||
    parts.schedule ||
    parts.import ||
    editing !== null ||
    decision !== null;
  const settingsDirty = useCallback(
    (value: boolean) =>
      setParts((p) => (p.settings === value ? p : { ...p, settings: value })),
    [],
  );
  const scheduleDirty = useCallback(
    (value: boolean) =>
      setParts((p) => (p.schedule === value ? p : { ...p, schedule: value })),
    [],
  );
  const importDirty = useCallback(
    (value: boolean) =>
      setParts((p) => (p.import === value ? p : { ...p, import: value })),
    [],
  );
  const apply = useCallback(
    (value: AcademicSnapshot) => {
      setSnapshot(value);
      onSnapshot?.(value);
    },
    [onSnapshot],
  );
  useEffect(() => {
    setReady(true);
    setNow(new Date().toISOString());
    const timer = window.setInterval(
      () => setNow(new Date().toISOString()),
      60_000,
    );
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  useEffect(() => {
    if (initial !== null) return;
    const control = new AbortController();
    setBusy(true);
    transport
      .overview(control.signal)
      .then((value) => {
        if (!control.signal.aborted) apply(value);
      })
      .catch((e: unknown) => {
        if (!control.signal.aborted) setError(academicError(e, errorMessage));
      })
      .finally(() => {
        if (!control.signal.aborted) setBusy(false);
      });
    return () => control.abort();
  }, [transport, initial, apply, errorMessage]);

  async function work<T>(task: () => Promise<T>): Promise<T> {
    if (inFlight.current) throw new Error("academic_request_pending");
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      return await task();
    } catch (e) {
      setError(academicError(e, errorMessage));
      throw e;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function refresh() {
    if (
      inFlight.current ||
      (dirty &&
        !window.confirm(
          "Отменить несохранённые правки и загрузить сохранённые учебные данные?",
        ))
    )
      return;
    try {
      const value = await work(() => transport.overview());
      apply(value);
      setEditing(null);
      setDecision(null);
      setParts({ settings: false, schedule: false, import: false });
      setGeneration((x) => x + 1);
      setMessage("Сохранённые учебные данные обновлены.");
    } catch {
      /* The displayed snapshot and edits remain available. */
    }
  }
  function chooseTab(value: Tab) {
    if (inFlight.current) return false;
    if (
      tab !== value &&
      dirty &&
      !window.confirm(
        "В этом разделе есть несохранённые правки. Перейти и отменить их?",
      )
    )
      return false;
    if (tab !== value) {
      setEditing(null);
      setDecision(null);
      setParts({ settings: false, schedule: false, import: false });
      setGeneration((x) => x + 1);
    }
    setTab(value);
    setError(null);
    setMessage(null);
    const url = new URL(window.location.href);
    url.searchParams.set("academicTab", value);
    window.history.replaceState(null, "", url);
    return true;
  }
  useEffect(() => {
    const navigate = () => {
      const requested = new URLSearchParams(window.location.search).get(
        "academicTab",
      );
      if (!tabs.some(([id]) => id === requested) || requested === tab) return;
      if (!chooseTab(requested as Tab)) {
        const url = new URL(window.location.href);
        url.searchParams.set("academicTab", tab);
        window.history.replaceState(null, "", url);
      }
    };
    window.addEventListener("lifeos:navigation", navigate);
    window.addEventListener("popstate", navigate);
    return () => {
      window.removeEventListener("lifeos:navigation", navigate);
      window.removeEventListener("popstate", navigate);
    };
  }, [tab, dirty]);
  const locked = busy || !ready;
  const events = snapshot?.events ?? [];
  const exams = events
    .filter((event) => event.kind === "university_exam")
    .sort((a, b) => (a.startsAt ?? "").localeCompare(b.startsAt ?? ""));
  const personal = events
    .filter((event) => event.kind === "personal_exam")
    .sort((a, b) => (a.startsAt ?? "").localeCompare(b.startsAt ?? ""));
  const nextExam = exams.find(
    (event) =>
      event.status === "confirmed" &&
      event.startsAt &&
      (!now || Date.parse(event.startsAt) >= Date.parse(now)),
  );
  const classes = snapshot?.classes ?? [];
  const nextClass = classes.find(
    (item) => !now || Date.parse(item.startsAt) >= Date.parse(now),
  );
  const sourceFor = (event: AcademicEvent) =>
    snapshot?.sources.find((source) => source.key === event.sourceKey);

  return (
    <div className="min-w-0 space-y-4" aria-label="Учебный консьерж">
      <header className={academicPanel}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
              <GraduationCap
                className="h-5 w-5 shrink-0 text-cyan-300"
                aria-hidden="true"
              />
              Экзамены и учебный календарь
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-zinc-300">
              Расписание, личные события и настоящие задания LMS. Проверка
              источников и согласие на уведомления — отдельно.
            </p>
          </div>
          <button
            type="button"
            aria-label="Обновить учебные события"
            className={academicButton + " shrink-0"}
            disabled={locked}
            onClick={() => void refresh()}
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only sm:not-sr-only">Обновить</span>
          </button>
        </div>
        {snapshot ? (
          <p className="mt-3 text-xs text-zinc-400">
            Личное время и тихие часы: {snapshot.timezone}. Занятия AITU:{" "}
            {ACADEMIC_TIMEZONE}. У событий сохранён их исходный часовой пояс.
          </p>
        ) : null}
        {nextExam ? (
          <div className="mt-4 rounded-lg border border-cyan-300/20 bg-cyan-300/[0.05] p-3">
            <p className="text-xs text-cyan-100">
              Ближайший подтверждённый экзамен
            </p>
            <p className="mt-1 break-words font-semibold text-white">
              {nextExam.title}
            </p>
            <p className="mt-1 text-sm text-zinc-200">
              {academicDateTime(nextExam.startsAt, nextExam.timezone)}
            </p>
            <p className="mt-1 text-sm text-cyan-200">
              {academicCountdown(nextExam, now)}
            </p>
          </div>
        ) : null}
      </header>
      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-rose-300/20 bg-rose-300/[0.05] p-3 text-sm text-rose-100"
        >
          {error}
        </p>
      ) : null}
      {message ? (
        <p
          role="status"
          className="rounded-lg border border-cyan-300/20 p-3 text-sm text-cyan-100"
        >
          {message}
        </p>
      ) : null}
      {!snapshot ? (
        <div className={academicPanel}>
          <p role="status" className="text-sm text-zinc-300">
            {busy
              ? "Загружаем учебные события…"
              : "Учебные события пока недоступны. Сохранённые данные не заменяются примерами."}
          </p>
          <button
            type="button"
            className={academicButton + " mt-3"}
            disabled={locked}
            onClick={() => void refresh()}
          >
            Повторить загрузку
          </button>
        </div>
      ) : (
        <>
          {snapshot.deliveryEnabled === false ? (
            <p className="rounded-lg border border-amber-300/20 bg-amber-300/[0.05] p-3 text-sm text-amber-100">
              <Bell className="mr-1 inline h-4 w-4" aria-hidden="true" />
              Автоматическая учебная доставка выключена на сервере. Просмотр,
              импорт и ручные записи доступны; сохранение предпочтений не
              означает, что сообщение уже отправлено.
            </p>
          ) : null}
          {snapshot.truncated ? (
            <p className="text-sm text-amber-100">
              Сводка ограничена по объёму. Она не подтверждает полноту
              расписания или заданий.
            </p>
          ) : null}
          {snapshot.warnings.length ? (
            <ul className="list-disc space-y-1 pl-5 text-sm text-amber-100">
              {snapshot.warnings.map((warning, i) => (
                <li key={i}>{academicWarning(warning)}</li>
              ))}
            </ul>
          ) : null}
          <div
            className="grid grid-cols-3 gap-2 rounded-xl border border-white/[0.08] bg-white/[0.02] p-2 sm:grid-cols-6"
            role="tablist"
            aria-label="Экзамены, календарь и уведомления"
          >
            {tabs.map(([key, label], index) => (
              <button
                key={key}
                id={`academic-tab-${key}`}
                type="button"
                role="tab"
                aria-selected={tab === key}
                aria-controls={`academic-panel-${tab}`}
                tabIndex={tab === key ? 0 : -1}
                disabled={locked}
                onClick={() => chooseTab(key)}
                onKeyDown={(e) => {
                  if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
                  e.preventDefault();
                  const next =
                    tabs[
                      (index + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) %
                        tabs.length
                    ][0];
                  chooseTab(next);
                  document.getElementById(`academic-tab-${next}`)?.focus();
                }}
                className={cx(
                  academicButton,
                  "min-w-0 px-1 text-xs",
                  tab === key
                    ? "border-cyan-300/25 bg-cyan-300/10 text-cyan-100"
                    : "text-zinc-300",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div
            id={`academic-panel-${tab}`}
            role="tabpanel"
            aria-labelledby={`academic-tab-${tab}`}
            className="min-w-0 space-y-3"
          >
            {tab === "exams" ? (
              <>
                <section className={academicPanel}>
                  <h3 className="text-base font-semibold text-white">
                    Следующее подтверждённое занятие
                  </h3>
                  {nextClass ? (
                    <>
                      <p className="mt-2 break-words text-sm text-zinc-100">
                        {nextClass.title}
                      </p>
                      <p className="mt-1 text-sm text-zinc-300">
                        {academicDateTime(
                          nextClass.startsAt,
                          ACADEMIC_TIMEZONE,
                        )}{" "}
                        · {ACADEMIC_TIMEZONE} ·{" "}
                        {nextClass.location ?? "Аудитория не подтверждена"}
                      </p>
                      <AcademicRoomMap
                        key={nextClass.location}
                        location={nextClass.location}
                      />
                    </>
                  ) : (
                    <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                      {snapshot.scheduleVerification.current
                        ? "В ближайшем проверенном периоде занятие не представлено. Это не означает отсутствие пар в других источниках."
                        : "Актуальный источник обычных занятий не подтверждён. Проверь его в настройках уведомлений."}
                    </p>
                  )}
                </section>
                <section className={academicPanel}>
                  <h3 className="text-base font-semibold text-white">
                    Подготовка к сессии
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-300">
                    Подтверждено экзаменов:{" "}
                    {
                      exams.filter((event) => event.status === "confirmed")
                        .length
                    }
                    . Предложений на проверке:{" "}
                    {
                      exams.filter((event) => event.status === "proposed")
                        .length
                    }
                    . Начни с материалов ближайшего подтверждённого предмета и
                    проверь реальные задания LMS. Баллы, часы подготовки и
                    результат экзамена не предполагаются.
                  </p>
                  <p className="mt-2 text-xs text-zinc-400">
                    Коды exam и examfx сохранены как в документе. Значение
                    examfx не подтверждено; это не автоматическая отметка о
                    пересдаче.
                  </p>
                </section>
                {exams.length ? (
                  exams.map((event) => (
                    <AcademicEventCard
                      key={event.id}
                      event={event}
                      source={sourceFor(event)}
                      now={now}
                      busy={locked}
                      onEdit={() => {
                        setEditing(event);
                        setDecision(null);
                      }}
                      onDecision={(action) => {
                        setDecision({ event, action });
                        setEditing(null);
                        setAgreed(false);
                      }}
                    />
                  ))
                ) : (
                  <p className={academicPanel + " text-sm text-zinc-400"}>
                    Экзамены ещё не импортированы. Подготовь проверенный
                    источник и открой предпросмотр; даты сессии не заменяют
                    точные слоты.
                  </p>
                )}
              </>
            ) : null}
            {tab === "personal" ? (
              <>
                <p className="text-sm leading-relaxed text-zinc-300">
                  Личные экзамены хранятся отдельно. Предложение не считается
                  подтверждённым событием и не создаёт уведомлений. Неизвестная
                  длительность остаётся неизвестной.
                </p>
                {personal.length ? (
                  personal.map((event) => (
                    <AcademicEventCard
                      key={event.id}
                      event={event}
                      source={sourceFor(event)}
                      now={now}
                      busy={locked}
                      onEdit={() => {
                        setEditing(event);
                        setDecision(null);
                      }}
                      onDecision={(action) => {
                        setDecision({ event, action });
                        setEditing(null);
                        setAgreed(false);
                      }}
                    />
                  ))
                ) : (
                  <p className={academicPanel + " text-sm text-zinc-400"}>
                    Личных экзаменов пока нет. Их можно отдельно добавить через
                    проверенный импорт.
                  </p>
                )}
              </>
            ) : null}
            {tab === "calendar" ? (
              <>
                <p className="text-sm leading-relaxed text-zinc-300">
                  Диапазоны включают последний день. Учебные периоды, праздники,
                  летний семестр и каникулы показаны отдельно, даже когда даты
                  пересекаются. Широкий период аттестации не определяет время
                  отдельного экзамена.
                </p>
                {([null, 1, 2, 3] as const).map((trimester) => {
                  const rows = events
                    .filter(
                      (event) =>
                        (event.kind === "calendar_period" ||
                          event.kind === "holiday") &&
                        event.trimester === trimester,
                    )
                    .sort((a, b) =>
                      (a.startsOn ?? "").localeCompare(b.startsOn ?? ""),
                    );
                  return (
                    <section key={trimester ?? "year"} className="space-y-3">
                      <h3 className="flex items-center gap-2 text-base font-semibold text-white">
                        <CalendarDays
                          className="h-4 w-4 text-cyan-300"
                          aria-hidden="true"
                        />
                        {trimester
                          ? `Триместр ${trimester}`
                          : "Общие события учебного года"}
                      </h3>
                      {rows.length ? (
                        rows.map((event) => (
                          <article key={event.id} className={academicPanel}>
                            <AcademicEventSummary
                              event={event}
                              source={sourceFor(event)}
                              now={now}
                              map={false}
                            />
                          </article>
                        ))
                      ) : (
                        <p className="text-sm text-zinc-400">
                          Подтверждённые события этого раздела не представлены.
                        </p>
                      )}
                    </section>
                  );
                })}
              </>
            ) : null}
            {tab === "assignments" ? (
              <>
                <section className={academicPanel}>
                  <h3 className="text-base font-semibold text-white">
                    Состояние источника Moodle
                  </h3>
                  <p className="mt-2 text-sm text-zinc-300">
                    {!snapshot.lms.configured
                      ? "Подключение LMS не настроено."
                      : snapshot.lms.stale
                        ? "Источник устарел или нужен повторный вход. Проверь подключение LMS обычным разрешённым способом."
                        : "Доступна сохранённая синхронизация LMS."}
                  </p>
                  <p className="mt-2 text-xs text-zinc-400">
                    Последняя успешная синхронизация:{" "}
                    {snapshot.lms.lastSuccessfulSyncAt
                      ? academicDateTime(
                          snapshot.lms.lastSuccessfulSyncAt,
                          snapshot.timezone,
                        )
                      : "не подтверждена"}
                    .
                  </p>
                </section>
                {snapshot.assignments?.length ? (
                  snapshot.assignments.map((item) => {
                    const link = moodleAssignmentUrl(item.sourceUrl);
                    return (
                      <article key={item.key} className={academicPanel}>
                        <h3 className="break-words text-base font-semibold text-white">
                          {item.title}
                        </h3>
                        <p className="mt-1 break-words text-sm text-zinc-300">
                          {item.courseTitle ?? "Предмет не подтверждён"}
                        </p>
                        <p className="mt-2 text-sm text-zinc-200">
                          Срок в источнике:{" "}
                          {academicDateTime(item.dueAt, snapshot.timezone)}
                        </p>
                        <p className="mt-2 text-xs text-zinc-400">
                          {
                            (
                              {
                                not_submitted: "По источнику ещё не отправлено",
                                submitted: "Подтверждена отправка",
                                graded: "По источнику оценено",
                                unknown: "Статус отправки не подтверждён",
                              } as const
                            )[item.submissionState]
                          }
                          {item.stale ? " · данные устарели" : ""}
                          {!item.verified
                            ? " · источник задания требует проверки"
                            : ""}
                        </p>
                        {link ? (
                          <a
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={academicButton + " mt-3"}
                          >
                            Открыть задание в Moodle
                          </a>
                        ) : null}
                      </article>
                    );
                  })
                ) : (
                  <p className={academicPanel + " text-sm text-zinc-400"}>
                    Подтверждённые задания с реальными сроками не представлены.
                    Это не означает, что в LMS нет работ. Тесты и строки оценок
                    не превращаются в дедлайны.
                  </p>
                )}
              </>
            ) : null}
            {tab === "settings" ? (
              <>
                <AcademicPreferencesForm
                  key={`prefs-${snapshot.preferences.revision}-${generation}`}
                  initial={snapshot.preferences}
                  timezone={snapshot.timezone}
                  busy={locked}
                  onDirtyChange={settingsDirty}
                  onSave={async (preferences) => {
                    const value = await work(() =>
                      transport.preferences(preferences),
                    );
                    apply(value);
                    setMessage(
                      "Предпочтения сохранены. Доставка дополнительно проверяет разрешения сервера, тихие часы и актуальность источника.",
                    );
                  }}
                />
                <AcademicScheduleVerificationForm
                  key={`schedule-${snapshot.scheduleVerification.revision}-${generation}`}
                  verification={snapshot.scheduleVerification}
                  busy={locked}
                  onDirtyChange={scheduleDirty}
                  onSave={async (input) => {
                    apply(await work(() => transport.verifySchedule(input)));
                    setMessage(
                      "Проверка обычного расписания сохранена. Предпочтения доставки не включались автоматически.",
                    );
                  }}
                />
              </>
            ) : null}
            {tab === "import" ? (
              <AcademicImportPanel
                key={`import-${generation}`}
                busy={locked}
                timezone={ACADEMIC_TIMEZONE}
                now={now}
                onDirtyChange={importDirty}
                onPreview={(bundle) => work(() => transport.preview(bundle))}
                onImport={async (input) => {
                  const result = await work(() =>
                    transport.importSelected(input),
                  );
                  apply(result.overview);
                  return result;
                }}
              />
            ) : null}
          </div>
          {editing ? (
            <AcademicEventEditor
              key={editing.id}
              event={editing}
              busy={locked}
              onCancel={() => setEditing(null)}
              onSave={async (patch) => {
                const overview = await work(() =>
                  transport.revise(editing.id, {
                    expectedRevision: editing.revision,
                    patch,
                    confirmed: true,
                  }),
                );
                apply(overview);
                setEditing(null);
                setMessage(
                  "Ручная правка сохранена. Уведомления не включались автоматически.",
                );
              }}
            />
          ) : null}
          {decision ? (
            <section
              role="dialog"
              aria-modal="false"
              aria-labelledby="academic-decision-title"
              className={academicPanel}
            >
              <h3
                id="academic-decision-title"
                className="text-base font-semibold text-white"
              >
                {decision.action === "confirm"
                  ? "Подтвердить выбранное событие?"
                  : "Отменить выбранное событие?"}
              </h3>
              <p className="mt-2 break-words text-sm text-zinc-200">
                {decision.event.title} ·{" "}
                {academicDateTime(
                  decision.event.startsAt,
                  decision.event.timezone,
                )}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-zinc-400">
                {decision.action === "confirm"
                  ? "Подтверждение относится только к этому событию. Доставка настраивается отдельно."
                  : "Событие останется в истории с пометкой отмены. Новые уведомления для него не отправляются."}
              </p>
              <label className="mt-3 flex min-h-11 items-center gap-3 text-sm text-zinc-200">
                <input
                  type="checkbox"
                  className="h-5 w-5 shrink-0 accent-cyan-300"
                  disabled={locked}
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                />
                Я проверил событие и подтверждаю это действие.
              </label>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={academicButton}
                  disabled={locked || !agreed}
                  onClick={() => {
                    void (async () => {
                      try {
                        const overview = await work(() =>
                          transport.decide(
                            decision.event.id,
                            decision.action,
                            decision.event.revision,
                          ),
                        );
                        apply(overview);
                        setDecision(null);
                        setAgreed(false);
                        setMessage("Статус выбранного события сохранён.");
                      } catch {
                        /* Keep explicit confirmation available for review/retry. */
                      }
                    })();
                  }}
                >
                  Да,{" "}
                  {decision.action === "confirm"
                    ? "подтвердить событие"
                    : "отменить событие"}
                </button>
                <button
                  type="button"
                  className={academicButton}
                  disabled={locked}
                  onClick={() => {
                    setDecision(null);
                    setAgreed(false);
                  }}
                >
                  Вернуться без изменений
                </button>
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
