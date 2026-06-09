export interface MonthlyFinanceTransaction {
  amount: number;
  transactionType: "income" | "expense" | "transfer" | "adjustment";
  status: string;
  category?: string | null;
  description?: string | null;
  merchant?: string | null;
  occurredOn: string;
}

export interface MonthlyHealthMetric {
  metricDate: string;
  metricType: string;
  value: number;
}

export interface MonthlyReminderItem {
  status: string;
  source?: string | null;
  createdAt: string;
  sentAt?: string | null;
}

export interface MonthlySourceEventItem {
  sourceKey: string;
  status: string;
}

export interface MonthlyReviewStats {
  periodMonth: string;
  startDate: string;
  endDate: string;
  finance: {
    totalIncome: number;
    totalExpense: number;
    netCashflow: number;
    topCategories: Array<{ category: string; amount: number; count: number }>;
    topDescriptions: Array<{
      description: string;
      amount: number;
      count: number;
    }>;
    biggestTransactions: Array<{
      amount: number;
      category: string;
      description: string | null;
      occurredOn: string;
    }>;
    dailySpendingTrend: Array<{ date: string; amount: number }>;
    draftCount: number;
    cancelledCount: number;
    debtTransactionCount: number;
    debtTotal: number;
  };
  health: {
    avgSteps: number | null;
    totalSteps: number;
    avgSleepMinutes: number | null;
    avgRestingHeartRate: number | null;
    avgActiveEnergyKcal: number | null;
    totalWorkoutMinutes: number;
    missingHealthDays: string[];
    bestStepsDay: { date: string; steps: number } | null;
    worstStepsDay: { date: string; steps: number } | null;
  };
  productivity: {
    remindersCreated: number;
    remindersSent: number;
    remindersFailed: number;
    googleTasksReminders: number;
    manualReminders: number;
    overdueOrPending: number;
  };
  sources: {
    sourceEventsByProvider: Array<{ sourceKey: string; count: number }>;
  };
}

export interface MonthlyReviewAggregationInput {
  periodMonth: string;
  transactions?: MonthlyFinanceTransaction[];
  healthMetrics?: MonthlyHealthMetric[];
  reminders?: MonthlyReminderItem[];
  sourceEvents?: MonthlySourceEventItem[];
}

const CARD_OR_ACCOUNT_PATTERN = /(?<!\d)(?:\d[\s-]?){12,19}(?!\d)/g;

export function redactMonthlyReviewText(value: string): string {
  return value
    .replace(CARD_OR_ACCOUNT_PATTERN, " [REDACTED] ")
    .replace(/\s+/g, " ")
    .trim();
}

function monthStart(periodMonth: string): Date {
  const match = periodMonth.match(/^(\d{4})-(\d{2})$/);

  if (!match) {
    throw new Error("periodMonth must use YYYY-MM");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);

  if (!Number.isInteger(year) || month < 1 || month > 12) {
    throw new Error("periodMonth must use YYYY-MM");
  }

  return new Date(Date.UTC(year, month - 1, 1));
}

