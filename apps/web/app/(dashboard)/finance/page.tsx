import { Banknote, CircleDollarSign, Landmark, TrendingUp } from "lucide-react";
import { MetricCard } from "@/components/MetricCard";
import { PageHeader } from "@/components/PageHeader";
import { SectionPanel } from "@/components/SectionPanel";
import { dashboardData } from "@/lib/dashboard-data";
import type { FinanceSummary } from "../../../../tma/src/api/types";
export default async function FinancePage() {
  const data = await dashboardData<FinanceSummary>("/api/tma/finance");
  const money = (value: number) =>
    new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency: data?.currency || "KZT",
      maximumFractionDigits: 0,
    }).format(value);
  return (
    <>
      <PageHeader
        kicker="Личный бюджет"
        title="Финансы"
        summary="Фактические операции и бюджеты из того же финансового журнала LifeOS."
      />
      {data ? (
        <>
          <div className="dashboard-grid">
            <MetricCard
              label="Сегодня"
              icon={CircleDollarSign}
              value={money(data.today.amount)}
              detail={`${data.today.count} операций`}
              tone="amber"
            />
            <MetricCard
              label="Неделя"
              icon={Banknote}
              value={money(data.week.amount)}
              detail={`${data.week.count} операций`}
              tone="mint"
            />
            <MetricCard
              label="Месяц"
              icon={Landmark}
              value={money(data.month.amount)}
              detail={`${data.month.count} операций`}
            />
            <MetricCard
              label="Баланс месяца"
              icon={TrendingUp}
              value={money(data.monthlySummary.net)}
              detail={`Доход: ${money(data.monthlySummary.income)} · расходы: ${money(data.monthlySummary.expense)}`}
              tone="violet"
            />
          </div>
          <div className="mt-6 grid gap-5 lg:grid-cols-2">
            <SectionPanel title="Бюджеты">
              <div className="space-y-3">
                {data.budgets.length ? (
                  data.budgets.map((budget) => (
                    <article
                      key={budget.budgetId}
                      className="rounded-lg border border-white/[0.08] p-3"
                    >
                      <h3 className="break-words text-sm font-semibold text-white">
                        {budget.name || "Бюджет"}
                      </h3>
                      <p className="mt-1 text-xs text-zinc-400">
                        {budget.periodStart} — {budget.periodEnd}
                      </p>
                      <p className="mt-2 text-sm text-zinc-300">
                        Потрачено {money(budget.spent)} /{" "}
                        {money(budget.planned)} · осталось{" "}
                        {money(budget.remaining)}
                      </p>
                    </article>
                  ))
                ) : (
                  <p className="text-sm text-zinc-400">
                    Бюджеты пока не созданы.
                  </p>
                )}
              </div>
            </SectionPanel>
            <SectionPanel title="Последние операции">
              <div className="space-y-3">
                {data.recentTransactions.length ? (
                  data.recentTransactions.map((transaction) => (
                    <article
                      key={transaction.id}
                      className="rounded-lg border border-white/[0.08] p-3"
                    >
                      <p className="break-words text-sm font-semibold text-white">
                        {transaction.merchant ||
                          transaction.categoryName ||
                          transaction.description ||
                          "Операция"}
                      </p>
                      <p className="mt-1 text-xs text-zinc-400">
                        {transaction.occurredOn} · {transaction.transactionType}{" "}
                        · {transaction.status}
                      </p>
                      <p className="mt-2 text-sm text-zinc-200">
                        {transaction.amount.toLocaleString("ru-RU")}{" "}
                        {transaction.currency}
                      </p>
                    </article>
                  ))
                ) : (
                  <p className="text-sm text-zinc-400">
                    Нет сохранённых операций.
                  </p>
                )}
              </div>
            </SectionPanel>
          </div>
        </>
      ) : (
        <SectionPanel title="Финансовые данные временно недоступны">
          <p className="text-sm text-zinc-300">
            Обнови страницу после восстановления соединения. Значения не
            заменяются демонстрационными данными.
          </p>
        </SectionPanel>
      )}
    </>
  );
}
