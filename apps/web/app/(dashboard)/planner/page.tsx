import { PageHeader } from "@/components/PageHeader";
import {
  PlannerWorkspace,
  type WebTasks,
} from "@/components/workspaces/PlannerWorkspace";
import { dashboardData } from "@/lib/dashboard-data";
export default async function PlannerPage() {
  return (
    <>
      <PageHeader
        kicker="Мои приоритеты"
        title="Задачи и план"
        summary="Реальные задачи из LifeOS. Изменения сохраняются для web и Telegram."
      />
      <PlannerWorkspace
        initial={await dashboardData<WebTasks>("/api/tma/tasks")}
      />
    </>
  );
}
