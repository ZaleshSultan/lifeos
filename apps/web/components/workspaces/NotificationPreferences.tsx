"use client";
import {
  useDraftState,
  useDraftRetention,
} from "../../../tma/src/lib/retained-draft";
import { useRef, useState } from "react";
import {
  DEFAULT_DAILY_LIFE_PREFERENCES,
  parseDailyLifePreferences,
  type DailyLifePreferences,
} from "../../../../packages/core/src/daily-life.js";
import { SectionPanel } from "@/components/SectionPanel";
import {
  Notice,
  buttonClass,
  inputClass,
  useUnsavedGuard,
} from "@/components/WorkspaceUI";
import { webRequest, webErrorMessage } from "@/lib/web-client";
export function NotificationPreferences({
  initial,
}: {
  initial: DailyLifePreferences | null;
}) {
  const [draft, setDraft] = useDraftState(
    "notification:preferences",
    "draft",
    initial ?? DEFAULT_DAILY_LIFE_PREFERENCES,
  );
  const [dirty, setDirty] = useDraftState(
    "notification:preferences",
    "dirty",
    false,
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(
    initial ? null : "Настройки пока не загружены. Обнови перед изменением.",
  );
  const [available, setAvailable] = useState(initial !== null);
  const inflight = useRef(false);
  const retained = useDraftRetention("notification:preferences", dirty);
  useUnsavedGuard(dirty || busy, retained && !busy);
  function change<K extends keyof DailyLifePreferences>(
    key: K,
    value: DailyLifePreferences[K],
  ) {
    if (inflight.current) return;
    setDraft((previous) => ({ ...previous, [key]: value }));
    setDirty(true);
    setMessage(null);
  }
  async function save() {
    if (inflight.current || !available) return;
    let input: DailyLifePreferences;
    try {
      input = parseDailyLifePreferences(draft);
    } catch {
      setMessage("Проверь местное время в формате ЧЧ:ММ.");
      return;
    }
    inflight.current = true;
    setBusy(true);
    try {
      setDraft(
        await webRequest<DailyLifePreferences>("daily-life/preferences", {
          method: "PUT",
          body: JSON.stringify(input),
        }),
      );
      setDirty(false);
      setMessage(
        "Предпочтения сохранены. Сообщения включены только там, где ты явно разрешил их.",
      );
    } catch (e) {
      setMessage(webErrorMessage(e));
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  }
  async function reload() {
    if (
      inflight.current ||
      (dirty &&
        !window.confirm(
          "Отменить несохранённые настройки и загрузить сохранённые?",
        ))
    )
      return;
    inflight.current = true;
    setBusy(true);
    try {
      setDraft(
        await webRequest<DailyLifePreferences>("daily-life/preferences"),
      );
      setDirty(false);
      setAvailable(true);
      setMessage(null);
    } catch (e) {
      setMessage(webErrorMessage(e));
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  }
  return (
    <SectionPanel
      title="Ежедневные обзоры и тихие часы"
      action={
        <button
          type="button"
          className={buttonClass}
          disabled={busy}
          onClick={() => void reload()}
        >
          Обновить настройки
        </button>
      }
    >
      <p className="mb-4 text-sm leading-relaxed text-zinc-300">
        По умолчанию автоматические сообщения выключены. Часы указаны в
        Asia/Almaty. Включение и сохранение — твоё согласие на доставку в
        Telegram.
      </p>
      {message ? (
        <div className="mb-4">
          <Notice>{message}</Notice>
        </div>
      ) : null}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={busy || !available} className="min-w-0 space-y-4">
          {(
            [
              { key: "morningEnabled", title: "Утренний обзор" },
              { key: "eveningEnabled", title: "Вечерний обзор" },
              {
                key: "hydrationRemindersEnabled",
                title: "Напоминания о воде в разрешённые часы",
              },
              {
                key: "includeHealth",
                title: "Включать записанные данные здоровья в личные обзоры",
              },
              {
                key: "includeFilming",
                title: "Включать необязательные идеи съёмки",
              },
            ] as const
          ).map((item) => (
            <label
              key={item.key}
              className="flex min-h-11 items-center gap-3 text-sm text-zinc-300"
            >
              <input
                type="checkbox"
                className="h-5 w-5 accent-cyan-300"
                checked={draft[item.key]}
                onChange={(e) => change(item.key, e.target.checked)}
              />
              {item.title}
            </label>
          ))}
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                { key: "morningTime", title: "Утреннее время" },
                { key: "eveningTime", title: "Вечернее время" },
                { key: "quietStart", title: "Тихие часы: с" },
                { key: "quietEnd", title: "Тихие часы: до" },
              ] as const
            ).map((item) => (
              <label
                key={item.key}
                className="block min-w-0 text-sm text-zinc-300"
              >
                {item.title}
                <input
                  className={inputClass}
                  type="time"
                  required
                  value={draft[item.key]}
                  onChange={(e) => change(item.key, e.target.value)}
                />
              </label>
            ))}
          </div>
          <button
            type="submit"
            className={buttonClass}
            disabled={busy || !dirty}
          >
            Сохранить предпочтения
          </button>
        </fieldset>
      </form>
    </SectionPanel>
  );
}
