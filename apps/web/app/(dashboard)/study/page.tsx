import {
  BookOpenCheck,
  BrainCircuit,
  GraduationCap,
  Timer,
} from "lucide-react";
import { MetricCard } from "@/components/MetricCard";
import { PageHeader } from "@/components/PageHeader";
import { SectionPanel } from "@/components/SectionPanel";

const pipeline = [
  {
    step: 1,
    label: "Capture",
    desc: "Log notes & sources via Telegram or Obsidian",
  },
  {
    step: 2,
    label: "Clarify",
    desc: "Distill raw captures into atomic concepts",
  },
  {
    step: 3,
    label: "Schedule",
    desc: "Assign study blocks respecting recovery mode",
  },
  {
    step: 4,
    label: "Review",
    desc: "Spaced repetition pass; merge into Obsidian",
  },
];

export default function StudyPage() {
  return (
    <>
      <PageHeader
        kicker="Study Layer"
        summary="Coursework, reading, and exam prep can bind tasks and reviews into one surface without changing the core kernel."
        title="Study"
      />

      <div className="dashboard-grid">
        <MetricCard
          detail="Tasks and deadlines can be scoped to courses through metadata or future study tables."
          icon={GraduationCap}
          label="Courses"
          tone="violet"
          value="Track"
        />
        <MetricCard
          detail="Study blocks are focus-aware and can respect recovery mode."
          icon={Timer}
          label="Blocks"
          value="Plan"
        />
        <MetricCard
          detail="Review notes mirror into Obsidian alongside captures and deadlines."
          icon={BookOpenCheck}
          label="Reviews"
          tone="mint"
          value="Recall"
        />
        <MetricCard
          detail="Future scoring can combine spaced repetition with energy and open-task load."
          icon={BrainCircuit}
          label="Cognition"
          tone="amber"
          value="Signal"
        />
      </div>

      <div className="mt-6">
        <SectionPanel eyebrow="Pipeline" title="Academic Workflow">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {pipeline.map((item, i) => (
              <div
                key={item.step}
                className="relative rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-4 transition-colors hover:bg-white/[0.04]"
              >
                {/* Step connector line */}
                {i < pipeline.length - 1 && (
                  <div className="absolute right-0 top-1/2 hidden h-px w-2 -translate-y-1/2 translate-x-full bg-white/[0.08] lg:block" />
                )}
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/[0.06] text-[11px] font-bold tabular-nums text-zinc-500">
                  {item.step}
                </span>
                <p className="mt-2.5 text-sm font-semibold text-zinc-200">
                  {item.label}
                </p>
                <p className="mt-1 text-[12px] leading-relaxed text-zinc-600">
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </SectionPanel>
      </div>
    </>
  );
}
