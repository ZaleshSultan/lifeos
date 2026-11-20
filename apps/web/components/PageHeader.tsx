interface PageHeaderProps {
  kicker: string;
  title: string;
  summary: string;
  action?: React.ReactNode;
}

export function PageHeader({ title, summary, action }: PageHeaderProps) {
  return (
    <header className="mb-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          {/* Title */}
          <h1 className="break-words text-[28px] font-semibold leading-[1.15] tracking-tight text-white md:text-[32px]">
            {title}
          </h1>

          {/* Summary */}
          <p className="mt-2.5 max-w-xl text-sm leading-relaxed text-zinc-400">
            {summary}
          </p>
        </div>

        {action ? <div className="shrink-0 md:mt-0.5">{action}</div> : null}
      </div>
    </header>
  );
}
