import { Banknote, CircleDollarSign, Landmark, TrendingUp } from "lucide-react";
import { MetricCard } from "@/components/MetricCard";
import { PageHeader } from "@/components/PageHeader";
import { SectionPanel } from "@/components/SectionPanel";

const reviewLane = [
  {
    key: "transactions",
    label: "Transactions",
    desc: "Manual, import, Telegram, and receipt-sourced ledger entries",
  },
  {
    key: "budgets",
    label: "Budget Envelopes",
    desc: "Weekly, monthly, quarterly, yearly, and custom periods",
  },
  {
    key: "receipts",
    label: "Receipts And AI",
    desc: "OCR imports and optional OpenRouter analysis stay auditable",
  },
];

export default function FinancePage() {
  return (
    <>
      <PageHeader
        kicker="Money Layer"
        summary="Single source of truth for accounts, transactions, budgets, receipts, recurring expenses, reimbursements, and reports."
        title="Finance"
      />

      <div className="dashboard-grid">
        <MetricCard
          detail="Manual, import, Telegram, and receipt entries write to finance_transactions."
          icon={CircleDollarSign}
          label="Ledger"
          tone="amber"
          value="SSOT"
        />
        <MetricCard
          detail="Category envelopes expose planned, spent, remaining, overspent, and utilization."
          icon={Banknote}
          label="Budget"
          tone="mint"
          value="Live"
        />
        <MetricCard
          detail="Transactions retain original currency and normalized base-currency values."
          icon={Landmark}
          label="Currencies"
          value="KZT"
        />
        <MetricCard
          detail="Reports and recommendations use deterministic data first, with optional OpenRouter."
          icon={TrendingUp}
          label="Reports"
          tone="violet"
          value="AI+Rules"
        />
      </div>

      <div className="mt-6">
        <SectionPanel eyebrow="Review" title="Finance Operating Lane">
          <div className="grid gap-2 md:grid-cols-3">
            {reviewLane.map((item) => (
              <div
                key={item.key}
                className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3 transition-colors hover:bg-white/[0.04]"
              >
                <p className="text-sm font-medium text-zinc-300">
                  {item.label}
                </p>
                <p className="mt-1 text-[12px] text-zinc-600">{item.desc}</p>
              </div>
            ))}
          </div>
        </SectionPanel>
      </div>
    </>
  );
}
