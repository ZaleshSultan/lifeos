import { PageHeader } from "@/components/PageHeader";
import { CalendarWorkspace } from "@/components/workspaces/CalendarWorkspace";
import { dashboardData, localDate } from "@/lib/dashboard-data";
import type { WebTodaySummary as TodaySummary } from "@/lib/dashboard-contracts";
export default async function CalendarPage() {
  const date = localDate();
  return (
    <>
      <PageHeader
        kicker="Asia/Almaty"
        title="Календарь"
        summary="Сохранённые события и расчётный план задач с явным различием между фактами и предложениями."
      />
      <CalendarWorkspace
        initial={await dashboardData<TodaySummary>(
          `/api/tma/today?date=${date}`,
        )}
        date={date}
      />
    </>
  );
}
