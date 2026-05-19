interface PageHeaderProps {
  kicker: string;
  title: string;
  summary: string;
  action?: React.ReactNode;
}

export function PageHeader({
  kicker,
  title,
  summary,
  action,
}: PageHeaderProps) {
  return (
    <header className="mb-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          {/* Kicker badge */}
          <div className="inline-flex items-center rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1">
            <span className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
              {kicker}
            </span>
          </div>

          {/* Title */}
          <h1 className="mt-3 text-[28px] font-semibold leading-[1.15] tracking-tight text-white md:text-[32px]">
            {title}
          </h1>

          {/* Summary */}
          <p className="mt-2.5 max-w-xl text-sm leading-relaxed text-zinc-500">
            {summary}
          </p>
        </div>

        {action ? <div className="shrink-0 md:mt-0.5">{action}</div> : null}
      </div>

      {/* Divider */}
      <div className="mt-7 h-px bg-white/[0.06]" />
    </header>
  );
}
