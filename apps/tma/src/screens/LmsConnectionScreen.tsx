import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import {
  LMS_COOKIE_MAX_LENGTH,
  LmsError,
  deleteLmsSession,
  lmsConnectionQueryKey,
  lmsErrorCategoryMessage,
  lmsWorkQueryKey,
  requestLmsSync,
  saveLmsSession,
  useLmsConnectionQuery,
  validateLmsSession,
  type LmsConnection,
  type LmsValidationReceipt,
} from "../api/lms";
import { todayQueryKey } from "../api/planning";
import { studyQueryKey } from "../api/study";
import { ErrorPanel, LoadingPanel } from "../components/AsyncState";
import {
  lmsConnectionLabels,
  lmsDateLabel,
  lmsFeatureLabel,
  takeLmsCookie,
} from "../components/study/lms-model";
import { telegram } from "../telegram";

export function LmsConnectionDetails({
  connection,
}: {
  connection: LmsConnection;
}) {
  const connected = connection.configured;
  const status = connection.state === "syncing" ? "syncing" : connected ? "connected" : "not_connected";

  return (
    <section className="lo-lms-hero" aria-label="Состояние подключения">
      <div className="flex items-center gap-3">
        <div className="lo-lms-hero-icon">
          <LockKeyhole className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <div className="lo-lms-eyebrow">УНИВЕРСИТЕТ · AITU</div>
          <div className="mt-1 text-lg font-bold tracking-tight text-white">Moodle LMS</div>
        </div>
      </div>
      <div className="lo-lms-status" data-state={status}>
        {connection.state === "syncing"
          ? "Обновляем учебные данные"
          : lmsConnectionLabels[connection.state] ?? "Состояние неизвестно"}
      </div>
      <dl className="lo-lms-details">
        <div className="lo-lms-detail">
          <dt>Последнее успешное обновление</dt>
          <dd>{lmsDateLabel(connection.lastSyncSuccessAt, undefined, "Пока не было")}</dd>
        </div>
        <div className="lo-lms-detail">
          <dt>Сессия хранится до</dt>
          <dd>{lmsDateLabel(connection.sessionExpiresAt, undefined, "Не подключена")}</dd>
        </div>
      </dl>
      {(connection.lastErrorCategory || connection.unsupportedFeatures.length > 0 || connection.syncRequestedAt || connection.state === "legacy_configuration") ? (
        <details className="lo-lms-advanced">
          <summary>Подробности подключения</summary>
          {connection.lastErrorCategory ? (
            <p className="text-amber-200">{lmsErrorCategoryMessage(connection.lastErrorCategory)}</p>
          ) : null}
          {connection.syncRequestedAt ? (
            <p>Запрос на синхронизацию: {lmsDateLabel(connection.syncRequestedAt)}. Это ещё не подтверждение завершения.</p>
          ) : null}
          {connection.unsupportedFeatures.length > 0 ? (
            <ul className="mt-2 space-y-1 text-xs text-zinc-300">
              {connection.unsupportedFeatures.map((feature, index) => (
                <li key={index}>• {lmsFeatureLabel(feature)}</li>
              ))}
            </ul>
          ) : null}
          {connection.state === "legacy_configuration" ? (
            <p>Старый синхронизатор может работать отдельно. Избегай одновременной синхронизации одного аккаунта.</p>
          ) : null}
          <p>Последняя попытка: {lmsDateLabel(connection.lastSyncAttemptAt, undefined, "Не было")}. Даты показаны по времени устройства.</p>
        </details>
      ) : null}
    </section>
  );
}

export function LmsManualFallback() {
  return (
    <p className="text-xs leading-relaxed text-zinc-400">
      Недостающие задания, экзамены и сроки можно добавить вручную в разделе
      «Учёба». Неизвестные даты и статусы останутся неизвестными.
    </p>
  );
}

