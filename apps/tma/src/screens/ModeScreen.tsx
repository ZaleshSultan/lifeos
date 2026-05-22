import {
  CalendarDays,
  Check,
  Clock3,
  Infinity,
  RotateCcw,
  Settings2,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  useClearModeMutation,
  useModeQuery,
  useSaveModeMutation,
} from "../api/hooks";
import type { LifeMode, SaveModeInput } from "../api/types";
import { ErrorPanel, LoadingPanel } from "../components/AsyncState";
import { cx } from "../lib/styles";

const modeOptions: Array<{ value: LifeMode | "auto"; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "exam_war", label: "Exam War" },
  { value: "summer", label: "Summer" },
  { value: "trimester", label: "Trimester" },
  { value: "recovery", label: "Recovery" },
  { value: "project_sprint", label: "Project Sprint" },
  { value: "maintenance", label: "Maintenance" },
];

const durationOptions: Array<{
  value: NonNullable<SaveModeInput["duration"]>;
  label: string;
  icon: typeof Clock3;
}> = [
  { value: "today", label: "Today", icon: Clock3 },
  { value: "7_days", label: "7 days", icon: CalendarDays },
  { value: "until_date", label: "Until date", icon: CalendarDays },
  { value: "permanent", label: "Permanent", icon: Infinity },
];

function formatSignedWeight(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

export function ModeScreen() {
  const query = useModeQuery();
  const saveMode = useSaveModeMutation();
  const clearMode = useClearModeMutation();
  const [selectedMode, setSelectedMode] = useState<LifeMode | "auto">("auto");
  const [duration, setDuration] =
    useState<NonNullable<SaveModeInput["duration"]>>("permanent");
  const [untilDate, setUntilDate] = useState("");

  useEffect(() => {
    if (!query.data) {
      return;
    }

    setSelectedMode(query.data.source === "manual" ? query.data.mode : "auto");
  }, [query.data]);

  const topWeights = useMemo(() => {
    return Object.entries(query.data?.priorityWeights ?? {})
      .sort((left, right) => Math.abs(right[1]) - Math.abs(left[1]))
      .slice(0, 6);
  }, [query.data?.priorityWeights]);

  if (query.isLoading) {
    return <LoadingPanel title="Loading mode" />;
  }

  if (query.isError) {
    return (
      <ErrorPanel
        detail={query.error.message}
        onRetry={() => void query.refetch()}
        title="Mode unavailable"
      />
    );
  }

  if (!query.data) {
    return (
      <ErrorPanel
        onRetry={() => void query.refetch()}
        title="Mode returned no data"
      />
    );
  }

  const current = query.data;
  const saveDisabled =
    saveMode.isPending ||
    clearMode.isPending ||
    (selectedMode !== "auto" && duration === "until_date" && !untilDate);

  function onSave() {
    if (selectedMode === "auto") {
      clearMode.mutate();
      return;
    }

    saveMode.mutate({
      mode: selectedMode,
      duration,
      untilDate: duration === "until_date" ? untilDate : undefined,
    });
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 shadow-panel">
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-cyan-400/20 bg-cyan-400/[0.08] text-cyan-300">
            <Settings2 className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-zinc-500">
              {current.source}
            </div>
            <h2 className="mt-1 break-words text-[26px] font-semibold leading-tight tracking-tight text-white">
              {current.label}
            </h2>
            <p className="mt-2 break-words text-sm text-zinc-300">
              {current.reason}
            </p>
            {current.source === "manual" && current.activeUntil ? (
              <div className="mt-3 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs font-medium text-zinc-300">
                {current.activeUntil}
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 shadow-panel">
        <div className="grid grid-cols-2 gap-2">
          {modeOptions.map((option) => {
            const active = selectedMode === option.value;

            return (
              <button
                className={cx(
                  "min-h-12 rounded-lg border px-3 text-sm font-semibold transition active:scale-[0.98]",
                  active
                    ? "border-cyan-400/30 bg-cyan-400/[0.12] text-cyan-200"
                    : "border-white/[0.08] bg-white/[0.03] text-zinc-400",
                )}
                key={option.value}
                onClick={() => setSelectedMode(option.value)}
                type="button"
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </section>

      {selectedMode === "auto" ? null : (
        <section className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 shadow-panel">
          <div className="grid grid-cols-2 gap-2">
            {durationOptions.map((option) => {
              const Icon = option.icon;
              const active = duration === option.value;

              return (
                <button
                  className={cx(
                    "inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-semibold transition active:scale-[0.98]",
                    active
                      ? "border-emerald-400/30 bg-emerald-400/[0.1] text-emerald-200"
                      : "border-white/[0.08] bg-white/[0.03] text-zinc-400",
                  )}
                  key={option.value}
                  onClick={() => setDuration(option.value)}
                  type="button"
                >
                  <Icon className="h-4 w-4" />
                  {option.label}
                </button>
              );
            })}
          </div>

          {duration === "until_date" ? (
            <input
              className="mt-3 min-h-12 w-full rounded-lg border border-white/[0.08] bg-black/20 px-3 text-sm font-semibold text-white"
              onChange={(event) => setUntilDate(event.target.value)}
              type="date"
              value={untilDate}
            />
          ) : null}
        </section>
      )}

      <section className="grid grid-cols-2 gap-2">
        <button
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-cyan-300 px-4 text-sm font-semibold text-graphite-950 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-60"
          disabled={saveDisabled}
          onClick={onSave}
          type="button"
        >
          <Check className="h-4 w-4" />
          Save
        </button>
        <button
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-4 text-sm font-semibold text-zinc-200 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-60"
          disabled={clearMode.isPending || saveMode.isPending}
          onClick={() => clearMode.mutate()}
          type="button"
        >
          <Trash2 className="h-4 w-4" />
          Clear
        </button>
      </section>

      {saveMode.isError ? (
        <ErrorPanel detail={saveMode.error.message} title="Save failed" />
      ) : null}
      {clearMode.isError ? (
        <ErrorPanel detail={clearMode.error.message} title="Clear failed" />
      ) : null}

      <section className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 shadow-panel">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          <RotateCcw className="h-5 w-5 text-cyan-400" />
          Weights
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {topWeights.map(([key, value]) => (
            <div className="rounded-lg bg-white/[0.03] px-3 py-2" key={key}>
              <div className="truncate text-xs text-zinc-500">{key}</div>
              <div className="mt-1 text-base font-semibold text-zinc-100">
                {formatSignedWeight(value)}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
