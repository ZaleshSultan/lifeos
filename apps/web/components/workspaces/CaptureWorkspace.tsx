"use client";
import { useDraftRetention } from "../../../tma/src/lib/retained-draft";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  CaptureCapabilities,
  CaptureSearchResult,
} from "../../../../packages/core/src/universal-capture.js";
import { CaptureInbox } from "../../../tma/src/components/capture/CaptureInbox";
import { captureTransport } from "../../../tma/src/components/capture/transport";
import { captureErrorMessage } from "../../../tma/src/components/capture/errors";
import { SectionPanel } from "@/components/SectionPanel";
import { useUnsavedGuard } from "@/components/WorkspaceUI";
import { webRequest, webErrorMessage, WebApiError } from "@/lib/web-client";

export function webCaptureError(error: unknown) {
  return error instanceof WebApiError
    ? (captureErrorMessage(error.code, error.status) ?? webErrorMessage(error))
    : webErrorMessage(error);
}
export function CaptureWorkspace({
  capabilities,
  history,
  initialCaptureId,
}: {
  capabilities: CaptureCapabilities | null;
  history: CaptureSearchResult | null;
  initialCaptureId?: string | null;
}) {
  const transport = useMemo(() => captureTransport(webRequest), []);
  const [dirty, setDirty] = useState(false);
  const router = useRouter();
  const retained = useDraftRetention("capture:workspace", dirty);
  useUnsavedGuard(dirty, retained);
  return (
    <SectionPanel title="Входящие и подтверждения" eyebrow="Nighthawk">
      <CaptureInbox
        transport={transport}
        initialCapabilities={capabilities}
        initialHistory={history}
        initialCaptureId={initialCaptureId}
        errorMessage={webCaptureError}
        onDirtyChange={setDirty}
        onNavigate={(destination) => {
          if (
            dirty &&
            !retained &&
            !window.confirm(
              "Есть несохранённые изменения. Открыть другой раздел и отменить их?",
            )
          )
            return;
          const path = {
            priorities: "/today",
            water: "/nutrition",
            workout: "/workouts",
            "ideal-human": "/ideal-human",
          }[destination];
          router.push(path);
        }}
      />
    </SectionPanel>
  );
}
