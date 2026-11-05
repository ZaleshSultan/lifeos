import { useDraftState, useDraftRetention } from "../../lib/retained-draft";
import { useEffect, useState, type FormEvent } from "react";
import {
  parseAcademicPreferences,
  type AcademicPreferences,
  type AcademicScheduleVerification,
  type AcademicScheduleVerificationInput,
} from "../../../../../packages/core/src/academic-concierge.js";
import { academicOffsetsInput } from "./academic-import";
import {
  academicButton,
  academicCalendarDate,
  academicInput,
  academicPanel,
} from "./academic-ui";

export function AcademicPreferencesForm({
  initial,
  busy,
  timezone,
  onSave,
  onDirtyChange,
}: {
  initial: AcademicPreferences;
  busy: boolean;
  timezone: string;
  onSave: (preferences: AcademicPreferences) => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = useDraftState(
    "academic:preferences",
    "draft",
    initial,
  );
  const [classOffset, setClassOffset] = useDraftState(
    "academic:preferences",
    "classOffset",
    String(initial.classOffsetMinutes),
  );
  const [offsets, setOffsets] = useDraftState(
    "academic:preferences",
    "offsets",
    {
      assignmentOffsetsMinutes: initial.assignmentOffsetsMinutes.join(", "),
      examOffsetsMinutes: initial.examOffsetsMinutes.join(", "),
      personalOffsetsMinutes: initial.personalOffsetsMinutes.join(", "),
    },
  );
  const [dirty, setDirty] = useDraftState(
    "academic:preferences",
    "dirty",
    false,
  );
  const [invalid, setInvalid] = useState(false);
  useDraftRetention("academic:preferences", dirty);
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  function change<K extends keyof AcademicPreferences>(
    key: K,
    value: AcademicPreferences[K],
  ) {
    setDraft((current) => ({ ...current, [key]: value }));
    setDirty(true);
    setInvalid(false);
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setInvalid(false);
    let preferences: AcademicPreferences;
    try {
      if (!/^\d{1,3}$/.test(classOffset)) throw new Error();
      preferences = parseAcademicPreferences({
        ...draft,
        classOffsetMinutes: Number(classOffset),
        assignmentOffsetsMinutes: academicOffsetsInput(
          offsets.assignmentOffsetsMinutes,
        ),
        examOffsetsMinutes: academicOffsetsInput(offsets.examOffsetsMinutes),
        personalOffsetsMinutes: academicOffsetsInput(
          offsets.personalOffsetsMinutes,
        ),
      });
    } catch {
      setInvalid(true);
      return;
    }
    try {
      await onSave(preferences);
      setDirty(false);
    } catch {
      /* The parent keeps the typed server error and this draft. */
    }
  }
  return (
    <form
      className={academicPanel}
      onSubmit={(e) => void submit(e)}
      aria-label="Настройки учебных уведомлений"
    >
      <h3 className="text-base font-semibold text-white">
        Уведомления об учёбе и личных экзаменах
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-zinc-300">
        Все категории изначально выключены. Выбор категории и сохранение —
        согласие на её сообщения в Telegram. Импорт событий сам по себе не
        включает доставку.
      </p>
      <p className="mt-2 text-xs text-zinc-400">
        Тихие часы: {timezone}. Время занятий AITU: Asia/Almaty. Подтверждённая
        сдача задания останавливает обычные напоминания о его отправке.
      </p>
      {invalid ? (
        <p role="alert" className="mt-3 text-sm text-amber-100">
          Проверь часы и интервалы. Укажи от 1 до 6 разных положительных
          отметок, не больше 10 080 минут.
        </p>
      ) : null}
      <fieldset disabled={busy} className="mt-4 min-w-0 space-y-3">
        {(
          [
            ["classAlertsEnabled", "Подтверждённые занятия"],
            ["assignmentAlertsEnabled", "Подтверждённые задания Moodle"],
            ["examAlertsEnabled", "Университетские экзамены"],
            [
              "personalAlertsEnabled",
              "Отдельные подтверждённые личные экзамены",
            ],
            [
              "staleWarningEnabled",
              "Предупреждения об устаревших данных и входе LMS",
            ],
            [
              "includeOnlineClasses",
              "Также уведомлять об онлайн-занятиях, если они подтверждены",
            ],
          ] as const
        ).map(([key, label]) => (
          <label
            key={key}
            className="flex min-h-11 items-center gap-3 text-sm leading-relaxed text-zinc-200"
          >
            <input
              type="checkbox"
              className="h-5 w-5 shrink-0 accent-cyan-300"
              checked={draft[key]}
              onChange={(e) => change(key, e.target.checked)}
            />
            {label}
          </label>
        ))}
        <label className="block min-w-0 text-sm text-zinc-300">
          За сколько минут до занятия
          <input
            className={academicInput}
            type="number"
            min={1}
            max={120}
            step={1}
            required
            value={classOffset}
            onChange={(e) => {
              setClassOffset(e.target.value);
              setDirty(true);
              setInvalid(false);
            }}
          />
        </label>
        <p className="text-xs leading-relaxed text-zinc-400">
          Для экзаменов и заданий — минуты до начала или срока сдачи: 1440 =
          сутки, 180 = 3 часа, 120 = 2 часа, 30 = полчаса.
        </p>
        {(
          [
            ["assignmentOffsetsMinutes", "Отметки для заданий"],
            ["examOffsetsMinutes", "Отметки для экзаменов AITU"],
            ["personalOffsetsMinutes", "Отметки для личных экзаменов"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="block min-w-0 text-sm text-zinc-300">
            {label}
            <input
              className={academicInput}
              value={offsets[key]}
              maxLength={70}
              required
              onChange={(e) => {
                setOffsets((current) => ({
                  ...current,
                  [key]: e.target.value,
                }));
                setDirty(true);
                setInvalid(false);
              }}
            />
          </label>
        ))}
        <div className="grid min-w-0 grid-cols-2 gap-3">
          <label className="block min-w-0 text-sm text-zinc-300">
            Тихие часы: с
            <input
              className={academicInput}
              type="time"
              required
              value={draft.quietStart}
              onChange={(e) => change("quietStart", e.target.value)}
            />
          </label>
          <label className="block min-w-0 text-sm text-zinc-300">
            Тихие часы: до
            <input
              className={academicInput}
              type="time"
              required
              value={draft.quietEnd}
              onChange={(e) => change("quietEnd", e.target.value)}
            />
          </label>
        </div>
        <button type="submit" className={academicButton} disabled={!dirty}>
          Сохранить настройки доставки
        </button>
      </fieldset>
    </form>
  );
}

export function AcademicScheduleVerificationForm({
  verification,
  busy,
  onSave,
  onDirtyChange,
}: {
  verification: AcademicScheduleVerification;
  busy: boolean;
  onSave: (input: AcademicScheduleVerificationInput) => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [from, setFrom] = useDraftState(
    "academic:schedule-verification",
    "from",
    verification.validFrom ?? "",
  );
  const [through, setThrough] = useDraftState(
    "academic:schedule-verification",
    "through",
    verification.validThrough ?? "",
  );
  const [source, setSource] = useDraftState(
    "academic:schedule-verification",
    "source",
    verification.sourceLabel ?? "",
  );
  const [baseRevision, setBaseRevision] = useDraftState(
    "academic:schedule-verification",
    "baseRevision",
    verification.revision,
  );
  const [agreed, setAgreed] = useState(false);
  const [dirty, setDirty] = useDraftState(
    "academic:schedule-verification",
    "dirty",
    false,
  );
  useDraftRetention("academic:schedule-verification", dirty);
  useEffect(() => {
    if (!dirty) setBaseRevision(verification.revision);
  }, [dirty, verification.revision]);
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!agreed) return;
    try {
      await onSave({
        expectedRevision: baseRevision,
        validFrom: from,
        validThrough: through,
        sourceLabel: source,
        confirmed: true,
      });
      setDirty(false);
      setAgreed(false);
    } catch {
      /* Preserve the review and dates on conflict or transport failure. */
    }
  }
  return (
    <form
      className={academicPanel}
      onSubmit={(e) => void submit(e)}
      aria-label="Подтверждение актуального расписания"
    >
      <h3 className="text-base font-semibold text-white">
        Актуальность обычного расписания
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-zinc-300">
        Уведомления о парах работают только для проверенного расписания и
        учебных дней из календаря. Даты расписания — Asia/Almaty. Экзамены не
        заменяют обычные пары.
      </p>
      <p className="mt-2 text-xs text-amber-100">
        {verification.current
          ? `Подтверждено: ${academicCalendarDate(verification.validFrom)} — ${academicCalendarDate(verification.validThrough)}.`
          : verification.changed
            ? "Сохранённое расписание изменилось после проверки. Нужна новая проверка."
            : "Период актуальности расписания не подтверждён или истёк."}
      </p>
      <details className="mt-3">
        <summary className="min-h-11 cursor-pointer text-sm text-cyan-200">
          Проверить источник и период актуальности
        </summary>
        <fieldset disabled={busy} className="min-w-0 space-y-3">
          <label className="block min-w-0 text-sm text-zinc-300">
            Проверенный источник расписания
            <input
              className={academicInput}
              value={source}
              maxLength={300}
              required
              onChange={(e) => {
                setSource(e.target.value);
                setDirty(true);
                setAgreed(false);
              }}
            />
          </label>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <label className="block min-w-0 text-sm text-zinc-300">
              Действует с
              <input
                className={academicInput}
                type="date"
                required
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  setDirty(true);
                  setAgreed(false);
                }}
              />
            </label>
            <label className="block min-w-0 text-sm text-zinc-300">
              Действует по, включительно
              <input
                className={academicInput}
                type="date"
                required
                min={from || undefined}
                value={through}
                onChange={(e) => {
                  setThrough(e.target.value);
                  setDirty(true);
                  setAgreed(false);
                }}
              />
            </label>
          </div>
          <label className="flex min-h-11 items-center gap-3 text-sm leading-relaxed text-zinc-200">
            <input
              type="checkbox"
              checked={agreed}
              className="h-5 w-5 shrink-0 accent-cyan-300"
              onChange={(e) => {
                setAgreed(e.target.checked);
                setDirty(true);
              }}
            />
            Я сверил сохранённые занятия, аудитории и даты с актуальным
            источником.
          </label>
          <button
            type="submit"
            className={academicButton}
            disabled={!agreed || !source.trim() || !from || !through}
          >
            Подтвердить актуальность расписания
          </button>
        </fieldset>
      </details>
    </form>
  );
}
