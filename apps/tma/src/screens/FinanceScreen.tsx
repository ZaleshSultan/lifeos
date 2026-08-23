import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  CircleDollarSign,
  Plus,
  RefreshCw,
  Tags,
  Upload,
  WalletCards,
  X,
} from "lucide-react";
import {
  type ChangeEvent,
  type FormEvent,
  useMemo,
  useState,
  useEffect,
} from "react";
import {
  useArchiveBudgetMutation,
  useCreateBudgetMutation,
  useCreateFinanceTransactionMutation,
  useFinanceCategoriesQuery,
  useFinanceQuery,
  useSaveFinanceSettingsMutation,
  useUpdateBudgetMutation,
  useUploadFinanceReceiptMutation,
  useReceiptQuery,
  useReviewReceiptMutation,
  useBackfillMutation,
} from "../api/hooks";
import { telegram } from "../telegram";
import type {
  BudgetSummary,
  FinanceReceiptSummary,
  FinanceTransaction,
  FinanceCategory,
} from "../api/types";
import { ErrorPanel, LoadingPanel } from "../components/AsyncState";
import { cx } from "../lib/styles";

function money(amount: number, currency: string): string {
  return new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 2,
    style: "currency",
    currency,
  }).format(amount);
}

function currentMonthStart(): string {
  const date = new Date();
  date.setDate(1);
  return date.toISOString().slice(0, 10);
}

function receiptStatusClass(
  status: FinanceReceiptSummary["displayStatus"],
): string {
  if (status === "completed") {
    return "border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300";
  }
  if (status === "partial" || status === "needs_review") {
    return "border-amber-400/20 bg-amber-400/[0.08] text-amber-200";
  }
  if (status === "failed") {
    return "border-rose-400/20 bg-rose-400/[0.08] text-rose-200";
  }
  return "border-cyan-400/20 bg-cyan-400/[0.08] text-cyan-200";
}

function ReceiptRow({
  receipt,
  onClick,
}: {
  receipt: FinanceReceiptSummary;
  onClick?: () => void;
}) {
  const clickable =
    receipt.displayStatus === "needs_review" ||
    receipt.displayStatus === "partial";

  return (
    <div
      onClick={clickable ? onClick : undefined}
      className={cx(
        "flex items-start justify-between gap-3 border-t border-white/[0.06] py-3 first:border-t-0",
        clickable &&
          "cursor-pointer hover:bg-white/[0.02] active:bg-white/[0.04] px-1 rounded transition-colors",
      )}
    >
      <div className="min-w-0">
        <div className="text-sm font-semibold text-white">
          {receipt.fileName || "Receipt"}
        </div>
        <div className="mt-1 text-xs text-zinc-500">
          {receipt.createdAt.slice(0, 10)}
          {receipt.amount && receipt.currency
            ? ` · ${money(receipt.amount, receipt.currency)}`
            : ""}
        </div>
        {receipt.errorMessage ? (
          <div className="mt-1 text-xs text-amber-200">
            {receipt.errorMessage}
          </div>
        ) : null}
      </div>
      <span
        className={cx(
          "shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold capitalize",
          receiptStatusClass(receipt.displayStatus),
        )}
      >
        {receipt.displayStatus.replaceAll("_", " ")}
      </span>
    </div>
  );
}

