"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  emptyIdealHumanDay,
  idealHumanDate,
  idealHumanDayNumber,
  idealHumanLocalDate,
  idealHumanStats,
  parseIdealHumanDay,
  type IdealHumanDay,
} from "../../../../packages/core/src/ideal-human.js";
import {
  DayPlan,
  LearningJournal,
  NutritionJournal,
  ReflectionJournal,
  VideoJournal,
} from "../../../tma/src/components/ideal-human/JournalSections";
import {
  Fold,
  NumberField,
  TextField,
} from "../../../tma/src/components/ideal-human/Fields";
import { SectionPanel } from "@/components/SectionPanel";
import {
  Notice,
  buttonClass,
  inputClass,
  useUnsavedGuard,
  useWebResource,
} from "@/components/WorkspaceUI";
import { WebApiError, webErrorMessage, webRequest } from "@/lib/web-client";

export function IdealHumanJournal({
  initial,
}: {
  initial: IdealHumanDay[] | null;
}) {
  const today = idealHumanLocalDate(new Date());
  const initialDate =
    today < idealHumanDate(1)
      ? idealHumanDate(1)
      : today > idealHumanDate(30)
        ? idealHumanDate(30)
        : today;
  const data = useWebResource<IdealHumanDay[]>("ideal-human/days", initial);
  const [date, setDate] = useState(initialDate);
  const [day, setDay] = useState(
    () =>
      initial?.find((record) => record.date === initialDate) ??
      emptyIdealHumanDay(initialDate),
  );
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const saving = useRef(false);
  const [message, setMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  useEffect(() => setReady(true), []);
  useUnsavedGuard(dirty || busy);
  const stats = idealHumanStats(data.data ?? []);
  function change<K extends keyof IdealHumanDay>(
    key: K,
    value: IdealHumanDay[K],
  ) {
    if (!ready || saving.current) return;
    setDay((previous) => ({ ...previous, [key]: value }));
    setDirty(true);
    setMessage(null);
  }
  function selectDate(next: string) {
    if (
      !ready ||
      saving.current ||
      (dirty &&
        !window.confirm(
          "Есть несохранённые изменения. Сменить день и отменить их?",
        ))
    )
      return;
    setDate(next);
    setDay(
      data.data?.find((record) => record.date === next) ??
        emptyIdealHumanDay(next),
    );
    setDirty(false);
    setMessage(null);
    setConflict(false);
  }
  async function save() {
    if (!ready || saving.current) return;
    let input: IdealHumanDay;
    try {
      input = parseIdealHumanDay(day);
    } catch {
      setMessage(
        "Проверь измерения, названия блюд и задач. Запиши хотя бы одно наблюдение или изменение плана; неизвестное оставь пустым.",
      );
      return;
    }
    saving.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const next = await webRequest<IdealHumanDay>("ideal-human/days", {
        method: "PUT",
        body: JSON.stringify({ day: input, expectedRevision: input.revision }),
      });
      setDay(next);
      data.setData((previous) =>
        [
          ...(previous ?? []).filter((record) => record.date !== next.date),
          next,
        ].sort((a, b) => a.date.localeCompare(b.date)),
      );
      setDirty(false);
      setConflict(false);
      setMessage(
        "Сохранено в LifeOS. Запись доступна в Telegram и после повторного входа.",
      );
    } catch (error) {
      setConflict(error instanceof WebApiError && error.status === 409);
      setMessage(webErrorMessage(error) + " Правки остаются на этом экране.");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  async function reload() {
    if (
      !ready ||
      saving.current ||
      (dirty &&
        !window.confirm(
          "Заменить несохранённые правки сохранённой версией? Сначала можно скопировать JSON своих правок ниже.",
        ))
    )
      return;
    saving.current = true;
    setBusy(true);
    try {
      const result = await data.reload();
      if (!result) return;
      setDay(
        result.find((record) => record.date === date) ??
          emptyIdealHumanDay(date),
      );
      setDirty(false);
      setConflict(false);
      setMessage(null);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  async function clearReflection() {
    if (!ready || saving.current || dirty || conflict || day.revision < 1)
      return;
    saving.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const next = await webRequest<IdealHumanDay>(
        "ideal-human/reflection/clear",
        {
          method: "POST",
          body: JSON.stringify({
            date,
            expectedRevision: day.revision,
            confirmed: true,
          }),
        },
      );
      setDay(next);
      data.setData((previous) =>
        [
          ...(previous ?? []).filter((record) => record.date !== next.date),
          next,
        ].sort((a, b) => a.date.localeCompare(b.date)),
      );
      setConflict(false);
      setMessage(
        "Вечерняя рефлексия удалена из дневника LifeOS. Остальные записи сохранены.",
      );
    } catch (error) {
      setConflict(error instanceof WebApiError && error.status === 409);
      setMessage(
        webErrorMessage(error) +
          " Удаление не подтверждено. Загрузи сохранённую версию и повтори.",
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="space-y-5" aria-busy={!ready || busy}>
      {!ready ? (
        <p role="status" className="text-sm text-zinc-400">
          Подготавливаем дневник…
        </p>
      ) : null}
      <SectionPanel
        title={`Ideal Human — Day ${idealHumanDayNumber(date)}/30`}
        eyebrow={`${date} · Asia/Almaty`}
      >
        <p className="text-sm text-zinc-300">
          Наблюдения: {stats.checkins}/30 · дневник: {stats.journalDays} дн.
          Сохранённый план не означает выполненный день.
        </p>
        <label className="mt-4 block text-sm text-zinc-300">
          День эксперимента
          <select
            className={inputClass}
            value={date}
            disabled={!ready || busy}
            onChange={(event) => selectDate(event.target.value)}
          >
            {Array.from({ length: 30 }, (_, i) => idealHumanDate(i + 1)).map(
              (value, i) => (
                <option key={value} value={value}>
                  День {i + 1} · {value}
                </option>
              ),
            )}
          </select>
        </label>
        {date > today ? (
          <p className="mt-3 text-xs text-amber-200">
            План будущего дня можно менять. Фактические результаты записывай
            после события.
          </p>
        ) : null}
      </SectionPanel>
      {data.error ? (
        <Notice error>
          {data.error}{" "}
          <button
            type="button"
            className={buttonClass}
            disabled={!ready || busy || data.busy}
            onClick={() => void reload()}
          >
            Повторить загрузку
          </button>
        </Notice>
      ) : null}
      {message ? <Notice error={dirty}>{message}</Notice> : null}
      {conflict ? (
        <SectionPanel title="Несохранённая версия">
          <p className="text-sm text-zinc-300">
            Скопируй свои правки перед загрузкой актуальной записи. Другой экран
            не будет перезаписан автоматически.
          </p>
          <textarea
            aria-label="Несохранённый день JSON"
            readOnly
            className={inputClass}
            rows={5}
            value={JSON.stringify(day, null, 2)}
            onFocus={(event) => event.currentTarget.select()}
          />
          <button
            type="button"
            disabled={!ready || busy}
            className={`${buttonClass} mt-3`}
            onClick={() => void reload()}
          >
            Загрузить сохранённую версию
          </button>
        </SectionPanel>
      ) : null}
      {data.data !== null ? (
        <form
          noValidate
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="sticky top-16 z-20 rounded-xl border border-white/15 bg-graphite-950/95 p-3 backdrop-blur-md xl:top-2">
            <button
              type="submit"
              disabled={!ready || busy || !dirty || conflict}
              className={`${buttonClass} w-full border-cyan-300/30 bg-cyan-300/10 text-cyan-100`}
            >
              {busy ? "Сохраняем…" : "Сохранить день"}
            </button>
          </div>
          <fieldset disabled={!ready || busy} className="min-w-0 space-y-5">
            <SectionPanel title="Утренний чек-ин">
              <p className="mb-3 text-xs text-zinc-400">
                Только реальные измерения. Все поля необязательны.
              </p>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <NumberField
                  title="Утренний вес, кг"
                  min={25}
                  max={300}
                  step={0.1}
                  value={day.weightKg}
                  onChange={(value) => change("weightKg", value)}
                />
                <NumberField
                  title="Сон, часов"
                  max={24}
                  step={0.25}
                  value={
                    day.sleepMinutes === null
                      ? null
                      : Math.round((day.sleepMinutes / 60) * 100) / 100
                  }
                  onChange={(value) =>
                    change(
                      "sleepMinutes",
                      value === null ? null : Math.round(value * 60),
                    )
                  }
                />
                <TextField
                  title="Лёг спать"
                  type="time"
                  value={day.bedtime ?? ""}
                  onChange={(value) => change("bedtime", value || null)}
                />
                <TextField
                  title="Проснулся"
                  type="time"
                  value={day.wakeTime ?? ""}
                  onChange={(value) => change("wakeTime", value || null)}
                />
                <NumberField
                  title="Измеренный рост, см"
                  min={80}
                  max={250}
                  step={0.1}
                  value={day.baselineHeightCm}
                  onChange={(value) => change("baselineHeightCm", value)}
                />
              </div>
            </SectionPanel>
            <DayPlan day={day} change={change} />
            <div className="grid gap-4 md:grid-cols-2">
              <Link href="/workouts" className={buttonClass}>
                Открыть тренировку и историю
              </Link>
              <Link href="/study" className={buttonClass}>
                Открыть AITU и дедлайны
              </Link>
            </div>
            <Fold title="Тренировка и восстановление">
              <NumberField
                title="Ощущаемое усилие, 1–10"
                min={1}
                max={10}
                value={day.workoutEffort}
                onChange={(value) => change("workoutEffort", value)}
              />
              <TextField
                title="Заметки после тренировки"
                multiline
                value={day.workoutNotes}
                onChange={(value) => change("workoutNotes", value)}
              />
              <TextField
                title="Восстановление и самочувствие"
                multiline
                value={day.recoveryNotes}
                onChange={(value) => change("recoveryNotes", value)}
              />
              <p className="text-xs text-zinc-400">
                Подходы и завершение тренировки учитываются в существующем
                разделе тренировок.
              </p>
            </Fold>
            <NutritionJournal day={day} change={change} />
            <LearningJournal day={day} change={change} />
            <VideoJournal day={day} change={change} />
            <ReflectionJournal
              day={day}
              change={change}
              onClear={() => void clearReflection()}
              clearDisabled={!ready || busy || conflict}
              dirty={dirty}
            />
          </fieldset>
        </form>
      ) : null}
      <SectionPanel title="Прогресс и полный экспорт">
        <div className="grid gap-3 text-sm text-zinc-300 sm:grid-cols-3">
          <p>
            Средний вес:{" "}
            {stats.avgWeightKg === null
              ? "нет измерений"
              : `${stats.avgWeightKg.toFixed(1)} кг`}
          </p>
          <p>
            Средний сон:{" "}
            {stats.avgSleepMinutes === null
              ? "нет измерений"
              : `${(stats.avgSleepMinutes / 60).toFixed(1)} ч`}
          </p>
          <p>
            Учёба:{" "}
            {stats.studyMinutes === null
              ? "нет записей"
              : `${stats.studyMinutes} мин`}
          </p>
        </div>
        <div className="mt-4 space-y-2">
          {stats.weekly.map((week) => (
            <p key={week.week} className="text-xs text-zinc-400">
              Неделя {week.week}: {week.recordedDays}/{week.totalDays} дней с
              наблюдениями · сон{" "}
              {week.avgSleepMinutes === null
                ? "неизвестен"
                : `${(week.avgSleepMinutes / 60).toFixed(1)} ч`}{" "}
              · привычки{" "}
              {week.adherence === null
                ? "без оценки"
                : `${Math.round(week.adherence * 100)}% отмеченных`}
              .
            </p>
          ))}
        </div>
        <details className="mt-4">
          <summary className="min-h-11 cursor-pointer text-sm text-cyan-200">
            Экспорт всех сохранённых записей (JSON)
          </summary>
          <p className="mb-2 text-xs text-zinc-400">
            Содержит личные заметки. Скопируй в приватный файл.
          </p>
          <textarea
            aria-label="Экспорт Ideal Human JSON"
            readOnly
            rows={6}
            className={inputClass}
            value={JSON.stringify(data.data ?? [], null, 2)}
            onFocus={(event) => event.currentTarget.select()}
          />
        </details>
      </SectionPanel>
    </div>
  );
}
