import { useEffect, useRef, useState, type FormEvent } from "react";
import type { AcademicEventInput } from "../../../../../packages/core/src/academic-concierge.js";
import type {
  AcademicImportBundle,
  AcademicImportConfirmation,
  AcademicImportPreview,
} from "../../api/study-concierge";
import {
  AcademicEventEditor,
  AcademicEventSummary,
} from "./AcademicEventReview";
import {
  academicFilePreview,
  MAX_ACADEMIC_IMPORT_BYTES,
  type AcademicImportFormat,
} from "./academic-import";
import {
  academicButton,
  academicInput,
  academicPanel,
  academicWarning,
} from "./academic-ui";

export function AcademicImportPanel({
  busy,
  timezone,
  now,
  onPreview,
  onImport,
  onDirtyChange,
}: {
  busy: boolean;
  timezone: string;
  now: string | null;
  onPreview: (bundle: AcademicImportBundle) => Promise<AcademicImportPreview>;
  onImport: (
    input: AcademicImportConfirmation,
  ) => Promise<{ created: number; unchanged: number; conflicts: string[] }>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [format, setFormat] = useState<AcademicImportFormat>("json");
  const [kind, setKind] = useState<"university_exam" | "personal_exam">(
    "university_exam",
  );
  const [code, setCode] = useState<"exam" | "examfx">("exam");
  const [filename, setFilename] = useState("");
  const [text, setText] = useState("");
  const [bundle, setBundle] = useState<AcademicImportBundle | null>(null);
  const [preview, setPreview] = useState<AcademicImportPreview | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [agreed, setAgreed] = useState(false);
  const [localBusy, setLocalBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<AcademicEventInput | null>(null);
  const identity = useRef<{ signature: string; requestId: string } | null>(
    null,
  );
  const fileInput = useRef<HTMLInputElement>(null);
  const dirty = Boolean(text.trim() || bundle || preview);
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  function invalidate() {
    setPreview(null);
    setSelected([]);
    setAgreed(false);
    setEditing(null);
    identity.current = null;
    setMessage(null);
  }
  function discard() {
    setText("");
    setFilename("");
    setBundle(null);
    invalidate();
    setEditing(null);
    if (fileInput.current) fileInput.current.value = "";
  }
  async function readFile(file: File | undefined) {
    if (!file || busy || localBusy) return;
    if (file.size > MAX_ACADEMIC_IMPORT_BYTES) {
      setMessage("Файл слишком большой: максимум 256 КиБ.");
      return;
    }
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!["json", "csv", "ics"].includes(extension ?? "")) {
      setMessage(
        "Выбери JSON, CSV или ICS. PDF и фотографии требуют ручной проверки таблицы.",
      );
      return;
    }
    setLocalBusy(true);
    try {
      const content = await file.text();
      setText(content);
      setFilename(file.name);
      setFormat(extension as AcademicImportFormat);
      setBundle(null);
      invalidate();
    } catch {
      setMessage(
        "Не удалось прочитать локальный файл. Он не отправлен внешнему провайдеру.",
      );
    } finally {
      setLocalBusy(false);
    }
  }
  async function review(e: FormEvent) {
    e.preventDefault();
    if (busy || localBusy) return;
    setLocalBusy(true);
    setMessage(null);
    setSelected([]);
    setAgreed(false);
    identity.current = null;
    try {
      const parsed =
        bundle ??
        (await academicFilePreview(text, {
          format,
          filename: filename || "Предоставленная таблица",
          kind,
          timezone,
          sourceTypeCode: code,
          referenceAt: new Date().toISOString(),
        }));
      setBundle(parsed);
      const result = await onPreview(parsed);
      setPreview(result);
    } catch {
      setMessage(
        "Предпросмотр не готов. Проверь формат, обязательные поля и источник. Вставляй нормализованный JSON с sources/events либо таблицу CSV или ICS без повторяющихся событий. Данные и выбор не импортированы.",
      );
    } finally {
      setLocalBusy(false);
    }
  }
  async function confirm() {
    if (!preview || !selected.length || !agreed || busy || localBusy) return;
    setLocalBusy(true);
    setMessage(null);
    try {
      const selectedKeys = [...selected].sort();
      const signature = JSON.stringify({
        previewHash: preview.previewHash,
        selectedKeys,
      });
      const requestId =
        identity.current?.signature === signature
          ? identity.current.requestId
          : globalThis.crypto.randomUUID();
      identity.current = { signature, requestId };
      const result = await onImport({
        sources: preview.sources,
        events: preview.events,
        selectedKeys,
        previewHash: preview.previewHash,
        confirmed: true,
        requestId,
      });
      if (!result.conflicts.length) discard();
      else {
        setSelected([]);
        setAgreed(false);
        identity.current = null;
      }
      setMessage(
        `Создано: ${result.created}. Уже сохранено: ${result.unchanged}. Требует проверки: ${result.conflicts.length}. Уведомления не включались.`,
      );
    } catch {
      /* The parent exposes the typed server failure. Keep the exact request identity for a safe retry. */
    } finally {
      setLocalBusy(false);
    }
  }
  return (
    <section
      className={academicPanel}
      aria-label="Предпросмотр и импорт учебных событий"
    >
      <h3 className="text-base font-semibold text-white">Импорт с проверкой</h3>
      <p className="mt-2 text-sm leading-relaxed text-zinc-300">
        Сначала проверь источник и каждую строку. Ничего не выбрано заранее.
        Языковые альтернативы зависят от личного зачисления и преподавателя; не
        выбирай их все сразу.
      </p>
      <p className="mt-2 text-xs leading-relaxed text-zinc-400">
        Файл читается локально и передаётся только защищённому API LifeOS для
        предпросмотра. Внешний AI не используется. PDF, изображения и Excel
        автоматически не распознаются; подготовь проверенную таблицу
        JSON/CSV/ICS.
      </p>
      {message ? (
        <p role="status" className="mt-3 break-words text-sm text-amber-100">
          {message}
        </p>
      ) : null}
      <form onSubmit={(e) => void review(e)} className="mt-3">
        <fieldset disabled={busy || localBusy} className="min-w-0 space-y-3">
          <label className="block min-w-0 text-sm text-zinc-300">
            Файл расписания или личного события
            <input
              ref={fileInput}
              type="file"
              accept=".json,.csv,.ics,application/json,text/csv,text/calendar"
              className="mt-2 min-h-11 w-full min-w-0 max-w-full text-sm file:mr-2 file:min-h-11 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:text-zinc-100"
              onChange={(e) => void readFile(e.target.files?.[0])}
            />
          </label>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <label className="block min-w-0 text-sm text-zinc-300">
              Формат
              <select
                className={academicInput}
                value={format}
                onChange={(e) => {
                  setFormat(e.target.value as AcademicImportFormat);
                  setBundle(null);
                  invalidate();
                }}
              >
                <option value="json">JSON</option>
                <option value="csv">CSV</option>
                <option value="ics">ICS</option>
              </select>
            </label>
            {format !== "json" ? (
              <label className="block min-w-0 text-sm text-zinc-300">
                Категория записей
                <select
                  className={academicInput}
                  value={kind}
                  onChange={(e) => {
                    setKind(e.target.value as typeof kind);
                    setBundle(null);
                    invalidate();
                  }}
                >
                  <option value="university_exam">Экзамены университета</option>
                  <option value="personal_exam">
                    Отдельные личные экзамены
                  </option>
                </select>
              </label>
            ) : null}
          </div>
          {format !== "json" && kind === "university_exam" ? (
            <label className="block min-w-0 text-sm text-zinc-300">
              Код, если в файле не указан
              <select
                className={academicInput}
                value={code}
                onChange={(e) => {
                  setCode(e.target.value as "exam" | "examfx");
                  setBundle(null);
                  invalidate();
                }}
              >
                <option value="exam">exam</option>
                <option value="examfx">examfx</option>
              </select>
            </label>
          ) : null}
          <p className="text-xs text-zinc-400">
            Местное время таблицы: {timezone}. Исходные exam и examfx
            сохраняются отдельно; смысл examfx не предполагается.
          </p>
          <details>
            <summary className="min-h-11 cursor-pointer text-sm text-cyan-200">
              Вставить содержимое файла вручную
            </summary>
            <label className="block text-sm text-zinc-300">
              Текст таблицы
              <textarea
                className={academicInput + " min-h-40"}
                spellCheck={false}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setBundle(null);
                  invalidate();
                }}
              />
            </label>
          </details>
          <div className="flex flex-wrap gap-2">
            <button
              className={academicButton}
              type="submit"
              disabled={!text.trim() && !bundle}
            >
              {localBusy
                ? "Проверяем…"
                : bundle && !preview
                  ? "Обновить предпросмотр"
                  : "Проверить перед импортом"}
            </button>
            <button
              className={academicButton}
              type="button"
              disabled={!dirty}
              onClick={discard}
            >
              Отменить импорт
            </button>
          </div>
        </fieldset>
      </form>
      {bundle && !preview ? (
        <p className="mt-3 text-xs text-amber-100">
          Локальные правки ещё не сохранены. Повтори предпросмотр, прежде чем
          выбирать записи.
        </p>
      ) : null}
      {preview ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-zinc-200">
            Предпросмотр: {preview.events.length} записей. Выбрано:{" "}
            {selected.length}.
          </p>
          {(preview.warnings ?? []).map((warning, i) => (
            <p key={i} className="break-words text-xs text-amber-100">
              {academicWarning(warning)}
            </p>
          ))}
          {preview.events.map((event) => (
            <article
              key={event.key}
              className="rounded-lg border border-white/10 p-3"
            >
              <label className="flex min-h-11 items-center gap-3 text-sm text-zinc-200">
                <input
                  className="h-5 w-5 shrink-0 accent-cyan-300"
                  type="checkbox"
                  disabled={busy || localBusy}
                  checked={selected.includes(event.key)}
                  onChange={(e) => {
                    setSelected((current) =>
                      e.target.checked
                        ? [...current, event.key]
                        : current.filter((key) => key !== event.key),
                    );
                    setAgreed(false);
                    identity.current = null;
                  }}
                />
                Выбрать запись «{event.title}»
              </label>
              <AcademicEventSummary
                event={event}
                source={preview.sources.find(
                  (source) => source.key === event.sourceKey,
                )}
                now={now}
                map={false}
              />
              <button
                className={academicButton + " mt-3"}
                type="button"
                disabled={busy || localBusy}
                onClick={() => setEditing(event)}
              >
                Править строку предпросмотра
              </button>
            </article>
          ))}
          <label className="flex min-h-11 items-center gap-3 text-sm leading-relaxed text-zinc-200">
            <input
              type="checkbox"
              className="h-5 w-5 shrink-0 accent-cyan-300"
              checked={agreed}
              disabled={busy || localBusy || !selected.length}
              onChange={(e) => setAgreed(e.target.checked)}
            />
            Я проверил выбранные записи и источники. Разрешаю сохранить только
            их; уведомления не включать.
          </label>
          <p className="text-xs text-zinc-400">
            Личные экзамены сохранятся отдельными предложениями и потребуют
            отдельного подтверждения. Ручные правки существующих событий не
            перезаписываются молча.
          </p>
          <button
            type="button"
            className={academicButton}
            disabled={busy || localBusy || !agreed || !selected.length}
            onClick={() => void confirm()}
          >
            Импортировать выбранные записи
          </button>
        </div>
      ) : null}
      {editing ? (
        <div className="mt-4">
          <p className="mb-2 text-sm text-amber-100">
            Правка только в предпросмотре; в LifeOS она ещё не сохранена.
          </p>
          <AcademicEventEditor
            key={editing.key}
            event={editing}
            busy={busy || localBusy}
            onCancel={() => setEditing(null)}
            onSave={async (patch) => {
              setBundle((current) =>
                current
                  ? {
                      ...current,
                      events: current.events.map((event) =>
                        event.key === editing.key
                          ? { ...event, ...patch }
                          : event,
                      ),
                    }
                  : current,
              );
              invalidate();
              setEditing(null);
            }}
          />
        </div>
      ) : null}
    </section>
  );
}
