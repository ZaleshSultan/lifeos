import { useCaptureInbox, captureApiError } from "../api/capture";
import { ErrorPanel, LoadingPanel } from "../components/AsyncState";
import { CaptureInbox } from "../components/capture/CaptureInbox";
import type { CaptureDestination } from "../components/capture/transport";
import type { ScreenId } from "../types";

const destinations: Record<CaptureDestination, ScreenId> = {
  priorities: "home",
  water: "daily-life",
  workout: "workout",
  "ideal-human": "ideal-human",
};
export function CaptureScreen({
  onDirtyChange,
  onNavigate,
}: {
  onDirtyChange: (dirty: boolean) => void;
  onNavigate: (screen: ScreenId) => void;
}) {
  const { capabilities, history, transport } = useCaptureInbox();
  if (capabilities.isPending || history.isPending)
    return <LoadingPanel title="Загружаем приватные входящие…" />;
  if (capabilities.isError || history.isError)
    return (
      <ErrorPanel
        title="Входящие пока недоступны"
        detail={captureApiError(capabilities.error ?? history.error)}
        onRetry={() => {
          void capabilities.refetch();
          void history.refetch();
        }}
      />
    );
  const requested =
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("captureId");
  const initialCaptureId =
    requested &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      requested,
    )
      ? requested
      : null;
  return (
    <CaptureInbox
      transport={transport}
      initialCapabilities={capabilities.data}
      initialHistory={history.data}
      initialCaptureId={initialCaptureId}
      errorMessage={captureApiError}
      onDirtyChange={onDirtyChange}
      onNavigate={(destination) => onNavigate(destinations[destination])}
    />
  );
}
