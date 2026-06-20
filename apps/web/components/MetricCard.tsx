import type { LucideIcon } from "lucide-react";
import { cx } from "@/lib/styles";

interface MetricCardProps {
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  tone?: "cyan" | "mint" | "amber" | "rose" | "violet";
}

const toneConfig: Record<
  NonNullable<MetricCardProps["tone"]>,
  { topBorder: string; iconBg: string; iconText: string }
> = {
  cyan: {
    topBorder: "border-t-cyan-400/60",
    iconBg: "bg-cyan-400/10",
    iconText: "text-cyan-400",
  },
  mint: {
    topBorder: "border-t-emerald-400/60",
    iconBg: "bg-emerald-400/10",
    iconText: "text-emerald-400",
  },
  amber: {
    topBorder: "border-t-amber-400/60",
    iconBg: "bg-amber-400/10",
    iconText: "text-amber-400",
  },
  rose: {
    topBorder: "border-t-rose-400/60",
    iconBg: "bg-rose-400/10",
    iconText: "text-rose-400",
  },
  violet: {
    topBorder: "border-t-violet-400/60",
    iconBg: "bg-violet-400/10",
    iconText: "text-violet-400",
  },
};

export function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  tone = "cyan",
}: MetricCardProps) {
  const config = toneConfig[tone];

  return (
    <section
      className={cx(
        "group relative rounded-xl border border-white/[0.08] bg-white/[0.03] p-5",
        "border-t-2",
        config.topBorder,
        "transition-all duration-200 hover:border-white/[0.12] hover:bg-white/[0.05]",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
            {label}
          </p>
          <p className="mt-3 text-[26px] font-semibold leading-none tracking-tight text-white tabular-nums">
            {value}
          </p>
        </div>
        <div
          className={cx(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
            config.iconBg,
          )}
        >
          <Icon className={cx("h-[18px] w-[18px]", config.iconText)} />
        </div>
      </div>
      <p className="mt-4 text-[13px] leading-relaxed text-zinc-600">{detail}</p>
    </section>
  );
}
