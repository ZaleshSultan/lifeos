import { calculateScholarshipDashboard } from "../../../../../packages/core/src/scholarship.js";
import { useStudyQuery } from "../../api/study";
import { scholarshipScore as score } from "./model";
export function ScholarshipDailySummary({ onOpen }: { onOpen: () => void }) {
  const query = useStudyQuery();
  if (query.isLoading)
    return (
      <section
        aria-label="Стипендия сегодня"
        className="rounded-xl border border-white/10 p-4 text-sm text-zinc-400"
      >
        Стипендия: загружаем оценки…
      </section>
    );
  if (query.isError || !query.data)
    return (
      <section className="rounded-xl border border-white/10 p-4">
        <p className="text-xs text-amber-200">
          Не удалось обновить риски стипендии.
        </p>
        <button
          type="button"
          className="min-h-11 text-sm text-cyan-200"
          onClick={() => void query.refetch()}
        >
          Повторить
        </button>
      </section>
    );
  const plan = calculateScholarshipDashboard(
    query.data.courses,
    query.data.records,
  );
  if (!plan.courses.length) return null;
  const worst = plan.courses.find((course) => course.included);
  return (
    <section
      aria-label="Стипендия сегодня"
      className="rounded-xl border border-cyan-300/20 bg-cyan-300/[0.035] p-4"
    >
      <h3 className="font-semibold text-white">Стипендия сегодня</h3>
      <p className="mt-2 text-sm text-zinc-300">
        Предметов: {plan.relevantCount} · риск: {plan.atRiskCount} ·
        недостижимый порог: {plan.impossibleCount} · малый запас:{" "}
        {plan.narrowCount} · недостаточно данных: {plan.unknownCount}.
      </p>
      {worst ? (
        <p className="mt-2 break-words text-xs text-zinc-400">
          Первым проверьте: {worst.title}. Реалистичный итог:{" "}
          {score(worst.scenarios?.realistic.finalScore ?? null)}; это сценарий,
          а не гарантия выплаты.
        </p>
      ) : null}
      <button
        type="button"
        className="mt-2 min-h-11 text-sm font-semibold text-cyan-200"
        onClick={onOpen}
      >
        Как сохранить стипендию
      </button>
    </section>
  );
}
