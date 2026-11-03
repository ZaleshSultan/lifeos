import { useState } from "react";
import { useAiRouterSettings } from "../api/ai-router";
import { ApiError, apiErrorMessage } from "../api/errors";
import { AiRouterSettings } from "./AiRouterSettings";

function routerErrorMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 409)
    return "Настройки изменились в другой сессии. Обнови сохранённую версию перед повторным сохранением.";
  if (error instanceof ApiError && error.status === 400)
    return "Проверь выбранные модели и ограничения. Настройки не сохранены.";
  return apiErrorMessage(error);
}

function Content({
  onDirtyChange,
}: {
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { query, save } = useAiRouterSettings();
  return (
    <AiRouterSettings
      snapshot={query.data ?? null}
      loading={query.isPending}
      error={query.error ? routerErrorMessage(query.error) : null}
      onReload={async () => {
        const result = await query.refetch();
        if (result.error) throw result.error;
        return result.data ?? null;
      }}
      onSave={save}
      errorMessage={routerErrorMessage}
      onDirtyChange={onDirtyChange}
    />
  );
}

export function AiRouterSettingsPanel({
  onDirtyChange,
}: {
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [opened, setOpened] = useState(false);
  return (
    <details
      className="rounded-xl border border-white/10 bg-white/[0.03] p-4"
      onToggle={(event) => {
        if (event.currentTarget.open) setOpened(true);
      }}
    >
      <summary className="min-h-11 cursor-pointer py-2 font-semibold text-cyan-200">
        Настройки моделей и приватности AI
      </summary>
      {opened ? <Content onDirtyChange={onDirtyChange} /> : null}
    </details>
  );
}
