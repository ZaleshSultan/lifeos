import { Activity, HeartPulse, Moon, RotateCw } from "lucide-react";
import { MetricCard } from "@/components/MetricCard";
import { PageHeader } from "@/components/PageHeader";
import { SectionPanel } from "@/components/SectionPanel";

const ingestReasons = [
  { id: "nightly_00_01", label: "nightly_00_01", desc: "Primary nightly run" },
  { id: "retry_00_15", label: "retry_00_15", desc: "15-min retry window" },
  {
    id: "morning_reconcile_06_00",
    label: "morning_reconcile_06_00",
    desc: "AM reconcile pass",
  },
  { id: "manual", label: "manual", desc: "On-demand trigger" },
  { id: "backfill", label: "backfill", desc: "Historical backfill" },
];

export default function HealthPage() {
  return (
    <>
      <PageHeader
        kicker="Recovery Layer"
        summary="Health is read from backend API projections fed by Health Connect ingest, never from frontend-held Supabase service credentials."
        title="Health"
      />

      <div className="dashboard-grid">
        <MetricCard
          detail="Calculated during /health/ingest from sleep, HRV, RHR, stress, and activity signals."
          icon={HeartPulse}
          label="Recovery Mode"
          tone="rose"
          value="Mode"
        />
        <MetricCard
          detail="Previous-day sleep rolls into daily health rows and focus decisions."
          icon={Moon}
          label="Sleep"
          value="Daily"
        />
        <MetricCard
          detail="Steps, active energy, and workouts are aggregated by the Android bridge."
          icon={Activity}
          label="Movement"
          tone="mint"
          value="Range"
        />
        <MetricCard
          detail="Sync runs preserve reason, status, source, and completeness score."
          icon={RotateCw}
          label="Sync"
          tone="amber"
          value="Runs"
        />
      </div>

      <div className="mt-6">
        <SectionPanel eyebrow="Ingest" title="Previous-Day Health Contract">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {ingestReasons.map((reason) => (
              <div
                key={reason.id}
                className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3 transition-colors hover:bg-white/[0.04]"
              >
                <p className="font-mono text-[12px] font-medium text-cyan-400/80">
                  {reason.label}
                </p>
                <p className="mt-1 text-[12px] text-zinc-600">{reason.desc}</p>
              </div>
            ))}
          </div>
        </SectionPanel>
      </div>
    </>
  );
}