export function monthlyReviewBounds(periodMonth: string): {
  startDate: string;
  endDate: string;
  nextMonthDate: string;
  days: string[];
} {
  const start = monthStart(periodMonth);
  const next = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1),
  );
  const end = new Date(next);
  end.setUTCDate(end.getUTCDate() - 1);
  const days: string[] = [];
  const current = new Date(start);

  while (current < next) {
    days.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    nextMonthDate: next.toISOString().slice(0, 10),
    days,
  };
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function avg(values: number[]): number | null {
  return values.length
    ? Math.round((sum(values) / values.length) * 10) / 10
    : null;
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

function safeDescription(value: string | null | undefined): string | null {
  const text = redactMonthlyReviewText(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

  if (!text || text.length > 80) {
    return null;
  }

  return text;
}

function increment<K extends string>(
  map: Map<K, { amount: number; count: number }>,
  key: K,
  amount: number,
): void {
  const current = map.get(key) ?? { amount: 0, count: 0 };
  current.amount += amount;
  current.count += 1;
  map.set(key, current);
}

export function aggregateMonthlyReviewStats(
  input: MonthlyReviewAggregationInput,
): MonthlyReviewStats {
  const bounds = monthlyReviewBounds(input.periodMonth);
  const transactions = input.transactions ?? [];
  const confirmedExpenses = transactions.filter(
    (item) => item.transactionType === "expense" && item.status === "confirmed",
  );
  const confirmedIncome = transactions.filter(
    (item) => item.transactionType === "income" && item.status === "confirmed",
  );
  const topCategories = new Map<string, { amount: number; count: number }>();
  const topDescriptions = new Map<string, { amount: number; count: number }>();
  const dailySpending = new Map(bounds.days.map((day) => [day, 0]));
  let debtTransactionCount = 0;
  let debtTotal = 0;

  for (const transaction of confirmedExpenses) {
    const amount = Number(transaction.amount) || 0;
    const category = transaction.category || "Другое";
    increment(topCategories, category, amount);

    const description = safeDescription(
      transaction.description ?? transaction.merchant,
    );

    if (description) {
      increment(topDescriptions, description, amount);
    }

    const day = transaction.occurredOn.slice(0, 10);
    dailySpending.set(day, (dailySpending.get(day) ?? 0) + amount);

    if (category === "Долги") {
      debtTransactionCount += 1;
      debtTotal += amount;
    }
  }

  const metricValues = (type: string): number[] =>
    (input.healthMetrics ?? [])
      .filter((metric) => metric.metricType === type)
      .map((metric) => Number(metric.value))
      .filter(Number.isFinite);
  const stepsByDay = new Map<string, number>();

  for (const metric of input.healthMetrics ?? []) {
    if (metric.metricType === "steps") {
      stepsByDay.set(metric.metricDate, Number(metric.value) || 0);
    }
  }

  const stepDays = [...stepsByDay.entries()].map(([date, steps]) => ({
    date,
    steps,
  }));
  const healthDays = new Set(
    (input.healthMetrics ?? []).map((metric) => metric.metricDate.slice(0, 10)),
  );
  const sourceCounts = new Map<string, number>();

  for (const event of input.sourceEvents ?? []) {
    sourceCounts.set(
      event.sourceKey,
      (sourceCounts.get(event.sourceKey) ?? 0) + 1,
    );
  }

  const reminders = input.reminders ?? [];
  const sourceOf = (reminder: MonthlyReminderItem) =>
    reminder.source || "manual";

  return {
    periodMonth: input.periodMonth,
    startDate: bounds.startDate,
    endDate: bounds.endDate,
    finance: {
      totalIncome: rounded(
        sum(confirmedIncome.map((item) => Number(item.amount) || 0)),
      ),
      totalExpense: rounded(
        sum(confirmedExpenses.map((item) => Number(item.amount) || 0)),
      ),
      netCashflow: rounded(
        sum(confirmedIncome.map((item) => Number(item.amount) || 0)) -
          sum(confirmedExpenses.map((item) => Number(item.amount) || 0)),
      ),
      topCategories: [...topCategories.entries()]
        .map(([category, value]) => ({
          category,
          amount: rounded(value.amount),
          count: value.count,
        }))
        .sort((left, right) => right.amount - left.amount)
        .slice(0, 8),
      topDescriptions: [...topDescriptions.entries()]
        .map(([description, value]) => ({
          description,
          amount: rounded(value.amount),
          count: value.count,
        }))
        .sort((left, right) => right.amount - left.amount)
        .slice(0, 8),
      biggestTransactions: [...confirmedExpenses]
        .sort((left, right) => Number(right.amount) - Number(left.amount))
        .slice(0, 8)
        .map((item) => ({
          amount: rounded(Number(item.amount) || 0),
          category: item.category || "Другое",
          description: safeDescription(item.description ?? item.merchant),
          occurredOn: item.occurredOn.slice(0, 10),
        })),
      dailySpendingTrend: [...dailySpending.entries()].map(
        ([date, amount]) => ({
          date,
          amount: rounded(amount),
        }),
      ),
      draftCount: transactions.filter((item) => item.status === "draft").length,
      cancelledCount: transactions.filter((item) => item.status === "cancelled")
        .length,
      debtTransactionCount,
      debtTotal: rounded(debtTotal),
    },
    health: {
      avgSteps: avg(metricValues("steps")),
      totalSteps: rounded(sum(metricValues("steps"))),
      avgSleepMinutes: avg(metricValues("sleep_minutes")),
      avgRestingHeartRate: avg(metricValues("resting_heart_rate")),
      avgActiveEnergyKcal: avg(metricValues("active_energy_kcal")),
      totalWorkoutMinutes: rounded(sum(metricValues("workout_minutes"))),
      missingHealthDays: bounds.days.filter((day) => !healthDays.has(day)),
      bestStepsDay: stepDays.length
        ? [...stepDays].sort((left, right) => right.steps - left.steps)[0]!
        : null,
      worstStepsDay: stepDays.length
        ? [...stepDays].sort((left, right) => left.steps - right.steps)[0]!
        : null,
    },
    productivity: {
      remindersCreated: reminders.length,
      remindersSent: reminders.filter((item) => item.status === "sent").length,
      remindersFailed: reminders.filter((item) => item.status === "failed")
        .length,
      googleTasksReminders: reminders.filter(
        (item) => sourceOf(item) === "google_tasks",
      ).length,
      manualReminders: reminders.filter((item) => sourceOf(item) === "manual")
        .length,
      overdueOrPending: reminders.filter(
        (item) => item.status === "pending" || item.status === "processing",
      ).length,
    },
    sources: {
      sourceEventsByProvider: [...sourceCounts.entries()]
        .map(([sourceKey, count]) => ({ sourceKey, count }))
        .sort((left, right) => right.count - left.count),
    },
  };
}

function money(value: number): string {
  return `${value.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} KZT`;
}

function valueOrNa(value: number | null, suffix = ""): string {
  return value === null ? "нет данных" : `${value}${suffix}`;
}

export function monthlyReviewSummaryBullets(
  stats: MonthlyReviewStats,
): string[] {
  return [
    `Финансовый итог: доход ${money(stats.finance.totalIncome)}, расходы ${money(stats.finance.totalExpense)}, net ${money(stats.finance.netCashflow)}.`,
    stats.finance.topCategories[0]
      ? `Главная категория расходов: ${stats.finance.topCategories[0].category} (${money(stats.finance.topCategories[0].amount)}).`
      : "Расходов за месяц не зафиксировано.",
    `Здоровье: средние шаги ${valueOrNa(stats.health.avgSteps)}, сон ${valueOrNa(stats.health.avgSleepMinutes, " мин")}.`,
    `Тренировки: ${valueOrNa(stats.health.totalWorkoutMinutes, " мин")} за месяц; пропусков health-данных: ${stats.health.missingHealthDays.length}.`,
    `Reminders: создано ${stats.productivity.remindersCreated}, отправлено ${stats.productivity.remindersSent}, failed ${stats.productivity.remindersFailed}.`,
    stats.finance.draftCount
      ? `Есть ${stats.finance.draftCount} finance draft: их надо разобрать.`
      : "Черновиков finance нет.",
  ];
}

export function buildMonthlyReviewMarkdown(stats: MonthlyReviewStats): string {
  const bullets = monthlyReviewSummaryBullets(stats);
  const topCategories = stats.finance.topCategories.length
    ? stats.finance.topCategories
        .map(
          (item) => `- ${item.category}: ${money(item.amount)} (${item.count})`,
        )
        .join("\n")
    : "- Нет расходов.";
  const leaks = stats.finance.topDescriptions.length
    ? stats.finance.topDescriptions
        .slice(0, 5)
        .map(
          (item) =>
            `- ${item.description}: ${money(item.amount)} (${item.count})`,
        )
        .join("\n")
    : "- Явных повторяющихся утечек не видно.";
  const dailyLimit =
    stats.finance.totalExpense > 0
      ? Math.max(1000, Math.round((stats.finance.totalExpense / 31) * 0.9))
      : 5000;
  const stepsTarget =
    stats.health.avgSteps === null
      ? 7000
      : Math.max(7000, Math.round(stats.health.avgSteps));

  return `# LifeOS Monthly Review — ${stats.periodMonth}

## 1. Краткий вывод
${bullets
  .slice(0, 6)
  .map((item) => `- ${item}`)
  .join("\n")}

## 2. Финансы
- Доход: ${money(stats.finance.totalIncome)}
- Расходы: ${money(stats.finance.totalExpense)}
- Net cashflow: ${money(stats.finance.netCashflow)}
- Draft/cancelled: ${stats.finance.draftCount}/${stats.finance.cancelledCount}
- Долги: ${stats.finance.debtTransactionCount} транзакций на ${money(stats.finance.debtTotal)}

### Top categories
${topCategories}

### Biggest leaks
${leaks}

Что резать в следующем месяце: первую категорию из top categories и все повторяющиеся мелкие покупки без пользы. ${
    stats.finance.netCashflow < 0
      ? "Расходы выше доходов: это опасный режим, нужен недельный лимит и ревью каждое воскресенье."
      : "Cashflow не отрицательный, но лимиты всё равно нужны."
  }

## 3. Здоровье
- Средние шаги: ${valueOrNa(stats.health.avgSteps)}
- Total steps: ${stats.health.totalSteps}
- Средний сон: ${valueOrNa(stats.health.avgSleepMinutes, " мин")}
- Средний resting HR: ${valueOrNa(stats.health.avgRestingHeartRate)}
- Средние active kcal: ${valueOrNa(stats.health.avgActiveEnergyKcal)}
- Workout minutes: ${stats.health.totalWorkoutMinutes}
- Missing health days: ${stats.health.missingHealthDays.length}

## 4. Продуктивность / Reminders
- Создано reminders: ${stats.productivity.remindersCreated}
- Отправлено: ${stats.productivity.remindersSent}
- Failed: ${stats.productivity.remindersFailed}
- Google Tasks reminders: ${stats.productivity.googleTasksReminders}
- Manual reminders: ${stats.productivity.manualReminders}
- Pending/overdue: ${stats.productivity.overdueOrPending}

## 5. Что было хорошо
- Система собрала данные без ручного отчёта.
- Видны реальные расходы, health consistency и reminder throughput.
- Есть база для конкретных лимитов, а не ощущения.

## 6. Что пошло плохо
- Пропуски health-данных: ${stats.health.missingHealthDays.length}.
- Финансовые draft/cancelled требуют внимания: ${stats.finance.draftCount + stats.finance.cancelledCount}.
- Повторяющиеся расходы надо проверять отдельно, особенно top descriptions.

## 7. План на следующий месяц
- Finance: поставить дневной лимит ${money(dailyLimit)}.
- Finance: разбирать drafts каждую неделю.
- Finance: отдельно проверить категорию ${stats.finance.topCategories[0]?.category ?? "Другое"}.
- Health: держать ${stepsTarget} шагов в день.
- Health: целиться в 7.5 часов сна.
- Health: не допускать больше 3 missing health days.
- Productivity: чистить pending reminders в конце дня.
- Productivity: failed reminders проверять сразу.
- Productivity: Google Tasks держать как основной внешний источник задач.

## 8. Конкретные правила на месяц
- Daily spending limit: ${money(dailyLimit)}
- Sleep target: 450 минут.
- Steps target: ${stepsTarget}.
- Review day: воскресенье 19:00.
`;
}
