"use client";
import { useState } from "react";
import type { GradeEventFeed } from "../../../../packages/core/src/academic-intelligence.js";
import { AcademicNotificationSettings } from "../../../tma/src/components/study/AcademicNotificationSettings";
import { academicIntelligenceTransport } from "../../../tma/src/api/academic-intelligence-transport";
import { webRequest } from "@/lib/web-client";
import { useUnsavedGuard } from "@/components/WorkspaceUI";

export function AcademicSettingsWorkspace({
  initial,
}: {
  initial: GradeEventFeed | null;
}) {
  const [feed, setFeed] = useState(initial);
  const [state, setState] = useState({
    dirty: false,
    saving: false,
    retained: false,
  });
  useUnsavedGuard(state.dirty || state.saving, state.retained && !state.saving);
  const transport = academicIntelligenceTransport(webRequest);
  if (!feed)
    return (
      <p
        role="status"
        className="rounded-xl border border-amber-300/20 p-4 text-sm text-amber-100"
      >
        Академические предпочтения недоступны. Существующие настройки не
        изменены; обнови страницу.
      </p>
    );
  return (
    <AcademicNotificationSettings
      preferences={feed.preferences}
      onStateChange={setState}
      deliveryEnabled={feed.deliveryEnabled === true}
      onSave={async (draft, expected) => {
        const result = await transport.preferences(draft, expected);
        setFeed(result);
        return result.preferences;
      }}
    />
  );
}