function TransactionRow({ transaction }: { transaction: FinanceTransaction }) {
  const income = transaction.transactionType === "income";
  const Icon = income ? ArrowDownLeft : ArrowUpRight;

  return (
    <div className="flex items-start gap-3 border-t border-white/[0.06] py-3 first:border-t-0">
      <div
        className={cx(
          "grid h-9 w-9 shrink-0 place-items-center rounded-lg border",
          income
            ? "border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300"
            : "border-amber-400/20 bg-amber-400/[0.08] text-amber-300",
        )}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="break-words text-sm font-semibold text-white">
          {transaction.description ||
            transaction.merchant ||
            transaction.categoryName ||
            "No description"}
        </div>
        <div className="mt-1 text-xs text-zinc-500">
          {transaction.categoryName || "Other"} · {transaction.occurredOn}
          {transaction.merchant ? ` · ${transaction.merchant}` : ""}
        </div>
        {transaction.tags.length ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {transaction.tags.map((tag) => (
              <span
                className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[11px] text-zinc-400"
                key={tag}
              >
                #{tag}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <div
        className={cx(
          "shrink-0 text-sm font-semibold",
          income ? "text-emerald-300" : "text-white",
        )}
      >
        {income ? "+" : "−"}
        {money(transaction.amount, transaction.currency)}
      </div>
    </div>
  );
}

function BudgetCard({
  budget,
  archivePending,
  onArchive,
  onSave,
  updatePending,
}: {
  budget: BudgetSummary;
  archivePending: boolean;
  onArchive: () => void;
  onSave: (input: { name: string; amount: number }) => void;
  updatePending: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(budget.name ?? "");
  const [amount, setAmount] = useState(String(budget.planned));
  const percent = Math.min(100, Math.max(0, budget.totalPercentUsed));

  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 shadow-panel">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <WalletCards className="h-4 w-4 text-emerald-300" />
            {editing ? (
              <input
                className="w-full rounded-lg border border-white/[0.08] bg-black/20 px-2 py-1 text-sm text-white"
                onChange={(event) => setName(event.target.value)}
                value={name}
              />
            ) : (
              budget.name || `${budget.period} budget`
            )}
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            {budget.periodStart} to {budget.periodEnd}
          </div>
        </div>
        {budget.isOverspent ? (
          <div className="flex items-center gap-1 rounded-full border border-red-400/20 bg-red-400/[0.08] px-2 py-1 text-[11px] font-semibold text-red-200">
            <AlertTriangle className="h-3 w-3" />
            Overspent
          </div>
        ) : null}
      </div>

      {editing ? (
        <div className="mt-4 space-y-3">
          <label className="block text-xs text-zinc-500">
            Planned amount
            <input
              className="mt-1 w-full rounded-lg border border-white/[0.08] bg-black/20 px-3 py-2 text-sm text-white"
              inputMode="decimal"
              onChange={(event) => setAmount(event.target.value)}
              value={amount}
            />
          </label>
          <div className="flex gap-2">
            <button
              className="flex-1 rounded-lg border border-emerald-400/20 bg-emerald-400/[0.08] px-3 py-2 text-sm font-semibold text-emerald-200 disabled:opacity-50"
              disabled={updatePending}
              onClick={() => {
                const parsed = Number(amount);
                if (!Number.isFinite(parsed) || parsed < 0) return;
                onSave({ name: name.trim(), amount: parsed });
                setEditing(false);
              }}
              type="button"
            >
              Save
            </button>
            <button
              className="rounded-lg border border-white/[0.08] px-3 py-2 text-sm text-zinc-300"
              onClick={() => {
                setEditing(false);
                setName(budget.name ?? "");
                setAmount(String(budget.planned));
              }}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <div>
              <div className="text-[11px] text-zinc-500">Planned</div>
              <div className="text-sm font-semibold text-white">
                {money(budget.planned, budget.currency)}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-zinc-500">Spent</div>
              <div className="text-sm font-semibold text-white">
                {money(budget.spent, budget.currency)}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-zinc-500">Remaining</div>
              <div
                className={cx(
                  "text-sm font-semibold",
                  budget.remaining < 0 ? "text-red-200" : "text-emerald-200",
                )}
              >
                {money(budget.remaining, budget.currency)}
              </div>
            </div>
          </div>

          <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className={cx(
                "h-full rounded-full",
                budget.isOverspent ? "bg-red-300" : "bg-emerald-300",
              )}
              style={{ width: `${percent}%` }}
            />
          </div>

          <div className="mt-3 space-y-2">
            {budget.categories.slice(0, 4).map((category) => (
              <div
                className="flex items-center justify-between gap-3 text-xs"
                key={category.categoryId}
              >
                <span className="truncate text-zinc-400">
                  {category.categoryName}
                </span>
                <span className="shrink-0 font-medium text-zinc-200">
                  {category.percentUsed}%
                </span>
              </div>
            ))}
          </div>

          <div className="mt-4 flex gap-2">
            <button
              className="flex-1 rounded-lg border border-white/[0.08] px-3 py-2 text-xs font-semibold text-zinc-200"
              onClick={() => setEditing(true)}
              type="button"
            >
              Edit
            </button>
            <button
              className="rounded-lg border border-rose-400/20 bg-rose-400/[0.08] px-3 py-2 text-xs font-semibold text-rose-200 disabled:opacity-50"
              disabled={archivePending}
              onClick={onArchive}
              type="button"
            >
              Archive
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function FinanceScreen() {
  const query = useFinanceQuery();
  const categoriesQuery = useFinanceCategoriesQuery();
  const createTransaction = useCreateFinanceTransactionMutation();
  const createBudget = useCreateBudgetMutation();
  const updateBudget = useUpdateBudgetMutation();
  const archiveBudget = useArchiveBudgetMutation();
  const saveFinanceSettings = useSaveFinanceSettingsMutation();
  const uploadReceipt = useUploadFinanceReceiptMutation();
  const backfill = useBackfillMutation();
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [showBudgetForm, setShowBudgetForm] = useState(false);
  const [selectedCurrency, setSelectedCurrency] = useState<string | null>(null);
  const [selectedReceiptId, setSelectedReceiptId] = useState<string | null>(
    null,
  );
  const [receiptUploadError, setReceiptUploadError] = useState<string | null>(
    null,
  );
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("Food");
  const [description, setDescription] = useState("");
  const [merchant, setMerchant] = useState("");
  const [tags, setTags] = useState("");
  const [budgetName, setBudgetName] = useState("");
  const [budgetAmount, setBudgetAmount] = useState("");

  const expenseCategories = useMemo(
    () =>
      (categoriesQuery.data ?? []).filter(
        (item) => item.transactionType === "expense",
      ),
    [categoriesQuery.data],
  );

  if (query.isLoading) return <LoadingPanel title="Loading finance" />;
  if (query.isError) {
    return (
      <ErrorPanel
        detail={query.error.message}
        onRetry={() => void query.refetch()}
        title="Finance unavailable"
      />
    );
  }

  const finance = query.data;

  if (!finance) return <ErrorPanel title="Finance unavailable" />;

  const activeBaseCurrency = selectedCurrency ?? finance.baseCurrency;

  const empty =
    finance.recentTransactions.length === 0 && finance.drafts.length === 0;

  async function handleReceiptUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    setReceiptUploadError(null);

    try {
      const imageBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = typeof reader.result === "string" ? reader.result : "";
          resolve(result.replace(/^data:[^;]+;base64,/, ""));
        };
        reader.onerror = () =>
          reject(new Error("Failed to read receipt image"));
        reader.readAsDataURL(file);
      });

      await uploadReceipt.mutateAsync({
        fileName: file.name,
        mimeType: file.type || "image/jpeg",
        imageBase64,
      });
    } catch (error) {
      setReceiptUploadError(
        error instanceof Error ? error.message : "Receipt upload failed",
      );
    }
  }

  async function handleSaveBaseCurrency(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await saveFinanceSettings.mutateAsync({ baseCurrency: activeBaseCurrency });
  }

  async function handleCreateExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedAmount = Number(amount);

    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return;
    }

    await createTransaction.mutateAsync({
      amount: parsedAmount,
      category,
      description: description.trim() || null,
      merchant: merchant.trim() || null,
      tags: tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      transactionType: "expense",
    });

    setAmount("");
    setDescription("");
    setMerchant("");
    setTags("");
    setShowExpenseForm(false);
  }

  async function handleCreateBudget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedAmount = Number(budgetAmount);

    if (!Number.isFinite(parsedAmount) || parsedAmount < 0) {
      return;
    }

    await createBudget.mutateAsync({
      name: budgetName.trim() || null,
      amount: parsedAmount,
      period: "monthly",
      periodStart: currentMonthStart(),
    });

    setBudgetName("");
    setBudgetAmount("");
    setShowBudgetForm(false);
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 shadow-panel">
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-lg border border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300">
            <CircleDollarSign className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-zinc-500">Ledger</div>
            <h2 className="mt-1 text-[26px] font-semibold text-white">
              Finance
            </h2>
          </div>
          <button
            aria-label="Refresh finance"
            className="grid h-11 w-11 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.03] text-zinc-300"
            onClick={() => void query.refetch()}
            type="button"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 shadow-panel">
        <div className="text-sm font-semibold text-white">Monthly summary</div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <div>
            <div className="text-[11px] text-zinc-500">Income</div>
            <div className="mt-1 text-sm font-semibold text-emerald-300">
              {money(finance.monthlySummary.income, finance.currency)}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-zinc-500">Expense</div>
            <div className="mt-1 text-sm font-semibold text-white">
              {money(finance.monthlySummary.expense, finance.currency)}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-zinc-500">Net</div>
            <div
              className={cx(
                "mt-1 text-sm font-semibold",
                finance.monthlySummary.net >= 0
                  ? "text-emerald-300"
                  : "text-red-200",
              )}
            >
              {money(finance.monthlySummary.net, finance.currency)}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 shadow-panel">
        <div className="text-sm font-semibold text-white">Base currency</div>
        <form className="mt-3 flex gap-2" onSubmit={handleSaveBaseCurrency}>
          <select
            className="min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-black/20 px-3 py-2 text-sm text-white"
            onChange={(event) => setSelectedCurrency(event.target.value)}
            value={activeBaseCurrency}
          >
            {(["KZT", "USD", "EUR", "RUB"] as const).map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <button
            className="rounded-lg border border-emerald-400/20 bg-emerald-400/[0.08] px-3 py-2 text-sm font-semibold text-emerald-200 disabled:opacity-50"
            disabled={saveFinanceSettings.isPending}
            type="submit"
          >
            Save
          </button>
        </form>
        <div className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-3">
          <span className="text-xs text-zinc-500">
            Missing legacy base amounts?
          </span>
          <button
            onClick={() => void backfill.mutateAsync()}
            disabled={backfill.isPending}
            className="text-xs font-semibold text-emerald-300 hover:text-emerald-200 disabled:opacity-50 transition-colors"
            type="button"
          >
            {backfill.isPending ? "Backfilling..." : "Run backfill"}
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 shadow-panel">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-white">Receipt upload</div>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-cyan-400/20 bg-cyan-400/[0.08] px-3 py-2 text-xs font-semibold text-cyan-200">
            <Upload className="h-4 w-4" />
            {uploadReceipt.isPending ? "Processing..." : "Upload photo"}
            <input
              accept="image/jpeg,image/png,image/webp,application/pdf"
              className="hidden"
              disabled={uploadReceipt.isPending}
              onChange={(event) => void handleReceiptUpload(event)}
              type="file"
            />
          </label>
        </div>
        {receiptUploadError ? (
          <div className="mt-3 text-sm text-rose-200">{receiptUploadError}</div>
        ) : null}
        {finance.recentReceipts.length ? (
          <div className="mt-3">
            {finance.recentReceipts.map((receipt) => (
              <ReceiptRow
                key={receipt.id}
                receipt={receipt}
                onClick={() => setSelectedReceiptId(receipt.id)}
              />
            ))}
          </div>
        ) : (
          <div className="mt-3 text-sm text-zinc-500">
            Upload a receipt photo to create a transaction automatically.
          </div>
        )}
      </section>

      {finance.anomalies.length ? (
        <section className="rounded-xl border border-rose-400/20 bg-rose-400/[0.04] p-4">
          <div className="text-sm font-semibold text-rose-200">
            Anomaly alerts
          </div>
          <ul className="mt-2 space-y-2 text-sm text-zinc-300">
            {finance.anomalies.map((item) => (
              <li key={`${item.type}-${item.occurredOn}-${item.amount}`}>
                - {item.reason}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="grid grid-cols-3 gap-2">
        {(
          [
            ["Today", finance.today],
            ["Week", finance.week],
            ["Month", finance.month],
          ] as const
        ).map(([label, period]) => (
          <div
            className="min-w-0 rounded-lg border border-white/[0.08] bg-white/[0.03] p-3"
            key={label}
          >
            <div className="text-[11px] font-medium text-zinc-500">{label}</div>
            <div className="mt-1 break-words text-sm font-semibold text-white">
              {money(period.amount, finance.currency)}
            </div>
            <div className="mt-1 text-[11px] text-zinc-600">
              {period.count} expenses
            </div>
          </div>
        ))}
      </section>

      <section className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 shadow-panel">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-white">Add expense</div>
          <button
            className="grid h-9 w-9 place-items-center rounded-lg border border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-200"
            onClick={() => setShowExpenseForm((value) => !value)}
            type="button"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        {showExpenseForm ? (
          <form className="mt-4 space-y-3" onSubmit={handleCreateExpense}>
            <label className="block text-xs text-zinc-500">
              Amount
              <input
                className="mt-1 w-full rounded-lg border border-white/[0.08] bg-black/20 px-3 py-2 text-sm text-white"
                inputMode="decimal"
                onChange={(event) => setAmount(event.target.value)}
                required
                value={amount}
              />
            </label>
            <label className="block text-xs text-zinc-500">
              Category
              <select
                className="mt-1 w-full rounded-lg border border-white/[0.08] bg-black/20 px-3 py-2 text-sm text-white"
                onChange={(event) => setCategory(event.target.value)}
                value={category}
              >
                {(expenseCategories.length
                  ? expenseCategories
                  : [{ id: "food", name: "Food", transactionType: "expense" }]
                ).map((item) => (
                  <option key={item.id} value={item.name}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-zinc-500">
              Description
              <input
                className="mt-1 w-full rounded-lg border border-white/[0.08] bg-black/20 px-3 py-2 text-sm text-white"
                onChange={(event) => setDescription(event.target.value)}
                value={description}
              />
            </label>
            <label className="block text-xs text-zinc-500">
              Merchant
              <input
                className="mt-1 w-full rounded-lg border border-white/[0.08] bg-black/20 px-3 py-2 text-sm text-white"
                onChange={(event) => setMerchant(event.target.value)}
                value={merchant}
              />
            </label>
            <label className="block text-xs text-zinc-500">
              Tags (comma separated)
              <input
                className="mt-1 w-full rounded-lg border border-white/[0.08] bg-black/20 px-3 py-2 text-sm text-white"
                onChange={(event) => setTags(event.target.value)}
                placeholder="work, travel"
                value={tags}
              />
            </label>
            <button
              className="w-full rounded-lg border border-emerald-400/20 bg-emerald-400/[0.08] px-3 py-2 text-sm font-semibold text-emerald-200 disabled:opacity-50"
              disabled={createTransaction.isPending}
              type="submit"
            >
              Save expense
            </button>
          </form>
        ) : null}
      </section>

      {finance.recommendations.length ? (
        <section className="rounded-xl border border-cyan-400/20 bg-cyan-400/[0.04] p-4">
          <div className="text-sm font-semibold text-cyan-200">
            Recommendations
          </div>
          <ul className="mt-2 space-y-2 text-sm text-zinc-300">
            {finance.recommendations.slice(0, 3).map((item) => (
              <li key={item}>- {item}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {empty ? (
        <section className="rounded-xl border border-dashed border-white/[0.1] px-5 py-8 text-center">
          <CircleDollarSign className="mx-auto h-6 w-6 text-zinc-600" />
          <h3 className="mt-3 text-sm font-semibold text-white">
            No transactions yet
          </h3>
          <p className="mt-1 text-sm text-zinc-500">
            Add an expense here or use /spend in Telegram.
          </p>
        </section>
      ) : null}

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-white">
            Budget analytics
          </div>
          <button
            className="rounded-lg border border-white/[0.08] px-3 py-1.5 text-xs font-semibold text-zinc-200"
            onClick={() => setShowBudgetForm((value) => !value)}
            type="button"
          >
            {showBudgetForm ? "Close" : "New budget"}
          </button>
        </div>
        {showBudgetForm ? (
          <form
            className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 shadow-panel"
            onSubmit={handleCreateBudget}
          >
            <div className="space-y-3">
              <label className="block text-xs text-zinc-500">
                Name
                <input
                  className="mt-1 w-full rounded-lg border border-white/[0.08] bg-black/20 px-3 py-2 text-sm text-white"
                  onChange={(event) => setBudgetName(event.target.value)}
                  value={budgetName}
                />
              </label>
              <label className="block text-xs text-zinc-500">
                Monthly limit
                <input
                  className="mt-1 w-full rounded-lg border border-white/[0.08] bg-black/20 px-3 py-2 text-sm text-white"
                  inputMode="decimal"
                  onChange={(event) => setBudgetAmount(event.target.value)}
                  required
                  value={budgetAmount}
                />
              </label>
              <button
                className="w-full rounded-lg border border-emerald-400/20 bg-emerald-400/[0.08] px-3 py-2 text-sm font-semibold text-emerald-200 disabled:opacity-50"
                disabled={createBudget.isPending}
                type="submit"
              >
                Create budget
              </button>
            </div>
          </form>
        ) : null}
        {finance.budgets.length ? (
          finance.budgets.map((budget) => (
            <BudgetCard
              archivePending={archiveBudget.isPending}
              budget={budget}
              key={budget.budgetId}
              onArchive={() => void archiveBudget.mutateAsync(budget.budgetId)}
              onSave={(input) =>
                void updateBudget.mutateAsync({
                  budgetId: budget.budgetId,
                  input,
                })
              }
              updatePending={updateBudget.isPending}
            />
          ))
        ) : (
          <div className="rounded-xl border border-dashed border-white/[0.1] px-5 py-6 text-center text-sm text-zinc-500">
            No active budgets yet.
          </div>
        )}
      </section>

      {finance.topCategories.length ? (
        <section className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 shadow-panel">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-white">
            <Tags className="h-4 w-4 text-cyan-300" />
            Top categories
          </div>
          {finance.topCategories.map((item) => (
            <div
              className="flex items-center justify-between gap-3 border-t border-white/[0.06] py-2.5 first:border-t-0"
              key={item.category}
            >
              <span className="text-sm text-zinc-300">{item.category}</span>
              <span className="text-sm font-semibold text-white">
                {money(item.amount, finance.currency)}
              </span>
            </div>
          ))}
        </section>
      ) : null}

      {finance.recentExpenses.length ? (
        <section className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 shadow-panel">
          <div className="mb-2 text-sm font-semibold text-white">
            Recent expenses
          </div>
          {finance.recentExpenses.map((transaction) => (
            <TransactionRow key={transaction.id} transaction={transaction} />
          ))}
        </section>
      ) : null}

      {finance.recentIncome.length ? (
        <section className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 shadow-panel">
          <div className="mb-2 text-sm font-semibold text-white">
            Recent income
          </div>
          {finance.recentIncome.map((transaction) => (
            <TransactionRow key={transaction.id} transaction={transaction} />
          ))}
        </section>
      ) : null}

      {finance.drafts.length ? (
        <section className="rounded-xl border border-amber-400/20 bg-amber-400/[0.04] p-4">
          <div className="mb-2 text-sm font-semibold text-amber-200">
            Drafts needing review
          </div>
          {finance.drafts.map((transaction) => (
            <TransactionRow key={transaction.id} transaction={transaction} />
          ))}
        </section>
      ) : null}

      {finance.recentTransactions.length ? (
        <section className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 shadow-panel">
          <div className="mb-2 text-sm font-semibold text-white">
            All recent transactions
          </div>
          {finance.recentTransactions.map((transaction) => (
            <TransactionRow key={transaction.id} transaction={transaction} />
          ))}
        </section>
      ) : null}

      {selectedReceiptId && (
        <ReceiptReviewModal
          receiptId={selectedReceiptId}
          onClose={() => setSelectedReceiptId(null)}
          expenseCategories={expenseCategories}
        />
      )}
    </div>
  );
}

function ReceiptReviewModal({
  receiptId,
  onClose,
  expenseCategories,
}: {
  receiptId: string;
  onClose: () => void;
  expenseCategories: FinanceCategory[];
}) {
  const {
    data: receipt,
    isLoading: receiptLoading,
    error: receiptError,
  } = useReceiptQuery(receiptId);
  const reviewMutation = useReviewReceiptMutation();

  const [imageBlobUrl, setImageBlobUrl] = useState<string | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageError, setImageError] = useState(false);

  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [merchant, setMerchant] = useState("");
  const [date, setDate] = useState("");
  const [category, setCategory] = useState("");

  useEffect(() => {
    let active = true;
    let currentUrl: string | null = null;
    setImageLoading(true);
    setImageError(false);
    setImageBlobUrl(null);

    const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").replace(
      /\/$/,
      "",
    );
    const imageUrl = `${apiBaseUrl}/api/tma/finance/receipts/${encodeURIComponent(receiptId)}/image`;

    fetch(imageUrl, {
      headers: {
        "x-telegram-init-data": telegram.initData,
      },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to fetch image");
        const blob = await res.blob();
        if (active) {
          currentUrl = URL.createObjectURL(blob);
          setImageBlobUrl(currentUrl);
        }
      })
      .catch((err) => {
        console.error(err);
        if (active) setImageError(true);
      })
      .finally(() => {
        if (active) setImageLoading(false);
      });

    return () => {
      active = false;
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl);
      }
    };
  }, [receiptId]);

  useEffect(() => {
    if (receipt) {
      const parsed = receipt.parsedJson || {};
      setAmount(
        parsed.amount !== undefined && parsed.amount !== null
          ? String(parsed.amount)
          : "",
      );
      setCurrency(parsed.currency || "USD");
      setMerchant(parsed.merchant || "");

      let formattedDate = parsed.date || "";
      if (!formattedDate) {
        formattedDate = receipt.processedAt
          ? receipt.processedAt.slice(0, 10)
          : new Date().toISOString().slice(0, 10);
      } else if (formattedDate.includes("T")) {
        formattedDate = formattedDate.slice(0, 10);
      }
      setDate(formattedDate);

      setCategory(parsed.category || (expenseCategories[0]?.name ?? "Food"));
    }
  }, [receipt, expenseCategories]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return;
    }

    await reviewMutation.mutateAsync({
      receiptId,
      input: {
        amount: parsedAmount,
        currency,
        merchant: merchant.trim(),
        date,
        category,
      },
    });

    onClose();
  }

  if (receiptLoading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <div className="relative w-full max-w-lg rounded-xl border border-white/[0.08] bg-zinc-900 p-6 shadow-2xl text-center space-y-3">
          <RefreshCw className="mx-auto h-6 w-6 animate-spin text-cyan-300" />
          <p className="text-sm text-zinc-400">Loading receipt details...</p>
        </div>
      </div>
    );
  }

  if (receiptError || !receipt) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <div className="relative w-full max-w-lg rounded-xl border border-white/[0.08] bg-zinc-900 p-6 shadow-2xl text-center space-y-4">
          <AlertTriangle className="mx-auto h-6 w-6 text-rose-400" />
          <p className="text-sm text-zinc-300">
            Failed to load receipt details.
          </p>
          <button
            onClick={onClose}
            className="w-full rounded-lg border border-white/[0.08] px-3 py-2 text-sm text-zinc-300"
            type="button"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-lg rounded-xl border border-white/[0.08] bg-zinc-900 p-5 shadow-2xl max-h-[90vh] overflow-y-auto space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-white">Review Receipt</h3>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.03] text-zinc-400 hover:text-white"
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Secure Image Preview */}
        <div className="relative flex aspect-video w-full max-h-48 items-center justify-center overflow-hidden rounded-lg border border-white/[0.08] bg-black/40">
          {imageLoading ? (
            <div className="flex flex-col items-center gap-2 text-xs text-zinc-500">
              <RefreshCw className="h-4 w-4 animate-spin text-zinc-500" />
              <span>Loading image...</span>
            </div>
          ) : imageError ? (
            <div className="flex flex-col items-center gap-1 text-xs text-zinc-500">
              <AlertTriangle className="h-4 w-4 text-zinc-600" />
              <span>Preview unavailable</span>
            </div>
          ) : imageBlobUrl ? (
            <img
              src={imageBlobUrl}
              alt="Receipt Preview"
              className="h-full w-full object-contain"
            />
          ) : null}
        </div>

        {/* OCR Text & Parse Errors */}
        {receipt.errorMessage ? (
          <div className="rounded-lg border border-amber-400/20 bg-amber-400/[0.08] p-3 text-xs text-amber-200">
            <strong>Parse Error:</strong> {receipt.errorMessage}
          </div>
        ) : null}

        {receipt.ocrText ? (
          <div className="space-y-1">
            <span className="text-xs text-zinc-500 font-medium">
              Extracted OCR Text
            </span>
            <pre className="max-h-24 overflow-y-auto rounded-lg bg-black/40 p-2 text-[10px] font-mono text-zinc-400 whitespace-pre-wrap scrollbar-thin">
              {receipt.ocrText}
            </pre>
          </div>
        ) : null}

        {/* Review Form */}
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs text-zinc-500">
              Amount
              <input
                className="mt-1 w-full rounded-lg border border-white/[0.08] bg-black/20 px-3 py-2 text-sm text-white"
                inputMode="decimal"
                type="number"
                step="any"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <label className="block text-xs text-zinc-500">
              Currency
              <select
                className="mt-1 w-full rounded-lg border border-white/[0.08] bg-black/20 px-3 py-2 text-sm text-white"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                {["KZT", "USD", "EUR", "RUB"].map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block text-xs text-zinc-500">
            Merchant
            <input
              className="mt-1 w-full rounded-lg border border-white/[0.08] bg-black/20 px-3 py-2 text-sm text-white"
              type="text"
              required
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs text-zinc-500">
              Date
              <input
                className="mt-1 w-full rounded-lg border border-white/[0.08] bg-black/20 px-3 py-2 text-sm text-white"
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label className="block text-xs text-zinc-500">
              Category
              <select
                className="mt-1 w-full rounded-lg border border-white/[0.08] bg-black/20 px-3 py-2 text-sm text-white"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {(expenseCategories.length
                  ? expenseCategories
                  : [{ id: "food", name: "Food" }]
                ).map((item) => (
                  <option key={item.id} value={item.name}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <button
            type="submit"
            disabled={reviewMutation.isPending}
            className="w-full rounded-lg border border-emerald-400/20 bg-emerald-400/[0.08] px-3 py-2 text-sm font-semibold text-emerald-200 disabled:opacity-50 transition-colors"
          >
            {reviewMutation.isPending ? "Saving..." : "Save & Confirm"}
          </button>
        </form>
      </div>
    </div>
  );
}
