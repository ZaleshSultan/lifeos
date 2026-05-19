import { Banknote, CircleDollarSign, Landmark, TrendingUp } from "lucide-react";
import { MetricCard } from "@/components/MetricCard";
import { PageHeader } from "@/components/PageHeader";
import { SectionPanel } from "@/components/SectionPanel";

const reviewLane = [
  {
    key: "uncategorized",
    label: "Uncategorized spend",
    desc: "Entries awaiting category assignment",
  },
  {
    key: "drift",
    label: "Monthly drift",
    desc: "Variance against planned envelopes",
  },
  {
    key: "review",
    label: "Next review prompt",
    desc: "Scheduled finance review window",
  },
];

export default function FinancePage() {
  return (
    <>
      <PageHeader
        kicker="Money Layer"
        summary="A quiet ledger surface for captured expenses, monthly totals, and future budget projections."
        title="Finance"
      />

      <div className="dashboard-grid">
        <MetricCard
          detail="Telegram /spend entries become finance life_entities and Obsidian notes."
          icon={CircleDollarSign}
          label="Captured Spend"
          tone="amber"
          value="Month"
        />
        <MetricCard
          detail="Recurring obligations and planned envelopes will sit behind backend routes."
          icon={Banknote}
          label="Budget"
          tone="mint"
          value="Plan"
        />
        <MetricCard
          detail="Accounts remain an explicit future integration, not a frontend secret store."
          icon={Landmark}
          label="Accounts"
          value="Later"
        />
        <MetricCard
          detail="Trend views can reuse finance migration tables once projections are defined."
          icon={TrendingUp}
          label="Trend"
          tone="violet"
          value="Signal"
        />
      </div>

      <div className="mt-6">
        <SectionPanel eyebrow="Review" title="Finance Review Lane">
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
