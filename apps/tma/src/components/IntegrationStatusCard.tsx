import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  ExternalLink,
  PauseCircle,
} from "lucide-react";
import { cx } from "../lib/styles";

export type IntegrationDisplayStatus =
  | "connected"
  | "disconnected"
  | "disabled"
  | "not_configured"
  | "error";

interface IntegrationStatusCardProps {
  title: string;
  status: IntegrationDisplayStatus;
  description: string;
  actionLabel?: string;
  actionBusy?: boolean;
  actionDisabled?: boolean;
  onAction?: () => void;
}

const statusLabels: Record<IntegrationDisplayStatus, string> = {
  connected: "connected",
  disconnected: "disconnected",
  disabled: "disabled",
  not_configured: "not configured",
  error: "error",
};

function statusStyle(status: IntegrationDisplayStatus): string {
  if (status === "connected") {
    return "border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300";
  }

  if (status === "error") {
    return "border-rose-400/20 bg-rose-400/[0.08] text-rose-300";
  }

  if (status === "disabled") {
    return "border-amber-400/20 bg-amber-400/[0.08] text-amber-300";
  }

  return "border-white/[0.08] bg-white/[0.04] text-zinc-300";
}

function StatusIcon({ status }: { status: IntegrationDisplayStatus }) {
  if (status === "connected") {
    return <CheckCircle2 className="h-4 w-4 text-emerald-300" />;
  }

  if (status === "error") {
    return <AlertTriangle className="h-4 w-4 text-rose-300" />;
  }

  if (status === "disabled") {
    return <PauseCircle className="h-4 w-4 text-amber-300" />;
  }

  return <CircleDashed className="h-4 w-4 text-zinc-500" />;
}

export function IntegrationStatusCard({
  actionBusy,
  actionDisabled,
  actionLabel,
  description,
  onAction,
  status,
  title,
}: IntegrationStatusCardProps) {
  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusIcon status={status} />
            <h3 className="truncate text-sm font-semibold text-white">
              {title}
            </h3>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-zinc-500">
            {description}
          </p>
        </div>
        <span
          className={cx(
            "shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium",
            statusStyle(status),
          )}
        >
          {statusLabels[status]}
        </span>
      </div>
      {actionLabel && onAction ? (
        <button
          className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-cyan-300/25 bg-cyan-300/10 px-3 text-sm font-semibold text-cyan-100 disabled:opacity-60"
          disabled={actionBusy || actionDisabled}
          onClick={onAction}
          type="button"
        >
          <ExternalLink className="h-4 w-4" />
          {actionBusy ? "Opening..." : actionLabel}
        </button>
      ) : null}
    </div>
  );
}
