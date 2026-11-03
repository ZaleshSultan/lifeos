import { AutoHealthPanel } from "../components/ideal-human/AutoHealthPanel";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  Check,
  Download,
  Dumbbell,
  HeartPulse,
  Save,
} from "lucide-react";
import {
  IDEAL_HUMAN_CONFIG,
  IDEAL_HUMAN_START,
  IDEAL_HUMAN_END,
  IdealHumanInputError,
  emptyIdealHumanDay,
  hasIdealHumanObservation,
  idealHumanAdherence,
  idealHumanDate,
  idealHumanDayNumber,
  idealHumanExperimentStatus,
  idealHumanLocalDate,
  idealHumanStats,
  idealHumanStudyMinutes,
  parseIdealHumanDay,
  type IdealHumanDay,
} from "../../../../packages/core/src/ideal-human.js";
import { ApiError, apiErrorMessage } from "../api/errors";
import {
  useClearIdealHumanReflection,
  useIdealHumanDays,
  useSaveIdealHumanDay,
} from "../api/ideal-human";
import { useWorkoutHistoryQuery, useWorkoutSessionQuery } from "../api/workout";
import { ErrorPanel, LoadingPanel } from "../components/AsyncState";
import { UniversityIntegration } from "../components/ideal-human/UniversityIntegration";
import {
  DayPlan,
  LearningJournal,
  NutritionJournal,
  ReflectionJournal,
  VideoJournal,
} from "../components/ideal-human/JournalSections";
import {
  ChoiceField,
  Fold,
  NumberField,
  StatusTile,
  TextField,
  buttonClass,
  inputClass,
  panelClass,
} from "../components/ideal-human/Fields";

const dates = Array.from({ length: 30 }, (_, i) => idealHumanDate(i + 1));
const hours = (minutes: number | null) =>
  minutes === null ? "Нет записи" : `${(minutes / 60).toFixed(1)} ч`;
