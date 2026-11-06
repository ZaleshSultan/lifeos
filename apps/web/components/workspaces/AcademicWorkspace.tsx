"use client";
import { useDraftRetention } from "../../../tma/src/lib/retained-draft";
import { useMemo, useState } from "react";
import {
  AcademicConcierge,
  type AcademicConciergeTab,
} from "../../../tma/src/components/study/AcademicConcierge";
import {
  academicTransport,
  type AcademicSnapshot,
} from "../../../tma/src/api/study-concierge";
import { useUnsavedGuard } from "@/components/WorkspaceUI";
import { webRequest, webErrorMessage } from "@/lib/web-client";

export function AcademicWorkspace({
  initial,
  initialAcademicTab = "exams",
}: {
  initial: AcademicSnapshot | null;
  initialAcademicTab?: AcademicConciergeTab;
}) {
  const transport = useMemo(() => academicTransport(webRequest), []);
  const [dirty, setDirty] = useState(false);
  const retained = useDraftRetention("academic:workspace", dirty);
  useUnsavedGuard(dirty, retained);
  return (
    <AcademicConcierge
      initial={initial}
      initialTab={initialAcademicTab}
      transport={transport}
      errorMessage={webErrorMessage}
      onDirtyChange={setDirty}
    />
  );
}
