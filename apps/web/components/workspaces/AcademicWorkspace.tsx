"use client";
import { useMemo, useState } from "react";
import { AcademicConcierge } from "../../../tma/src/components/study/AcademicConcierge";
import {
  academicTransport,
  type AcademicSnapshot,
} from "../../../tma/src/api/study-concierge";
import { useUnsavedGuard } from "@/components/WorkspaceUI";
import { webRequest, webErrorMessage } from "@/lib/web-client";

export function AcademicWorkspace({
  initial,
}: {
  initial: AcademicSnapshot | null;
}) {
  const transport = useMemo(() => academicTransport(webRequest), []);
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard(dirty);
  return (
    <AcademicConcierge
      initial={initial}
      transport={transport}
      errorMessage={webErrorMessage}
      onDirtyChange={setDirty}
    />
  );
}
