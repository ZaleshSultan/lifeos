"use client";
import {
  useDraftState,
  useDraftRetention,
  useDiscardDraft,
} from "../../lib/retained-draft";
import { useEffect, useRef, useState } from "react";
import type { TaskWorkspaceItem } from "../../../../../packages/core/src/daily-life.js";
import type {
  CaptureActionPayload,
  CaptureCapabilities,
  CaptureConfirmRequest,
  CaptureView,
} from "../../../../../packages/core/src/universal-capture.js";
import {
  CaptureActionEditor,
  captureButtonClass,
  captureInputClass,
} from "./ActionEditor";
import { CaptureContextPanel } from "./ContextPanel";
import { CaptureProposalDetails } from "./ProposalDetails";
import { CaptureExternalControls } from "./ExternalControls";
import { captureErrorMessage } from "./errors";
import {
  canApproveCaptureAction,
  captureActionLabels,
  captureDateTime,
  captureProposalTitle,
  captureProvenanceLabel,
  captureStatusLabel,
  localInstantInput,
  operationIdentity,
  reviewExpired,
} from "./model";
import type { CaptureLifecycle, CaptureExternalInput } from "./transport";

const missingLabels: Record<string, string> = {
  title: "название",
  content: "текст",
  topic: "тема",
  label: "описание еды",
  key: "ключ памяти",
  text: "вопрос",
  taskId: "выбранная задача",
  expectedUpdatedAt: "текущая версия задачи",
  remindAt: "время напоминания",
  amountMl: "количество воды",
  supportedQuestion: "разрешённый источник ответа",
  minutes: "продолжительность",
  experimentDate: "дата эксперимента Ideal Human",
};
export function CaptureDetail({
  capture,
  capabilities,
  tasks,
  tasksUnavailable,
  busy,
  onReload,
  onEdit,
  onLifecycle,
  onConfirm,
  onDelete,
  onCorrect,
  onReject,
  onExternal,
  onDirtyChange,
}: {
  capture: CaptureView;
  capabilities: CaptureCapabilities;
  tasks: TaskWorkspaceItem[];
  tasksUnavailable: boolean;
  busy: boolean;
  onReload: () => void;
  onEdit: (input: {
    transcript?: string;
    actionId?: string;
    action?: CaptureActionPayload;
  }) => Promise<void>;
  onLifecycle: (action: CaptureLifecycle) => void;
  onConfirm: (input: CaptureConfirmRequest) => void;
  onDelete: () => void;
  onCorrect?: (instruction: string) => Promise<void>;
  onReject?: (actionId: string) => void;
  onExternal?: (input: CaptureExternalInput) => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useDraftState<string | null>(
    `capture:detail:${capture.id}:${capture.revision}`,
    "editing",
    null,
  );
  const [editDirty, setEditDirty] = useDraftState(
    `capture:detail:${capture.id}:${capture.revision}`,
    "editDirty",
    false,
  );
  const [instruction, setInstruction] = useDraftState(
    `capture:detail:${capture.id}:${capture.revision}`,
    "instruction",
    "",
  );
  const [externalDirty, setExternalDirty] = useState(false);
  const [consentGeneration, setConsentGeneration] = useState(0);
  const [transcript, setTranscript] = useDraftState(
    `capture:detail:${capture.id}:${capture.revision}`,
    "transcript",
    capture.transcript ?? "",
  );
  const [transcriptOpen, setTranscriptOpen] = useDraftState(
    `capture:detail:${capture.id}:${capture.revision}`,
    "transcriptOpen",
    capture.state === "awaiting_transcript",
  );
  const [now, setNow] = useState(Date.now);
  const confirmation = useRef<{ payload: string; requestId: string } | null>(
    null,
  );
  const transcriptDirty = transcript !== (capture.transcript ?? "");
  const discardAction = useDiscardDraft(`capture:action:${editing}`);
  const correctionDirty = Boolean(instruction.trim());
  const reviewDirty = transcriptDirty || correctionDirty || externalDirty;
  useDraftRetention(
    `capture:detail:${capture.id}:${capture.revision}`,
    editDirty || transcriptDirty || correctionDirty,
  );
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    onDirtyChange(editDirty || reviewDirty);
  }, [editDirty, reviewDirty, onDirtyChange]);
  const timezone = capture.context?.timezone ?? "Asia/Almaty";
  const date =
    capture.context?.date ??
    localInstantInput(capture.createdAt, timezone).split("T")[0];
  const frozen = capture.state === "processing" || capture.archivedAt !== null;
  const expired = reviewExpired(capture.reviewExpiresAt, now);
  const pending = capture.actions.filter(
    (action) =>
      action.status === "pending" ||
      action.status === "needs_input" ||
      action.status === "conflict",
  );
  const eligible = (action: CaptureView["actions"][number]) =>
    capture.state === "needs_review" &&
    canApproveCaptureAction(action) &&
    capabilities.actionKinds.includes(action.kind) &&
    (action.kind !== "memory.delete" || capabilities.memoryDeleteEnabled);
  const selectedActions = capture.actions.filter(
    (action) => selected.includes(action.id) && eligible(action),
  );
  function discardDrafts() {
    if (!(editDirty || reviewDirty)) return true;
    if (!window.confirm("Есть несохранённые изменения. Отменить их?"))
      return false;
    discardAction();
    setTranscript(capture.transcript ?? "");
    setInstruction("");
    setEditing(null);
    setEditDirty(false);
    setExternalDirty(false);
    setConsentGeneration((value) => value + 1);
    return true;
  }
  return (
    <section
      aria-label="Просмотр записи"
      className="min-w-0 space-y-4 rounded-xl border border-white/10 bg-white/[0.02] p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold text-white">
            {captureStatusLabel(capture)}
          </h2>
          <p className="mt-1 text-xs text-zinc-400">
            {capture.sourceLabel} ·{" "}
            {captureDateTime(capture.createdAt, timezone)}
          </p>
          {capture.archivedAt ? (
            <p className="mt-1 text-xs text-zinc-400">Запись в архиве</p>
          ) : null}
        </div>
        <button
          type="button"
          className={captureButtonClass}
          disabled={busy}
          onClick={() => {
            if (discardDrafts()) onReload();
          }}
        >
          Обновить запись
        </button>
      </div>
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Исходный запрос
        </h3>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-200">
          {capture.text ||
            "Получено голосовое сообщение. Текст ещё не добавлен."}
        </p>
      </div>
      <p className="text-xs leading-relaxed text-zinc-400">
        Исходный текст — данные, а не разрешение. Сохранение записи не выполняет
        предложенные действия.
      </p>
      {capture.expiresAt ? (
        <p className="text-xs text-zinc-400">
          Срок хранения записи: {captureDateTime(capture.expiresAt, timezone)}
        </p>
      ) : null}
      {capture.errorCode ? (
        <p
          role="alert"
          className="rounded-lg border border-rose-300/20 bg-rose-300/[0.04] p-3 text-sm text-rose-100"
        >
          {captureErrorMessage(capture.errorCode) ??
            (capture.state === "awaiting_transcript"
              ? "Автоматическая расшифровка недоступна. Добавь текст вручную, чтобы подготовить предложения."
              : capture.state === "failed"
                ? "Обработка не завершилась. Исходная запись сохранена; можно повторить безопасно."
                : "Не все действия удалось завершить. Проверь текущие записи и уточни предложения.")}
        </p>
      ) : null}
      {capture.inputType === "voice" || capture.transcript !== null ? (
        <div className="space-y-3 rounded-lg border border-white/10 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-zinc-100">Расшифровка</h3>
            <button
              type="button"
              className={captureButtonClass}
              disabled={busy || frozen}
              onClick={() => setTranscriptOpen((open) => !open)}
            >
              {transcriptOpen
                ? "Скрыть редактор расшифровки"
                : "Добавить или исправить текст"}
            </button>
          </div>
          {capture.transcript ? (
            <div className="space-y-2">
              <p className="text-xs text-zinc-400">
                {capture.transcriptSource === "provider"
                  ? "Расшифровка провайдера — проверь текст"
                  : capture.transcriptSource === "manual"
                    ? "Текст добавлен вручную"
                    : "Сохранённый текст расшифровки"}
              </p>
              <p className="whitespace-pre-wrap break-words text-sm text-zinc-300">
                {capture.transcript}
              </p>
            </div>
          ) : (
            <p className="text-sm text-zinc-400">
              Расшифровки пока нет. LifeOS не заявляет, что речь распознана.
            </p>
          )}
          {transcriptOpen ? (
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void onEdit({ transcript: transcript.trim() }).catch(() => {});
              }}
            >
              <label className="block text-sm text-zinc-300">
                Ручная расшифровка
                <textarea
                  aria-label="Ручная расшифровка"
                  rows={5}
                  maxLength={capabilities.maxTextLength}
                  className={captureInputClass}
                  disabled={busy || frozen || correctionDirty || externalDirty}
                  value={transcript}
                  onChange={(event) => setTranscript(event.target.value)}
                />
              </label>
              <p className="text-xs text-zinc-400">
                Исправление сбросит предыдущий просмотр. Новые предложения снова
                потребуют твоего выбора.
              </p>
              <button
                type="submit"
                className={captureButtonClass}
                disabled={
                  busy ||
                  frozen ||
                  correctionDirty ||
                  externalDirty ||
                  !transcriptDirty ||
                  !transcript.trim()
                }
              >
                Сохранить расшифровку
              </button>
            </form>
          ) : null}
        </div>
      ) : null}
      <CaptureContextPanel context={capture.context} />
      {onExternal ? (
        <CaptureExternalControls
          key={consentGeneration}
          capture={capture}
          capabilities={capabilities}
          disabled={
            busy || frozen || editDirty || transcriptDirty || correctionDirty
          }
          onRun={onExternal}
          onDirtyChange={setExternalDirty}
        />
      ) : null}
      {capture.state === "queued" ||
      capture.state === "awaiting_transcript" ||
      capture.state === "failed" ||
      capture.state === "cancelled" ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={captureButtonClass}
            disabled={
              busy ||
              frozen ||
              (capture.state === "awaiting_transcript" && !capture.transcript)
            }
            onClick={() => {
              if (discardDrafts())
                onLifecycle(
                  capture.state === "failed" || capture.state === "cancelled"
                    ? "retry"
                    : "process",
                );
            }}
          >
            {capture.state === "failed" || capture.state === "cancelled"
              ? "Повторить обработку записи"
              : "Подготовить предложения"}
          </button>
        </div>
      ) : null}
      {capture.state === "processing" ? (
        <div
          role="status"
          className="rounded-lg border border-cyan-300/20 p-3 text-sm text-cyan-100"
        >
          <p>
            {capture.processingStage === "transcribing"
              ? "Расшифровка запущена. Текст ещё не готов; исходная запись сохранена."
              : capture.processingStage === "extracting"
                ? "Готовим отдельные предложения из текста. Действия ещё не выполняются."
                : "Идёт ограниченная обработка. Можно уйти и вернуться: состояние хранится в LifeOS."}
          </p>
          <button
            type="button"
            className={`${captureButtonClass} mt-3`}
            disabled={busy}
            onClick={() => {
              if (discardDrafts()) onLifecycle("cancel");
            }}
          >
            Отменить обработку
          </button>
          <p className="mt-2 text-xs text-zinc-400">
            Исходная запись и уже сохранённые данные LifeOS останутся.
          </p>
        </div>
      ) : null}
      {capture.actions.length ? (
        <div className="space-y-3">
          <h3 className="font-semibold text-zinc-100">Предложения</h3>
          <p className="text-xs leading-relaxed text-zinc-400">
            Выбери только нужные действия. Пустые значения не будут заменены
            выдуманными фактами.
          </p>
          {tasksUnavailable ? (
            <p className="text-xs text-amber-100">
              Список задач временно недоступен. Для изменения или завершения
              задачи сначала обнови запись и выбери существующую задачу.
            </p>
          ) : null}
          {capture.actions.map((action, index) => (
            <article
              key={action.id}
              aria-label={`Предложение ${index + 1}: ${captureProposalTitle(action)}`}
              className="min-w-0 rounded-lg border border-white/10 p-3"
            >
              <label className="flex min-h-11 items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 h-5 w-5 shrink-0 accent-cyan-300"
                  checked={selected.includes(action.id)}
                  disabled={
                    busy ||
                    frozen ||
                    expired ||
                    !eligible(action) ||
                    editing !== null ||
                    reviewDirty
                  }
                  onChange={(event) => {
                    setSelected((old) =>
                      event.target.checked
                        ? [...old.filter((id) => id !== action.id), action.id]
                        : old.filter((id) => id !== action.id),
                    );
                    confirmation.current = null;
                  }}
                  aria-label={`Выбрать действие ${index + 1}: ${captureActionLabels[action.kind]}`}
                />
                <span className="min-w-0">
                  <span className="block text-xs text-cyan-100">
                    {captureActionLabels[action.kind]}
                  </span>
                  <span className="mt-1 block whitespace-pre-wrap break-words text-base font-semibold leading-relaxed text-zinc-100">
                    {captureProposalTitle(action)}
                  </span>
                </span>
              </label>
              <p className="mt-2 text-xs text-zinc-400">
                {captureProvenanceLabel(action)} ·{" "}
                {action.status === "succeeded"
                  ? "Сохранено"
                  : action.status === "cancelled"
                    ? "Отменено"
                    : action.status === "conflict"
                      ? "Конфликт — проверь текущую версию"
                      : action.status === "needs_input"
                        ? "Нужно уточнение"
                        : "Ещё не выполнено"}
              </p>
              <CaptureProposalDetails action={action} timezone={timezone} />
              {action.missingFields.length ? (
                <p className="mt-2 break-words text-xs text-amber-100">
                  Уточни:{" "}
                  {action.missingFields
                    .map((field) => missingLabels[field] ?? "детали действия")
                    .join(", ")}
                  .
                </p>
              ) : null}
              {action.kind === "memory.delete" &&
              !capabilities.memoryDeleteEnabled ? (
                <p className="mt-2 text-xs text-amber-100">
                  Безвозвратное удаление памяти выключено политикой сервера.
                </p>
              ) : null}
              {action.resultSummary ? (
                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-emerald-100">
                  {action.resultSummary}
                </p>
              ) : null}
              {action.completedAt ? (
                <p className="mt-2 text-xs text-zinc-400">
                  {captureDateTime(action.completedAt, timezone)}
                </p>
              ) : null}
              {action.status !== "succeeded" &&
              action.status !== "cancelled" ? (
                <button
                  type="button"
                  className={`${captureButtonClass} mt-3`}
                  disabled={
                    busy ||
                    frozen ||
                    correctionDirty ||
                    externalDirty ||
                    (editing !== null && editing !== action.id)
                  }
                  onClick={() => {
                    if (!discardDrafts()) return;
                    setSelected([]);
                    confirmation.current = null;
                    setEditing(action.id);
                    setEditDirty(false);
                  }}
                >
                  Уточнить предложение {index + 1}
                </button>
              ) : null}
              {onReject &&
              action.status !== "succeeded" &&
              action.status !== "cancelled" ? (
                <button
                  type="button"
                  className={`${captureButtonClass} mt-3 ml-0 sm:ml-2`}
                  disabled={busy || frozen}
                  onClick={() => {
                    if (discardDrafts()) onReject(action.id);
                  }}
                >
                  Отклонить предложение {index + 1}
                </button>
              ) : null}
              {editing === action.id ? (
                <CaptureActionEditor
                  action={action}
                  date={action.presentation?.suggestedDate ?? date}
                  timezone={action.presentation?.timezone ?? timezone}
                  tasks={tasks}
                  kinds={capabilities.actionKinds.filter(
                    (kind) =>
                      kind !== "memory.delete" ||
                      capabilities.memoryDeleteEnabled,
                  )}
                  busy={busy}
                  onDirtyChange={setEditDirty}
                  onSave={async (value) => {
                    await onEdit({ actionId: action.id, action: value });
                    setEditing(null);
                    setEditDirty(false);
                  }}
                  onCancel={() => {
                    if (discardDrafts()) {
                      discardAction();
                      setEditing(null);
                      setEditDirty(false);
                    }
                  }}
                />
              ) : null}
            </article>
          ))}
          {expired && pending.length ? (
            <p
              role="status"
              className="rounded-lg border border-amber-300/20 p-3 text-sm text-amber-100"
            >
              Время подтверждения истекло. Обнови разбор и заново проверь
              предложения.
            </p>
          ) : null}
          {expired && pending.length ? (
            <button
              type="button"
              className={captureButtonClass}
              disabled={busy || frozen || editDirty || reviewDirty}
              onClick={() => onLifecycle("retry")}
            >
              Обновить истёкший просмотр
            </button>
          ) : null}
          {pending.length ? (
            <div className="rounded-xl border border-amber-300/25 bg-amber-300/[0.04] p-4">
              <p className="text-sm font-semibold text-amber-100">
                Выбрано действий: {selectedActions.length}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-zinc-300">
                Будут выполнены только выбранные действия текущего просмотра.
                Неотмеченные останутся предложениями. Нажатие ниже — явное
                подтверждение.
              </p>
              <button
                type="button"
                className={`${captureButtonClass} mt-3 w-full border-amber-200/40 bg-amber-200/10 text-amber-100`}
                disabled={
                  busy ||
                  frozen ||
                  expired ||
                  selectedActions.length === 0 ||
                  editing !== null ||
                  reviewDirty
                }
                onClick={() => {
                  if (
                    reviewExpired(capture.reviewExpiresAt) ||
                    selectedActions.length === 0
                  )
                    return;
                  const payload = {
                    expectedRevision: capture.revision,
                    actionIds: selectedActions
                      .map((action) => action.id)
                      .sort(),
                    confirmed: true as const,
                  };
                  confirmation.current = operationIdentity(
                    confirmation.current,
                    payload,
                  );
                  onConfirm({
                    ...payload,
                    requestId: confirmation.current.requestId,
                  });
                }}
              >
                Подтвердить выбранные действия ({selectedActions.length})
              </button>
            </div>
          ) : null}
        </div>
      ) : capture.state === "completed" ? (
        <p className="text-sm text-zinc-400">
          Предложений нет. Исходная запись сохранена.
        </p>
      ) : null}
      {onCorrect && pending.length > 0 && !capture.archivedAt ? (
        <section
          aria-label="Уточнить намерения"
          className="space-y-3 rounded-xl border border-white/10 p-3"
        >
          <h3 className="text-sm font-semibold text-zinc-100">
            Исправить предложения одним сообщением
          </h3>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (instruction.trim())
                void onCorrect(instruction.trim()).catch(() => {});
            }}
          >
            <label className="block text-sm text-zinc-300">
              Уточнение
              <textarea
                aria-label="Уточнение предложений"
                className={captureInputClass}
                rows={3}
                maxLength={1000}
                value={instruction}
                disabled={
                  busy ||
                  frozen ||
                  editDirty ||
                  transcriptDirty ||
                  externalDirty
                }
                onChange={(event) => setInstruction(event.target.value)}
                placeholder="DBMS не завтра, а в пятницу. Тренировку убери."
              />
            </label>
            <p className="text-xs leading-relaxed text-zinc-400">
              Уточнение меняет только предложения. Уже сохранённые записи
              останутся; новый просмотр снова потребует твоего выбора.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                className={captureButtonClass}
                disabled={
                  busy ||
                  frozen ||
                  editDirty ||
                  transcriptDirty ||
                  externalDirty ||
                  !correctionDirty
                }
              >
                Применить уточнение
              </button>
              <button
                type="button"
                className={captureButtonClass}
                disabled={busy || !correctionDirty}
                onClick={() => setInstruction("")}
              >
                Очистить уточнение
              </button>
            </div>
          </form>
        </section>
      ) : null}
      <div className="flex flex-wrap gap-2 border-t border-white/10 pt-4">
        {capture.archivedAt ? (
          <button
            type="button"
            className={captureButtonClass}
            disabled={busy || capture.state === "processing"}
            onClick={() => onLifecycle("restore")}
          >
            Вернуть запись из архива
          </button>
        ) : null}
        {!capture.archivedAt && pending.length ? (
          <button
            type="button"
            className={captureButtonClass}
            disabled={busy || frozen}
            onClick={() => {
              if (
                discardDrafts() &&
                window.confirm(
                  "Отменить оставшиеся предложения? Уже сохранённые действия останутся в LifeOS.",
                )
              )
                onLifecycle("cancel");
            }}
          >
            Отменить оставшиеся предложения
          </button>
        ) : null}
        {!capture.archivedAt ? (
          <button
            type="button"
            className={captureButtonClass}
            disabled={busy || frozen}
            onClick={() => {
              if (discardDrafts()) onLifecycle("archive");
            }}
          >
            Архивировать запись
          </button>
        ) : null}
        <button
          type="button"
          className={`${captureButtonClass} border-rose-300/20 text-rose-100`}
          disabled={busy || capture.state === "processing"}
          onClick={() => {
            if (
              discardDrafts() &&
              window.confirm(
                "Удалить исходную запись, расшифровку и её историю? Уже подтверждённые задачи и записи LifeOS не отменяются.",
              )
            )
              onDelete();
          }}
        >
          Удалить запись и её историю
        </button>
      </div>
      <p className="text-xs leading-relaxed text-zinc-400">
        Уже подтверждённые задачи и записи LifeOS не отменяются при удалении
        исходной записи.
      </p>
    </section>
  );
}
