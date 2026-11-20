import { ChevronRight } from "lucide-react";
import type { AcademicRecord } from "../../api/types";
import type { StudyWorkspaceCourse } from "../../api/study";
import { courseGradeCards, gradeLetter } from "./grade-cards";
import { studyScoreLabel } from "./model";
import "./grades.css";

function points(item: { score: number | null; max: number | null }) {
  const score = studyScoreLabel(item.score);
  return item.score !== null && item.max !== null && item.max !== 100
    ? score + " / " + studyScoreLabel(item.max)
    : score;
}

function BreakdownRows({
  rows,
}: {
  rows: ReturnType<typeof courseGradeCards>[number]["rows"];
}) {
  return (
    <dl>
      {rows.map((row, i) => (
        <div key={row.id + ":" + i}>
          <dt>
            {row.title}
            {row.demo && <small>Демонстрационные данные</small>}
          </dt>
          <dd>
            {row.score === null ? (
              <abbr title="Ещё не оценено" aria-label="Ещё не оценено">
                —
              </abbr>
            ) : (
              points(row)
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function StudyGrades({
  records,
  courses = [],
}: {
  records: AcademicRecord[];
  courses?: StudyWorkspaceCourse[];
}) {
  const cards = courseGradeCards(records, courses);
  return (
    <section className="grades-list" aria-label="Оценки из Moodle">
      {!cards.length && (
        <p className="grades-empty">
          Оценок пока нет. Подключи Moodle и обнови данные.
        </p>
      )}
      {cards.map((card, index) => {
        const letter = gradeLetter(card.total);
        const chips = [
          {
            label: "Посещ.",
            full: "Посещаемость",
            value:
              card.attendance === null
                ? null
                : studyScoreLabel(card.attendance) + "%",
            attendance: card.attendance,
          },
          { label: "MT", full: "Midterm", value: card.mid && points(card.mid) },
          { label: "ET", full: "Endterm", value: card.end && points(card.end) },
          {
            label: "Final",
            full: "Final",
            value: card.final && points(card.final),
          },
        ].filter((chip) => chip.value !== null);
        return (
          <article className="grade-card" key={card.key}>
            <header className="grade-head">
              <div>
                <h2>{card.name}</h2>
                {card.subtitle && (
                  <p className="grade-instructor">{card.subtitle}</p>
                )}
              </div>
              <div className="grade-result" aria-label="Итог курса">
                <strong title="Итог Moodle">
                  {card.total ? points(card.total) : "—"}
                </strong>
                {letter && <span title="По шкале AITU">{letter}</span>}
              </div>
            </header>
            {chips.length > 0 && (
              <ul className="grade-chips">
                {chips.map((chip) => (
                  <li
                    key={chip.label}
                    aria-label={chip.full + ": " + chip.value}
                    title={chip.full}
                    data-attendance={
                      chip.attendance == null
                        ? undefined
                        : chip.attendance === 100
                          ? "full"
                          : "partial"
                    }
                  >
                    {chip.label} {chip.value}
                  </li>
                ))}
              </ul>
            )}
            <details className="grade-details" open={index === 0}>
              <summary>
                <ChevronRight size={16} aria-hidden="true" />
                Детализация ({card.rows.length})
              </summary>
              <BreakdownRows rows={card.rows} />
            </details>
            {card.assignments.length > 0 && (
              <details className="grade-details grade-assignments">
                <summary>
                  <ChevronRight size={16} aria-hidden="true" />
                  Задания ({card.assignments.length})
                </summary>
                <BreakdownRows rows={card.assignments} />
              </details>
            )}
          </article>
        );
      })}
    </section>
  );
}
