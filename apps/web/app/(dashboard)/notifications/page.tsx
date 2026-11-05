import { NotificationPreferences } from "@/components/workspaces/NotificationPreferences";
import type { DailyLifePreferences } from "../../../../../packages/core/src/daily-life.js";
import { PageHeader } from "@/components/PageHeader";
import { NotificationsWorkspace } from "@/components/workspaces/NotificationsWorkspace";
import { dashboardData } from "@/lib/dashboard-data";
import type { RemindersResponse } from "../../../../tma/src/api/types";
import type { GradeEventFeed } from "../../../../../packages/core/src/academic-intelligence.js";
import { AcademicSettingsWorkspace } from "@/components/workspaces/AcademicSettingsWorkspace";
export default async function NotificationsPage() {
  return (
    <>
      <PageHeader
        kicker="Telegram"
        title="Напоминания"
        summary="Выбирай время и текст. Создание здесь означает согласие на доставку в Telegram."
      />
      <NotificationsWorkspace
        initial={await dashboardData<RemindersResponse>("/api/tma/reminders")}
      />
      <div className="mt-6">
        <AcademicSettingsWorkspace
          initial={await dashboardData<GradeEventFeed>(
            "/api/tma/study/grade-events",
          )}
        />
      </div>
      <div className="mt-6">
        <NotificationPreferences
          initial={await dashboardData<DailyLifePreferences>(
            "/api/tma/daily-life/preferences",
          )}
        />
      </div>
    </>
  );
}
