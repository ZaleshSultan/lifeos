import { PageHeader } from "@/components/PageHeader";
import { IdealHumanJournal } from "@/components/workspaces/IdealHumanJournal";
import { dashboardData } from "@/lib/dashboard-data";
import type { IdealHumanDay } from "../../../../../packages/core/src/ideal-human.js";
export default async function IdealHumanPage() {
  const days = await dashboardData<IdealHumanDay[]>(
    "/api/tma/ideal-human/days",
  );
  return (
    <>
      <PageHeader
        kicker="3 ноября — 2 декабря 2026"
        title="Ideal Human"
        summary="Один дневник для Telegram и web. Гибкие планы, реальные наблюдения и честные итоги."
      />
      <IdealHumanJournal initial={days} />
    </>
  );
}
