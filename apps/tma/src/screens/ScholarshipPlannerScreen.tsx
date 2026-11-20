import { useState } from "react";
import { useStudyQuery } from "../api/study";
import { ErrorPanel, LoadingPanel } from "../components/AsyncState";
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
  const query = useStudyQuery();
  const [selected, setSelected] = useState("");
  if (query.isLoading)
    return <LoadingPanel title="Загружаем оценки и силабусы…" />;
  if (!query.data)
    return (
      <ErrorPanel
        title="Не удалось загрузить предметы"
        onRetry={() => void query.refetch()}
      />
    );
  const { courses, records } = query.data;
  const course = courses.find((item) => item.id === selected) ?? courses[0];
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
          <SyllabusWorksheet
            key={course.id}
            course={course}
            records={records}
            onOpenCalculator={() => onOpenCalculator(course.id)}
            onRefresh={() => void query.refetch()}
          />
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
