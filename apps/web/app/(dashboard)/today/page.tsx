import {
  Activity,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  Clock,
} from "lucide-react";
import { MetricCard } from "@/components/MetricCard";
import { PageHeader } from "@/components/PageHeader";
import { SectionPanel } from "@/components/SectionPanel";

const queueItems = [
  { label: "Top task", hint: "Highest-priority open loop" },
  { label: "Next deadline", hint: "Earliest upcoming due date" },
  { label: "Latest capture", hint: "Most recent Telegram entry" },
];

const syncRows = [
  { key: "Pending queue", value: "Tracked" },
  { key: "Worker mode", value: "Arch server" },
];

export default function TodayPage() {
  return (
    <>
      <PageHeader
        kicker="Command Center"
        summary="A compact operating surface for the day: focus, health, money, and the queue that should become Obsidian notes."
        title="Today"
      />

      <div className="dashboard-grid">
        <MetricCard
          detail="Backend summary endpoint will fold tasks, deadlines, and captures into this lane."
          icon={CheckCircle2}
          label="Queue"
          tone="mint"
          value="Ready"
        />
        <MetricCard
          detail="Focus score is owned by packages/core and can blend health mode with open loops."
          icon={Activity}
          label="Focus"
          value="Signal"
        />
        <MetricCard
          detail="Deadlines created by Telegram will surface here with due windows."
          icon={CalendarClock}
          label="Deadlines"
          tone="amber"
          value="Next"
        />
        <MetricCard
          detail="Spend captures and finance rollups stay behind the backend API."
          icon={CircleDollarSign}
          label="Finance"
          tone="violet"
          value="Month"
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
        <SectionPanel eyebrow="Flow" title="Operating Queue">
          <div className="space-y-2">
            {queueItems.map((item) => (
              <div
                key={item.label}
                className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3 transition-colors hover:bg-white/[0.04]"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-200">
                    {item.label}
                  </p>
                  <p className="mt-0.5 text-[12px] text-zinc-600">
                    {item.hint}
                  </p>
                </div>
                <div className="ml-4 flex shrink-0 items-center gap-1.5 rounded-full border border-white/[0.06] bg-white/[0.03] px-2.5 py-1">
                  <Clock className="h-3 w-3 text-zinc-600" />
                  <span className="text-[11px] font-medium text-zinc-500">
                    API pending
                  </span>
                </div>
              </div>
            ))}
          </div>
        </SectionPanel>

        <SectionPanel eyebrow="Mirror" title="Obsidian Sync">
          <div className="space-y-2">
            {syncRows.map((row) => (
              <div
                key={row.key}
                className="flex items-center justify-between rounded-lg bg-white/[0.03] px-4 py-3"
              >
                <span className="text-sm text-zinc-500">{row.key}</span>
                <span className="text-sm font-medium text-zinc-200">
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        </SectionPanel>
      </div>
    </>
  );
}
