import type { GradeChangeEvent } from "../../../../../packages/core/src/academic-intelligence.js";

export function CourseGradeHistory({
  events,
  courseId,
  title,
  truncated = false,
}: {
  events: GradeChangeEvent[];
  courseId: string;
  title: string;
  truncated?: boolean;
}) {
  const own = events.filter((event) => event.courseId === courseId);
  return (
    <section
      className="rounded-xl border border-white/10 p-4"
      aria-label={`История оценок: ${title}`}
    >
      <h3 className="break-words font-semibold text-white">
        Новые оценки и исправления · {title}
      </h3>
      <p className="mt-2 text-xs text-zinc-400">
        История начинается с подключения наблюдения; первичный снимок не
        считается новой оценкой.
      </p>
      {!own.length ? (
        <p className="mt-3 text-sm text-zinc-400">
          Подтверждённых изменений пока нет.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-white/10">
          {own.map((event) => (
            <li
              key={event.id}
              className="break-words py-3 text-sm text-zinc-300"
            >
              <strong>{event.itemTitle}</strong>
              <p className="mt-1 text-xs text-zinc-400">
                {event.kind === "corrected" ? "Исправление" : "Новая оценка"} ·{" "}
                {event.observedAt}
              </p>
              <p>
                {event.kind === "corrected"
                  ? `${event.oldScore ?? "?"}${event.oldMaxScore === null ? " / ?" : ` / ${event.oldMaxScore}`} → `
                  : ""}
                {event.newScore}
                {event.newMaxScore === null
                  ? " / ?"
                  : ` / ${event.newMaxScore}`}
              </p>
            </li>
          ))}
        </ul>
      )}
      {truncated ? (
        <p className="mt-3 text-xs text-amber-200">
          Показана ограниченная история, а не полный журнал LMS.
        </p>
      ) : null}
    </section>
  );
}
