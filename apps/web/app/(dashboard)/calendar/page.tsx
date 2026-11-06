import { PageHeader } from "@/components/PageHeader";
import { CalendarWorkspace } from "@/components/workspaces/CalendarWorkspace";
import { dashboardData, localDate } from "@/lib/dashboard-data";
import type { WebTodaySummary as TodaySummary } from "@/lib/dashboard-contracts";
import { webContextDate } from "@/lib/navigation";
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string | string[] }>;
}) {
  const date = webContextDate((await searchParams).date, localDate());
  return (
    <>
      <PageHeader
        kicker="Asia/Almaty"
        title="Календарь"
        summary="Сохранённые события и расчётный план задач с явным различием между фактами и предложениями."
      />
      <CalendarWorkspace
        key={date}
        initial={await dashboardData<TodaySummary>(
          `/api/tma/today?date=${date}`,
        )}
        date={date}
      />
    </>
  );
}
