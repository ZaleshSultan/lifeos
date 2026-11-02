import { PageHeader } from "@/components/PageHeader";
import { NutritionWorkspace } from "@/components/workspaces/NutritionWorkspace";
import { dashboardData, localDate } from "@/lib/dashboard-data";
import type { DailyLifeSummary } from "../../../../../packages/core/src/daily-life.js";
import type { IdealHumanDay } from "../../../../../packages/core/src/ideal-human.js";
export default async function NutritionPage() {
  const date = localDate();
  const [summary, days] = await Promise.all([
    dashboardData<DailyLifeSummary>(`/api/tma/daily-life/summary?date=${date}`),
    dashboardData<IdealHumanDay[]>("/api/tma/ideal-human/days"),
  ]);
  return (
    <>
      <PageHeader
        kicker="Питание без давления"
        title="Еда и вода"
        summary="Лёгкие ручные записи с честными оценками. Питание сохраняется в существующем дневнике Ideal Human."
      />
      <NutritionWorkspace summary={summary} days={days} date={date} />
    </>
  );
}