export function LmsConnectionScreen({ onBack }: { onBack: () => void }) {
  const query = useLmsConnectionQuery();
  const queryClient = useQueryClient();
  const secretInput = useRef<HTMLInputElement | null>(null);
  const receipt = useRef<LmsValidationReceipt | null>(null);
  const controller = useRef<AbortController | null>(null);
  const expiryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const operationRef = useRef(false);
  const versionRef = useRef(0);
  const [hasInput, setHasInput] = useState(false);
  const [operation, setOperation] = useState<
    "validate" | "save" | "sync" | "delete" | null
  >(null);
  const [validated, setValidated] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const syncing = query.data?.state === "syncing";

  function discardReceipt() {
    receipt.current = null;
    if (expiryTimer.current) clearTimeout(expiryTimer.current);
    expiryTimer.current = null;
    setValidated(false);
  }

  useEffect(
    () => () => {
      versionRef.current += 1;
      controller.current?.abort();
      receipt.current = null;
      if (secretInput.current) secretInput.current.value = "";
      if (expiryTimer.current) clearTimeout(expiryTimer.current);
    },
    [],
  );

  async function refreshStudy() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: lmsWorkQueryKey }),
      queryClient.invalidateQueries({ queryKey: studyQueryKey }),
      queryClient.invalidateQueries({ queryKey: todayQueryKey }),
      queryClient.invalidateQueries({ queryKey: ["academic"] }),
      queryClient.invalidateQueries({ queryKey: ["sources"] }),
    ]);
  }

  async function runOperation(
    kind: NonNullable<typeof operation>,
    action: (signal: AbortSignal) => Promise<void>,
  ) {
    if (operationRef.current) return;
    operationRef.current = true;
    const version = ++versionRef.current;
    const abortController = new AbortController();
    controller.current = abortController;
    setOperation(kind);
    setError(null);
    setNotice(null);
    try {
      await action(abortController.signal);
    } catch (failure) {
      if (versionRef.current === version)
        setError(
          failure instanceof LmsError
            ? failure.message
            : "Запрос не выполнен. Проверь подключение и попробуй снова.",
        );
    } finally {
      if (versionRef.current === version) {
        operationRef.current = false;
        controller.current = null;
        setOperation(null);
      }
    }
  }

  function validate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (operationRef.current || syncing) return;
    let cookie = takeLmsCookie(secretInput.current);
    setHasInput(false);
    discardReceipt();
    if (!cookie) return;
    void runOperation("validate", async (signal) => {
      const pending = validateLmsSession(cookie, signal);
      cookie = "";
      const result = await pending;
      if (signal.aborted) return;
      const expiresIn = new Date(result.expiresAt).getTime() - Date.now();
      if (
        !result.validationToken ||
        !Number.isFinite(expiresIn) ||
        expiresIn <= 0
      )
        throw new LmsError("Проверка истекла. Проверь сессию заново.");
      receipt.current = result;
      setValidated(true);
      setNotice(
        "Сессия проверена. Рабочее подключение ещё не изменено. Сохрани её в течение 5 минут.",
      );
      expiryTimer.current = setTimeout(
        () => {
          receipt.current = null;
          setValidated(false);
          setNotice("Проверка истекла. Вставь cookie и проверь сессию заново.");
        },
        Math.min(expiresIn, 5 * 60_000),
      );
    });
    cookie = "";
  }

  function save() {
    if (operationRef.current || syncing) return;
    const current = receipt.current;
    if (!current || new Date(current.expiresAt).getTime() <= Date.now()) {
      discardReceipt();
      setError("Проверка истекла. Проверь сессию заново.");
      return;
    }
    let validationToken = current.validationToken;
    discardReceipt();
    void runOperation("save", async (signal) => {
      const pending = saveLmsSession(validationToken, signal);
      validationToken = "";
      const connection = await pending;
      if (signal.aborted) return;
      queryClient.setQueryData(lmsConnectionQueryKey, connection);
      setNotice("Сессия сохранена. Теперь можно запросить синхронизацию.");
      telegram.hapticImpact("medium");
      await refreshStudy();
    });
    validationToken = "";
  }

  const busy = operation !== null;
  return (
    <div className="min-w-0 space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm text-zinc-300 hover:bg-white/[0.06] active:scale-[0.98]"
      >
        <ArrowLeft className="h-4 w-4" />
        Назад в учёбу
      </button>
      <header>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-white">
          <LockKeyhole className="h-5 w-5 shrink-0 text-cyan-400" />
          Подключение AITU
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          Оценки, задания и дедлайны из университета — в одном месте.
        </p>
      </header>
      {query.isLoading ? (
        <LoadingPanel title="Проверяем состояние LMS…" />
      ) : query.data ? (
        <LmsConnectionDetails connection={query.data} />
      ) : (
        <ErrorPanel
          title="Состояние LMS недоступно"
          detail={
            query.error instanceof LmsError
              ? query.error.message
              : "Проверь подключение и попробуй снова."
          }
          onRetry={() => void query.refetch()}
        />
      )}
      {query.isError && query.data ? (
        <ErrorPanel
          title="Не удалось обновить состояние"
          detail="Показано последнее загруженное состояние подключения."
          onRetry={() => void query.refetch()}
        />
      ) : null}
      <form
        onSubmit={validate}
        autoComplete="off"
        className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4"
      >
        <div className="lo-lms-step">
          <div className="lo-lms-number">1</div>
          <div>
            <h2>{query.data?.configured ? "Обновить доступ" : "Подключить аккаунт"}</h2>
            <p>Подтверди сессию Microsoft, чтобы LifeOS мог читать учебные данные.</p>
          </div>
        </div>
        <details id="lms-session-help" className="lo-lms-advanced mb-3">
          <summary>Где найти ESTSAUTHPERSISTENT?</summary>
          <p>Войди в AITU LMS в своём браузере, открой инструменты разработчика и найди cookie ESTSAUTHPERSISTENT для login.microsoftonline.com. Вставь только значение, без имени, кавычек и других cookies.</p>
          <p>LifeOS не обходит интерактивный вход или MFA. Сессия должна быть действующей.</p>
        </details>
        <label
          htmlFor="lms-session-cookie"
          className="mt-4 block text-sm font-medium text-zinc-200"
        >
          Значение ESTSAUTHPERSISTENT
        </label>
        <input
          ref={secretInput}
          id="lms-session-cookie"
          type="password"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={LMS_COOKIE_MAX_LENGTH}
          disabled={busy || syncing}
          aria-describedby="lms-session-help lms-session-privacy"
          onChange={(event) => {
            setHasInput(event.currentTarget.value.length > 0);
            discardReceipt();
            setNotice(null);
          }}
          className="mt-2 min-h-11 w-full min-w-0 rounded-lg border border-white/[0.08] bg-graphite-900 px-3 py-3 text-base text-white disabled:opacity-50"
        />
        <p
          id="lms-session-privacy"
          className="mt-2 text-xs leading-relaxed text-zinc-400"
        >
          Поле очищается сразу при проверке. Проверка не заменяет сохранённую
          сессию; подтверждение действует до 5 минут. Секрет передаётся только
          защищённому backend LifeOS и не отправляется AI. Для постоянного
          подключения используется шифрование.
        </p>
        <button
          disabled={!hasInput || busy || syncing}
          type="submit"
          className="lo-lms-primary mt-4 disabled:opacity-50"
        >
          <ShieldCheck className="h-4 w-4" />
          {operation === "validate" ? "Проверяем…" : "Проверить без сохранения"}
        </button>
        {validated ? (
          <div className="mt-3 space-y-2">
            <button
              disabled={busy || syncing}
              type="button"
              onClick={save}
              className="lo-lms-primary disabled:opacity-50"
            >
              Сохранить проверенную сессию
            </button>
            <button
              disabled={busy}
              type="button"
              onClick={() => {
                discardReceipt();
                setNotice("Проверка отменена. Сохранённая сессия не изменена.");
              }}
              className="min-h-11 w-full rounded-lg px-3 text-sm text-zinc-300 hover:bg-white/[0.06]"
            >
              Не сохранять
            </button>
          </div>
        ) : null}
      </form>
      {operation === "save" ? (
        <LoadingPanel title="Сохраняем проверенную сессию…" />
      ) : null}
      {notice ? (
        <p
          role="status"
          className="lo-lms-notice"
        >
          {notice}
        </p>
      ) : null}
      {error ? (
        <div role="alert">
          <ErrorPanel title="Операция LMS не выполнена" detail={error} />
        </div>
      ) : null}
      <section className="space-y-3 rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
        <div className="lo-lms-step"><div className="lo-lms-number">2</div><div><h2>Обновить данные</h2><p>Синхронизируй оценки и дедлайны после подключения.</p></div></div>
        <button
          type="button"
          disabled={busy || syncing || !query.data?.configured}
          onClick={() =>
            void runOperation("sync", async (signal) => {
              await requestLmsSync(signal);
              if (signal.aborted) return;
              setNotice(
                "Запрос на синхронизацию принят. Данные обновятся после успешной работы синхронизатора.",
              );
              telegram.hapticImpact("light");
              await query.refetch();
              await refreshStudy();
            })
          }
          className="lo-lms-primary disabled:opacity-50"
        >
          <RefreshCw className="h-4 w-4" />
          {operation === "sync" || syncing
            ? "Синхронизация…"
            : "Запросить синхронизацию"}
        </button>
        <button
          type="button"
          disabled={busy || query.isFetching}
          onClick={() => void query.refetch()}
          className="lo-lms-secondary w-full disabled:opacity-50"
        >
          Обновить состояние
        </button>
        <button
          type="button"
          disabled={
            busy ||
            syncing ||
            !query.data ||
            query.data.state === "not_configured"
          }
          onClick={() => setConfirmDelete(true)}
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-rose-400/20 px-3 text-sm text-rose-200 hover:bg-rose-400/10 active:scale-[0.98] disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" />
          Удалить сохранённую сессию
        </button>
        {confirmDelete ? (
          <div className="space-y-2 rounded-lg border border-rose-400/20 p-3">
            <p className="text-sm leading-relaxed text-zinc-200">
              Удалить сохранённую сессию? Оценки, задания и ручные сроки
              останутся.
            </p>
            <button
              type="button"
              disabled={busy || syncing}
              onClick={() => {
                discardReceipt();
                if (secretInput.current) secretInput.current.value = "";
                setHasInput(false);
                void runOperation("delete", async (signal) => {
                  const connection = await deleteLmsSession(signal);
                  if (signal.aborted) return;
                  queryClient.setQueryData(lmsConnectionQueryKey, connection);
                  setConfirmDelete(false);
                  setNotice(
                    "Сохранённая сессия удалена. Учебные данные сохранены.",
                  );
                  telegram.hapticImpact("medium");
                  await refreshStudy();
                });
              }}
              className="min-h-11 w-full rounded-lg bg-rose-400/10 px-3 text-sm font-medium text-rose-100 hover:bg-rose-400/20 disabled:opacity-50"
            >
              Подтвердить удаление
            </button>
            <button
              disabled={busy}
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="min-h-11 w-full rounded-lg px-3 text-sm text-zinc-300 hover:bg-white/[0.06]"
            >
              Отмена
            </button>
          </div>
        ) : null}
        <LmsManualFallback />
      </section>
    </div>
  );
}
