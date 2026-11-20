import { useMemo } from "react";
import { selectScholarshipCourseRecords } from "../../../../../packages/core/src/scholarship.js";
import type { StudyWorkspaceCourse } from "../../api/study";
import type { AcademicRecord } from "../../api/types";
import { studyScoreLabel } from "../study/model";
import {
  courseGradeCards,
  gradePointsLabel,
  gradePercent,
} from "../study/grade-cards";

type GradeCard = ReturnType<typeof courseGradeCards>[number];

function PublishedRows({ rows }: { rows: GradeCard["rows"] }) {
  return (
    <dl className="saved-grade-rows">
      {rows.map((row) => (
        <div key={JSON.stringify([row.id, row.score, row.max])}>
          <dt>{row.title}</dt>
          <dd>{gradePointsLabel(row)}</dd>
        </div>
      ))}
    </dl>
  );
}

function SavedGradeGroup({
  card,
  showTotalInHeader,
}: {
  card: GradeCard;
  showTotalInHeader: boolean;
}) {
  const slots = [
    ["Мидтерм", card.mid],
    ["Эндтерм", card.end],
    ["Финал", card.final],
    ["Итог курса", card.total],
  ] as const;
  const summary = slots.filter(([, item]) => item && item.score !== null);
  const registerSummary = showTotalInHeader
    ? summary.filter(([, item]) => item !== card.total)
    : summary;
  const shown = new Set(summary.map(([, item]) => item!.id));
  const unique = new Set<string>();
  const rows = [...card.assignments, ...card.rows].filter((row) => {
    if (row.score === null || row.demo || shown.has(row.id)) return false;
    const key = JSON.stringify([row.id, row.score, row.max]);
    if (unique.has(key)) return false;
    unique.add(key);
    return true;
  });
  if (!rows.length && !summary.length) return null;
  return (
    <>
      {registerSummary.length > 0 && (
        <div>
          <p className="syllabus-caption">Ведомость Moodle</p>
          <dl className="saved-grade-register" aria-label="Ведомость Moodle">
            {registerSummary.map(([label, item]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{gradePointsLabel(item!)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {rows.length > 0 && <PublishedRows rows={rows.slice(0, 3)} />}
      {rows.length > 3 && (
        <details>
          <summary>Ещё оценки ({rows.length - 3})</summary>
          <PublishedRows rows={rows.slice(3)} />
        </details>
      )}
    </>
  );
}

export function SavedCourseGrades({
  course,
  records,
  completedScore,
}: {
  course: StudyWorkspaceCourse;
  records: AcademicRecord[];
  completedScore: number | null;
}) {
  const { cards, skipped } = useMemo(() => {
    const { own, skipped } = selectScholarshipCourseRecords(course, records);
    const cards = courseGradeCards(own, [course]).filter((card) =>
      [card.total, ...card.rows, ...card.assignments].some(
        (row) => row && row.score !== null && !row.demo,
      ),
    );
    return { cards, skipped };
  }, [course, records]);
  const totals = cards.flatMap((card) =>
    card.total && gradePercent(card.total) !== null ? [card.total] : [],
  );
  const official = totals.length === 1 ? totals[0] : null;
  const resultLabel = official ? "Итог по предмету" : "Итог по силабусу";
  return (
    <section
      className="syllabus-card saved-grades"
      aria-label="Полученные оценки"
    >
      {completedScore !== null && (
        <div className="saved-grade-result">
          <p>{resultLabel}</p>
          <output aria-label={resultLabel}>
            {official
              ? gradePointsLabel(official)
              : studyScoreLabel(completedScore)}
          </output>
          <span>Все работы оценены</span>
        </div>
      )}
      <h2>Полученные оценки</h2>
      {cards.map((card) => (
        <SavedGradeGroup
          card={card}
          key={card.key}
          showTotalInHeader={
            completedScore !== null && !!official && official === card.total
          }
        />
      ))}
      {skipped && (
        <p className="syllabus-caption">
          У одноимённых групп разные ведомости. Показаны только оценки,
          привязанные к этому предмету.
        </p>
      )}
      {!cards.length && !skipped && (
        <p className="syllabus-caption">
          В журнале пока нет выставленных оценок по этому предмету.
        </p>
      )}
    </section>
  );
}
