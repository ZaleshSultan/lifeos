import { useEffect, useState } from "react";
import type { AcademicIntelligencePreferences } from "../../../../../packages/core/src/academic-intelligence.js";
import { useDraftState, useDraftRetention } from "../../lib/retained-draft";

export type AcademicPreferenceDraft = {
  gradeAlertsEnabled: boolean;
  assignmentAlertsEnabled: boolean;
  quizAlertsEnabled: boolean;
  assignmentOffsetsMinutes: number[];
  quizOffsetsMinutes: number[];
  quietStart: string;
  quietEnd: string;
};
export interface AcademicPreferenceUiState {
  dirty: boolean;
  saving: boolean;
  retained: boolean;
}
/** A preference editor only: the server's release switch still controls delivery. */
export function AcademicNotificationSettings({
  preferences,
  deliveryEnabled,
  onSave,
  onStateChange,
}: {
  preferences: AcademicIntelligencePreferences;
  deliveryEnabled: boolean;
  onSave: (
    draft: AcademicPreferenceDraft,
    expected: { expectedRevision: number; expectedAcademicRevision: number },
  ) => Promise<AcademicIntelligencePreferences>;
  onStateChange?: (state: AcademicPreferenceUiState) => void;
}) {
  const scope = "academic-notification-preferences";
  const [draft, setDraft] = useDraftState<AcademicPreferenceDraft>(
    scope,
    "draft",
    () => ({
      gradeAlertsEnabled: preferences.gradeAlertsEnabled,
      assignmentAlertsEnabled: preferences.assignmentAlertsEnabled,
      quizAlertsEnabled: preferences.quizAlertsEnabled,
      assignmentOffsetsMinutes: [...preferences.assignmentOffsetsMinutes],
      quizOffsetsMinutes: [...preferences.quizOffsetsMinutes],
      quietStart: preferences.quietStart,
      quietEnd: preferences.quietEnd,
    }),
  );
  const [assignmentOffsets, setAssignmentOffsets] = useDraftState(
    scope,
    "assignmentOffsets",
    draft.assignmentOffsetsMinutes.join(", "),
  );
  const [quizOffsets, setQuizOffsets] = useDraftState(
    scope,
    "quizOffsets",
    draft.quizOffsetsMinutes.join(", "),
  );
  const [confirmed, setConfirmed] = useState(false);
  const [edited, setEdited] = useDraftState(scope, "edited", false);
  const [expected, setExpected] = useDraftState(scope, "expected", () => ({
    expectedRevision: preferences.revision,
    expectedAcademicRevision: preferences.academicRevision,
  }));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const dirty =
    draft.gradeAlertsEnabled !== preferences.gradeAlertsEnabled ||
    draft.assignmentAlertsEnabled !== preferences.assignmentAlertsEnabled ||
    draft.quizAlertsEnabled !== preferences.quizAlertsEnabled ||
    draft.quietStart !== preferences.quietStart ||
    draft.quietEnd !== preferences.quietEnd ||
    assignmentOffsets !== preferences.assignmentOffsetsMinutes.join(", ") ||
    quizOffsets !== preferences.quizOffsetsMinutes.join(", ");
  const retained = useDraftRetention(scope, edited && dirty);
  useEffect(() => {
    onStateChange?.({ dirty: edited && dirty, saving, retained });
  }, [edited, dirty, saving, retained, onStateChange]);
  useEffect(
    () => () =>
      onStateChange?.({ dirty: false, saving: false, retained: false }),
    [onStateChange],
  );
  useEffect(() => {
    if (
      edited ||
      saving ||
      (expected.expectedRevision === preferences.revision &&
        expected.expectedAcademicRevision === preferences.academicRevision)
    )
      return;
    setExpected({
      expectedRevision: preferences.revision,
      expectedAcademicRevision: preferences.academicRevision,
    });
    setDraft({
      gradeAlertsEnabled: preferences.gradeAlertsEnabled,
      assignmentAlertsEnabled: preferences.assignmentAlertsEnabled,
      quizAlertsEnabled: preferences.quizAlertsEnabled,
      assignmentOffsetsMinutes: preferences.assignmentOffsetsMinutes,
      quizOffsetsMinutes: preferences.quizOffsetsMinutes,
      quietStart: preferences.quietStart,
      quietEnd: preferences.quietEnd,
    });
    setAssignmentOffsets(preferences.assignmentOffsetsMinutes.join(", "));
    setQuizOffsets(preferences.quizOffsetsMinutes.join(", "));
    setConfirmed(false);
  }, [
    preferences,
    edited,
    saving,
    expected,
    setExpected,
    setDraft,
    setAssignmentOffsets,
    setQuizOffsets,
  ]);
  const input =
    "min-h-11 w-full min-w-0 rounded-lg border border-white/[0.12] bg-graphite-950 px-3 py-2 text-base text-white";
  return (
    <form
      aria-label="Академические уведомления"
      className="space-y-4 rounded-xl border border-white/[0.08] bg-white/[0.03] p-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!confirmed || saving) return;
        const parse = (value: string) =>
          value
            .split(",")
            .map((part) => part.trim())
            .filter(Boolean)
            .map(Number);
        const assignments = parse(assignmentOffsets),
          quizzes = parse(quizOffsets);
        if (
          ![assignments, quizzes].every(
            (items) =>
              items.length > 0 &&
              items.length <= 6 &&
              items.every((v) => Number.isInteger(v) && v >= 1 && v <= 10080) &&
              new Set(items).size === items.length,
          )
        ) {
          setStatus(
            "Укажи от 1 до 6 разных целых смещений в минутах, от 1 до 10080.",
          );
          return;
        }
        setSaving(true);
        setStatus(null);
        try {
          const saved = await onSave(
            {
              ...draft,
              assignmentOffsetsMinutes: assignments,
              quizOffsetsMinutes: quizzes,
            },
            expected,
          );
          setExpected({
            expectedRevision: saved.revision,
            expectedAcademicRevision: saved.academicRevision,
          });
          setDraft({
            gradeAlertsEnabled: saved.gradeAlertsEnabled,
            assignmentAlertsEnabled: saved.assignmentAlertsEnabled,
            quizAlertsEnabled: saved.quizAlertsEnabled,
            assignmentOffsetsMinutes: saved.assignmentOffsetsMinutes,
            quizOffsetsMinutes: saved.quizOffsetsMinutes,
            quietStart: saved.quietStart,
            quietEnd: saved.quietEnd,
          });
          setAssignmentOffsets(saved.assignmentOffsetsMinutes.join(", "));
          setQuizOffsets(saved.quizOffsetsMinutes.join(", "));
          setConfirmed(false);
          setEdited(false);
          setStatus(
            "Предпочтения сохранены. Они не включают серверную доставку автоматически.",
          );
        } catch {
          setStatus(
            "Не удалось сохранить. Возможно, настройки изменились в другом окне. Обнови данные и проверь выбор перед повторным сохранением.",
          );
        } finally {
          setSaving(false);
        }
      }}
    >
      <div>
        <h2 className="font-semibold text-white">Академические уведомления</h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-300">
          {deliveryEnabled
            ? "Серверная доставка доступна только для выбранных категорий и свежих подтверждённых источников."
            : "Доставка отключена на сервере. Здесь можно подготовить предпочтения; новые категории требуют отдельно разрешённого релиза."}
        </p>
      </div>
      {(
        [
          ["gradeAlertsEnabled", "Новые оценки и исправления"],
          ["assignmentAlertsEnabled", "Дедлайны несданных заданий"],
          ["quizAlertsEnabled", "Подтверждённое закрытие незавершённых тестов"],
        ] as const
      ).map(([key, title]) => (
        <label
          key={key}
          className="flex min-h-11 items-center gap-3 text-sm text-zinc-200"
        >
          <input
            type="checkbox"
            checked={draft[key]}
            disabled={saving}
            onChange={(e) => {
              setDraft({ ...draft, [key]: e.target.checked });
              setConfirmed(false);
              setEdited(true);
            }}
          />
          {title}
        </label>
      ))}
      <p className="text-xs leading-relaxed text-zinc-400">
        Рекомендация: 4320 минут (72 часа) и 1440 (24 часа); 180 минут (3 часа)
        — по желанию. Это подсказка, не согласие. Неизвестный статус сдачи
        исключает напоминание.
      </p>
      <label className="block space-y-2 text-sm text-zinc-300">
        <span>Задания: за сколько минут до срока</span>
        <input
          aria-label="Смещения напоминаний заданий"
          className={input}
          value={assignmentOffsets}
          disabled={saving}
          onChange={(e) => {
            setAssignmentOffsets(e.target.value);
            setConfirmed(false);
            setEdited(true);
          }}
        />
      </label>
      <label className="block space-y-2 text-sm text-zinc-300">
        <span>Тесты: за сколько минут до закрытия</span>
        <input
          aria-label="Смещения напоминаний тестов"
          className={input}
          value={quizOffsets}
          disabled={saving}
          onChange={(e) => {
            setQuizOffsets(e.target.value);
            setConfirmed(false);
            setEdited(true);
          }}
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        {(
          [
            ["quietStart", "Тишина с"],
            ["quietEnd", "Тишина до"],
          ] as const
        ).map(([key, title]) => (
          <label key={key} className="min-w-0 space-y-2 text-sm text-zinc-300">
            <span>{title}</span>
            <input
              type="time"
              required
              className={input}
              value={draft[key]}
              disabled={saving}
              onChange={(e) => {
                setDraft({ ...draft, [key]: e.target.value });
                setConfirmed(false);
                setEdited(true);
              }}
            />
          </label>
        ))}
      </div>
      <p className="text-xs text-zinc-400">
        Тихие часы применяются в сохранённом часовом поясе профиля. Изменение
        срока, сдача и оценивание повторно проверяются перед отправкой.
      </p>
      <label className="flex min-h-11 items-center gap-3 text-sm text-zinc-200">
        <input
          type="checkbox"
          checked={confirmed}
          disabled={saving}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        Подтверждаю выбранные категории и интервалы.
      </label>
      <button
        type="submit"
        disabled={!confirmed || saving}
        className="min-h-11 w-full rounded-lg border border-cyan-300/25 bg-cyan-300/10 px-3 py-2 text-sm font-semibold text-cyan-100 disabled:opacity-40"
      >
        {saving ? "Сохранение…" : "Сохранить предпочтения"}
      </button>
      {status ? (
        <p role="status" className="break-words text-sm text-amber-100">
          {status}
        </p>
      ) : null}
    </form>
  );
}
