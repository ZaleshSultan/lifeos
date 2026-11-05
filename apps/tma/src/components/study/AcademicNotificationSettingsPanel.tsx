import {
  useAcademicPreferenceSave,
  useGradeEventFeed,
} from "../../api/academic-intelligence";
import { AcademicNotificationSettings } from "./AcademicNotificationSettings";
import { useCallback } from "react";

export function AcademicNotificationSettingsPanel({
  onDirtyChange,
}: {
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const feed = useGradeEventFeed();
  const save = useAcademicPreferenceSave();
  const stateChanged = useCallback(
    (state: { dirty: boolean; saving: boolean }) =>
      onDirtyChange?.(state.dirty || state.saving),
    [onDirtyChange],
  );
  if (feed.isLoading)
    return (
      <p role="status" className="p-4 text-sm text-zinc-300">
        Загрузка академических предпочтений…
      </p>
    );
  if (feed.isError || !feed.data)
    return (
      <div className="rounded-xl border border-amber-300/20 p-4 text-sm text-amber-100">
        <p>
          Академические настройки недоступны. Сохранённые предпочтения не
          изменены.
        </p>
        <button
          type="button"
          className="mt-2 min-h-11 underline"
          onClick={() => void feed.refetch()}
        >
          Обновить настройки
        </button>
      </div>
    );
  return (
    <AcademicNotificationSettings
      preferences={feed.data.preferences}
      deliveryEnabled={feed.data.deliveryEnabled === true}
      onSave={save}
      onStateChange={stateChanged}
    />
  );
}
