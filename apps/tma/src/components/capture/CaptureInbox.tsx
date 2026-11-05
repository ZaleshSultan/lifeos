"use client";
import {
  useDraftState,
  useDraftRetention,
  useDraftRef,
} from "../../lib/retained-draft";
import { useEffect, useRef, useState } from "react";
import { Inbox, Mic, Plus, Search, ShieldCheck } from "lucide-react";
import type { TaskWorkspaceItem } from "../../../../../packages/core/src/daily-life.js";
import {
  parseCaptureIngestRequest,
  type CaptureCapabilities,
  type CaptureEditRequest,
  type CaptureMemoryView,
  type CaptureSearchInput,
  type CaptureSearchResult,
  type CaptureState,
  type CaptureView,
} from "../../../../../packages/core/src/universal-capture.js";
import { CaptureDetail } from "./CaptureDetail";
import { CaptureMemoryPanel } from "./MemoryPanel";
import { captureButtonClass, captureInputClass } from "./ActionEditor";
import {
  captureDateTime,
  captureStateLabels,
  captureStatusLabel,
  operationIdentity,
} from "./model";
import type {
  CaptureDestination,
  CaptureLifecycle,
  CaptureTransport,
} from "./transport";

const defaultSearch: CaptureSearchInput = {
  query: "",
  includeArchived: false,
  limit: 20,
};
export interface CaptureInboxProps {
  transport: CaptureTransport;
  initialCapabilities?: CaptureCapabilities | null;
  initialHistory?: CaptureSearchResult | null;
  initialCaptureId?: string | null;
  errorMessage: (error: unknown) => string;
  onDirtyChange?: (dirty: boolean) => void;
  onNavigate?: (destination: CaptureDestination) => void;
}

