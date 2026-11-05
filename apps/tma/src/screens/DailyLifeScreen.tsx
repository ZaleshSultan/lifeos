import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  idealHumanLocalDate,
  idealHumanDayNumber,
  emptyIdealHumanDay,
  type IdealHumanMeal,
  type IdealHumanDay,
} from "../../../../packages/core/src/ideal-human.js";
import {
  DEFAULT_DAILY_LIFE_PREFERENCES,
  type DailyLifePreferences,
  type BriefingView,
} from "../../../../packages/core/src/daily-life.js";
import {
  useDailyLife,
  useDailyPreferences,
  useWaterActions,
  dailyLifeRequest,
} from "../api/daily-life";
import { apiErrorMessage } from "../api/errors";
import { mergeReviewedMeals } from "../../../../packages/core/src/nutrition.js";
import { useSaveIdealHumanDay } from "../api/ideal-human";
import { ErrorPanel, LoadingPanel } from "../components/AsyncState";
import { MealPhotoReview } from "../components/ideal-human/MealPhotoReview";
import { AcademicHomeBriefing } from "../components/AcademicHomeBriefing";
import type { AcademicHomeRow } from "../../../../packages/core/src/academic-home.js";
import {
  ChoiceField,
  TextField,
  NumberField,
  buttonClass,
  inputClass,
  panelClass,
} from "../components/ideal-human/Fields";
function Briefing({
  view,
  children,
}: {
  view: BriefingView;
  children?: ReactNode;
}) {
  return (
    <section className={`${panelClass} space-y-3`}>
      <h2 className="text-lg font-semibold text-white">{view.title}</h2>
      <p className="text-xs text-zinc-400">
        По записанным данным LifeOS · без внешнего AI
      </p>
      <h3 className="text-sm font-semibold text-zinc-200">Факты</h3>
      {view.facts.length ? (
        <ul className="list-disc space-y-2 pl-5 text-sm text-zinc-300">
          {view.facts.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-zinc-400">
          Подтверждённых записей пока мало.
        </p>
      )}
      {view.warnings.map((s, i) => (
        <p key={i} className="text-xs text-amber-200">
          {s}
        </p>
      ))}
      <h3 className="text-sm font-semibold text-zinc-200">Предложения</h3>
      {view.suggestions.map((s, i) => (
        <p key={i} className="text-sm text-zinc-300">
          {s}
        </p>
      ))}
      {view.questions.map((s, i) => (
        <p key={i} className="text-sm text-cyan-200">
          {s}
        </p>
      ))}
      {children}
      {view.tomorrowOrder.length ? (
        <details>
          <summary className="min-h-11 cursor-pointer text-sm text-zinc-200">
            Черновик порядка на завтра
          </summary>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-zinc-300">
            {view.tomorrowOrder.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-zinc-400">
            Ничего не перенесено автоматически. Измени план вручную после
            решения.
          </p>
        </details>
      ) : null}
    </section>
  );
}
export function DailyLifeScreen({
  onOpenIdealHuman,
  onOpenReminders,
  onDirtyChange,
  onOpenAcademicCourse,
}: {
  onOpenIdealHuman: () => void;
  onOpenReminders: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onOpenAcademicCourse?: (
    courseId: string | null,
    tab: AcademicHomeRow["tab"],
  ) => void;
}) {
  const [today, setToday] = useState(() => idealHumanLocalDate(new Date()));
  const [date, setDate] = useState(() => {
    const requested = new URLSearchParams(window.location.search).get("date");
    return requested && idealHumanDayNumber(requested) !== null
      ? requested
      : today;
  });
  const [mealDraftId] = useState(() => {
    const id = new URLSearchParams(window.location.search).get("mealDraft");
    return id && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id)
      ? id
      : undefined;
  });
  const data = useDailyLife(date);
  const water = useWaterActions();
  const prefs = useDailyPreferences();
  const cache = useQueryClient();
  const [amount, setAmount] = useState<number | null>(250);
  const requestId = useRef<{ id: string; amount: number; at: number } | null>(
    null,
  );
  const [prefReloading, setPrefReloading] = useState(false);
  const [preferenceDraft, setPreferenceDraft] = useState<DailyLifePreferences>({
    ...DEFAULT_DAILY_LIFE_PREFERENCES,
  });
  const [prefsDirty, setPrefsDirty] = useState(false);
  const [photoDirty, setPhotoDirty] = useState(false);
  const [notice, setNotice] = useState("");
  const saveDay = useSaveIdealHumanDay();
  const savePreferences = useMutation({
    mutationFn: (v: DailyLifePreferences) =>
      dailyLifeRequest<DailyLifePreferences>("daily-life/preferences", {
        method: "PUT",
        body: JSON.stringify(v),
      }),
    onSuccess: async (result) => {
      setPreferenceDraft(result);
      setPrefsDirty(false);
      setNotice("Настройки уведомлений сохранены.");
      await cache.invalidateQueries({ queryKey: ["daily-life-preferences"] });
    },
  });
  useEffect(
    () =>
      onDirtyChange?.(
        prefsDirty || photoDirty || savePreferences.isPending || prefReloading,
      ),
    [
      prefsDirty,
      photoDirty,
      savePreferences.isPending,
      prefReloading,
      onDirtyChange,
    ],
  );
  useEffect(() => {
    if (!prefsDirty && !photoDirty) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [prefsDirty, photoDirty]);
  async function reloadPreferences() {
    if (
      prefsDirty &&
      !window.confirm(
        "Загрузить сохранённые настройки и отменить несохранённые правки?",
      )
    )
      return;
    setPrefReloading(true);
    try {
      const result = await prefs.refetch();
      if (result.data) {
        setPreferenceDraft(result.data);
        setPrefsDirty(false);
        savePreferences.reset();
      }
    } finally {
      setPrefReloading(false);
    }
  }
  useEffect(() => {
    const timer = setInterval(
      () => setToday(idealHumanLocalDate(new Date())),
      60000,
    );
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (prefs.data && !prefsDirty) setPreferenceDraft(prefs.data);
  }, [prefs.data, prefsDirty]);
  function setPreference<K extends keyof DailyLifePreferences>(
    key: K,
    value: DailyLifePreferences[K],
  ) {
    setPreferenceDraft((old) => ({ ...old, [key]: value }));
    setPrefsDirty(true);
    setNotice("");
  }
  async function logWater(ml: number) {
    if (water.add.isPending || date !== today) return;
    if (
      !requestId.current ||
      requestId.current.amount !== ml ||
      (!water.add.isError && Date.now() - requestId.current.at > 700)
    )
      requestId.current = {
        id: crypto.randomUUID(),
        amount: ml,
        at: Date.now(),
      };
    try {
      await water.add.mutateAsync({
        amountMl: ml,
        requestId: requestId.current.id,
      });
    } catch {
      void data.refetch(); /* Keep the exact receipt for a failed response retry. */
    }
  }
  async function confirmMeals(meals: IdealHumanMeal[], originalDate?: string) {
    const saveDate =
      originalDate && idealHumanDayNumber(originalDate) !== null
        ? originalDate
        : date;
    const latest = await dailyLifeRequest<IdealHumanDay[]>("ideal-human/days");
    const day =
      latest.find((d) => d.date === saveDate) ?? emptyIdealHumanDay(saveDate);
    const merged = mergeReviewedMeals(day.meals, meals);
    if (JSON.stringify(merged) === JSON.stringify(day.meals)) return;
    await saveDay.mutateAsync({ ...day, meals: merged });
    await data.refetch();
  }
  return (
    <div className="space-y-4 pb-5">
      <header className={panelClass}>
        <h1 className="text-2xl font-semibold text-white">Твой день</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Обзор, вода и питание · Asia/Almaty
        </p>
        <label className="mt-3 block text-xs text-zinc-300">
          Дата
          <input
            aria-label="Дата обзора"
            className={inputClass}
            type="date"
            max={today}
            value={date}
            disabled={photoDirty}
            onChange={(e) => {
              if (e.target.value) setDate(e.target.value);
            }}
          />
        </label>
      </header>
      {data.isLoading ? (
        <LoadingPanel title="Собираем реальные записи…" />
      ) : data.isError ? (
        <ErrorPanel
          title="Не удалось загрузить обзор"
          detail={apiErrorMessage(data.error)}
          onRetry={() => void data.refetch()}
        />
      ) : data.data ? (
        <>
          {data.data.sourceWarnings.map((w, i) => (
            <p key={i} className="text-xs text-amber-200">
              {w}
            </p>
          ))}
          <section className={`${panelClass} space-y-3`}>
            <h2 className="text-lg font-semibold text-white">Вода</h2>
            <p className="text-3xl font-semibold text-cyan-200">
              {data.data.hydration?.totalMl ?? "—"} мл
            </p>
            <p className="text-xs text-zinc-400">
              Только твои записи, без обязательной нормы. Быстрые кнопки
              записывают текущий день.
            </p>
            <div className="grid grid-cols-3 gap-2">
              {[150, 250, 500].map((ml) => (
                <button
                  key={ml}
                  className={buttonClass}
                  disabled={
                    date !== today ||
                    water.add.isPending ||
                    water.undo.isPending
                  }
                  onClick={() => void logWater(ml)}
                >
                  +{ml} мл
                </button>
              ))}
            </div>
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <NumberField
                  title="Своя порция, мл"
                  min={1}
                  max={5000}
                  value={amount}
                  onChange={setAmount}
                />
              </div>
              <button
                className={buttonClass}
                disabled={date !== today || water.add.isPending || !amount}
                onClick={() => amount && void logWater(amount)}
              >
                Записать
              </button>
            </div>
            {water.add.isError || water.undo.isError ? (
              <p role="alert" className="text-sm text-rose-200">
                {apiErrorMessage(water.add.error ?? water.undo.error)}
              </p>
            ) : null}
            {(data.data.hydration?.entries ?? []).slice(0, 8).map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.08] p-2 text-sm text-zinc-300"
              >
                <span>
                  {entry.amountMl} мл ·{" "}
                  {new Intl.DateTimeFormat("ru-RU", {
                    timeZone: data.data!.hydration!.timezone,
                    hour: "2-digit",
                    minute: "2-digit",
                  }).format(new Date(entry.occurredAt))}
                  {entry.undoneAt ? " · отменено" : ""}
                </span>
                {!entry.undoneAt ? (
                  <button
                    className={buttonClass}
                    disabled={water.undo.isPending}
                    onClick={() => water.undo.mutate(entry.id)}
                  >
                    Отменить
                  </button>
                ) : null}
              </div>
            ))}
          </section>
          <Briefing view={data.data.morning}>
            {onOpenAcademicCourse ? (
              <AcademicHomeBriefing
                onOpen={(row) => onOpenAcademicCourse(row.courseId, row.tab)}
              />
            ) : null}
          </Briefing>
          <Briefing view={data.data.evening} />
          <section className={`${panelClass} space-y-3`}>
            <h2 className="text-lg font-semibold text-white">
              Измерения и источники
            </h2>
            {(
              ["sleepMinutes", "weightKg", "steps", "workoutMinutes"] as const
            ).map((key) => {
              const v = data.data!.health[key];
              return (
                <p className="text-sm text-zinc-300" key={key}>
                  {
                    {
                      sleepMinutes: "Сон",
                      weightKg: "Вес",
                      steps: "Шаги",
                      workoutMinutes: "Активность",
                    }[key]
                  }
                  :{" "}
                  {v
                    ? `${v.value} ${v.unit} · ${v.source}${v.stale ? " · устарело" : ""}`
                    : "Нет данных"}
                </p>
              );
            })}
            <p className="text-xs text-zinc-400">
              Разрешения Health Connect проверяются на телефоне. Автоматические
              данные не заменяют ручные измерения в дневнике.
            </p>
          </section>
          <button
            className={`${buttonClass} w-full`}
            onClick={onOpenIdealHuman}
          >
            Записать еду вручную в дневнике
          </button>
          {idealHumanDayNumber(date) !== null ? (
            <MealPhotoReview
              disabled={saveDay.isPending}
              onDirtyChange={setPhotoDirty}
              initialDraftId={mealDraftId}
              requestFn={dailyLifeRequest}
              onConfirm={confirmMeals}
              errorMessage={apiErrorMessage}
            />
          ) : null}
          <section className={`${panelClass} space-y-3`}>
            <h2 className="text-lg font-semibold text-white">
              Подсказки для съёмки
            </h2>
            {data.data.documentary.shots.map((shot, i) => (
              <p key={i} className="text-sm text-zinc-300">
                {shot.title}
                <span className="mt-1 block text-xs text-zinc-500">
                  {shot.reason}
                </span>
              </p>
            ))}
            <button
              className={`${buttonClass} w-full`}
              onClick={onOpenIdealHuman}
            >
              Дневник, каталог кадров и рефлексия
            </button>
          </section>
        </>
      ) : null}
      <section className={`${panelClass} space-y-3`}>
        <h2 className="text-lg font-semibold text-white">
          Уведомления по твоему выбору
        </h2>
        <p className="text-xs text-zinc-400">
          По умолчанию выключены. Время местное; тихие часы учитываются.
          Сохранение включённой опции означает согласие на сообщения в Telegram.
        </p>
        {prefs.isLoading ? (
          <LoadingPanel title="Загружаем настройки…" />
        ) : prefs.isError ? (
          <ErrorPanel
            title="Не удалось загрузить настройки"
            onRetry={() => void prefs.refetch()}
          />
        ) : (
          <fieldset
            disabled={savePreferences.isPending || prefReloading}
            className="space-y-3"
          >
            {(
              [
                "morningEnabled",
                "eveningEnabled",
                "hydrationRemindersEnabled",
                "includeHealth",
                "includeFilming",
              ] as const
            ).map((key) => (
              <label
                key={key}
                className="flex min-h-11 items-center gap-3 text-sm text-zinc-300"
              >
                <input
                  className="h-5 w-5"
                  type="checkbox"
                  checked={preferenceDraft[key]}
                  onChange={(e) => setPreference(key, e.target.checked)}
                />
                {
                  {
                    morningEnabled: "Утренний обзор",
                    eveningEnabled: "Вечерняя рефлексия",
                    hydrationRemindersEnabled:
                      "Ненавязчивые напоминания про записи воды",
                    includeHealth: "Включать измерения здоровья в сообщения",
                    includeFilming: "Включать подсказки для съёмки",
                  }[key]
                }
              </label>
            ))}
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  "morningTime",
                  "eveningTime",
                  "quietStart",
                  "quietEnd",
                ] as const
              ).map((key) => (
                <TextField
                  key={key}
                  title={
                    {
                      morningTime: "Утро",
                      eveningTime: "Вечер",
                      quietStart: "Тихо с",
                      quietEnd: "Тихо до",
                    }[key]
                  }
                  type="time"
                  value={preferenceDraft[key]}
                  onChange={(value) => setPreference(key, value)}
                />
              ))}
            </div>
            <button
              className={`${buttonClass} w-full`}
              disabled={!prefsDirty}
              onClick={() => savePreferences.mutate(preferenceDraft)}
            >
              Сохранить настройки уведомлений
            </button>
          </fieldset>
        )}
        {savePreferences.isError ? (
          <p role="alert" className="text-sm text-rose-200">
            Настройки не сохранены. При конфликте загрузи актуальную версию и
            повтори изменения.
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="text-xs text-emerald-200">
            {notice}
          </p>
        ) : null}
        {savePreferences.isError ? (
          <button
            className={`${buttonClass} w-full`}
            disabled={prefReloading}
            onClick={() => void reloadPreferences()}
          >
            Загрузить сохранённые настройки
          </button>
        ) : null}
        <button className={`${buttonClass} w-full`} onClick={onOpenReminders}>
          Открыть обычные напоминания
        </button>
      </section>
    </div>
  );
}
