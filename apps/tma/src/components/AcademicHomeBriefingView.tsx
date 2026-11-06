import { GraduationCap } from "lucide-react";
import type {
  buildAcademicHome,
  AcademicHomeRow,
} from "../../../../packages/core/src/academic-home.js";

export function AcademicHomeBriefingView({
  view,
  onOpen,
}: {
  view: ReturnType<typeof buildAcademicHome>;
  onOpen: (row: AcademicHomeRow) => void;
}) {
  return (
    <section
      aria-label="Академический обзор дня"
      className="min-w-0 rounded-xl border border-white/[0.08] bg-white/[0.03] p-4"
    >
      <h2 className="flex items-center gap-2 font-semibold text-white">
        <GraduationCap
          className="h-5 w-5 shrink-0 text-cyan-300"
          aria-hidden="true"
        />
        Учёба сегодня
      </h2>
      <p className="mt-2 text-xs leading-relaxed text-zinc-400">
        Изменения за 24 часа, дедлайны на неделю и подтверждённые экзамены.
        Просмотр не отправляет уведомлений.
      </p>
      {view.warnings.map((warning) => (
        <p
          key={warning}
          role="status"
          className="mt-3 break-words rounded-lg border border-amber-300/20 p-3 text-sm text-amber-100"
        >
          {warning}
        </p>
      ))}
      {(
        [
          ["Оценки", view.grades],
          ["Сроки сдачи", view.deadlines],
          ["Экзамены", view.exams],
          ["Нужен план", view.risks],
        ] as const
      ).map(([title, rows]) =>
        rows.length ? (
          <div key={title} className="mt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
              {title}
            </h3>
            <ul className="mt-2 space-y-2">
              {rows.slice(0, 1).map((row) => (
                <li key={row.key}>
                  <button
                    type="button"
                    onClick={() => onOpen(row)}
                    className="min-h-11 w-full min-w-0 rounded-lg border border-white/[0.08] p-3 text-left hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
                  >
                    <span className="block break-words text-sm font-medium text-white">
                      {row.title}
                    </span>
                    <span className="mt-1 block break-words text-xs leading-relaxed text-zinc-300">
                      {row.detail}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {rows.length > 1 ? (
              <details className="mt-2">
                <summary className="min-h-11 cursor-pointer py-3 text-xs text-cyan-200">
                  Ещё {rows.length - 1}
                </summary>
                <ul className="space-y-2">
                  {rows.slice(1).map((row) => (
                    <li key={row.key}>
                      <button
                        type="button"
                        onClick={() => onOpen(row)}
                        className="min-h-11 w-full min-w-0 rounded-lg border border-white/[0.08] p-3 text-left text-sm text-zinc-200 hover:bg-white/[0.04]"
                      >
                        <span className="block break-words font-medium">
                          {row.title}
                        </span>
                        <span className="mt-1 block break-words text-xs">
                          {row.detail}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        ) : null,
      )}
      {view.fresh &&
      !view.historyPending &&
      !view.grades.length &&
      !view.deadlines.length &&
      !view.exams.length &&
      !view.risks.length ? (
        <p className="mt-3 text-sm text-zinc-400">
          В текущей выборке нет недавних изменений и ближайших подтверждённых
          сроков. Полный контекст — в Учёбе.
        </p>
      ) : null}
      {view.lastSuccessfulSyncAt ? (
        <p className="mt-3 break-words text-xs text-zinc-400">
          Успешная синхронизация Moodle: {view.lastSuccessfulSyncAt}
        </p>
      ) : null}
    </section>
  );
}
