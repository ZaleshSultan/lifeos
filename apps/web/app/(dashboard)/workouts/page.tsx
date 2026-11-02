import { PageHeader } from "@/components/PageHeader";
import { WorkoutWorkspace } from "@/components/workspaces/WorkoutWorkspace";
import { dashboardData } from "@/lib/dashboard-data";
import type { WebWorkout, WebWorkoutHistory } from "@/lib/dashboard-contracts";
import type { WorkoutProgram } from "../../../../../packages/core/src/workout.js";
export default async function WorkoutsPage() {
  const [current, history, program] = await Promise.all([
    dashboardData<WebWorkout>("/api/tma/workout/current"),
    dashboardData<WebWorkoutHistory[]>("/api/tma/workout/history"),
    dashboardData<WorkoutProgram>("/api/tma/workout/program"),
  ]);
  return (
    <>
      <PageHeader
        kicker="Underground GYM"
        title="Тренировки"
        summary="Та же программа, подходы и история, что в Telegram. Нагрузка и самочувствие важнее идеальных цифр."
      />
      <WorkoutWorkspace initial={current} history={history} program={program} />
    </>
  );
}
