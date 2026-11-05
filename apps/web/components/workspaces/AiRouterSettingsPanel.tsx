"use client";
import { useDraftRetention } from "../../../tma/src/lib/retained-draft";
import { useState } from "react";
import type { AiRouterSettingsSnapshot } from "../../../../packages/core/src/ai-router-settings-view.js";
import { AiRouterSettings } from "../../../tma/src/components/AiRouterSettings";
import { SectionPanel } from "@/components/SectionPanel";
import { useUnsavedGuard } from "@/components/WorkspaceUI";
import { WebApiError, webErrorMessage, webRequest } from "@/lib/web-client";

function routerErrorMessage(error: unknown) {
  return error instanceof WebApiError && error.status === 400
    ? "Проверь выбранные модели и ограничения. Настройки не сохранены."
    : webErrorMessage(error);
}

export function AiRouterSettingsPanel({
  initial,
}: {
  initial: AiRouterSettingsSnapshot | null;
}) {
  const [snapshot, setSnapshot] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const retained = useDraftRetention("ai:settings:workspace", dirty);
  useUnsavedGuard(dirty, retained);
  return (
    <SectionPanel eyebrow="AI settings" title="Модели, приватность и расходы">
      <AiRouterSettings
        snapshot={snapshot}
        onDirtyChange={setDirty}
        onReload={async () => {
          const value =
            await webRequest<AiRouterSettingsSnapshot>("ai/router/settings");
          setSnapshot(value);
          return value;
        }}
        onSave={async (settings, expectedRevision) => {
          const value = await webRequest<AiRouterSettingsSnapshot>(
            "ai/router/settings",
            {
              method: "PUT",
              body: JSON.stringify({ settings, expectedRevision }),
            },
          );
          setSnapshot(value);
          return value;
        }}
        errorMessage={routerErrorMessage}
      />
    </SectionPanel>
  );
}
