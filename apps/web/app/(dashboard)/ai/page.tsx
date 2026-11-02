import { PageHeader } from "@/components/PageHeader";
import { AiWorkspace } from "@/components/workspaces/AiWorkspace";
import { dashboardData, localDate } from "@/lib/dashboard-data";
import type { WebAiStatus } from "@/lib/dashboard-contracts";
export default async function AiPage() {
  return (
    <>
      <PageHeader
        kicker="Данные и решения"
        title="AI помощник"
        summary="Фактический контекст, ограниченные инструменты и явное подтверждение изменений."
      />
      <AiWorkspace
        status={await dashboardData<WebAiStatus>("/api/tma/ai/status")}
        date={localDate()}
      />
    </>
  );
}
