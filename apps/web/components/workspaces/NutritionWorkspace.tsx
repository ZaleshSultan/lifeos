"use client";
import {
  useDraftState,
  useDraftRetention,
  useDraftRef,
} from "../../../tma/src/lib/retained-draft";
import { MealPhotoReview } from "./MealPhotoReview";
import { useRef, useState } from "react";
import Link from "next/link";
import type {
  DailyLifeSummary,
  HydrationSummary,
} from "../../../../packages/core/src/daily-life.js";
import {
  emptyIdealHumanDay,
  idealHumanDayNumber,
  parseIdealHumanDay,
  type IdealHumanDay,
} from "../../../../packages/core/src/ideal-human.js";
import { NutritionJournal } from "../../../tma/src/components/ideal-human/JournalSections";
import { SectionPanel } from "@/components/SectionPanel";
import {
  Notice,
  buttonClass,
  inputClass,
  rowClass,
  useUnsavedGuard,
} from "@/components/WorkspaceUI";
import { webRequest, webErrorMessage } from "@/lib/web-client";
export function NutritionWorkspace({
  summary,
  days,
  date,
}: {
  summary: DailyLifeSummary | null;
  days: IdealHumanDay[] | null;
  date: string;
}) {
  const [hydration, setHydration] = useState(summary?.hydration ?? null);
  const [day, setDay] = useDraftState(
    `nutrition:${date}`,
    "day",
    () =>
      days?.find((entry) => entry.date === date) ??
      (idealHumanDayNumber(date) ? emptyIdealHumanDay(date) : null),
  );
  const [custom, setCustom] = useDraftState(`nutrition:${date}`, "custom", "");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useDraftState(`nutrition:${date}`, "dirty", false);
  const [photoDirty, setPhotoDirty] = useDraftState(
    `nutrition:${date}`,
    "photoDirty",
    false,
  );
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const inflight = useRef(false);
  const pending = useDraftRef<{ amountMl: number; requestId: string } | null>(
    `nutrition:${date}`,
    "pendingWater",
    null,
  );
  const retained = useDraftRetention(
    `nutrition:${date}`,
    dirty || photoDirty || Boolean(custom),
  );
  useUnsavedGuard(
    dirty || photoDirty || busy || Boolean(custom),
    retained && !busy,
  );
  function change<K extends keyof IdealHumanDay>(
    key: K,
    value: IdealHumanDay[K],
  ) {
    if (inflight.current) return;
    setDay((previous) => (previous ? { ...previous, [key]: value } : null));
    setDirty(true);
    setReceipt(null);
  }
  async function water(amountMl: number) {
    if (
      inflight.current ||
      !Number.isInteger(amountMl) ||
      amountMl < 1 ||
      amountMl > 5000
    )
      return;
    if (pending.current && pending.current.amountMl !== amountMl) {
      setError(
        "Сначала повтори предыдущую попытку тем же объёмом: сервер защитит её от двойного учёта.",
      );
      return;
    }
    pending.current ??= { amountMl, requestId: crypto.randomUUID() };
    inflight.current = true;
    setBusy(true);
    setError(null);
    try {
      setHydration(
        await webRequest<HydrationSummary>("hydration", {
          method: "POST",
          body: JSON.stringify(pending.current),
        }),
      );
      pending.current = null;
      setReceipt("Вода записана в LifeOS.");
    } catch (e) {
      setError(
        webErrorMessage(e) +
          " Повтори тот же объём: повторный запрос не создаст дубль.",
      );
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  }
  async function undo() {
    const last = hydration?.entries.find((entry) => entry.undoneAt === null);
    if (!last || inflight.current) return;
    inflight.current = true;
    setBusy(true);
    setError(null);
    try {
      setHydration(
        await webRequest<HydrationSummary>(`hydration/${last.id}/undo`, {
          method: "POST",
          body: "{}",
        }),
      );
      setReceipt("Последняя запись воды отменена.");
    } catch (e) {
      setError(webErrorMessage(e));
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  }
  async function save() {
    if (!day || inflight.current) return;
    let input: IdealHumanDay;
    try {
      input = parseIdealHumanDay(day);
    } catch {
      setError(
        "Добавь описание блюда и проверь калории и белок. Неизвестные значения можно оставить пустыми.",
      );
      return;
    }
    inflight.current = true;
    setBusy(true);
    setError(null);
    try {
      setDay(
        await webRequest<IdealHumanDay>("ideal-human/days", {
          method: "PUT",
          body: JSON.stringify({
            day: input,
            expectedRevision: input.revision,
          }),
        }),
      );
      setDirty(false);
      setReceipt("Питание сохранено в том же дневнике Ideal Human.");
    } catch (e) {
      setError(
        webErrorMessage(e) +
          " Твои правки остаются на этом экране; при конфликте скопируй их и открой актуальный дневник.",
      );
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="space-y-5">
      {error ? <Notice error>{error}</Notice> : null}
      {receipt ? <Notice>{receipt}</Notice> : null}
      <SectionPanel title="Вода сегодня">
        <p className="text-3xl font-semibold text-white">
          {hydration === null ? "Нет данных" : `${hydration.totalMl} мл`}
        </p>
        <p className="mt-2 text-xs text-zinc-400">
          {date} · Asia/Almaty. Это дневник выпитой воды, без навязанной
          медицинской нормы.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {[150, 250, 500].map((amount) => (
            <button
              key={amount}
              type="button"
              className={buttonClass}
              disabled={busy}
              onClick={() => void water(amount)}
            >
              +{amount} мл
            </button>
          ))}
        </div>
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void water(Number(custom));
          }}
        >
          <label className="min-w-0 flex-1 text-sm text-zinc-300">
            Свой объём, мл
            <input
              type="number"
              min={1}
              max={5000}
              required
              className={inputClass}
              value={custom}
              disabled={busy}
              onChange={(e) => setCustom(e.target.value)}
            />
          </label>
          <button
            type="submit"
            className={buttonClass}
            disabled={busy || !custom}
          >
            Записать
          </button>
        </form>
        <button
          type="button"
          className={`${buttonClass} mt-3`}
          disabled={
            busy || !hydration?.entries.some((entry) => entry.undoneAt === null)
          }
          onClick={() => void undo()}
        >
          Отменить последнюю запись
        </button>
        <div className="mt-4 space-y-2">
          {hydration?.entries.slice(0, 8).map((entry) => (
            <p key={entry.id} className={`${rowClass} text-xs text-zinc-300`}>
              {entry.amountMl} мл ·{" "}
              {new Intl.DateTimeFormat("ru-RU", {
                timeZone: "Asia/Almaty",
                timeStyle: "short",
              }).format(new Date(entry.occurredAt))}
              {entry.undoneAt ? " · отменено" : ""}
            </p>
          ))}
        </div>
      </SectionPanel>
      {day ? (
        <MealPhotoReview
          draftScope={`nutrition:photo:${date}`}
          disabled={busy}
          onDirtyChange={setPhotoDirty}
          onConfirm={async (meals) => {
            if (inflight.current) throw new Error("busy");
            const next = parseIdealHumanDay({
              ...day,
              meals: [
                ...day.meals.filter(
                  (meal) => !meals.some((item) => item.id === meal.id),
                ),
                ...meals,
              ],
            });
            inflight.current = true;
            setBusy(true);
            try {
              setDay(
                await webRequest<IdealHumanDay>("ideal-human/days", {
                  method: "PUT",
                  body: JSON.stringify({
                    day: next,
                    expectedRevision: next.revision,
                  }),
                }),
              );
              setDirty(false);
              setReceipt("Подтверждённая еда сохранена в LifeOS.");
            } finally {
              inflight.current = false;
              setBusy(false);
            }
          }}
        />
      ) : null}
      {day ? (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <fieldset disabled={busy} className="min-w-0 space-y-4">
            <NutritionJournal day={day} change={change} />
            <button
              type="submit"
              className={`${buttonClass} w-full`}
              disabled={busy || !dirty}
            >
              Сохранить питание
            </button>
          </fieldset>
          <details className="mt-4">
            <summary className="min-h-11 cursor-pointer text-xs text-zinc-400">
              Скопировать текущие правки перед обновлением
            </summary>
            <textarea
              readOnly
              aria-label="Питание JSON"
              className={inputClass}
              rows={5}
              value={JSON.stringify(day.meals, null, 2)}
              onFocus={(e) => e.currentTarget.select()}
            />
          </details>
        </form>
      ) : (
        <Notice>
          Дневник 30-дневного эксперимента доступен с 3 ноября по 2 декабря.
          Вода остаётся доступной каждый день.
        </Notice>
      )}
      <SectionPanel title="Приватность и оценка питания">
        <p className="text-sm leading-relaxed text-zinc-300">
          Ручной ввод работает без AI. Калории и белок можно оставить
          неизвестными или обозначить как приблизительную оценку. Фотографии не
          загружаются из этого экрана автоматически.
        </p>
        <Link href="/ideal-human" className={`${buttonClass} mt-4`}>
          Открыть весь дневник Ideal Human
        </Link>
      </SectionPanel>
    </div>
  );
}