const dayLabel = (date: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
const sameContent = (a: IdealHumanDay, b: IdealHumanDay) =>
  JSON.stringify({ ...a, revision: 0 }) ===
  JSON.stringify({ ...b, revision: 0 });

function downloadJson(value: unknown, filename: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], {
      type: "application/json;charset=utf-8",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function validationMessage(error: IdealHumanInputError) {
  const messages: Record<string, string> = {
    "Invalid weightKg":
      "Вес: введи измеренное значение от 25 до 300 кг или оставь поле пустым.",
    "Invalid baselineHeightCm":
      "Рост: введи измеренное значение от 80 до 250 см или оставь поле пустым.",
    "Invalid sleepMinutes": "Сон: введи продолжительность от 0 до 24 часов.",
    "Invalid energy": "Энергия должна быть от 1 до 5.",
    "Invalid mood": "Настроение должно быть от 1 до 5.",
    "Invalid workoutEffort": "Оцени усилие от 1 до 10 или оставь поле пустым.",
    "Meal needs a description":
      "Добавь описание приёма пищи или убери пустую запись.",
    "Plan block needs a title and kind":
      "У каждого блока плана должно быть название.",
    "Task needs a title": "Добавь название задачи или убери её из плана.",
    "Record at least one observation, reflection, or plan change":
      "Запиши хотя бы одно наблюдение, заметку или изменение плана.",
  };
  return (
    messages[error.message] ??
    "Проверь значения: время в формате ЧЧ:ММ, минуты до 900, калории до 10000, белок до 400 г. Поля можно оставить пустыми."
  );
}

export function IdealHumanScreen({
  onOpenWorkout,
  onOpenHealth,
  onOpenStudy,
  onOpenReminders,
  onDirtyChange,
}: {
  onOpenWorkout: () => void;
  onOpenHealth: () => void;
  onOpenStudy: () => void;
  onOpenReminders: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [today, setToday] = useState(() => idealHumanLocalDate(new Date()));
  const initialDate =
    today < IDEAL_HUMAN_START
      ? IDEAL_HUMAN_START
      : today > IDEAL_HUMAN_END
        ? IDEAL_HUMAN_END
        : today;
  const [date, setDate] = useState(initialDate);
  const previousToday = useRef(today);
  const [draft, setDraft] = useState(() => emptyIdealHumanDay(initialDate));
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [reloading, setReloading] = useState(false);
  const saving = useRef(false);
  const query = useIdealHumanDays();
  const mutation = useSaveIdealHumanDay();
  const clearMutation = useClearIdealHumanReflection();
  const busy = mutation.isPending || clearMutation.isPending || reloading;
  const workoutHistory = useWorkoutHistoryQuery();
  const currentWorkout = useWorkoutSessionQuery();
  const record = query.data?.find((day) => day.date === date);
  const experiment = idealHumanExperimentStatus(today);
  const selectedDay = idealHumanDayNumber(date)!;

  useEffect(() => {
    const update = () => setToday(idealHumanLocalDate(new Date()));
    const timer = window.setInterval(update, 60_000);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  useEffect(() => {
    if (
      previousToday.current !== today &&
      date === previousToday.current &&
      !dirty &&
      !saving.current &&
      idealHumanDayNumber(today) !== null
    ) {
      setDate(today);
      setSaved(false);
    }
    previousToday.current = today;
  }, [today, date, dirty]);
  useEffect(() => {
    if (!dirty && !saving.current) setDraft(record ?? emptyIdealHumanDay(date));
  }, [record, date, dirty]);
  useEffect(() => onDirtyChange(dirty || busy), [dirty, busy, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  const workoutDates = useMemo(
    () =>
      workoutHistory.data?.map((item) =>
        idealHumanLocalDate(new Date(item.endedAt)),
      ),
    [workoutHistory.data],
  );
  const stats = useMemo(
    () => idealHumanStats(query.data ?? [], workoutDates),
    [query.data, workoutDates],
  );
  const dayWorkouts = (workoutHistory.data ?? []).filter(
    (item) => idealHumanLocalDate(new Date(item.endedAt)) === date,
  );
  const activeWorkout =
    currentWorkout.data &&
    idealHumanLocalDate(new Date(currentWorkout.data.startedAt)) === date
      ? currentWorkout.data
      : null;
  const studyMinutes = idealHumanStudyMinutes(draft);
  const adherence = idealHumanAdherence(draft);

  function change<K extends keyof IdealHumanDay>(
    key: K,
    value: IdealHumanDay[K],
  ) {
    if (saving.current) return;
    setDraft((previous) => ({ ...previous, [key]: value }));
    setDirty(true);
    setSaved(false);
    setValidation(null);
  }
  function navigateDate(next: string) {
    if (saving.current) return;
    if (
      dirty &&
      !window.confirm(
        "Есть несохранённые изменения. Перейти к другому дню и отменить их?",
      )
    )
      return;
    setDate(next);
    setDraft(
      query.data?.find((day) => day.date === next) ?? emptyIdealHumanDay(next),
    );
    setDirty(false);
    setSaved(false);
    setConflict(false);
    setValidation(null);
    mutation.reset();
    clearMutation.reset();
  }
  async function clearReflection() {
    if (saving.current || dirty || conflict || draft.revision < 1) return;
    saving.current = true;
    setSaved(false);
    setValidation(null);
    mutation.reset();
    try {
      const result = await clearMutation.mutateAsync(draft);
      setDraft(result);
      setDirty(false);
      setSaved(true);
      setConflict(false);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) setConflict(true);
    } finally {
      saving.current = false;
    }
  }
  async function save() {
    if (saving.current) return;
    let input: IdealHumanDay;
    try {
      input = parseIdealHumanDay(draft);
    } catch (error) {
      setValidation(
        error instanceof IdealHumanInputError
          ? validationMessage(error)
          : "Проверь поля дневника.",
      );
      return;
    }
    saving.current = true;
    setValidation(null);
    clearMutation.reset();
    try {
      const result = await mutation.mutateAsync(input);
      setDraft(result);
      setDirty(false);
      setSaved(true);
      setConflict(false);
    } catch (error) {
      setSaved(false);
      if (error instanceof ApiError && error.status === 409) {
        const refreshed = await query.refetch();
        const remote = refreshed.data?.find((day) => day.date === date);
        // A response can be lost after a successful save. Retrying the same content
        // should recover the receipt without replacing newer, different content.
        if (remote && sameContent(input, remote)) {
          setDraft(remote);
          setDirty(false);
          setSaved(true);
          setConflict(false);
          mutation.reset();
        } else setConflict(true);
      }
    } finally {
      saving.current = false;
    }
  }
  async function loadSaved() {
    if (saving.current) return;
    if (
      dirty &&
      !window.confirm(
        "Заменить несохранённые правки сохранённой версией? Сначала можно экспортировать свои правки.",
      )
    )
      return;
    const requestedDate = date;
    saving.current = true;
    setReloading(true);
    try {
      const result = await query.refetch();
      if (result.isError) return;
      setDraft(
        result.data?.find((day) => day.date === requestedDate) ??
          emptyIdealHumanDay(requestedDate),
      );
      setDirty(false);
      setSaved(false);
      setConflict(false);
      setValidation(null);
      mutation.reset();
      clearMutation.reset();
    } finally {
      saving.current = false;
      setReloading(false);
    }
  }

  return (
    <div className="space-y-4 pb-5">
      <header className={panelClass}>
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-cyan-300">
          IDEAL HUMAN · 03.11 — 02.12.2026
        </p>
        <h1 className="mt-2 text-2xl font-bold text-white">
          Ideal Human — Day {selectedDay}/30
        </h1>
        <p className="mt-1 text-sm text-zinc-300">
          {dayLabel(date)} · {date === today ? "Сегодня" : "Выбранный день"}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-zinc-400">
          Сегодня {today} · Asia/Almaty (UTC+05:00).{" "}
          {experiment.phase === "upcoming"
            ? "Старт 3 ноября. День 1 уже подготовлен."
            : experiment.phase === "complete"
              ? "30 дней завершены. Дневник остаётся доступным."
              : `После сегодняшнего дня остаётся ${experiment.daysRemaining}.`}
        </p>
        <div
          className="mt-3 h-2 overflow-hidden rounded-full bg-white/10"
          role="progressbar"
          aria-label="Дни с наблюдениями"
          aria-valuemin={0}
          aria-valuemax={30}
          aria-valuenow={stats.checkins}
        >
          <div
            className="h-full rounded-full bg-cyan-400"
            style={{ width: `${(stats.checkins / 30) * 100}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-zinc-400">
          Наблюдения: {stats.checkins}/30 · дневник: {stats.journalDays} дн.
          Пустой день означает «нет данных».
        </p>
      </header>

      <section className={panelClass}>
        <label
          className="flex items-center gap-2 text-sm font-semibold text-white"
          htmlFor="ideal-human-day"
        >
          <CalendarDays className="h-4 w-4 text-cyan-300" /> День эксперимента
        </label>
        <select
          id="ideal-human-day"
          className={inputClass}
          value={date}
          disabled={busy}
          onChange={(event) => navigateDate(event.target.value)}
        >
          {dates.map((day, i) => (
            <option value={day} key={day}>
              День {i + 1} · {day}
              {query.data?.some((item) => item.date === day)
                ? " · сохранено"
                : ""}
            </option>
          ))}
        </select>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            type="button"
            className={buttonClass}
            disabled={selectedDay === 1 || busy}
            onClick={() => navigateDate(idealHumanDate(selectedDay - 1))}
          >
            Предыдущий
          </button>
          <button
            type="button"
            className={buttonClass}
            disabled={selectedDay === 30 || busy}
            onClick={() => navigateDate(idealHumanDate(selectedDay + 1))}
          >
            Следующий
          </button>
        </div>
        {date > today ? (
          <p className="mt-3 text-xs text-amber-200">
            Можно редактировать план будущего дня. Фактические измерения и
            выполнение отмечай после события.
          </p>
        ) : null}
      </section>

      {query.isLoading ? (
        <LoadingPanel title="Загружаем дневник…" />
      ) : query.isError && query.data === undefined ? (
        <ErrorPanel
          title="Не удалось загрузить дневник"
          detail={apiErrorMessage(query.error)}
          onRetry={() => void query.refetch()}
        />
      ) : (
        <>
          {query.isError ? (
            <ErrorPanel
              title="Не удалось обновить сохранённые данные"
              detail="Несохранённые правки остаются на экране. Проверь соединение."
              onRetry={() => void query.refetch()}
            />
          ) : null}
          <AutoHealthPanel
            date={date}
            manual={draft}
            onOpenHealth={onOpenHealth}
          />
          <section
            className="grid grid-cols-2 gap-2"
            aria-label="Статус выбранного дня"
          >
            <StatusTile
              title="Чек-ин"
              value={
                record && hasIdealHumanObservation(record)
                  ? "Есть наблюдения"
                  : "Нет наблюдений"
              }
              recorded={Boolean(record && hasIdealHumanObservation(record))}
            />
            <StatusTile
              title="Сон"
              value={hours(draft.sleepMinutes)}
              recorded={draft.sleepMinutes !== null}
            />
            <StatusTile
              title="Питание"
              value={
                draft.meals.length
                  ? `${draft.meals.length} приёмов пищи`
                  : draft.caloriesKcal !== null || draft.proteinG !== null
                    ? "Внесён итог"
                    : "Нет записи"
              }
              recorded={Boolean(
                draft.meals.length ||
                draft.caloriesKcal !== null ||
                draft.proteinG !== null,
              )}
            />
            <StatusTile
              title="Тренировка"
              value={
                dayWorkouts.length
                  ? `${dayWorkouts.length} завершено в LifeOS`
                  : activeWorkout
                    ? "Идёт тренировка"
                    : workoutHistory.isError
                      ? "История недоступна"
                      : "Нет завершённой записи"
              }
              recorded={dayWorkouts.length > 0}
            />
            <StatusTile
              title="Учёба"
              value={
                studyMinutes === null ? "Нет записи" : `${studyMinutes} мин`
              }
              recorded={studyMinutes !== null}
            />
            <StatusTile
              title="Съёмка"
              value={
                draft.footageCaptured === true ||
                draft.aRoll === true ||
                draft.bRoll === true ||
                (draft.filmingMinutes ?? 0) > 0 ||
                (draft.footage?.length ?? 0) > 0
                  ? "Материал отмечен"
                  : "Нет подтверждения"
              }
              recorded={
                draft.footageCaptured === true ||
                draft.aRoll === true ||
                draft.bRoll === true ||
                (draft.filmingMinutes ?? 0) > 0 ||
                (draft.footage?.length ?? 0) > 0
              }
            />
            <StatusTile
              title="Привычки"
              value={
                adherence === null
                  ? "Нет отметок"
                  : `${Math.round(adherence * 100)}% отмеченных`
              }
              recorded={adherence !== null}
            />
            <StatusTile
              title="Копия видео"
              value={
                draft.footageBackedUp === true
                  ? "Проверена тобой"
                  : "Не подтверждена"
              }
              recorded={draft.footageBackedUp === true}
            />
          </section>

          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
            className="space-y-4"
          >
            <div className="sticky top-2 z-20 rounded-xl border border-white/15 bg-zinc-950/95 p-3 shadow-panel backdrop-blur-md">
              <p aria-live="polite" className="mb-2 text-xs text-zinc-300">
                {clearMutation.isPending
                  ? "Удаляем вечернюю рефлексию…"
                  : mutation.isPending
                    ? "Сохраняем в LifeOS…"
                    : saved && !dirty
                      ? "Сохранено в LifeOS. Можно закрыть и открыть снова."
                      : dirty
                        ? "Есть несохранённые изменения. Они останутся на экране при ошибке сети."
                        : "Все поля необязательны. Записывай только реальные данные."}
              </p>
              <button
                type="submit"
                disabled={busy || !dirty || conflict}
                className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-cyan-400 px-4 text-sm font-semibold text-zinc-950 hover:bg-cyan-300 active:scale-[0.98] disabled:opacity-50"
              >
                {saved && !dirty ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {mutation.isPending ? "Сохраняем…" : "Сохранить день"}
              </button>
              {validation ? (
                <p role="alert" className="mt-2 text-sm text-rose-200">
                  {validation}
                </p>
              ) : null}
              {mutation.isError && !conflict ? (
                <p role="alert" className="mt-2 text-sm text-rose-200">
                  {apiErrorMessage(mutation.error)} Правки не удалены; повтори
                  сохранение.
                </p>
              ) : null}
              {clearMutation.isError && !conflict ? (
                <p role="alert" className="mt-2 text-sm text-rose-200">
                  {apiErrorMessage(clearMutation.error)} Не удалось подтвердить
                  удаление. Загрузи сохранённую версию и повтори.
                </p>
              ) : null}
            </div>
            {conflict ? (
              <section
                className="space-y-3 rounded-xl border border-amber-300/30 bg-amber-300/[0.05] p-4"
                role="alert"
              >
                <p className="text-sm text-amber-100">
                  Запись изменилась на другом устройстве. Твои правки сохранены
                  на этом экране. Экспортируй их, затем загрузи актуальную
                  версию и перенеси нужное.
                </p>
                <button
                  type="button"
                  className={`${buttonClass} w-full`}
                  onClick={() =>
                    downloadJson(
                      { config: IDEAL_HUMAN_CONFIG, unsavedDay: draft },
                      `ideal-human-unsaved-${date}.json`,
                    )
                  }
                >
                  Экспортировать мои несохранённые правки
                </button>
                <button
                  type="button"
                  className={`${buttonClass} w-full`}
                  onClick={() => void loadSaved()}
                >
                  Загрузить сохранённую версию
                </button>
              </section>
            ) : null}
            <fieldset disabled={busy} className="min-w-0 space-y-4">
              <section className={panelClass}>
                <h2 className="flex items-center gap-2 font-semibold text-white">
                  <HeartPulse className="h-4 w-4 text-emerald-300" /> Утренний
                  чек-ин
                </h2>
                <p className="mt-2 text-xs text-zinc-400">
                  Взвесься и запиши фактический сон. Приблизительные исходные
                  50–52 кг не считаются измерением.
                </p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <NumberField
                    title="Утренний вес, кг"
                    min={25}
                    max={300}
                    step={0.1}
                    value={draft.weightKg}
                    onChange={(value) => change("weightKg", value)}
                  />
                  <NumberField
                    title="Сон, часов"
                    max={24}
                    step={0.25}
                    value={
                      draft.sleepMinutes === null
                        ? null
                        : Math.round((draft.sleepMinutes / 60) * 100) / 100
                    }
                    onChange={(value) =>
                      change(
                        "sleepMinutes",
                        value === null ? null : Math.round(value * 60),
                      )
                    }
                  />
                  <TextField
                    title="Лёг спать (если известно)"
                    type="time"
                    value={draft.bedtime ?? ""}
                    onChange={(value) => change("bedtime", value || null)}
                  />
                  <TextField
                    title="Проснулся (если известно)"
                    type="time"
                    value={draft.wakeTime ?? ""}
                    onChange={(value) => change("wakeTime", value || null)}
                  />
                </div>
                <details className="mt-3">
                  <summary className="min-h-11 cursor-pointer text-sm text-zinc-300">
                    Исходное измерение роста
                  </summary>
                  <NumberField
                    title="Измеренный рост, см"
                    min={80}
                    max={250}
                    step={0.1}
                    value={draft.baselineHeightCm}
                    onChange={(value) => change("baselineHeightCm", value)}
                  />
                  <p className="mt-2 text-xs text-zinc-400">
                    Измерь один раз и сохрани в День 1. Пропуски допустимы.
                  </p>
                </details>
              </section>
              <DayPlan day={draft} change={change} />

              <UniversityIntegration date={date} onOpenStudy={onOpenStudy} />

              <Fold
                title="Тренировка и восстановление"
                open
                detail="Подходы и история хранятся в существующем разделе тренировок."
              >
                {workoutHistory.isLoading || currentWorkout.isLoading ? (
                  <p className="text-xs text-zinc-400">
                    Проверяем тренировки LifeOS…
                  </p>
                ) : null}
                {workoutHistory.isError || currentWorkout.isError ? (
                  <ErrorPanel
                    title="Не удалось проверить тренировки"
                    onRetry={() => {
                      void workoutHistory.refetch();
                      void currentWorkout.refetch();
                    }}
                  />
                ) : null}
                {dayWorkouts.map((workout) => (
                  <div
                    key={workout.id}
                    className="rounded-lg border border-emerald-300/20 p-3"
                  >
                    <p className="text-sm font-semibold text-emerald-100">
                      {workout.title} · завершена
                    </p>
                    <p className="mt-1 text-xs text-zinc-300">
                      {workout.completedSets} подходов ·{" "}
                      {Math.max(
                        0,
                        Math.round(
                          (Date.parse(workout.endedAt) -
                            Date.parse(workout.startedAt)) /
                            60000,
                        ),
                      )}{" "}
                      мин
                    </p>
                  </div>
                ))}
                {activeWorkout ? (
                  <p className="text-sm text-cyan-200">
                    Сейчас: {activeWorkout.title}, {activeWorkout.completedSets}
                    /{activeWorkout.totalSets} подходов.
                  </p>
                ) : null}
                {!dayWorkouts.length &&
                !activeWorkout &&
                !workoutHistory.isError &&
                !currentWorkout.isError ? (
                  <p className="text-xs text-zinc-400">
                    Завершённая тренировка на этот день пока не
                    зарегистрирована.
                  </p>
                ) : null}
                <p className="text-xs leading-relaxed text-zinc-400">
                  День 1: Underground GYM с Алинуром после университета. Начни с
                  разминки, знакомых упражнений и комфортного веса; оставь запас
                  сил. Существующая программа и история сохраняются.
                </p>
                <button
                  type="button"
                  className={`${buttonClass} w-full border-emerald-400/25 text-emerald-200`}
                  onClick={onOpenWorkout}
                >
                  <Dumbbell className="h-4 w-4" /> Открыть тренировку и подходы
                </button>
                <ChoiceField
                  title="Активность / восстановление (заметка)"
                  value={draft.training}
                  choices={[
                    { value: "gym", label: "Был в зале" },
                    { value: "recovery", label: "Восстановление" },
                    { value: "other", label: "Другая активность" },
                    { value: "none", label: "Без тренировки" },
                  ]}
                  onChange={(value) => change("training", value)}
                />
                <p className="text-xs text-zinc-400">
                  Эта отметка не создаёт тренировку. Частота тренировок берётся
                  из завершённых сессий LifeOS.
                </p>
                <NumberField
                  title="Ощущаемое усилие, 1–10"
                  min={1}
                  max={10}
                  value={draft.workoutEffort}
                  onChange={(value) => change("workoutEffort", value)}
                />
                <TextField
                  title="Заметки после тренировки"
                  multiline
                  value={draft.workoutNotes}
                  onChange={(value) => change("workoutNotes", value)}
                />
                <TextField
                  title="Восстановление и самочувствие"
                  multiline
                  value={draft.recoveryNotes}
                  onChange={(value) => change("recoveryNotes", value)}
                />
                <p className="text-xs text-zinc-400">
                  После нагрузки: поесть, попить воды и оставить время на сон.
                  Усталость помогает скорректировать следующий день.
                </p>
                <button
                  type="button"
                  className={`${buttonClass} w-full`}
                  onClick={onOpenHealth}
                >
                  Открыть здоровье и восстановление
                </button>
              </Fold>
              <NutritionJournal day={draft} change={change} />
              <LearningJournal day={draft} change={change} />
              <VideoJournal day={draft} change={change} />
              <ReflectionJournal
                day={draft}
                change={change}
                onClear={() => void clearReflection()}
                clearDisabled={busy || conflict}
                dirty={dirty}
              />
            </fieldset>
          </form>

          <Fold
            title="Прогресс за 30 дней"
            detail="Тренды только по сохранённым измерениям. Пустые значения не превращаются в нули."
          >
            <div className="grid grid-cols-2 gap-2">
              <StatusTile
                title="Зал, дней"
                value={
                  workoutHistory.isError
                    ? "История недоступна"
                    : String(stats.gymDays)
                }
                recorded={stats.gymDays > 0}
              />
              <StatusTile
                title="Учёба"
                value={
                  stats.studyMinutes === null
                    ? "Нет записей"
                    : `${stats.studyMinutes} мин`
                }
                recorded={stats.studyMinutes !== null}
              />
              <StatusTile
                title="Съёмка, дней"
                value={String(stats.filmedDays)}
                recorded={stats.filmedDays > 0}
              />
              <StatusTile
                title="Средний сон"
                value={hours(stats.avgSleepMinutes)}
                recorded={stats.avgSleepMinutes !== null}
              />
              <StatusTile
                title="Средний вес"
                value={
                  stats.avgWeightKg === null
                    ? "Нет измерений"
                    : `${stats.avgWeightKg.toFixed(1)} кг`
                }
                recorded={stats.avgWeightKg !== null}
              />
              <StatusTile
                title="Разброс сна"
                value={
                  stats.sleepVariationMinutes === null
                    ? "Нужно 2+ измерения"
                    : `${Math.round(stats.sleepVariationMinutes)} мин`
                }
                recorded={stats.sleepVariationMinutes !== null}
              />
            </div>
            <p className="text-xs text-zinc-400">
              Разброс сна описывает изменчивость измеренной продолжительности.
              Один короткий сон не означает провал. Время отхода ко сну и
              подъёма можно сравнить в записях ниже.
            </p>
            {stats.weekly.map((week) => (
              <article
                key={week.week}
                className="rounded-lg border border-white/[0.08] p-3"
              >
                <h3 className="text-sm font-semibold text-zinc-100">
                  Неделя {week.week} · {week.recordedDays}/{week.totalDays} дней
                  с наблюдениями
                </h3>
                <p className="mt-2 text-xs leading-relaxed text-zinc-400">
                  Сон: {hours(week.avgSleepMinutes)} · вес:{" "}
                  {week.avgWeightKg === null
                    ? "нет измерений"
                    : `${week.avgWeightKg.toFixed(1)} кг`}{" "}
                  · отмеченные привычки:{" "}
                  {week.adherence === null
                    ? "нет отметок"
                    : `${Math.round(week.adherence * 100)}%`}
                  .
                </p>
              </article>
            ))}
            {stats.weightTrend.length || stats.sleepTrend.length ? (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-white">
                  Измеренные дни
                </h3>
                {(query.data ?? [])
                  .filter(
                    (day) =>
                      day.weightKg !== null ||
                      day.sleepMinutes !== null ||
                      day.bedtime ||
                      day.wakeTime,
                  )
                  .map((day) => (
                    <p
                      key={day.date}
                      className="text-xs leading-relaxed text-zinc-300"
                    >
                      {dayLabel(day.date)} ·{" "}
                      {day.weightKg === null ? "вес —" : `${day.weightKg} кг`} ·
                      сон {hours(day.sleepMinutes)}
                      {day.bedtime ? ` · лёг ${day.bedtime}` : ""}
                      {day.wakeTime ? ` · встал ${day.wakeTime}` : ""}
                    </p>
                  ))}
              </div>
            ) : (
              <p className="text-xs text-zinc-400">
                Для трендов запиши реальные сон и вес. Неизмеренные дни остаются
                пустыми.
              </p>
            )}
            <button
              type="button"
              className={`${buttonClass} w-full`}
              onClick={() =>
                downloadJson(
                  {
                    config: IDEAL_HUMAN_CONFIG,
                    exportedAt: new Date().toISOString(),
                    days: query.data ?? [],
                    workoutHistory:
                      workoutHistory.data?.filter(
                        (workout) =>
                          idealHumanDayNumber(
                            idealHumanLocalDate(new Date(workout.endedAt)),
                          ) !== null,
                      ) ?? null,
                  },
                  "ideal-human-2026.json",
                )
              }
            >
              <Download className="h-4 w-4" /> Экспорт всех сохранённых данных
              (JSON)
            </button>
            <p className="text-xs text-zinc-400">
              Экспорт содержит личные заметки. Файл скачивается на твоё
              устройство.
            </p>
            <details className="rounded-lg border border-white/[0.08] p-3">
              <summary className="min-h-11 cursor-pointer text-sm text-zinc-300">
                JSON для копирования, если скачивание недоступно
              </summary>
              <textarea
                aria-label="Экспорт дневника для копирования"
                readOnly
                className={inputClass}
                rows={6}
                value={JSON.stringify(
                  { config: IDEAL_HUMAN_CONFIG, days: query.data ?? [] },
                  null,
                  2,
                )}
                onFocus={(event) => event.currentTarget.select()}
              />
            </details>
          </Fold>
          <section className={panelClass}>
            <h2 className="text-sm font-semibold text-white">
              Напоминания по твоему выбору
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-zinc-400">
              Утренний чек-ин, запись тренировки, вечерняя рефлексия и
              подготовка ко сну. Выбери удобные время и текст в существующем
              разделе. Сообщения начнут приходить только после создания
              напоминания.
            </p>
            <button
              type="button"
              className={`${buttonClass} mt-3 w-full`}
              onClick={onOpenReminders}
            >
              Настроить напоминания
            </button>
          </section>
        </>
      )}
    </div>
  );
}
