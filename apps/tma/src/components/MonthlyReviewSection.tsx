"use client";

import { useState } from "react";
import { useGenerateMonthlyReviewMutation, useMonthlyReviewQuery } from "../api/hooks";
import { ErrorPanel } from "./AsyncState";

function MonthReview() {
  const query = useMonthlyReviewQuery();
  const generate = useGenerateMonthlyReviewMutation();
  const latest = query.data?.latest;
  const status = { draft: "Черновик", generated: "Готов", failed: "Ошибка" };
  return (
    <div className="space-y-2 pb-2">
      {query.isLoading ? (
        <p role="status" className="text-sm text-zinc-400">
          Загружаем отчёт…
        </p>
      ) : query.isError ? (
        <ErrorPanel
          title="Не удалось загрузить отчёт"
          onRetry={() => void query.refetch()}
        />
      ) : latest ? (
        <>
          <p className="text-sm font-semibold">
            {latest.reportTitle || latest.periodMonth} · {status[latest.status]}
          </p>
          {latest.reportMarkdown && (
            <p className="whitespace-pre-wrap break-words text-sm text-zinc-400">
              {latest.reportMarkdown}
            </p>
          )}
        </>
      ) : (
        <p className="text-sm text-zinc-400">Отчёта пока нет.</p>
      )}
      {generate.isError && (
        <p role="alert" className="text-sm text-rose-300">
          Не удалось сформировать отчёт. Попробуй ещё раз.
        </p>
      )}
      <button
        type="button"
        disabled={generate.isPending}
        onClick={() => generate.mutate()}
        className="min-h-11 text-sm font-semibold text-[#89aaff]"
      >
        {generate.isPending
          ? "Готовим отчёт…"
          : "Сформировать отчёт за прошлый месяц"}
      </button>
    </div>
  );
}

export function MonthlyReviewSection() {
  const [monthOpen, setMonthOpen] = useState(false);
  return (
    <details onToggle={(event) => setMonthOpen(event.currentTarget.open)}>
      <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">
        Итоги месяца
      </summary>
      {monthOpen && <MonthReview />}
    </details>
  );
}
