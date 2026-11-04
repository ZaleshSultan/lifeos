"use client";
import { useEffect, useRef, useState } from "react";
import {
  AI_ROUTER_PROVIDERS,
  AI_ROUTER_TIERS,
  defaultAiRouterSettings,
  parseAiRouterSettings,
  type AiRouterDataCategory,
  type AiRouterProviderId,
  type AiRouterSettings,
  type AiRouterTier,
} from "../../../../packages/core/src/ai-model-router.js";
import type { AiRouterSettingsSnapshot } from "../../../../packages/core/src/ai-router-settings-view.js";
import { parseRouterUsdMicros, routerUsdInput } from "../api/ai-router-input";

const inputClass =
  "mt-1 min-h-11 w-full min-w-0 rounded-lg border border-white/15 bg-zinc-950 px-3 py-2 text-sm text-white disabled:opacity-50";
const buttonClass =
  "min-h-11 rounded-lg border border-white/15 px-3 py-2 text-sm text-cyan-200 disabled:opacity-40";
const providers: Record<AiRouterProviderId, string> = {
  gemini: "Gemini API",
  openrouter: "OpenRouter",
  openai: "OpenAI API",
  anthropic: "Anthropic API",
  chatgpt_plan: "ChatGPT plan",
};
const tiers: Record<AiRouterTier, string> = {
  deterministic: "Без модели",
  fast: "Быстрые задачи",
  balanced: "Повседневные задачи",
  advanced: "Сложные задачи",
  vision: "Фото и изображения",
  voice: "Аудио",
};
const categories: Record<AiRouterDataCategory, string> = {
  general: "Обычный текст",
  health: "Здоровье",
  finance: "Финансы",
  university: "Университет",
};
const statusLabels: Record<
  AiRouterSettingsSnapshot["providers"][number]["status"],
  string
> = {
  not_configured: "Не настроен",
  configured_unverified: "Настроен; доступ не проверен",
  permission_required: "Нужно отдельное разрешение",
  disabled: "Выключен",
  available: "Доступен",
  expired: "Доступ истёк",
};
const toggle = <T extends string>(
  values: T[],
  value: T,
  checked: boolean,
): T[] =>
  checked
    ? [...new Set([...values, value])]
    : values.filter((item) => item !== value);
const usd = (value: number | null) =>
  value === null ? "не указан" : `$${routerUsdInput(value)}`;

export interface AiRouterSettingsProps {
  snapshot: AiRouterSettingsSnapshot | null;
  loading?: boolean;
  error?: string | null;
  onReload: () => Promise<AiRouterSettingsSnapshot | null>;
  onSave: (
    settings: AiRouterSettings,
    expectedRevision: number,
  ) => Promise<AiRouterSettingsSnapshot>;
  errorMessage: (error: unknown) => string;
  onDirtyChange?: (dirty: boolean) => void;
}

