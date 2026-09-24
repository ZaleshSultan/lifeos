import { useState } from "react";
import { Watch } from "lucide-react";
import { ApiError } from "../api/client";
import {
  copyHealthConnectionValue,
  healthBridgeApiBaseUrl,
  issueHealthSessionToken,
  type HealthSessionToken,
} from "../api/health";

const buttonClass =
  "min-h-11 rounded-xl border border-white/10 px-3 py-2 text-sm font-medium text-zinc-100 transition-colors hover:bg-white/10 active:scale-[0.98] disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400";

export function HealthBridgeConnection() {
  const [connection, setConnection] = useState<HealthSessionToken | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const apiBaseUrl = healthBridgeApiBaseUrl();

  async function connect() {
    setBusy(true);
    setError(null);
    setCopyNotice(null);
    try {
      setConnection(await issueHealthSessionToken());
    } catch (failure) {
      setError(
        failure instanceof ApiError && failure.status === 503
          ? "Подключение часов пока не настроено на сервере."
          : failure instanceof ApiError && [401, 403].includes(failure.status)
            ? "Открой мини-приложение заново через Telegram и повтори попытку."
            : "Не удалось получить токен. Проверь соединение и попробуй ещё раз.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function copy(value: string, name: string) {
    const copied = await copyHealthConnectionValue(value);
    setCopyNotice(
      copied
        ? `${name} скопирован.`
        : "Не удалось скопировать автоматически. Нажми на поле, выдели текст и скопируй вручную.",
    );
  }

  return (
    <section
      className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 shadow-panel"
      aria-labelledby="health-bridge-title"
    >
      <h3
        id="health-bridge-title"
        className="flex items-center gap-2 font-semibold text-white"
      >
        <Watch className="h-5 w-5 text-cyan-400" aria-hidden="true" />
        Подключить часы
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-zinc-400">
        Health Bridge на Android передаёт данные из Health Connect в LifeOS.
      </p>
      {!connection ? (
        <button
          type="button"
          onClick={() => void connect()}
          disabled={busy}
          className={`${buttonClass} mt-3 w-full border-cyan-400/30 bg-cyan-400/10 text-cyan-100`}
        >
          {busy ? "Получаем токен…" : "Получить токен для Health Bridge"}
        </button>
      ) : (
        <div className="mt-4 space-y-3">
          <p className="text-sm leading-relaxed text-zinc-300">
            В Health Bridge заполни два поля ниже, сохрани подключение и разреши
            чтение данных Health Connect.
          </p>
          <label
            className="block text-sm text-zinc-300"
            htmlFor="health-bridge-url"
          >
            API base URL
          </label>
          <input
            id="health-bridge-url"
            readOnly
            value={apiBaseUrl}
            onFocus={(event) => event.currentTarget.select()}
            className="min-h-11 w-full min-w-0 rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-white"
          />
          <button
            type="button"
            className={buttonClass}
            onClick={() => void copy(apiBaseUrl, "Адрес")}
          >
            Скопировать адрес
          </button>
          <label
            className="block text-sm text-zinc-300"
            htmlFor="health-bridge-token"
          >
            Health session token
          </label>
          <textarea
            id="health-bridge-token"
            readOnly
            value={connection.token}
            rows={3}
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="off"
            onFocus={(event) => event.currentTarget.select()}
            className="w-full min-w-0 resize-y rounded-lg border border-white/10 bg-black/20 p-3 font-mono text-xs text-white"
            aria-describedby="health-bridge-expiry"
          />
          <button
            type="button"
            className={buttonClass}
            onClick={() => void copy(connection.token, "Токен")}
          >
            Скопировать токен
          </button>
          <p
            id="health-bridge-expiry"
            className="text-xs leading-relaxed text-zinc-400"
          >
            Действует до{" "}
            {new Date(connection.expiresAt).toLocaleString("ru-RU")}. После
            истечения получи новый токен здесь и замени его в Health Bridge.
          </p>
          <p className="text-xs text-zinc-400">
            Токен привязан к твоему аккаунту. Передавай его только в Health
            Bridge.
          </p>
          <button
            type="button"
            className={buttonClass}
            onClick={() => {
              setConnection(null);
              setCopyNotice(null);
            }}
          >
            Убрать токен с экрана
          </button>
        </div>
      )}
      {error ? (
        <p className="mt-3 text-sm text-rose-300" role="alert">
          {error}
        </p>
      ) : null}
      {copyNotice ? (
        <p className="mt-3 text-sm text-zinc-300" role="status">
          {copyNotice}
        </p>
      ) : null}
    </section>
  );
}
