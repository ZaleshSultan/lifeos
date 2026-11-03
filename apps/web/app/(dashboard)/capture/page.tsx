import { PageHeader } from "@/components/PageHeader";
import { CaptureWorkspace } from "@/components/workspaces/CaptureWorkspace";
import { dashboardData } from "@/lib/dashboard-data";
import type {
  CaptureCapabilities,
  CaptureSearchResult,
} from "../../../../../packages/core/src/universal-capture.js";

export default async function CapturePage({
  searchParams,
}: {
  searchParams: Promise<{ captureId?: string }>;
}) {
  const [capabilities, history, params] = await Promise.all([
    dashboardData<CaptureCapabilities>("/api/tma/captures/capabilities"),
    dashboardData<CaptureSearchResult>("/api/tma/captures"),
    searchParams,
  ]);
  const initialCaptureId =
    typeof params.captureId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      params.captureId,
    )
      ? params.captureId
      : null;
  return (
    <>
      <PageHeader
        kicker="Nighthawk · приватный захват"
        title="Входящие"
        summary="Мысли, ссылки и расшифровки — в одном месте. Сначала просмотр, затем только явно выбранные действия."
      />
      <CaptureWorkspace
        capabilities={capabilities}
        history={history}
        initialCaptureId={initialCaptureId}
      />
    </>
  );
}
