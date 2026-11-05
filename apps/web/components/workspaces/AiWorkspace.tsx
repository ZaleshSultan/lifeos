"use client";
import {
  useDraftState,
  useDraftRetention,
} from "../../../tma/src/lib/retained-draft";
import { useEffect, useRef, useState } from "react";
import type {
  WebAiAnswer,
  WebAiMessage,
  WebAiRequest,
  WebAiStatus,
} from "@/lib/dashboard-contracts";
import { SectionPanel } from "@/components/SectionPanel";
import {
  Notice,
  buttonClass,
  inputClass,
  rowClass,
  useUnsavedGuard,
} from "@/components/WorkspaceUI";
import { webRequest, webErrorMessage } from "@/lib/web-client";

type ConversationMessage = WebAiMessage & {
  provider?: string;
  modelRoute?: WebAiAnswer["modelRoute"];
};
function providerName(provider: string | undefined) {
  return provider === "gemini"
    ? "Google Gemini"
    : provider === "openrouter"
      ? "OpenRouter"
      : provider === "openai"
        ? "OpenAI API"
        : provider === "anthropic"
          ? "Anthropic API"
          : provider === "chatgpt_plan"
            ? "ChatGPT plan"
            : "LifeOS";
}
function ModelDetails({
  route,
}: {
  route: NonNullable<WebAiAnswer["modelRoute"]>;
}) {
  const cost = (micros: number | null) =>
    typeof micros === "number" && Number.isSafeInteger(micros) && micros >= 0
      ? new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
          maximumFractionDigits: 6,
        }).format(micros / 1_000_000)
      : null;
  return (
    <div
      aria-label="Использование AI модели"
      className="mt-3 space-y-1 border-t border-white/[0.08] pt-3 text-xs leading-relaxed text-zinc-400"
    >
      <p className="break-words text-zinc-300">
        {providerName(route.provider)} · {route.model}
        {route.upstreamProvider ? ` · Обработал ${route.upstreamProvider}` : ""}
      </p>
      <p>
        {route.billing === "chatgpt_plan"
          ? "Лимит плана ChatGPT · это не API-кредиты OpenAI"
          : route.billing === "free"
            ? "Бесплатная модель · ограничения провайдера сохраняются"
            : "Оплата через API"}
      </p>
      {route.billing !== "chatgpt_plan" ? (
        <p>
          {cost(route.estimatedCostMicros)
            ? `Оценка ${cost(route.estimatedCostMicros)}`
            : "Оценка стоимости неизвестна"}
          {cost(route.reportedCostMicros)
            ? ` · ${route.costSource === "provider_reported" ? "Стоимость от провайдера" : route.costSource === "rate_estimate" ? "Оценка по использованным токенам" : "Стоимость использования"} ${cost(route.reportedCostMicros)}`
            : " · Фактическая стоимость не сообщена"}
        </p>
      ) : null}
      <p>
        {Number.isFinite(route.latencyMs) && route.latencyMs >= 0
          ? `${Math.round(route.latencyMs)} мс`
          : "Время ответа неизвестно"}{" "}
        ·{" "}
        {route.fallback ? "Использован резервный маршрут" : "Выбранная модель"}{" "}
        · Внешняя обработка
      </p>
      <p className="break-words">
        Причина выбора: {route.reason.replaceAll("_", " ")}
      </p>
    </div>
  );
}
export function AiWorkspace({
  status,
  date,
}: {
  status: WebAiStatus | null;
  date: string;
}) {
  const [history, setHistory] = useDraftState<ConversationMessage[]>(
    "assistant",
    "history",
    [],
  );
  const [text, setText] = useDraftState("assistant", "text", "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    input: WebAiRequest;
    confirmation: { token: string; summary: string };
  } | null>(null);
  const [retry, setRetry] = useState<WebAiRequest | null>(null);
  const retained = useDraftRetention(
    "assistant",
    Boolean(text || history.length),
  );
  useUnsavedGuard(
    Boolean(text || history.length) || busy || Boolean(pending),
    retained && !busy && !pending,
  );
  const controller = useRef<AbortController | null>(null);
  const previousModelId = useRef<string | undefined>(undefined);
  useEffect(() => () => controller.current?.abort(), []);
  const enabled = Boolean(
    status && (status.available || status.assistantEnabled),
  );
  async function request(input: WebAiRequest) {
    if (controller.current) return;
    const control = new AbortController();
    controller.current = control;
    setBusy(true);
    setError(null);
    setRetry(null);
    try {
      const answer = await webRequest<WebAiAnswer>("ai/chat", {
        method: "POST",
        body: JSON.stringify(input),
        signal: control.signal,
      });
      setHistory((old) => [
        ...old,
        {
          role: "assistant",
          text: answer.answer,
          provider: answer.provider,
          modelRoute: answer.modelRoute,
        },
      ]);
      if (answer.modelRoute)
        previousModelId.current = answer.modelRoute.modelId;
      setPending(
        answer.confirmation
          ? { input, confirmation: answer.confirmation }
          : null,
      );
    } catch (e) {
      setError(
        control.signal.aborted
          ? "Ожидание отменено. Уже принятые сервером действия могли завершиться; проверь данные перед новым запросом."
          : webErrorMessage(e),
      );
      setRetry(input);
    } finally {
      controller.current = null;
      setBusy(false);
    }
  }
  async function send() {
    const value = text.trim();
    if (!value || busy) return;
    const messages: WebAiMessage[] = [
      ...history.slice(-10),
      { role: "user" as const, text: value },
    ].map((message) => ({
      role: message.role,
      text: message.text.slice(0, 2000),
    }));
    setHistory((old) => [...old, { role: "user", text: value }]);
    setText("");
    setPending(null);
    await request({
      messages,
      date,
      requestId: crypto.randomUUID(),
      ...(previousModelId.current
        ? { previousModelId: previousModelId.current }
        : {}),
    });
  }
  return (
    <SectionPanel title="LifeOS AI">
      <p className="mb-4 text-sm leading-relaxed text-zinc-300">
        Помощник использует разрешённые данные LifeOS. Предложения не являются
        выполненными действиями. Изменения требуют отдельного подтверждения.
      </p>
      {!enabled ? (
        <Notice>
          AI сейчас {status?.enabled ? "недоступен" : "выключен"}. Задачи,
          календарь и дневник работают самостоятельно; провайдеры не подменяются
          выдуманными ответами.
        </Notice>
      ) : null}
      <div aria-live="polite" className="space-y-3">
        {history.map((message, i) => (
          <article key={i} className={rowClass}>
            <p className="mb-2 text-xs font-semibold text-cyan-200">
              {message.role === "user" ? "Ты" : providerName(message.provider)}
            </p>
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-200">
              {message.text}
            </p>
            {message.role === "assistant" && message.modelRoute ? (
              <ModelDetails route={message.modelRoute} />
            ) : null}
          </article>
        ))}
      </div>
      {error ? (
        <div className="mt-4">
          <Notice error>{error}</Notice>
        </div>
      ) : null}
      {retry && !busy ? (
        <button
          type="button"
          className={`${buttonClass} mt-3`}
          onClick={() => void request(retry)}
        >
          Повторить тот же запрос
        </button>
      ) : null}
      {pending ? (
        <div className="mt-4 rounded-xl border border-amber-300/30 p-4">
          <p className="text-sm text-amber-100">
            {pending.confirmation.summary}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className={buttonClass}
              disabled={busy}
              onClick={() =>
                void request({
                  ...pending.input,
                  confirmationToken: pending.confirmation.token,
                })
              }
            >
              Подтвердить это действие
            </button>
            <button
              type="button"
              className={buttonClass}
              disabled={busy}
              onClick={() => setPending(null)}
            >
              Отклонить
            </button>
          </div>
        </div>
      ) : null}
      <form
        className="mt-5 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label className="block text-sm text-zinc-300">
          Сообщение
          <textarea
            className={inputClass}
            rows={4}
            maxLength={2000}
            value={text}
            disabled={busy || !enabled}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            className={buttonClass}
            disabled={busy || !enabled || !text.trim()}
          >
            Отправить
          </button>
          {busy ? (
            <button
              type="button"
              className={buttonClass}
              onClick={() => controller.current?.abort()}
            >
              Отменить ожидание
            </button>
          ) : (
            <button
              type="button"
              className={buttonClass}
              onClick={() => {
                setHistory([]);
                previousModelId.current = undefined;
                setPending(null);
                setRetry(null);
                setError(null);
              }}
            >
              Очистить экран
            </button>
          )}
        </div>
      </form>
      <p className="mt-3 text-xs text-zinc-400">
        Переписка не записывается в браузерное хранилище. Не отправляй пароли,
        cookies и ключи доступа.
      </p>
    </SectionPanel>
  );
}
