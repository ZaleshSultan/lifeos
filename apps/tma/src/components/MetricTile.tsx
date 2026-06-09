import type { ReactNode } from "react";

interface MetricTileProps {
  label: string;
  value: ReactNode;
  tone?: "cyan" | "mint" | "amber" | "rose";
}

const toneClasses = {
  cyan: "border-t-cyan-400/60 text-cyan-100",
  mint: "border-t-emerald-400/60 text-emerald-100",
  amber: "border-t-amber-400/60 text-amber-100",
  rose: "border-t-rose-400/60 text-rose-100",
};

export function MetricTile({ label, value, tone = "cyan" }: MetricTileProps) {
  return (
    <div
      className={`rounded-xl border border-white/[0.08] border-t-2 bg-white/[0.03] p-3 shadow-panel ${toneClasses[tone]}`}
    >
      <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
        {label}
      </div>
      <div className="mt-2 truncate text-xl font-semibold leading-none text-white tabular-nums">
        {value}
      </div>
    </div>
  );
}
