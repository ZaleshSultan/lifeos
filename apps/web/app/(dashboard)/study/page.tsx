import Link from "next/link";
import { redirect } from "next/navigation";
import { AcademicWorkspace } from "@/components/workspaces/AcademicWorkspace";
import {
  StudyManualCalculator,
  StudyScheduleView,
  StudySyllabusEditor,
} from "@/components/study/StudySections";
import { LmsStatus } from "@/components/LmsStatus";
import { WorkspaceRefresh } from "@/components/WorkspaceRefresh";
import { dashboardData, dateTime } from "@/lib/dashboard-data";
import { lifeosApi } from "@/lib/lifeos-api";
import type { WebLmsConnection, WebLmsWork } from "@/lib/lms-contracts";
import type { StudyWorkspace } from "../../../../tma/src/api/study";
import type { AcademicSnapshot } from "../../../../tma/src/api/study-concierge";
import { StudyCampusMap } from "../../../../tma/src/components/study/StudyCampusMap";
import { StudyGrades } from "../../../../tma/src/components/study/StudyGrades";

const sections = [
  ["grades", "Оценки"],
  ["work", "Задания и LMS"],
  ["schedule", "Расписание"],
  ["concierge", "Экзамены"],
  ["syllabi", "Силабус"],
  ["calculator", "Калькулятор"],
  ["map", "Карта"],
] as const;

async function StudyWork() {
  const [connection, work] = await Promise.all([
    dashboardData<WebLmsConnection>("/api/tma/lms/connection"),
    dashboardData<WebLmsWork>("/api/tma/lms/work"),
  ]);
  return (
    <div className="space-y-4">
      <section className="rounded-[18px] border border-white/[0.08] bg-[#151517] p-4">
        <h2 className="text-lg font-semibold">Работы и дедлайны</h2>
        {!work || !work.items.length ? (
          <p className="mt-2 text-sm text-zinc-400">
            {work
              ? "В сохранённом списке пока нет заданий."
              : "Не удалось загрузить задания."}
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-white/[0.07]">
            {work.items.map((item, index) => (
              <li className="space-y-1 py-3 text-sm" key={index}>
                <p className="break-words font-semibold">{item.title}</p>
                <p className="break-words text-zinc-400">
                  {[item.courseTitle, item.category, item.submissionStatus]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <p className="text-zinc-300">
                  {item.dueAt
                    ? "Срок — " + dateTime(item.dueAt)
                    : "Срок не указан"}
                  {item.score !== null &&
                    " · " +
                      item.score +
                      (item.maxScore === null ? "" : " / " + item.maxScore)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
      <LmsStatus connection={connection} work={work} />
    </div>
  );
}

export default async function StudyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, study] = await Promise.all([
    searchParams,
    lifeosApi<StudyWorkspace>("/api/tma/study"),
  ]);
  if (!study) redirect("/access");
  const tab = sections.find(([id]) => id === params.studyTab)?.[0] ?? "grades";
  const courseId = study.courses.find(
    (course) => course.id === params.courseId,
  )?.id;
  const sectionLink = ([id, name]: (typeof sections)[number]) => (
    <Link
      key={id}
      aria-current={tab === id ? "page" : undefined}
      href={{
        pathname: "/study",
        query: { studyTab: id, ...(courseId && { courseId }) },
      }}
      prefetch={false}
      className={`inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold ${tab === id ? "bg-[#252c40] text-[#adc4ff]" : "text-zinc-400 hover:bg-white/[0.06] hover:text-white"}`}
    >
      {name}
    </Link>
  );
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-[28px] font-bold leading-tight tracking-tight">
          Учёба
        </h1>
        <WorkspaceRefresh label="Обновить учёбу" />
      </header>
      <nav aria-label="Разделы учёбы" className="flex flex-wrap gap-1">
        {sections.slice(0, 5).map(sectionLink)}
        <details className="relative" key={tab}>
          <summary className="inline-flex min-h-11 cursor-pointer items-center rounded-xl px-3 text-sm font-semibold text-zinc-300">
            {tab === "calculator"
              ? "Калькулятор ▾"
              : tab === "map"
                ? "Карта ▾"
                : "Ещё ▾"}
          </summary>
          <div className="absolute right-0 z-10 grid min-w-36 rounded-xl border border-white/10 bg-[#151517] p-1">
            {sections.slice(5).map(sectionLink)}
          </div>
        </details>
      </nav>
      {tab === "map" && <StudyCampusMap />}
      {tab === "calculator" && (
        <StudyManualCalculator initial={study} initialCourseId={courseId} />
      )}
      {tab === "grades" && (
        <StudyGrades courses={study.courses} records={study.records} />
      )}
      {tab === "schedule" && (
        <StudyScheduleView courses={study.courses} timezone={study.timezone} />
      )}
      {tab === "syllabi" && (
        <StudySyllabusEditor initial={study} initialCourseId={courseId} />
      )}
      {tab === "work" && <StudyWork />}
      {tab === "concierge" && (
        <AcademicWorkspace
          initial={await dashboardData<AcademicSnapshot>(
            "/api/tma/study/concierge",
          )}
        />
      )}
    </div>
  );
}
