import {
  BookOpenCheck,
  CalendarDays,
  Calculator,
  GraduationCap,
} from "lucide-react";
import { redirect } from "next/navigation";
import { LmsStatus } from "@/components/LmsStatus";
import { dashboardData, dateTime } from "@/lib/dashboard-data";
import type { WebLmsConnection, WebLmsWork } from "@/lib/lms-contracts";
import { MetricCard } from "@/components/MetricCard";
import { PageHeader } from "@/components/PageHeader";
import { SectionPanel } from "@/components/SectionPanel";
import { lifeosApi } from "@/lib/lifeos-api";
import { GradeTargetWorkspace } from "@/components/workspaces/GradeTargetWorkspace";
import type { StudyWorkspace } from "../../../../tma/src/api/study-types";
import type { GradeEventFeed } from "../../../../../packages/core/src/academic-intelligence.js";
import { AcademicWorkspace } from "@/components/workspaces/AcademicWorkspace";
import type { AcademicSnapshot } from "../../../../tma/src/api/study-concierge";

const dayOrder = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

const dayLabels: Record<string, string> = {
  monday: "Пн",
  tuesday: "Вт",
  wednesday: "Ср",
  thursday: "Чт",
  friday: "Пт",
  saturday: "Сб",
  sunday: "Вс",
};

export default async function StudyPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
} = {}) {
  const requested = (await searchParams) ?? {};
  const requestedCourseId =
    requested.courseId === undefined
      ? null
      : typeof requested.courseId === "string"
        ? requested.courseId
        : "__invalid__";
  const [study, lmsConnection, lmsWork, academic, gradeFeed] =
    await Promise.all([
      lifeosApi<StudyWorkspace>("/api/tma/study"),
      dashboardData<WebLmsConnection>("/api/tma/lms/connection"),
      dashboardData<WebLmsWork>("/api/tma/lms/work"),
      dashboardData<AcademicSnapshot>("/api/tma/study/concierge"),
      dashboardData<GradeEventFeed>("/api/tma/study/grade-events"),
    ]);
  if (!study) redirect("/access");

  const scheduleCount = study.courses.reduce(
    (total, course) => total + course.schedules.length,
    0,
  );
  const calculatorCount = study.courses.filter(
    (course) => course.calculator !== null,
  ).length;

  return (
    <>
      <PageHeader
        kicker={study.timezone}
        summary="Твои курсы, расписание и калькуляторы загружаются из того же LifeOS-профиля, который открыл /web."
        title="Учёба"
      />

      <div className="dashboard-grid">
        <MetricCard
          detail="Активные предметы именно твоего аккаунта."
          icon={GraduationCap}
          label="Предметы"
          tone="violet"
          value={String(study.courses.length)}
        />
        <MetricCard
          detail="Занятия из сохранённого расписания."
          icon={CalendarDays}
          label="Пары"
          value={String(scheduleCount)}
        />
        <MetricCard
          detail="Предметы с настроенной схемой силабуса."
          icon={Calculator}
          label="Калькуляторы"
          tone="amber"
          value={String(calculatorCount)}
        />
        <MetricCard
          detail="Импортированные академические записи и оценки."
          icon={BookOpenCheck}
          label="Записи"
          tone="mint"
          value={String(study.records.length)}
        />
      </div>

      <div className="mt-6">
        <LmsStatus connection={lmsConnection} work={lmsWork} />
      </div>
      <div className="mt-6">
        <GradeTargetWorkspace
          initial={study}
          initialFeed={gradeFeed}
          initialCourseId={requestedCourseId}
          initialTab={
            requested.studyTab === "calculator" ? "calculator" : "grades"
          }
        />
      </div>
      <div id="academic-calendar" className="mt-6 scroll-mt-24">
        <AcademicWorkspace initial={academic} />
      </div>
      <p className="mt-4 text-sm text-amber-100">
        Сохранённое расписание; проверь актуальность в AITU.
      </p>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {study.courses.map((course) => {
          const schedules = [...course.schedules].sort((left, right) => {
            const dayDelta =
              dayOrder.indexOf(left.dayOfWeek.toLowerCase()) -
              dayOrder.indexOf(right.dayOfWeek.toLowerCase());
            return dayDelta || left.startTime.localeCompare(right.startTime);
          });

          return (
            <SectionPanel
              key={course.id}
              eyebrow={course.code || "Course"}
              title={course.title}
            >
              {schedules.length ? (
                <div className="space-y-2">
                  {schedules.map((slot) => (
                    <div
                      key={slot.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-sm"
                    >
                      <div>
                        <span className="font-medium text-zinc-200">
                          {dayLabels[slot.dayOfWeek.toLowerCase()] ??
                            slot.dayOfWeek}
                          {" · "}
                          {slot.startTime.slice(0, 5)}–
                          {slot.endTime.slice(0, 5)}
                        </span>
                        <p className="mt-0.5 text-xs text-zinc-400">
                          {[slot.sessionType, slot.instructorName]
                            .filter(Boolean)
                            .join(" · ") || "Занятие"}
                        </p>
                      </div>
                      <span className="text-xs text-zinc-400">
                        {slot.room || "—"}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-zinc-400">
                  Расписание ещё не добавлено.
                </p>
              )}
              <div className="mt-3 text-xs text-zinc-400">
                {course.calculator
                  ? "Калькулятор силабуса настроен"
                  : "Калькулятор пока не настроен"}
              </div>
            </SectionPanel>
          );
        })}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div id="study-work" className="scroll-mt-24">
          <SectionPanel title="Работы и дедлайны">
            <div className="space-y-3">
              {lmsWork?.items.length ? (
                lmsWork.items.slice(0, 40).map((item, index) => (
                  <article
                    key={index}
                    className="rounded-lg border border-white/[0.08] p-3"
                  >
                    <p className="break-words text-sm font-semibold text-zinc-100">
                      {item.title}
                    </p>
                    <p className="mt-1 break-words text-xs text-zinc-400">
                      {item.courseTitle} · {item.category} ·{" "}
                      {item.submissionStatus}
                    </p>
                    <p className="mt-2 text-xs text-zinc-300">
                      Дедлайн: {dateTime(item.dueAt)}
                      {item.score !== null
                        ? ` · оценка ${item.score}${item.maxScore === null ? "" : `/${item.maxScore}`}`
                        : ""}
                    </p>
                  </article>
                ))
              ) : (
                <p className="text-sm text-zinc-400">
                  Нет доступных подтверждённых работ. Это не означает отсутствие
                  заданий в LMS.
                </p>
              )}
            </div>
          </SectionPanel>
        </div>
      </div>
      {!study.courses.length && (
        <div className="mt-6">
          <SectionPanel eyebrow="Study" title="Пока нет предметов">
            <p className="text-sm text-zinc-400">
              Импортируй учебные данные через LifeOS — после этого они появятся
              здесь только у твоего аккаунта.
            </p>
          </SectionPanel>
        </div>
      )}
    </>
  );
}