/** A shared private inbox. It never imports Telegram, browser storage, or provider clients. */
export function CaptureInbox({
  transport,
  initialCapabilities = null,
  initialHistory = null,
  initialCaptureId,
  errorMessage,
  onDirtyChange,
  onNavigate,
}: CaptureInboxProps) {
  const [ready, setReady] = useState(false);
  const [capabilities, setCapabilities] = useState(initialCapabilities);
  const [history, setHistory] = useState<CaptureSearchResult | null>(
    initialHistory,
  );
  const [selected, setSelected] = useDraftState<CaptureView | null>(
    "capture:inbox",
    "selected",
    null,
  );
  const [loading, setLoading] = useState(
    initialHistory === null || initialCapabilities === null,
  );
  const [loadGeneration, setLoadGeneration] = useState(0);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [text, setText] = useDraftState("capture:inbox", "text", "");
  const [inputType, setInputType] = useDraftState<"text" | "link">(
    "capture:inbox",
    "inputType",
    "text",
  );
  const [retentionDays, setRetentionDays] = useDraftState<7 | 30 | 90 | null>(
    "capture:inbox",
    "retentionDays",
    null,
  );
  const [query, setQuery] = useDraftState("capture:inbox", "query", "");
  const [filterState, setFilterState] = useDraftState<CaptureState | "">(
    "capture:inbox",
    "filterState",
    "",
  );
  const [includeArchived, setIncludeArchived] = useDraftState(
    "capture:inbox",
    "includeArchived",
    false,
  );
  const [tab, setTab] = useDraftState<"inbox" | "memory">(
    "capture:inbox",
    "tab",
    "inbox",
  );
  const [voiceHelp, setVoiceHelp] = useState(false);
  const [detailDirty, setDetailDirty] = useDraftState(
    "capture:inbox",
    "detailDirty",
    false,
  );
  const [detailGeneration, setDetailGeneration] = useState(0);
  const [memoryDirty, setMemoryDirty] = useDraftState(
    "capture:inbox",
    "memoryDirty",
    false,
  );
  const [memories, setMemories] = useState<CaptureMemoryView[] | null>(null);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TaskWorkspaceItem[]>([]);
  const [tasksUnavailable, setTasksUnavailable] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const historySequence = useRef(0);
  const historyControl = useRef<AbortController | null>(null);
  const detailSequence = useRef(0);
  const detailControl = useRef<AbortController | null>(null);
  const memorySequence = useRef(0);
  const memoryControl = useRef<AbortController | null>(null);
  const composeIdentity = useDraftRef<{
    payload: string;
    requestId: string;
  } | null>("capture:inbox", "composeIdentity", null);
  const memoryIdentity = useDraftRef<{
    payload: string;
    requestId: string;
  } | null>("capture:inbox", "memoryIdentity", null);
  const appliedSearch = useRef<CaptureSearchInput>(defaultSearch);
  const composeInput = useRef<HTMLTextAreaElement>(null);
  const detailRegion = useRef<HTMLDivElement>(null);
  const dirty = Boolean(text.trim()) || detailDirty || memoryDirty || busy;

  useDraftRetention("capture:inbox", dirty);
  useEffect(() => {
    mounted.current = true;
    setReady(true);
    return () => {
      mounted.current = false;
      historyControl.current?.abort();
      detailControl.current?.abort();
      memoryControl.current?.abort();
    };
  }, []);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (selected)
      detailRegion.current?.scrollIntoView({
        block: "start",
        behavior: "auto",
      });
  }, [selected?.id]);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);
  useEffect(() => {
    if (initialCapabilities !== null && initialHistory !== null) return;
    setLoading(true);
    const control = new AbortController();
    const sequence = historySequence.current;
    const work = [
      initialCapabilities === null
        ? transport.capabilities(control.signal).then((value) => {
            if (mounted.current && !control.signal.aborted)
              setCapabilities(value);
          })
        : Promise.resolve(),
      initialHistory === null
        ? transport.search(defaultSearch, control.signal).then((value) => {
            if (
              mounted.current &&
              !control.signal.aborted &&
              sequence === historySequence.current
            )
              setHistory(value);
          })
        : Promise.resolve(),
    ];
    void Promise.all(work)
      .catch((failure) => {
        if (
          mounted.current &&
          !control.signal.aborted &&
          sequence === historySequence.current
        )
          setError(errorMessage(failure));
      })
      .finally(() => {
        if (
          mounted.current &&
          !control.signal.aborted &&
          sequence === historySequence.current
        )
          setLoading(false);
      });
    return () => control.abort();
  }, [
    transport,
    initialCapabilities,
    initialHistory,
    errorMessage,
    loadGeneration,
  ]);
  useEffect(() => {
    if (!initialCaptureId || (selected?.id === initialCaptureId && detailDirty))
      return;
    const control = new AbortController();
    const sequence = ++detailSequence.current;
    detailControl.current?.abort();
    detailControl.current = control;
    setDetailLoading(true);
    void transport
      .get(initialCaptureId, control.signal)
      .then((value) => {
        if (
          mounted.current &&
          !control.signal.aborted &&
          sequence === detailSequence.current
        )
          setSelected(value);
      })
      .catch((failure) => {
        if (
          mounted.current &&
          !control.signal.aborted &&
          sequence === detailSequence.current
        )
          setError(errorMessage(failure));
      })
      .finally(() => {
        if (mounted.current && sequence === detailSequence.current)
          setDetailLoading(false);
      });
    return () => control.abort();
  }, [transport, initialCaptureId, errorMessage]);
  useEffect(() => {
    if (!selected) return;
    const control = new AbortController();
    void transport
      .tasks(control.signal)
      .then((value) => {
        if (mounted.current && !control.signal.aborted) {
          setTasks(value.tasks);
          setTasksUnavailable(false);
        }
      })
      .catch(() => {
        if (mounted.current && !control.signal.aborted)
          setTasksUnavailable(true);
      });
    return () => control.abort();
  }, [transport, selected?.id]);
  useEffect(() => {
    if (!selected || selected.state !== "processing") return;
    const id = selected.id;
    const control = new AbortController();
    let attempts = 0;
    let pending = false;
    const timer = setInterval(() => {
      if (pending || attempts++ >= 20) {
        if (attempts >= 20) clearInterval(timer);
        return;
      }
      pending = true;
      void transport
        .get(id, control.signal)
        .then((value) => {
          if (mounted.current && !control.signal.aborted)
            setSelected((old) =>
              old?.id === id &&
              old.state === "processing" &&
              value.revision >= old.revision
                ? value
                : old,
            );
        })
        .catch(() => {})
        .finally(() => {
          pending = false;
        });
    }, 3000);
    return () => {
      clearInterval(timer);
      control.abort();
    };
  }, [transport, selected?.id, selected?.state]);

  function accept(value: CaptureView) {
    if (!mounted.current) return;
    detailSequence.current++;
    detailControl.current?.abort();
    setDetailLoading(false);
    setSelected(value);
    setDetailDirty(false);
    setDetailGeneration((old) => old + 1);
    setHistory((old) =>
      old
        ? {
            ...old,
            captures: old.captures.some((item) => item.id === value.id)
              ? old.captures.map((item) =>
                  item.id === value.id ? value : item,
                )
              : [value, ...old.captures].slice(0, 50),
          }
        : { captures: [value], nextCursor: null },
    );
  }
  async function mutation(work: () => Promise<void>, success: string) {
    if (inFlight.current || !ready)
      throw new Error("capture_operation_pending");
    inFlight.current = true;
    historySequence.current++;
    historyControl.current?.abort();
    detailSequence.current++;
    detailControl.current?.abort();
    setDetailLoading(false);
    setLoading(false);
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await work();
      if (!mounted.current) return;
      try {
        const currentHistory = await transport.search(appliedSearch.current);
        if (mounted.current) setHistory(currentHistory);
      } catch {
        if (mounted.current)
          setError(
            "Изменение сервер подтвердил, но историю не удалось обновить. Обнови список; не создавай новую копию действия.",
          );
      }
      if (mounted.current) setMessage(success);
    } catch (failure) {
      if (mounted.current) setError(errorMessage(failure));
      throw failure;
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function search(input: CaptureSearchInput, more = false) {
    if (inFlight.current) return;
    const sequence = ++historySequence.current;
    const control = new AbortController();
    historyControl.current?.abort();
    historyControl.current = control;
    setLoading(true);
    setError(null);
    try {
      const value = await transport.search(input, control.signal);
      if (
        !mounted.current ||
        control.signal.aborted ||
        sequence !== historySequence.current
      )
        return;
      appliedSearch.current = { ...input, cursor: undefined };
      setHistory((old) =>
        more && old
          ? {
              captures: [
                ...new Map(
                  [...old.captures, ...value.captures].map((item) => [
                    item.id,
                    item,
                  ]),
                ).values(),
              ],
              nextCursor: value.nextCursor,
            }
          : value,
      );
    } catch (failure) {
      if (
        mounted.current &&
        !control.signal.aborted &&
        sequence === historySequence.current
      )
        setError(errorMessage(failure));
    } finally {
      if (mounted.current && sequence === historySequence.current)
        setLoading(false);
    }
  }
  async function loadMemories() {
    const sequence = ++memorySequence.current;
    const control = new AbortController();
    memoryControl.current?.abort();
    memoryControl.current = control;
    setMemoryLoading(true);
    setMemoryError(null);
    try {
      const value = await transport.memories(control.signal);
      if (
        mounted.current &&
        !control.signal.aborted &&
        sequence === memorySequence.current
      )
        setMemories(value);
    } catch (failure) {
      if (
        mounted.current &&
        !control.signal.aborted &&
        sequence === memorySequence.current
      )
        setMemoryError(errorMessage(failure));
    } finally {
      if (mounted.current && sequence === memorySequence.current)
        setMemoryLoading(false);
    }
  }
  async function openCapture(item: CaptureView) {
    if (inFlight.current) return;
    if (
      detailDirty &&
      !window.confirm(
        "Есть несохранённые изменения. Открыть другую запись и отменить их?",
      )
    )
      return;
    const sequence = ++detailSequence.current;
    const control = new AbortController();
    detailControl.current?.abort();
    detailControl.current = control;
    setDetailLoading(true);
    setError(null);
    try {
      const value = await transport.get(item.id, control.signal);
      if (
        mounted.current &&
        !control.signal.aborted &&
        sequence === detailSequence.current
      ) {
        setSelected(value);
        setDetailDirty(false);
        setDetailGeneration((old) => old + 1);
      }
    } catch (failure) {
      if (
        mounted.current &&
        !control.signal.aborted &&
        sequence === detailSequence.current
      )
        setError(errorMessage(failure));
    } finally {
      if (mounted.current && sequence === detailSequence.current)
        setDetailLoading(false);
    }
  }
  async function create(value: string, kind: "text" | "link", memory = false) {
    if (!capabilities?.enabled || !capabilities.text)
      throw new Error("capture_disabled");
    if (
      detailDirty &&
      !window.confirm(
        "Отменить несохранённые изменения предложения и открыть новую запись?",
      )
    )
      return;
    const identity = memory ? memoryIdentity : composeIdentity;
    const payload = {
      inputType: kind,
      text: value.trim(),
      retentionDays: memory ? null : retentionDays,
    };
    identity.current = operationIdentity(identity.current, payload);
    const input = parseCaptureIngestRequest({
      ...payload,
      requestId: identity.current.requestId,
    });
    await mutation(async () => {
      let saved = await transport.create(input);
      if (!mounted.current) return;
      accept(saved);
      identity.current = null;
      if (!memory) setText("");
      setTab("inbox");
      setMemoryDirty(false);
      if (saved.state === "queued") {
        saved = await transport.lifecycle(saved.id, "process", saved.revision);
        accept(saved);
      }
    }, "Запись сохранена. Действия ещё не выполнялись: проверь и выбери предложения.");
  }
  async function lifecycle(action: CaptureLifecycle) {
    if (!selected) return;
    const current = selected;
    await mutation(
      async () => {
        const value = await transport.lifecycle(
          current.id,
          action,
          current.revision,
        );
        accept(value);
      },
      action === "archive"
        ? "Запись архивирована. Уже сохранённые действия остались в LifeOS."
        : action === "restore"
          ? "Запись возвращена в историю. Действия не выполнялись."
          : action === "cancel"
            ? "Оставшиеся предложения отменены."
            : "Просмотр обновлён. Заново проверь и выбери действия.",
    );
  }
  const disabled =
    !ready || busy || !capabilities?.enabled || !capabilities.text;
  return (
    <div className="min-w-0 space-y-4" aria-label="Универсальные входящие">
      <section className="rounded-xl border border-cyan-300/20 bg-cyan-300/[0.04] p-4">
        <div className="flex items-center gap-3">
          <Inbox className="h-5 w-5 text-cyan-200" aria-hidden="true" />
          <h2 className="font-semibold text-white">
            Мысли → просмотр → выбранные действия
          </h2>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-zinc-300">
          Сохрани мысль одним сообщением. LifeOS подготовит предложения; ничего
          не выполнится от самого текста.
        </p>
        <p className="mt-2 flex items-start gap-2 text-xs leading-relaxed text-zinc-400">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          Приватная история твоего аккаунта. Пароли, cookies и ключи доступа
          сюда не отправляй.
        </p>
        <div
          className="mt-4 flex flex-wrap gap-2"
          role="group"
          aria-label="Режим входящих"
        >
          <button
            type="button"
            className={captureButtonClass}
            aria-pressed={tab === "inbox"}
            onClick={() => {
              if (
                memoryDirty &&
                !window.confirm("Отменить несохранённую форму памяти?")
              )
                return;
              setMemoryDirty(false);
              setTab("inbox");
            }}
          >
            Входящие и действия
          </button>
          <button
            type="button"
            className={captureButtonClass}
            aria-pressed={tab === "memory"}
            onClick={() => {
              if (
                detailDirty &&
                !window.confirm("Отменить несохранённые изменения предложения?")
              )
                return;
              setDetailDirty(false);
              setTab("memory");
              if (memories === null) void loadMemories();
            }}
          >
            Память по выбору
          </button>
        </div>
      </section>
      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-rose-300/25 bg-rose-300/[0.04] p-4 text-sm text-rose-100"
        >
          {error}
          <p className="mt-2 text-xs">
            При неясном результате обнови запись или повтори то же
            подтверждение. Не создавай новую копию действия.
          </p>
          {!capabilities || !history ? (
            <button
              type="button"
              className={`${captureButtonClass} mt-3`}
              disabled={!ready || loading || busy}
              onClick={() => {
                setError(null);
                setLoadGeneration((value) => value + 1);
              }}
            >
              Повторить загрузку входящих
            </button>
          ) : null}
        </div>
      ) : null}
      {message ? (
        <p
          role="status"
          className="rounded-xl border border-emerald-300/20 p-4 text-sm leading-relaxed text-emerald-100"
        >
          {message}
        </p>
      ) : null}
      {capabilities && !capabilities.enabled ? (
        <p
          role="status"
          className="rounded-xl border border-amber-300/20 p-4 text-sm text-amber-100"
        >
          Входящие пока выключены на сервере. Обычные задачи, дневник и план
          LifeOS продолжают работать.
        </p>
      ) : null}
      {tab === "memory" ? (
        <CaptureMemoryPanel
          memories={memories}
          loading={memoryLoading}
          error={memoryError}
          busy={busy || !ready || !capabilities?.enabled || !capabilities.text}
          deleteEnabled={capabilities?.memoryDeleteEnabled === true}
          onReload={() => void loadMemories()}
          onPrepare={(command) => create(command, "text", true)}
          onDirtyChange={setMemoryDirty}
        />
      ) : (
        <>
          <section
            aria-label="Новая запись"
            className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold text-white">
                Записать без лишних форм
              </h2>
              <button
                type="button"
                className={captureButtonClass}
                onClick={() => setVoiceHelp((open) => !open)}
                aria-expanded={voiceHelp}
              >
                <Mic className="h-4 w-4" aria-hidden="true" />
                Голос в Telegram
              </button>
            </div>
            {voiceHelp ? (
              <div
                role="status"
                className="space-y-2 rounded-lg border border-cyan-300/20 p-3 text-sm leading-relaxed text-zinc-300"
              >
                <p>
                  Отправь голосовое сообщение в личный чат с LifeOS. Микрофон не
                  включается на этой странице.
                </p>
                <p>
                  {capabilities?.transcription === "configured_unverified"
                    ? "Настроенный способ расшифровки ещё не проверен; автоматическое распознавание не обещается."
                    : "Автоматическая расшифровка сейчас недоступна. В полученной записи можно добавить текст вручную."}
                </p>
                {capabilities ? (
                  <p className="text-xs text-zinc-400">
                    Ограничение: до {capabilities.maxVoiceSeconds} секунд и{" "}
                    {Math.round(capabilities.maxVoiceBytes / 1024 / 1024)} МиБ.
                    Исходное аудио не является разрешением на действия.
                  </p>
                ) : null}
                <a
                  className="inline-flex min-h-11 items-center text-cyan-100 underline"
                  href="https://t.me/MYlifeeOS_bot"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Открыть чат LifeOS
                </a>
              </div>
            ) : null}
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void create(text, inputType).catch((failure) => {
                  if (mounted.current) setError(errorMessage(failure));
                });
              }}
            >
              <fieldset disabled={disabled} className="min-w-0 space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm text-zinc-300">
                    Тип записи
                    <select
                      className={captureInputClass}
                      value={inputType}
                      onChange={(event) => {
                        setInputType(event.target.value as "text" | "link");
                        composeIdentity.current = null;
                      }}
                    >
                      <option value="text">Текст или ручная расшифровка</option>
                      <option value="link">Ссылка без загрузки страницы</option>
                    </select>
                  </label>
                  <label className="block text-sm text-zinc-300">
                    Срок хранения записи
                    <select
                      className={captureInputClass}
                      value={retentionDays ?? "keep"}
                      onChange={(event) => {
                        setRetentionDays(
                          event.target.value === "keep"
                            ? null
                            : (Number(event.target.value) as 7 | 30 | 90),
                        );
                        composeIdentity.current = null;
                      }}
                    >
                      <option value="keep">Пока не удалю сам</option>
                      <option value={7}>7 дней — по моему выбору</option>
                      <option value={30}>30 дней — по моему выбору</option>
                      <option value={90}>90 дней — по моему выбору</option>
                    </select>
                  </label>
                </div>
                <label className="block text-sm text-zinc-300">
                  Мысль, команда или ссылка
                  <textarea
                    ref={composeInput}
                    aria-label="Мысль, команда или ссылка"
                    className={captureInputClass}
                    rows={5}
                    maxLength={capabilities?.maxTextLength ?? 8000}
                    value={text}
                    onChange={(event) => {
                      setText(event.target.value);
                      composeIdentity.current = null;
                    }}
                    placeholder="Завтра после занятий хочу в зал. Напомни закончить DBMS и сохрани идею съёмки…"
                  />
                </label>
                <p className="text-right text-xs text-zinc-500">
                  {text.length}/{capabilities?.maxTextLength ?? 8000}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="submit"
                    className={`${captureButtonClass} border-cyan-200/30 bg-cyan-200/10`}
                    disabled={disabled || !text.trim()}
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Сохранить и подготовить просмотр
                  </button>
                  <button
                    type="button"
                    className={captureButtonClass}
                    disabled={disabled}
                    onClick={() => {
                      if (
                        text &&
                        !window.confirm(
                          "Заменить несохранённый текст шаблоном задачи?",
                        )
                      )
                        return;
                      setInputType("text");
                      setText("Task: ");
                      composeIdentity.current = null;
                      composeInput.current?.focus();
                    }}
                  >
                    Добавить задачу
                  </button>
                </div>
              </fieldset>
            </form>
            <p className="text-xs leading-relaxed text-zinc-400">
              {capabilities?.aiExtraction
                ? "Внешний AI-разбор запускается только с отдельным согласием внутри записи. Настройки расходов при этом не меняются."
                : "Поддерживаемые команды разбираются правилами LifeOS без обращения к AI. Неясные детали остаются на уточнение."}{" "}
              Ссылки сохраняются как данные; их содержимое не загружается и не
              получает полномочий.
            </p>
          </section>
          {onNavigate ? (
            <section
              aria-label="Быстрые действия"
              className="flex flex-wrap gap-2"
            >
              {[
                ["priorities", "Приоритеты сегодня"],
                ["water", "Записать воду"],
                ["workout", "Открыть тренировку"],
                ["ideal-human", "Ideal Human"],
              ].map(([destination, label]) => (
                <button
                  key={destination}
                  type="button"
                  className={captureButtonClass}
                  onClick={() => onNavigate(destination as CaptureDestination)}
                >
                  {label}
                </button>
              ))}
            </section>
          ) : null}
          <section
            aria-label="История входящих"
            className="space-y-3 rounded-xl border border-white/10 p-4"
          >
            <h2 className="font-semibold text-white">Приватная история</h2>
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void search({
                  query: query.trim(),
                  ...(filterState ? { state: filterState } : {}),
                  includeArchived,
                  limit: 20,
                });
              }}
            >
              <label className="block text-sm text-zinc-300">
                Поиск по исходным записям
                <textarea
                  aria-label="Поиск по исходным записям"
                  rows={1}
                  maxLength={200}
                  className={captureInputClass}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <div className="flex flex-wrap items-end gap-3">
                <label className="min-w-[12rem] flex-1 text-sm text-zinc-300">
                  Состояние
                  <select
                    className={captureInputClass}
                    value={filterState}
                    onChange={(event) =>
                      setFilterState(event.target.value as CaptureState | "")
                    }
                  >
                    <option value="">Все состояния</option>
                    {Object.entries(captureStateLabels).map(
                      ([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <label className="flex min-h-11 items-center gap-2 text-sm text-zinc-300">
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-cyan-300"
                    checked={includeArchived}
                    onChange={(event) =>
                      setIncludeArchived(event.target.checked)
                    }
                  />
                  Включить архив
                </label>
                <button
                  type="submit"
                  className={captureButtonClass}
                  disabled={!ready || busy || loading}
                >
                  <Search className="h-4 w-4" aria-hidden="true" />
                  Найти записи
                </button>
                <button
                  type="button"
                  className={captureButtonClass}
                  disabled={!ready || busy || loading}
                  onClick={() => {
                    setQuery("");
                    setFilterState("");
                    setIncludeArchived(false);
                    void search(defaultSearch);
                  }}
                >
                  Сбросить поиск
                </button>
              </div>
            </form>
            {loading ? (
              <p role="status" className="text-sm text-zinc-400">
                Загружаем сохранённую историю…
              </p>
            ) : null}
            {history !== null && history.captures.length === 0 && !loading ? (
              <p className="rounded-lg border border-white/10 p-4 text-sm text-zinc-400">
                Записей по этому запросу пока нет. Сохрани мысль выше или измени
                фильтр.
              </p>
            ) : null}
            <div className="space-y-2">
              {history?.captures.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`w-full min-w-0 rounded-lg border p-3 text-left ${selected?.id === item.id ? "border-cyan-300/35 bg-cyan-300/[0.05]" : "border-white/10 hover:bg-white/[0.03]"}`}
                  disabled={busy || detailLoading}
                  onClick={() => void openCapture(item)}
                >
                  <span className="block break-words text-sm font-semibold text-zinc-100">
                    {(
                      item.transcript ||
                      item.text ||
                      "Голосовое сообщение"
                    ).slice(0, 180)}
                  </span>
                  <span className="mt-2 block text-xs text-zinc-400">
                    {captureStatusLabel(item)}
                    {item.archivedAt ? " · архив" : ""} ·{" "}
                    {captureDateTime(item.createdAt, item.context?.timezone)}
                  </span>
                </button>
              ))}
            </div>
            {history?.nextCursor ? (
              <button
                type="button"
                className={captureButtonClass}
                disabled={!ready || busy || loading}
                onClick={() =>
                  void search(
                    { ...appliedSearch.current, cursor: history.nextCursor! },
                    true,
                  )
                }
              >
                Показать ещё записи
              </button>
            ) : null}
          </section>
          {detailLoading ? (
            <p role="status" className="text-sm text-zinc-400">
              Обновляем выбранную запись…
            </p>
          ) : null}
          <div ref={detailRegion} className="scroll-mt-24">
            {selected && capabilities ? (
              <CaptureDetail
                key={`${selected.id}:${selected.revision}:${detailGeneration}`}
                capture={selected}
                capabilities={capabilities}
                tasks={tasks}
                tasksUnavailable={tasksUnavailable}
                busy={busy || detailLoading || !ready || !capabilities.enabled}
                onDirtyChange={setDetailDirty}
                onReload={() => void openCapture(selected)}
                onEdit={async (patch) => {
                  const current = selected;
                  await mutation(async () => {
                    accept(
                      await transport.edit(current.id, {
                        ...patch,
                        expectedRevision: current.revision,
                      } as CaptureEditRequest),
                    );
                  }, "Предложение сохранено. Предыдущий выбор сброшен — проверь текущий просмотр.");
                }}
                onLifecycle={(action) => void lifecycle(action).catch(() => {})}
                onCorrect={async (instruction) => {
                  const current = selected;
                  await mutation(async () => {
                    accept(
                      await transport.correct(current.id, {
                        expectedRevision: current.revision,
                        instruction,
                      }),
                    );
                  }, "Предложения уточнены. Проверь новый просмотр и заново выбери действия.");
                }}
                onReject={(actionId) => {
                  const current = selected;
                  void mutation(async () => {
                    accept(
                      await transport.reject(current.id, {
                        expectedRevision: current.revision,
                        actionId,
                      }),
                    );
                  }, "Предложение отклонено. Другие действия не выполнялись.").catch(
                    () => {},
                  );
                }}
                onExternal={async (input) => {
                  const current = selected;
                  await mutation(async () => {
                    accept(await transport.external(current.id, input));
                  }, "Ответ на запрос обработки получен. Проверь состояние и текст; действия не подтверждались.");
                }}
                onConfirm={(input) => {
                  const current = selected;
                  void mutation(async () => {
                    accept(await transport.confirm(current.id, input));
                    if (mounted.current && memories !== null)
                      await loadMemories();
                  }, "Ответ сервера получен. Ниже указано, какие выбранные действия действительно сохранены.").catch(
                    () => {},
                  );
                }}
                onDelete={() => {
                  const current = selected;
                  void mutation(async () => {
                    await transport.remove(current.id, current.revision);
                    if (mounted.current) {
                      setSelected(null);
                      setDetailDirty(false);
                    }
                  }, "Исходная запись и её история удалены. Подтверждённые записи LifeOS не отменены.").catch(
                    () => {},
                  );
                }}
              />
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
