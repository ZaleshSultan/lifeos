import { PageHeader } from "@/components/PageHeader";
import { CreatorWorkspace } from "@/components/workspaces/CreatorWorkspace";
import { dashboardData } from "@/lib/dashboard-data";
import type { CreatorCapabilities } from "../../../../../packages/core/src/creator.js";
import type { IdealHumanDay } from "../../../../../packages/core/src/ideal-human.js";
export default async function CreatorPage() {
  const [capabilities, days] = await Promise.all([
    dashboardData<CreatorCapabilities>("/api/tma/creator/capabilities"),
    dashboardData<IdealHumanDay[]>("/api/tma/ideal-human/days"),
  ]);
  return (
    <>
      <PageHeader
        kicker="Документальный проект"
        title="Creator"
        summary="Планы и реальные записи о кадрах. Внешняя аналитика и creator-почта требуют отдельного разрешения."
      />
      <CreatorWorkspace capabilities={capabilities} days={days} />
    </>
  );
}