/** Shared form; callers supply authenticated transport for web or Telegram. */
export function AiRouterSettings({
  snapshot,
  loading = false,
  error,
  onReload,
  onSave,
  errorMessage,
  onDirtyChange,
}: AiRouterSettingsProps) {
  const [draft, setDraft] = useState<AiRouterSettings>(
    () => snapshot?.settings ?? defaultAiRouterSettings(),
  );
  const [loaded, setLoaded] = useState(snapshot);
  const [requestUsd, setRequestUsd] = useState(() =>
    routerUsdInput(draft.spending.maxRequestCostMicros),
  );
  const [dailyUsd, setDailyUsd] = useState(() =>
    routerUsdInput(draft.spending.maxDailyCostMicros),
  );
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const inflight = useRef(false);
  useEffect(() => setReady(true), []);
  useEffect(() => {
    if (snapshot && !dirty && !inflight.current) {
      setLoaded(snapshot);
      setDraft(snapshot.settings);
      setRequestUsd(
        routerUsdInput(snapshot.settings.spending.maxRequestCostMicros),
      );
      setDailyUsd(
        routerUsdInput(snapshot.settings.spending.maxDailyCostMicros),
      );
    }
  }, [snapshot, dirty]);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);
  const change = <K extends keyof AiRouterSettings>(
    key: K,
    value: AiRouterSettings[K],
  ) => {
    if (!ready || inflight.current) return;
    setDraft((previous) => ({ ...previous, [key]: value }));
    setDirty(true);
    setMessage(null);
  };
  function apply(next: AiRouterSettingsSnapshot) {
    setLoaded(next);
    setDraft(next.settings);
    setRequestUsd(routerUsdInput(next.settings.spending.maxRequestCostMicros));
    setDailyUsd(routerUsdInput(next.settings.spending.maxDailyCostMicros));
    setDirty(false);
  }
  async function save() {
    if (!ready || !loaded || inflight.current) return;
    let settings: AiRouterSettings;
    try {
      settings = parseAiRouterSettings({
        ...draft,
        spending: {
          ...draft.spending,
          maxRequestCostMicros: parseRouterUsdMicros(requestUsd),
          maxDailyCostMicros: parseRouterUsdMicros(dailyUsd),
        },
      });
      const limits = loaded.operatorLimits;
      if (
        (limits.maxRequestCostMicros !== null &&
          settings.spending.maxRequestCostMicros >
            limits.maxRequestCostMicros) ||
        (limits.maxDailyCostMicros !== null &&
          settings.spending.maxDailyCostMicros > limits.maxDailyCostMicros)
      ) {
        setMessage(
          "Лимит превышает ограничение сервера. Уменьши сумму перед сохранением.",
        );
        return;
      }
    } catch {
      setMessage(
        "Проверь модели и лимиты: сумма в USD, до шести знаков после запятой.",
      );
      return;
    }
    inflight.current = true;
    setBusy(true);
    setMessage(null);
    try {
      apply(await onSave(settings, loaded.revision));
      setMessage(
        "Настройки сохранены. Сохранение не запускает AI-запрос или проверку провайдера.",
      );
    } catch (reason) {
      setMessage(
        errorMessage(reason) + " Несохранённые изменения остались на экране.",
      );
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  }
  async function reload() {
    if (
      !ready ||
      inflight.current ||
      (dirty &&
        !window.confirm(
          "Отменить несохранённые настройки AI и загрузить сохранённые?",
        ))
    )
      return;
    inflight.current = true;
    setBusy(true);
    try {
      const result = await onReload();
      if (result) {
        apply(result);
        setMessage(null);
      }
    } catch (reason) {
      setMessage(errorMessage(reason));
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  }
  const catalog = loaded?.models ?? [];
  return (
    <section
      aria-label="AI Model Router settings"
      className="min-w-0 space-y-4 text-sm text-zinc-300"
    >
      <p className="leading-relaxed">
        Детерминированные функции LifeOS работают без ключей и AI. Сначала
        разреши провайдера и категории данных. Платный запрос также требует
        твоего разрешения и разрешения сервера.
      </p>
      {loaded?.operatorLimits.routerEnabled === false ? (
        <p className="rounded-lg border border-amber-300/20 p-3 text-amber-200">
          Новый маршрутизатор пока выключен на сервере. Здесь можно подготовить
          настройки; существующие функции Gemini не переключаются автоматически.
        </p>
      ) : null}
      <button
        type="button"
        className={buttonClass}
        disabled={!ready || busy || loading}
        onClick={() => void reload()}
      >
        Обновить настройки AI
      </button>
      {loading && !loaded ? <p role="status">Загружаем настройки AI…</p> : null}
      {error ? (
        <p role="alert" className="break-words text-rose-200">
          {error}
        </p>
      ) : null}
      {message ? (
        <p
          role="status"
          className="break-words rounded-lg border border-white/10 p-3"
        >
          {message}
        </p>
      ) : null}
      {!loaded && !loading ? (
        <p>
          Настройки пока недоступны. Обнови перед изменением; согласие не
          предполагается.
        </p>
      ) : null}
      {loaded ? (
        <div className="grid min-w-0 gap-2 sm:grid-cols-2">
          {loaded.providers.map((provider) => (
            <div
              key={provider.id}
              className="min-w-0 rounded-lg border border-white/10 p-3"
            >
              <p className="font-semibold text-white">
                {providers[provider.id]}
              </p>
              <p className="mt-1 break-words text-xs text-zinc-400">
                {statusLabels[provider.status]}
                {provider.verified ? " · Проверено" : " · Без сетевой проверки"}
              </p>
              {provider.credentialLabels.length ? (
                <p className="mt-1 break-words text-xs text-zinc-400">
                  Профили ключей: {provider.credentialLabels.join(", ")}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      <p className="text-xs leading-relaxed text-zinc-400">
        Ключи настраивает владелец на сервере; браузер их не получает. Один ключ
        OpenRouter открывает несколько моделей. Дополнительные ключи разделяют
        проекты или учёт расходов, а не обходят лимиты.
      </p>
      {loaded ? (
        <details className="min-w-0 rounded-lg border border-white/10 p-3">
          <summary className="min-h-11 cursor-pointer py-2 text-cyan-200">
            Последние запросы через маршрутизатор
          </summary>
          {loaded.recentExecutions === undefined ? (
            <p className="text-xs text-zinc-400">
              История пока недоступна. Обнови настройки позже.
            </p>
          ) : loaded.recentExecutions.length === 0 ? (
            <p className="text-xs text-zinc-400">
              Запросов через новый маршрутизатор пока нет. Просмотр настроек не
              вызывает модель.
            </p>
          ) : (
            <ul className="space-y-2">
              {loaded.recentExecutions.map((entry, index) => (
                <li
                  key={`${entry.createdAt}-${index}`}
                  className="min-w-0 break-words rounded-lg border border-white/10 p-3 text-xs"
                >
                  <p className="font-semibold text-white">
                    {
                      {
                        chat: "Чат",
                        classification: "Классификация",
                        finance: "Финансы",
                        meal_photo: "Фото еды",
                        morning_briefing: "Утренний обзор",
                        evening_review: "Вечерний обзор",
                        documentary: "Документальный проект",
                        agata: "AGATA",
                      }[entry.feature]
                    }{" "}
                    · {providers[entry.routing.provider]}
                  </p>
                  <p className="mt-1">
                    Модель: {entry.routing.model} · Профиль:{" "}
                    {entry.routing.credentialLabel}
                  </p>
                  <p className="mt-1">
                    {
                      {
                        reserved: "Бюджет зарезервирован; итог не записан",
                        completed: "Завершён",
                        failed: "Не выполнен",
                        cancelled: "Отменён",
                        timed_out: "Время истекло",
                      }[entry.state]
                    }{" "}
                    · Попыток: {entry.routing.attempts} ·{" "}
                    {entry.routing.fallback
                      ? "Был запасной маршрут"
                      : "Без запасного маршрута"}
                  </p>
                  <p className="mt-1">
                    {entry.routing.billing === "chatgpt_plan"
                      ? "Использование плана ChatGPT; стоимость API не применяется."
                      : `Оценка до запроса: ${usd(entry.estimatedCostMicros)} · ${{ provider_reported: "Стоимость по данным провайдера", rate_estimate: "Расчёт по токенам и тарифу", unknown: "Неизвестный расход" }[entry.routing.costSource]}: ${usd(entry.reportedCostMicros)}`}
                  </p>
                  <time
                    className="mt-1 block text-zinc-400"
                    dateTime={entry.createdAt}
                  >
                    {new Intl.DateTimeFormat("ru-RU", {
                      timeZone: "Asia/Almaty",
                      dateStyle: "short",
                      timeStyle: "short",
                    }).format(new Date(entry.createdAt))}{" "}
                    · Asia/Almaty
                  </time>
                </li>
              ))}
            </ul>
          )}
        </details>
      ) : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <fieldset
          disabled={!ready || !loaded || busy || loading}
          className="min-w-0 space-y-5"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block min-w-0">
              Выбор модели
              <select
                aria-label="Выбор модели"
                className={inputClass}
                value={draft.mode}
                onChange={(event) =>
                  change("mode", event.target.value as AiRouterSettings["mode"])
                }
              >
                <option value="auto">Автоматически по задаче</option>
                <option value="manual">Вручную</option>
              </select>
            </label>
            <label className="block min-w-0">
              Ручная модель
              <select
                aria-label="Ручная модель"
                className={inputClass}
                value={draft.manualModelId ?? ""}
                disabled={draft.mode !== "manual"}
                onChange={(event) =>
                  change("manualModelId", event.target.value || null)
                }
              >
                <option value="">Выбери модель</option>
                {draft.manualModelId &&
                !catalog.some((model) => model.id === draft.manualModelId) ? (
                  <option value={draft.manualModelId}>
                    Недоступная сохранённая модель: {draft.manualModelId}
                  </option>
                ) : null}
                {catalog.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label} · {providers[model.provider]} · {model.status}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <fieldset className="space-y-2">
            <legend className="font-semibold text-white">
              Разрешённые провайдеры
            </legend>
            <div className="grid gap-1 sm:grid-cols-2">
              {AI_ROUTER_PROVIDERS.map((id) => (
                <label key={id} className="flex min-h-11 items-center gap-3">
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-cyan-300"
                    checked={draft.allowedProviders.includes(id)}
                    onChange={(event) =>
                      change(
                        "allowedProviders",
                        toggle(
                          draft.allowedProviders,
                          id,
                          event.target.checked,
                        ),
                      )
                    }
                  />
                  {providers[id]}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="space-y-3">
            <legend className="font-semibold text-white">
              Уровни и порядок моделей
            </legend>
            <p className="text-xs text-zinc-400">
              Первый подходящий вариант имеет приоритет. Сохранённая беседа
              сохраняет модель, пока требования, доступ и разрешения это
              позволяют. В ручном режиме недоступная модель не заменяется молча.
            </p>
            {AI_ROUTER_TIERS.map((tier) => (
              <div
                key={tier}
                className="min-w-0 rounded-lg border border-white/10 p-3"
              >
                <label className="flex min-h-11 items-center gap-3">
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-cyan-300"
                    checked={
                      tier === "deterministic" ||
                      draft.allowedTiers.includes(tier)
                    }
                    disabled={tier === "deterministic"}
                    onChange={(event) =>
                      change(
                        "allowedTiers",
                        toggle(draft.allowedTiers, tier, event.target.checked),
                      )
                    }
                  />
                  {tiers[tier]}
                </label>
                {tier !== "deterministic" ? (
                  <>
                    <ol className="space-y-2">
                      {draft.tierModels[tier].map((id, index, list) => {
                        const model = catalog.find((item) => item.id === id);
                        return (
                          <li
                            key={id}
                            className="flex min-w-0 flex-wrap items-center gap-2"
                          >
                            <span className="min-w-0 flex-1 break-words text-xs">
                              {index + 1}. {model?.label ?? id}
                            </span>
                            <div className="flex gap-1">
                              <button
                                className={buttonClass}
                                type="button"
                                aria-label={`Поднять ${id} в ${tier}`}
                                disabled={index === 0}
                                onClick={() => {
                                  const next = [...list];
                                  [next[index - 1], next[index]] = [
                                    next[index],
                                    next[index - 1],
                                  ];
                                  change("tierModels", {
                                    ...draft.tierModels,
                                    [tier]: next,
                                  });
                                }}
                              >
                                ↑
                              </button>
                              <button
                                className={buttonClass}
                                type="button"
                                aria-label={`Опустить ${id} в ${tier}`}
                                disabled={index === list.length - 1}
                                onClick={() => {
                                  const next = [...list];
                                  [next[index], next[index + 1]] = [
                                    next[index + 1],
                                    next[index],
                                  ];
                                  change("tierModels", {
                                    ...draft.tierModels,
                                    [tier]: next,
                                  });
                                }}
                              >
                                ↓
                              </button>
                              <button
                                className={buttonClass}
                                type="button"
                                aria-label={`Убрать ${id} из ${tier}`}
                                onClick={() =>
                                  change("tierModels", {
                                    ...draft.tierModels,
                                    [tier]: list.filter((item) => item !== id),
                                  })
                                }
                              >
                                Убрать
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                    <select
                      aria-label={`Добавить модель: ${tier}`}
                      className={inputClass}
                      value=""
                      disabled={draft.tierModels[tier].length >= 12}
                      onChange={(event) => {
                        if (event.target.value)
                          change("tierModels", {
                            ...draft.tierModels,
                            [tier]: [
                              ...draft.tierModels[tier],
                              event.target.value,
                            ],
                          });
                      }}
                    >
                      <option value="">Добавить модель в очередь</option>
                      {catalog
                        .filter(
                          (model) =>
                            model.tiers.includes(tier) &&
                            !draft.tierModels[tier].includes(model.id),
                        )
                        .map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.label} · {providers[model.provider]}
                          </option>
                        ))}
                    </select>
                  </>
                ) : null}
              </div>
            ))}
            {!catalog.length ? (
              <p className="text-xs text-amber-200">
                На сервере ещё нет разрешённого каталога моделей.
                Детерминированные функции доступны.
              </p>
            ) : (
              <details>
                <summary className="min-h-11 cursor-pointer py-3 text-cyan-200">
                  Возможности и оценочные цены
                </summary>
                <ul className="space-y-2">
                  {catalog.map((model) => (
                    <li
                      key={model.id}
                      className="min-w-0 break-words rounded-lg border border-white/10 p-3 text-xs"
                    >
                      <strong>{model.label}</strong> ·{" "}
                      {providers[model.provider]}
                      <p className="mt-1">
                        {model.capabilities.join(", ")} ·{" "}
                        {model.billing === "chatgpt_plan"
                          ? "Лимиты плана ChatGPT; не API-биллинг"
                          : model.tiers.includes("voice") &&
                              model.capabilities.includes("audio")
                            ? typeof model.audioCostMicrosPerMinute === "number"
                              ? `Аудио: ${usd(model.audioCostMicrosPerMinute)} за минуту; оценочный резерв за 120 секунд: ${usd(model.audioCostMicrosPerMinute * 2)}. Системный резерв может быть выше.`
                              : "Цена аудио не указана; выполнение ограничено"
                            : `USD за 1000 токенов: вход ${usd(model.inputCostMicrosPer1k)}, выход ${usd(model.outputCostMicrosPer1k)}`}
                      </p>
                      <p className="mt-1">
                        {model.metadataVerified
                          ? "Метаданные модели проверены"
                          : "Метаданные не подтверждены; выполнение ограничено"}
                      </p>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </fieldset>
          <fieldset className="space-y-3">
            <legend className="font-semibold text-white">
              Разрешение передачи данных
            </legend>
            <p className="text-xs text-zinc-400">
              Каждое разрешение относится к указанному провайдеру. Смена модели
              не расширяет доступ к данным и не отменяет подтверждения действий
              LifeOS.
            </p>
            {(Object.keys(categories) as AiRouterDataCategory[]).map(
              (category) => (
                <details
                  key={category}
                  className="rounded-lg border border-white/10 px-3"
                >
                  <summary className="min-h-11 cursor-pointer py-3">
                    {categories[category]} · {draft.privacy[category].length}{" "}
                    разрешений
                  </summary>
                  <div className="pb-2">
                    {AI_ROUTER_PROVIDERS.map((provider) => (
                      <label
                        key={provider}
                        className="flex min-h-11 items-center gap-3"
                      >
                        <input
                          type="checkbox"
                          className="h-5 w-5 accent-cyan-300"
                          aria-label={`Разрешить ${categories[category]} для ${providers[provider]}`}
                          checked={draft.privacy[category].includes(provider)}
                          onChange={(event) =>
                            change("privacy", {
                              ...draft.privacy,
                              [category]: toggle(
                                draft.privacy[category],
                                provider,
                                event.target.checked,
                              ),
                            })
                          }
                        />
                        {providers[provider]}
                      </label>
                    ))}
                  </div>
                </details>
              ),
            )}
          </fieldset>
          <fieldset className="space-y-3">
            <legend className="font-semibold text-white">Расходы</legend>
            <label className="flex min-h-11 items-start gap-3">
              <input
                type="checkbox"
                className="mt-1 h-5 w-5 shrink-0 accent-cyan-300"
                checked={draft.spending.paidCallsAuthorized}
                onChange={(event) =>
                  change("spending", {
                    ...draft.spending,
                    paidCallsAuthorized: event.target.checked,
                  })
                }
              />
              <span>
                Я разрешаю платные запросы в пределах сохранённых лимитов.
              </span>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block min-w-0">
                Максимум на запрос, USD
                <input
                  aria-label="Максимум на запрос, USD"
                  type="text"
                  inputMode="decimal"
                  className={inputClass}
                  value={requestUsd}
                  maxLength={14}
                  onChange={(event) => {
                    setRequestUsd(event.target.value);
                    setDirty(true);
                    setMessage(null);
                  }}
                />
              </label>
              <label className="block min-w-0">
                Максимум за день, USD
                <input
                  aria-label="Максимум за день, USD"
                  type="text"
                  inputMode="decimal"
                  className={inputClass}
                  value={dailyUsd}
                  maxLength={14}
                  onChange={(event) => {
                    setDailyUsd(event.target.value);
                    setDirty(true);
                    setMessage(null);
                  }}
                />
              </label>
            </div>
            <p className="text-xs text-zinc-400">
              Ноль запрещает расходы. Ограничения сервера: запрос{" "}
              {usd(loaded?.operatorLimits.maxRequestCostMicros ?? null)}, день{" "}
              {usd(loaded?.operatorLimits.maxDailyCostMicros ?? null)}.{" "}
              {loaded?.operatorLimits.paidRequestsEnabled
                ? "Платные запросы разрешены оператором; твои ограничения всё равно действуют."
                : "Платные запросы сейчас отключены на сервере."}{" "}
              Оценка стоимости не заменяет лимит биллинга провайдера.
            </p>
          </fieldset>
          <fieldset className="space-y-3">
            <legend className="font-semibold text-white">
              Безопасный запасной маршрут
            </legend>
            <label className="flex min-h-11 items-center gap-3">
              <input
                type="checkbox"
                className="h-5 w-5 accent-cyan-300"
                checked={draft.fallback.enabled}
                onChange={(event) =>
                  change("fallback", {
                    ...draft.fallback,
                    enabled: event.target.checked,
                  })
                }
              />
              Разрешить ограниченные запасные попытки
            </label>
            <label className="flex min-h-11 items-center gap-3">
              <input
                type="checkbox"
                className="h-5 w-5 accent-cyan-300"
                checked={draft.fallback.allowProviderChange}
                disabled={!draft.fallback.enabled}
                onChange={(event) =>
                  change("fallback", {
                    ...draft.fallback,
                    allowProviderChange: event.target.checked,
                  })
                }
              />
              Разрешить смену провайдера в пределах моих разрешений
            </label>
            <label className="block">
              Максимум попыток
              <select
                aria-label="Максимум попыток"
                className={inputClass}
                value={draft.fallback.maxAttempts}
                disabled={!draft.fallback.enabled}
                onChange={(event) =>
                  change("fallback", {
                    ...draft.fallback,
                    maxAttempts: Number(event.target.value),
                  })
                }
              >
                {[1, 2, 3].map((count) => (
                  <option key={count} value={count}>
                    {count}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-xs text-zinc-400">
              Неудача или лимит не разрешают другой способ оплаты.
              Неподтверждённый результат и исчерпанный бюджет не запускают
              бесконечные повторы.
            </p>
          </fieldset>
          <div className="rounded-lg border border-white/10 p-3 text-xs leading-relaxed">
            <p className="font-semibold text-white">
              ChatGPT: вход и разрешение плана — разные действия
            </p>
            <p className="mt-2">
              Подготовлен официальный локальный вход с твоим отдельным согласием
              в браузере.{" "}
              {loaded?.chatgptPlan.identityConnected
                ? "Личность подключена."
                : "Учётная запись ещё не подключена."}{" "}
              {loaded?.chatgptPlan.planUsageAuthorized
                ? "Разрешение использовать план получено."
                : "Разрешение использовать план не получено; запросы по подписке не отправляются."}{" "}
              Это не обычные OpenAI API credits и не доступ к перепискам.
            </p>
            {loaded?.chatgptPlan.manageUsageUrl ===
            "https://chatgpt.com/settings/usage" ? (
              <a
                className="mt-2 inline-flex min-h-11 items-center text-cyan-200 underline"
                href="https://chatgpt.com/settings/usage"
                target="_blank"
                rel="noopener noreferrer"
              >
                Управлять использованием плана ChatGPT
              </a>
            ) : null}
            <p className="mt-2">
              Подписка Claude Code остаётся для нативного инструмента
              разработки. Для LifeOS допустим только отдельный Anthropic
              API-ключ.
            </p>
          </div>
          <button
            type="submit"
            className={`${buttonClass} w-full bg-cyan-300/10 font-semibold`}
            disabled={!ready || !loaded || busy || !dirty}
          >
            {busy ? "Сохраняем…" : "Сохранить настройки AI"}
          </button>
          {dirty ? (
            <p className="text-xs text-amber-200">
              Есть несохранённые изменения.
            </p>
          ) : null}
        </fieldset>
      </form>
    </section>
  );
}
