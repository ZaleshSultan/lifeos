"use client";
import { useEffect, useRef, useState } from "react";
import type {
  CaptureCapabilities,
  CaptureView,
} from "../../../../../packages/core/src/universal-capture.js";
import { captureButtonClass } from "./ActionEditor";
import { operationIdentity } from "./model";
import type { CaptureExternalInput } from "./transport";

export function CaptureExternalControls({
  capture,
  capabilities,
  disabled,
  onRun,
  onDirtyChange,
}: {
  capture: CaptureView;
  capabilities: CaptureCapabilities;
  disabled: boolean;
  onRun: (input: CaptureExternalInput) => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const model =
    capabilities.externalModel === "configured_unverified" &&
    (capture.inputType !== "voice" || Boolean(capture.transcript?.trim()));
  const speech =
    capture.inputType === "voice" &&
    !capture.transcript?.trim() &&
    capabilities.transcription === "configured_unverified";
  const [mode, setMode] = useState<"model" | "transcription">(
    speech ? "transcription" : "model",
  );
  const [consent, setConsent] = useState(false);
  const [pending, setPending] = useState(false);
  const identity = useRef<{ payload: string; requestId: string } | null>(null);
  const sending = useRef(false);
  useEffect(() => onDirtyChange(consent), [consent, onDirtyChange]);
  if (capture.source === "legacy")
    return (
      <p className="text-xs text-zinc-400">
        Это запись прежней истории. Новые действия из неё не запускаются.
      </p>
    );
  if (!model && !speech)
    return (
      <p className="text-xs leading-relaxed text-zinc-400">
        Автоматическая расшифровка и внешний AI-разбор недоступны. Текст можно
        добавить вручную; правила LifeOS работают без провайдера.
      </p>
    );
  if (capture.actions.some((action) => action.status === "succeeded"))
    return (
      <p className="text-xs leading-relaxed text-zinc-400">
        Часть действий уже сохранена. Оставшиеся предложения можно уточнить
        вручную; новый внешний разбор здесь не запускается.
      </p>
    );
  const selectedMode =
    mode === "transcription" && speech
      ? "transcription"
      : model
        ? "model"
        : "transcription";
  return (
    <section
      aria-label="Отдельное согласие на внешнюю обработку"
      className="space-y-3 rounded-lg border border-amber-300/20 p-3"
    >
      <h3 className="text-sm font-semibold text-amber-100">
        Внешняя обработка — только по твоему выбору
      </h3>
      <p className="text-xs leading-relaxed text-zinc-300">
        Возможность внешней обработки подготовлена, но ещё не проверена. Сервер
        отдельно проверит разрешения провайдера, приватность и расходы. Это
        согласие не меняет твои лимиты.
      </p>
      <fieldset disabled={disabled || pending} className="space-y-3">
        {model && speech ? (
          <div className="flex flex-wrap gap-3">
            {[
              ["model", "Разобрать текст"],
              ["transcription", "Расшифровать голос"],
            ].map(([value, label]) => (
              <label
                key={value}
                className="flex min-h-11 items-center gap-2 text-sm text-zinc-300"
              >
                <input
                  type="radio"
                  name="capture-external-mode"
                  checked={mode === value}
                  onChange={() => {
                    setMode(value as typeof mode);
                    setConsent(false);
                  }}
                />
                {label}
              </label>
            ))}
          </div>
        ) : null}
        <label className="flex min-h-11 items-start gap-3 text-sm leading-relaxed text-zinc-300">
          <input
            type="checkbox"
            className="mt-1 h-5 w-5 shrink-0 accent-amber-300"
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
          />
          {selectedMode === "transcription"
            ? "Разрешаю передать аудио этой записи внешнему провайдеру для одной расшифровки"
            : "Разрешаю передать текст этой записи и разрешённый контекст плана (занятость и сроки) внешнему провайдеру для одного разбора"}
        </label>
        <button
          type="button"
          className={captureButtonClass}
          disabled={disabled || pending || !consent}
          onClick={() => {
            if (sending.current) return;
            sending.current = true;
            const payload: Omit<CaptureExternalInput, "requestId"> = {
              expectedRevision: capture.revision,
              mode: selectedMode,
              confirmed: true as const,
            };
            identity.current = operationIdentity(identity.current, payload);
            setPending(true);
            void onRun({ ...payload, requestId: identity.current.requestId })
              .catch(() => {})
              .finally(() => {
                sending.current = false;
                setPending(false);
              });
          }}
        >
          {selectedMode === "transcription"
            ? "Запросить расшифровку с моим согласием"
            : "Запросить AI-разбор с моим согласием"}
        </button>
      </fieldset>
      {pending ? (
        <p role="status" className="text-xs text-amber-100">
          Ожидаем ответ сервера. Это ещё не готовая расшифровка или разбор.
        </p>
      ) : null}
      <p className="text-xs leading-relaxed text-zinc-400">
        Результат останется черновиком. Действия выполняются только после
        отдельного просмотра и подтверждения. При неясном ответе сначала обнови
        запись.
      </p>
    </section>
  );
}
