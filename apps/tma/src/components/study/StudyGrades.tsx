import { BookOpen } from "lucide-react";
import type { AcademicRecord } from "../../api/types";
import type { StudyWorkspaceCourse } from "../../api/study-types";
import type {
  GradePolicyReview,
  GradeTargetLmsSource,
} from "../../../../../packages/core/src/grade-target.js";
import { CourseGradeTargetCard } from "./CourseGradeTargetCard";
import {
  courseGradeTarget,
  studyGradeScope,
  studyRawGradeLabel,
} from "./grade-target-model";
import type { GradeChangeEvent } from "../../../../../packages/core/src/academic-intelligence.js";
import { CourseGradeHistory } from "./CourseGradeHistory";

export function StudyGrades({
  records,
  courses = [],
  reviews = {},
  onAnalyze,
  lms,
  selectedCourseId,
  onSelectCourse,
  events,
  historyTruncated,
}: {
  records: AcademicRecord[];
  courses?: StudyWorkspaceCourse[];
  reviews?: Record<string, GradePolicyReview>;
  onAnalyze?: (courseId: string) => void;
  lms?: GradeTargetLmsSource;
  selectedCourseId?: string | null;
  onSelectCourse?: (courseId: string | null) => void;
  events?: GradeChangeEvent[];
  historyTruncated?: boolean;
}) {
  const scope = studyGradeScope(courses, records, selectedCourseId);
  const groups = new Map<string, AcademicRecord[]>();
  for (const record of scope.records) {
    const items = groups.get(record.courseTitle) ?? [];
    items.push(record);
    groups.set(record.courseTitle, items);
  }
  return (
    <section className="space-y-3" aria-label="Оценки из Moodle">
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
        <h2 className="flex items-center gap-2 font-semibold text-white">
          <BookOpen className="h-5 w-5 text-cyan-400" aria-hidden="true" />
          Оценки из Moodle
        </h2>
        <p className="mt-2 text-sm text-zinc-400">
          {scope.records.length} записей · {groups.size} курсов
        </p>
        <p className="mt-2 text-xs leading-relaxed text-zinc-400">
          Здесь показаны последние синхронизированные данные. Задание без оценки
          не считается нулём. Значения калькулятора сохраняются отдельно.
        </p>
      </div>
      {onSelectCourse ? (
        <label className="block text-sm text-zinc-300">
          Курс для оценок
          <select
            className="mt-2 min-h-11 w-full min-w-0 rounded-lg border border-white/10 bg-graphite-950 px-3 text-base text-white"
            value={
              scope.unavailable ? "__unavailable__" : (scope.selected?.id ?? "")
            }
            onChange={(event) => onSelectCourse(event.target.value || null)}
          >
            {scope.unavailable ? (
              <option value="__unavailable__" disabled>
                Запрошенный курс недоступен
              </option>
            ) : null}
            <option value="">Все мои курсы</option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.title}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {scope.unavailable ? (
        <p
          role="status"
          className="rounded-xl border border-amber-400/20 p-4 text-sm text-amber-200"
        >
          Запрошенный курс недоступен. Выбери свой курс или открой все мои
          курсы.
        </p>
      ) : null}
      {scope.courses.map((course) => (
        <CourseGradeTargetCard
          key={course.id}
          title={course.title}
          sourceRef={
            reviews[course.id]?.sourceRef ??
            course.calculator?.definition.sourceName
          }
          reviewedAt={reviews[course.id]?.reviewedAt}
          result={courseGradeTarget(
            course,
            records,
            reviews[course.id],
            new Date().toISOString(),
            lms,
          )}
          onAnalyze={onAnalyze ? () => onAnalyze(course.id) : undefined}
        />
      ))}
      {scope.selected && events ? (
        <CourseGradeHistory
          events={events}
          courseId={scope.selected.id}
          title={scope.selected.title}
          truncated={historyTruncated}
        />
      ) : null}
      {!scope.unavailable && !scope.records.length ? (
        <p className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 text-sm text-zinc-400">
          Оценок пока нет. Подключи Moodle и запусти синхронизацию, затем обнови
          экран.
        </p>
      ) : null}
      {[...groups].map(([title, items]) => (
        <details
          key={title}
          className="rounded-xl border border-white/[0.08] bg-white/[0.03]"
        >
          <summary className="min-h-11 cursor-pointer break-words rounded-xl p-4 text-sm font-semibold text-white hover:bg-white/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400">
            {title}{" "}
            <span className="font-normal text-zinc-400">({items.length})</span>
          </summary>
          <ul className="divide-y divide-white/[0.06] px-4 pb-2">
            {items.map((record) => (
              <li key={record.id} className="space-y-1 py-3">
                <p className="break-words text-sm text-zinc-300">
                  {record.title}
                </p>
                <p className="text-sm font-semibold tabular-nums text-white">
                  {record.rawJson?._grade_visibility_unknown === true &&
                  record.score !== null
                    ? "Последняя известная: "
                    : ""}
                  {studyRawGradeLabel(record)}
                </p>
                {record.rawJson?._grade_visibility_unknown === true ? (
                  <p className="text-xs text-amber-200">
                    Текущая оценка скрыта или недоступна. Последнее известное
                    значение не включается в фактический прогноз.
                  </p>
                ) : null}
                <p className="text-[11px] text-zinc-500">
                  Moodle · наблюдение:{" "}
                  {Number.isFinite(Date.parse(record.updatedAt))
                    ? record.updatedAt
                        .replace("T", " ")
                        .replace(".000Z", " UTC")
                    : "дата неизвестна"}
                </p>
                {record.rawJson?._is_mocked === true ? (
                  <p className="text-xs text-amber-300">
                    Демонстрационные данные
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ))}
    </section>
  );
}
