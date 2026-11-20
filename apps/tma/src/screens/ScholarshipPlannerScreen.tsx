import { useMemo, useState } from "react";
import {
  calculateSyllabusMinimum,
  defaultScholarshipConfig,
  scholarshipSyllabusEvidence,
} from "../../../../packages/core/src/scholarship.js";
import { useStudyQuery } from "../api/study";
import { ErrorPanel, LoadingPanel } from "../components/AsyncState";
import { SavedCourseGrades } from "../components/scholarship/SavedCourseGrades";
import { SyllabusWorksheet } from "../components/scholarship/SyllabusWorksheet";

export interface ScholarshipPlannerProps {
  onOpenCalculator: (courseId: string) => void;
  onOpenStudy: () => void;
  onOpenLms: () => void;
}
export function ScholarshipPlannerScreen({
  onOpenStudy,
  onOpenCalculator,
}: ScholarshipPlannerProps) {
  const query = useStudyQuery({ refreshOnOpen: true });
  const [selected, setSelected] = useState("");
  const course =
    query.data?.courses.find((item) => item.id === selected) ??
    query.data?.courses[0];
  const records = query.data?.records;
  const evidence = useMemo(
    () =>
      course && records ? scholarshipSyllabusEvidence(course, records) : null,
    [course, records],
  );
  if (query.isLoading)
    return <LoadingPanel title="Загружаем оценки и силабусы…" />;
  if (!query.data)
    return (
      <ErrorPanel
        title="Не удалось загрузить предметы"
        onRetry={() => void query.refetch()}
      />
    );
  const { courses } = query.data;
  const graded =
    evidence &&
    evidence.rows.length > 0 &&
    evidence.rows.every((row) => row.confirmed !== null);
  const completedScore = graded
    ? calculateSyllabusMinimum(
        evidence,
        course?.scholarship ?? defaultScholarshipConfig(),
      ).earnedFinalPoints
    : null;
  return (
    <div className="syllabus-page">
      <h1>Стипендия</h1>
      {query.isError && (
        <ErrorPanel
          title="Показаны последние загруженные оценки"
          onRetry={() => void query.refetch()}
        />
      )}
      {course ? (
        <>
          <label className="syllabus-select">
            Предмет
            <select
              value={course.id}
              onChange={(event) => setSelected(event.target.value)}
            >
              {courses.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
          <SavedCourseGrades
            key={"grades:" + course.id}
            course={course}
            records={query.data.records}
            completedScore={completedScore}
          />
          {completedScore === null && (
            <SyllabusWorksheet
              key={course.id}
              course={course}
              evidence={evidence}
              onOpenCalculator={() => onOpenCalculator(course.id)}
              onRefresh={() => void query.refetch()}
            />
          )}
        </>
      ) : (
        <div className="syllabus-card">
          <p>Нет активных предметов.</p>
          <button type="button" onClick={onOpenStudy}>
            Открыть учёбу
          </button>
        </div>
      )}
    </div>
  );
}
