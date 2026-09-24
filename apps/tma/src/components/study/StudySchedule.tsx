import { CalendarDays, Clock3, MapPin, UserRound } from "lucide-react";
import { useState } from "react";
import type { StudyWeekday, StudyWorkspaceCourse } from "../../api/study";
import { cx } from "../../lib/styles";
import {
  studyDateLabel,
  studyDaySessions,
  studyDays,
  studyWeekday,
} from "./model";

const sessionLabels: Record<string, string> = {
  lecture: "Лекция",
  practice: "Практика",
  practical: "Практика",
  seminar: "Семинар",
  lab: "Лабораторная",
  laboratory: "Лабораторная",
};

export function StudySchedule({
  courses,
  timezone,
}: {
  courses: StudyWorkspaceCourse[];
  timezone: string;
}) {
  const today = studyWeekday(timezone);
  const [selected, setSelected] = useState<StudyWeekday | null>(null);
  const day = selected ?? today;
  const sessions = studyDaySessions(courses, day);
  const total = courses.reduce(
    (count, course) => count + course.schedules.length,
    0,
  );
  return (
    <section className="space-y-4" aria-label="Расписание занятий">
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
        <div className="flex items-center gap-2 text-white">
          <CalendarDays className="h-5 w-5 text-cyan-400" aria-hidden="true" />
          <h2 className="font-semibold">Учебная неделя</h2>
        </div>
        <p className="mt-2 text-sm text-zinc-400">
          Повторяющееся расписание · {total} занятий
        </p>
        <p className="mt-1 break-words text-xs text-zinc-400">
          Время: {timezone}. Даты экзаменов сюда не включены.
        </p>
        <div
          className="mt-4 grid grid-cols-4 gap-2"
          role="group"
          aria-label="День недели"
        >
          {studyDays.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-label={`${item.label}${item.id === today ? ", сегодня" : ""}`}
              aria-pressed={day === item.id}
              onClick={() => setSelected(item.id)}
              className={cx(
                "min-h-11 min-w-11 rounded-lg border px-1 py-2 text-sm font-semibold transition-colors active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400",
                day === item.id
                  ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-200"
                  : "border-white/[0.08] bg-white/[0.03] text-zinc-300 hover:bg-white/[0.08]",
              )}
            >
              <span className="block">{item.short}</span>
              {item.id === today ? (
                <span className="block text-[10px] font-normal">Сегодня</span>
              ) : null}
            </button>
          ))}
        </div>
      </div>
      <h3 className="text-sm font-semibold text-zinc-300">
        {studyDays.find((item) => item.id === day)?.label}
      </h3>
      {!sessions.length ? (
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 text-sm text-zinc-400">
          {total
            ? "На этот день занятия не указаны. Выбери другой день недели."
            : "Расписание пока не добавлено. После импорта учебного плана обнови этот экран."}
        </div>
      ) : (
        <ol className="space-y-3">
          {sessions.map(({ course, schedule }) => (
            <li
              key={schedule.id}
              className="min-w-0 rounded-xl border border-white/[0.08] bg-white/[0.03] p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2 text-sm font-semibold tabular-nums text-cyan-200">
                  <Clock3 className="h-4 w-4" aria-hidden="true" />
                  {schedule.startTime.slice(0, 5)}–
                  {schedule.endTime.slice(0, 5)}
                </span>
                {schedule.sessionType ? (
                  <span className="break-words text-xs text-zinc-400">
                    {sessionLabels[schedule.sessionType] ??
                      schedule.sessionType}
                  </span>
                ) : null}
              </div>
              <h4 className="mt-3 break-words text-base font-semibold text-white">
                {course.title}
              </h4>
              <p className="mt-1 break-words text-xs text-zinc-400">
                {course.code}
              </p>
              <div className="mt-3 space-y-2 text-sm text-zinc-300">
                <p className="flex items-start gap-2">
                  <MapPin
                    className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400"
                    aria-hidden="true"
                  />
                  <span className="min-w-0 break-words">
                    {schedule.room
                      ? `Аудитория ${schedule.room}`
                      : "Аудитория не указана"}
                  </span>
                </p>
                {schedule.instructorName ? (
                  <p className="flex items-start gap-2">
                    <UserRound
                      className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400"
                      aria-hidden="true"
                    />
                    <span className="min-w-0 break-words">
                      {schedule.instructorName}
                    </span>
                  </p>
                ) : null}
              </div>
              <p className="mt-3 text-xs text-zinc-400">
                {course.startsOn || course.endsOn
                  ? `Период курса: ${course.startsOn ? studyDateLabel(course.startsOn) : "начало не указано"} — ${course.endsOn ? studyDateLabel(course.endsOn) : "окончание не указано"}`
                  : "Даты действия расписания не указаны"}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
