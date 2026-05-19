interface ProgressRingProps {
  value: number;
  label: string;
  tone?: "cyan" | "mint" | "amber";
}

const tones = {
  cyan: "#22d3ee",
  mint: "#4ade80",
  amber: "#fbbf24",
};

export function ProgressRing({
  value,
  label,
  tone = "cyan",
}: ProgressRingProps) {
  const normalized = Math.max(0, Math.min(100, value));
  const accent = tones[tone];

  return (
    <div
      className="grid h-24 w-24 shrink-0 place-items-center rounded-full p-1 shadow-[0_0_36px_rgba(34,211,238,0.12)]"
      style={{
        background: `conic-gradient(${accent} ${normalized}%, rgba(255,255,255,0.08) ${normalized}% 100%)`,
      }}
    >
      <div className="grid h-[4.85rem] w-[4.85rem] place-items-center rounded-full border border-white/[0.08] bg-graphite-950 text-center">
        <div>
          <div className="text-xl font-semibold text-white tabular-nums">
            {Math.round(normalized)}%
          </div>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
            {label}
          </div>
        </div>
      </div>
    </div>
  );
}
