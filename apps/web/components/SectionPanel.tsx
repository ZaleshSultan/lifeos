interface SectionPanelProps {
  title: string;
  eyebrow?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}

export function SectionPanel({
  title,
  eyebrow,
  children,
  action,
}: SectionPanelProps) {
  return (
    <section className="rounded-xl border border-white/[0.08] bg-white/[0.02]">
      {/* Panel header */}
      <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
        <div>
          {eyebrow ? (
            <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-widest text-zinc-600">
              {eyebrow}
            </p>
          ) : null}
          <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
        </div>
        {action ? <div>{action}</div> : null}
      </div>

      {/* Panel body */}
      <div className="p-5">{children}</div>
    </section>
  );
}
