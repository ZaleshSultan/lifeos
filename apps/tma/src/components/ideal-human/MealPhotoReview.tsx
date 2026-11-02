"use client";
import { useEffect, useRef, useState } from "react";
import type { IdealHumanMeal } from "../../../../../packages/core/src/ideal-human.js";
import { buttonClass, inputClass, panelClass } from "./Fields";
function Notice({
  children,
  error = false,
}: {
  children: React.ReactNode;
  error?: boolean;
}) {
  return (
    <div
      role={error ? "alert" : "status"}
      className={`rounded-lg border p-3 text-sm leading-relaxed ${error ? "border-rose-400/25 bg-rose-400/[0.05] text-rose-100" : "border-white/[0.08] bg-white/[0.02] text-zinc-300"}`}
    >
      {children}
    </div>
  );
}
interface FoodItem {
  label: string;
  portion: string | null;
  caloriesKcal: number | null;
  proteinG: number | null;
  fatG: number | null;
  carbsG: number | null;
}
interface FoodDraft {
  draftId: string;
  date?: string;
  expiresAt: string;
  items: FoodItem[];
  uncertainty: string[];
  source: "gemini";
  estimated: true;
  requiresReview: true;
}
async function prepareImage(file: File): Promise<string> {
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    file.size > 12 * 1024 * 1024
  )
    throw new Error("Выбери JPEG, PNG или WebP до 12 МБ.");
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    if (img.width * img.height > 60_000_000)
      throw new Error("Слишком большое изображение.");
    const ratio = Math.min(1, 1280 / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * ratio));
    canvas.height = Math.max(1, Math.round(img.height * ratio));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Не удалось подготовить фото.");
    context.drawImage(img, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL("image/jpeg", 0.75).split(",")[1];
    if (!data || data.length > 700_000)
      throw new Error("Фото слишком велико. Выбери уменьшенную копию.");
    return data;
  } finally {
    URL.revokeObjectURL(url);
  }
}
export function MealPhotoReview({
  disabled,
  onConfirm,
  requestFn,
  initialDraftId,
  errorMessage = () =>
    "Фотоанализ временно недоступен. Проверь соединение и повтори попытку.",
  onDirtyChange,
}: {
  disabled: boolean;
  initialDraftId?: string;
  requestFn: <T>(resource: string, options?: RequestInit) => Promise<T>;
  errorMessage?: (error: unknown) => string;
  onDirtyChange?: (dirty: boolean) => void;
  onConfirm: (meals: IdealHumanMeal[], date?: string) => Promise<void>;
}) {
  const [capability, setCapability] = useState<{
    available: boolean;
    requiresConsent: true;
    reason: string | null;
  } | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [draft, setDraft] = useState<FoodDraft | null>(null);
  const [corrected, setCorrected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const inflight = useRef(false);
  const requestId = useRef<string | null>(null);
  const analysisControl = useRef<AbortController | null>(null);
  const dirty = image !== null || draft !== null || busy;
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  useEffect(() => () => analysisControl.current?.abort(), []);
  useEffect(() => {
    const control = new AbortController();
    void requestFn<typeof capability>("nutrition/capabilities", {
      signal: control.signal,
    })
      .then(setCapability)
      .catch(() => {
        if (!control.signal.aborted)
          setCapability({
            available: false,
            requiresConsent: true,
            reason: "unavailable",
          });
      });
    return () => control.abort();
  }, [requestFn]);
  useEffect(() => {
    if (!initialDraftId) return;
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        initialDraftId,
      )
    ) {
      setError("Недействительная ссылка на оценку еды.");
      return;
    }
    const control = new AbortController();
    setBusy(true);
    inflight.current = true;
    setImage(null);
    setConsent(false);
    setDraft(null);
    setError(null);
    void requestFn<FoodDraft>(`nutrition/drafts/${initialDraftId}`, {
      signal: control.signal,
    })
      .then((value) => {
        if (
          !value.requiresReview ||
          !value.estimated ||
          !Array.isArray(value.items)
        )
          throw new Error("invalid_draft");
        setDraft(value);
        setCorrected(false);
      })
      .catch((error) => {
        if (!control.signal.aborted) setError(errorMessage(error));
      })
      .finally(() => {
        if (!control.signal.aborted) {
          setBusy(false);
          inflight.current = false;
        }
      });
    return () => {
      control.abort();
      inflight.current = false;
    };
  }, [initialDraftId, requestFn]);
  async function choose(file: File | undefined) {
    if (!file || inflight.current) return;
    if (draft && !window.confirm("Заменить несохранённую оценку новым фото?"))
      return;
    setBusy(true);
    inflight.current = true;
    setError(null);
    setDraft(null);
    setImage(null);
    setConsent(false);
    setReceipt(null);
    requestId.current = null;
    try {
      setImage(await prepareImage(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось прочитать фото.");
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  }
  async function analyze() {
    if (!image || !consent || inflight.current || !capability?.available)
      return;
    inflight.current = true;
    setBusy(true);
    setError(null);
    requestId.current ??= crypto.randomUUID();
    try {
      const control = new AbortController();
      analysisControl.current = control;
      const result = await requestFn<FoodDraft>("nutrition/analyze", {
        signal: control.signal,
        method: "POST",
        body: JSON.stringify({
          mimeType: "image/jpeg",
          imageBase64: image,
          consentToExternalAnalysis: true,
          requestId: requestId.current,
        }),
      });
      if (
        !result.requiresReview ||
        !result.estimated ||
        !Array.isArray(result.items)
      )
        throw new Error("Invalid draft");
      setDraft(result);
      setCorrected(false);
      setImage(null);
      setConsent(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      analysisControl.current = null;
      inflight.current = false;
      setBusy(false);
    }
  }
  function change(
    index: number,
    key: keyof FoodItem,
    value: string | number | null,
  ) {
    setDraft((old) =>
      old
        ? {
            ...old,
            items: old.items.map((item, i) =>
              i === index ? { ...item, [key]: value } : item,
            ),
          }
        : null,
    );
    setCorrected(true);
  }
  async function confirm() {
    if (!draft || inflight.current) return;
    if (draft.items.some((item) => !item.label.trim())) {
      setError("Добавь названия распознанных блюд.");
      return;
    }
    inflight.current = true;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(
        draft.items.map((item, i) => ({
          id: `photo-${draft.draftId}-${i}`,
          label: item.label.trim(),
          portion: item.portion ?? "",
          caloriesKcal: item.caloriesKcal,
          proteinG: item.proteinG,
          fatG: item.fatG,
          carbsG: item.carbsG,
          mealTime: null,
          analysisSource: "gemini",
          corrected,
          estimated: true,
        })),
        draft.date,
      );
      setDraft(null);
      setReceipt(
        "Подтверждённая оценка сохранена в дневнике. Фото не является точным измерением состава еды.",
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  }
  return (
    <section className={panelClass}>
      <h2 className="mb-3 text-base font-semibold text-white">
        Оценка еды по фото
      </h2>
      <p className="mb-3 text-sm leading-relaxed text-zinc-300">
        Фотография даёт только приблизительную оценку порций и нутриентов.
        Результат не сохраняется без твоего просмотра и подтверждения.
      </p>
      {capability === null ? (
        <p className="text-sm text-zinc-400">Проверяем доступность функции…</p>
      ) : !capability.available ? (
        <Notice>
          Сейчас нет доступного фотоанализа. Ручной дневник питания работает без
          него.
        </Notice>
      ) : (
        <>
          <label className="block text-sm text-zinc-300">
            Фото приёма пищи
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              disabled={disabled || busy}
              className={`${inputClass} py-3`}
              onChange={(e) => void choose(e.target.files?.[0])}
            />
          </label>
          {image ? (
            <div className="mt-4 space-y-3">
              <img
                src={`data:image/jpeg;base64,${image}`}
                alt="Локальный предпросмотр выбранной еды"
                className="max-h-60 w-full rounded-lg object-contain"
              />
              <label className="flex min-h-11 items-center gap-3 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-cyan-300"
                  checked={consent}
                  disabled={disabled || busy}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                Разрешаю отправить это фото Gemini (Google) для оценки еды.
              </label>
              <p className="text-xs text-zinc-400">
                Выбери фото без лиц, документов и приватных экранов. До нажатия
                оно остаётся на устройстве. Доступность провайдера проверяется
                при запросе.
              </p>
              <button
                type="button"
                className={buttonClass}
                disabled={!consent || disabled || busy}
                onClick={() => void analyze()}
              >
                Оценить фото — без сохранения еды
              </button>
              <button
                type="button"
                className={buttonClass}
                disabled={disabled || busy}
                onClick={() => {
                  setImage(null);
                  setConsent(false);
                  requestId.current = null;
                }}
              >
                Убрать фото
              </button>
            </div>
          ) : null}
        </>
      )}
      {busy && analysisControl.current ? (
        <button
          type="button"
          className={buttonClass}
          onClick={() => analysisControl.current?.abort()}
        >
          Отменить ожидание
        </button>
      ) : null}
      {error ? (
        <div className="mt-3">
          <Notice error>{error}</Notice>
        </div>
      ) : null}
      {receipt ? (
        <div className="mt-3">
          <Notice>{receipt}</Notice>
        </div>
      ) : null}
      {draft ? (
        <div className="mt-4 space-y-4">
          <h3 className="text-sm font-semibold text-amber-100">
            Оценка AI: проверь и исправь
          </h3>
          {draft.date ? (
            <p className="text-sm text-zinc-300">
              Дата исходной записи: {draft.date}. Сохраняй в дневник этой даты.
            </p>
          ) : null}
          {draft.uncertainty.map((warning, i) => (
            <p key={i} className="text-xs leading-relaxed text-amber-100">
              {warning}
            </p>
          ))}
          {draft.items.map((item, i) => (
            <fieldset
              key={i}
              disabled={disabled || busy}
              className="min-w-0 space-y-3 rounded-lg border border-white/[0.08] p-3"
            >
              <label className="block text-sm text-zinc-300">
                Блюдо {i + 1}
                <input
                  className={inputClass}
                  maxLength={240}
                  value={item.label}
                  onChange={(e) => change(i, "label", e.target.value)}
                />
              </label>
              <label className="block text-sm text-zinc-300">
                Порция (оценка)
                <input
                  className={inputClass}
                  maxLength={240}
                  value={item.portion ?? ""}
                  onChange={(e) => change(i, "portion", e.target.value || null)}
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                {(
                  [
                    { key: "caloriesKcal", label: "Ккал" },
                    { key: "proteinG", label: "Белок, г" },
                    { key: "fatG", label: "Жиры, г" },
                    { key: "carbsG", label: "Углеводы, г" },
                  ] as const
                ).map((field) => (
                  <label
                    key={field.key}
                    className="min-w-0 text-xs text-zinc-300"
                  >
                    {field.label}
                    <input
                      className={inputClass}
                      type="number"
                      min={0}
                      step={field.key === "caloriesKcal" ? 1 : 0.1}
                      value={item[field.key] ?? ""}
                      onChange={(e) =>
                        change(
                          i,
                          field.key,
                          e.target.value === "" ? null : Number(e.target.value),
                        )
                      }
                    />
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className={buttonClass}
              disabled={disabled || busy}
              onClick={() => void confirm()}
            >
              Подтвердить и сохранить приём пищи
            </button>
            <button
              type="button"
              className={buttonClass}
              disabled={disabled || busy}
              onClick={() => {
                setDraft(null);
                setError(null);
              }}
            >
              Отбросить оценку
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
