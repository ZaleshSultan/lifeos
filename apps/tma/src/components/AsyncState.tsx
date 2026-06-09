import { AlertTriangle, RefreshCw } from "lucide-react";

interface AsyncStateProps {
  title: string;
  detail?: string;
  onRetry?: () => void;
}

export function LoadingPanel({ title }: Pick<AsyncStateProps, "title">) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 shadow-panel">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <div className="h-3 w-24 animate-pulse rounded-full bg-white/10" />
          <div className="h-6 w-40 animate-pulse rounded-md bg-white/10" />
        </div>
        <div className="h-12 w-12 animate-pulse rounded-xl bg-white/10" />
      </div>
      <div className="mt-5 space-y-2">
        <div className="h-14 animate-pulse rounded-lg bg-white/[0.06]" />
        <div className="h-14 animate-pulse rounded-lg bg-white/[0.06]" />
        <div className="h-14 animate-pulse rounded-lg bg-white/[0.06]" />
      </div>
      <p className="mt-4 text-sm text-zinc-500">{title}</p>
    </div>
  );
}

export function ErrorPanel({ title, detail, onRetry }: AsyncStateProps) {
  return (
    <div className="rounded-xl border border-rose-400/25 bg-rose-950/30 p-4 shadow-panel">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 flex-none text-pulse-rose" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-rose-100">{title}</h2>
          {detail ? (
            <p className="mt-1 break-words text-sm text-rose-100/75">
              {detail}
            </p>
          ) : null}
        </div>
      </div>
      {onRetry ? (
        <button
          className="mt-4 inline-flex h-11 items-center gap-2 rounded-lg bg-white/10 px-4 text-sm font-semibold text-white active:scale-[0.98]"
          onClick={onRetry}
          type="button"
        >
          <RefreshCw className="h-4 w-4" />
          Retry
        </button>
      ) : null}
    </div>
  );
}
