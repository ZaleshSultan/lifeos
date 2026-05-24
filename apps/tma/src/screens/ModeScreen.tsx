import {
  BookOpenCheck,
  CalendarDays,
  Check,
  Clock3,
  GraduationCap,
  Infinity,
  Percent,
  RotateCcw,
  Settings2,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  useClearModeMutation,
  useDiscreteMathCourseQuery,
  useModeQuery,
  useSaveModeMutation,
  useUpdateDiscreteMathCourseProgressMutation,
} from "../api/hooks";
import type { LifeMode, SaveModeInput } from "../api/types";
import { ErrorPanel, LoadingPanel } from "../components/AsyncState";
import { formatDateTime } from "../lib/format";
import { cx } from "../lib/styles";

const modeOptions: Array<{ value: LifeMode | "auto"; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "exam_war", label: "Exam War" },
  { value: "practice", label: "Practice" },
  { value: "recovery_setup", label: "Recovery Setup" },
  { value: "summer_term", label: "Summer Term" },
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

const COURSE_PROGRESS_MIN = 0;
const COURSE_PROGRESS_MAX = 100;

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return COURSE_PROGRESS_MIN;
  }

  return Math.min(COURSE_PROGRESS_MAX, Math.max(COURSE_PROGRESS_MIN, value));
}

function formatSignedWeight(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function formatPercent(value: number): string {
  const percent = clampPercent(value);
  return Number.isInteger(percent) ? String(percent) : percent.toFixed(1);
}

function formatCourseWindow(
  startsOn?: string | null,
  endsOn?: string | null,
): string {
  const start = startsOn?.slice(5);
  const end = endsOn?.slice(5);

  if (start && end) {
    return `${start} - ${end}`;
  }

  if (start) {
    return `From ${start}`;
  }

  if (end) {
    return `Until ${end}`;
  }

  return "Dates pending";
}

function formatProgressInput(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function ModeScreen() {
  const query = useModeQuery();
  const courseQuery = useDiscreteMathCourseQuery();
  const saveMode = useSaveModeMutation();
  const clearMode = useClearModeMutation();
  const updateCourseProgress = useUpdateDiscreteMathCourseProgressMutation();
  const [selectedMode, setSelectedMode] = useState<LifeMode | "auto">("auto");
  const [duration, setDuration] =
    useState<NonNullable<SaveModeInput["duration"]>>("permanent");
  const [untilDate, setUntilDate] = useState("");
  const [courseProgress, setCourseProgress] = useState("0");

  useEffect(() => {
    if (!query.data) {
      return;
    }

    setSelectedMode(query.data.source === "manual" ? query.data.mode : "auto");
  }, [query.data]);

  useEffect(() => {
    if (!courseQuery.data) {
      return;
    }

    setCourseProgress(formatProgressInput(courseQuery.data.progressPercent));
  }, [courseQuery.data]);

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
  const course = courseQuery.data;
  const currentCourseProgress = clampPercent(course?.progressPercent ?? 0);
  const parsedCourseProgress =
    courseProgress.trim() === "" ? Number.NaN : Number(courseProgress);
  const selectedCourseProgress = clampPercent(parsedCourseProgress);
  const hasManualOverride = current.source === "manual";
  const hasCourseProgressChange =
    course !== null &&
    course !== undefined &&
    Number.isFinite(parsedCourseProgress) &&
    Math.abs(parsedCourseProgress - course.progressPercent) >= 0.01;
  const saveDisabled =
    saveMode.isPending ||
    clearMode.isPending ||
    (selectedMode !== "auto" && duration === "until_date" && !untilDate);
  const courseProgressDisabled =
    !course ||
    updateCourseProgress.isPending ||
    !Number.isFinite(parsedCourseProgress) ||
    parsedCourseProgress < 0 ||
    parsedCourseProgress > 100 ||
    !hasCourseProgressChange;

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

  function onSaveCourseProgress() {
    if (courseProgressDisabled) {
      return;
    }

    updateCourseProgress.mutate({
      progressPercent: parsedCourseProgress,
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
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-xs font-medium capitalize text-zinc-300">
                {current.source}
              </span>
              <span className="rounded-full border border-cyan-400/20 bg-cyan-400/[0.08] px-2.5 py-1 text-xs font-medium text-cyan-300">
                Current mode
              </span>
            </div>
            <h2 className="mt-1 break-words text-[26px] font-semibold leading-tight tracking-tight text-white">
              {current.label}
            </h2>
            <p className="mt-2 break-words text-sm text-zinc-300">
              {current.reason}
            </p>
            {current.source === "manual" && current.activeUntil ? (
              <div className="mt-3 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs font-medium text-zinc-300">
                Active until {formatDateTime(current.activeUntil)}
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 shadow-panel">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
          <SlidersHorizontal className="h-5 w-5 text-cyan-400" />
          Mode selector
        </div>
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
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
            <Clock3 className="h-5 w-5 text-emerald-400" />
            Duration selector
          </div>
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
          {selectedMode === "auto" ? "Use Auto" : "Save Mode"}
        </button>
        <button
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 text-xs font-semibold text-zinc-200 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-60"
          disabled={clearMode.isPending || saveMode.isPending || !hasManualOverride}
          onClick={() => clearMode.mutate()}
          type="button"
        >
          <Trash2 className="h-4 w-4" />
          Clear Override
        </button>
      </section>

      {saveMode.isError ? (
        <ErrorPanel detail={saveMode.error.message} title="Save failed" />
      ) : null}
      {clearMode.isError ? (
        <ErrorPanel detail={clearMode.error.message} title="Clear failed" />
      ) : null}

      <section className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 shadow-panel">
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300">
            <GraduationCap className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-zinc-500">Summer Term</div>
            <h3 className="mt-1 break-words text-xl font-semibold leading-tight text-white">
              {course?.title ?? "Discrete Mathematics"}
            </h3>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-xs font-medium text-zinc-300">
                {course?.term ?? "Summer 2026"}
              </span>
              <span className="rounded-full border border-emerald-400/20 bg-emerald-400/[0.08] px-2.5 py-1 text-xs font-medium text-emerald-300">
                {courseQuery.isLoading
                  ? "loading"
                  : course?.status ?? "not found"}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2">
            <div className="text-xs text-zinc-500">Window</div>
            <div className="mt-1 text-sm font-semibold text-zinc-100">
              {courseQuery.isLoading
                ? "Loading"
                : formatCourseWindow(course?.startsOn, course?.endsOn)}
            </div>
          </div>
          <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2">
            <div className="text-xs text-zinc-500">Progress</div>
            <div className="mt-1 text-sm font-semibold text-zinc-100">
              {course ? `${formatPercent(currentCourseProgress)}%` : "--"}
            </div>
          </div>
        </div>

        <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className="h-full rounded-full bg-emerald-400 transition-all"
            style={{ width: `${currentCourseProgress}%` }}
          />
        </div>

        <div className="mt-4 grid grid-cols-[1fr_5.5rem] gap-3">
          <label className="min-w-0">
            <span className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-zinc-500">
              <BookOpenCheck className="h-4 w-4 text-emerald-400" />
              Course progress
            </span>
            <input
              className="h-2 w-full appearance-none rounded-full bg-white/[0.08] accent-emerald-300"
              disabled={!course || updateCourseProgress.isPending}
              max="100"
              min="0"
              onChange={(event) => setCourseProgress(event.target.value)}
              step="1"
              type="range"
              value={selectedCourseProgress}
            />
          </label>
          <label>
            <span className="mb-2 flex items-center gap-1 text-xs font-semibold uppercase tracking-widest text-zinc-500">
              <Percent className="h-3.5 w-3.5" />
              Value
            </span>
            <input
              className="h-10 w-full rounded-lg border border-white/[0.08] bg-black/20 px-2 text-center text-sm font-semibold text-white"
              disabled={!course || updateCourseProgress.isPending}
              inputMode="decimal"
              max="100"
              min="0"
              onChange={(event) => setCourseProgress(event.target.value)}
              step="1"
              type="number"
              value={courseProgress}
            />
          </label>
        </div>

        <button
          className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-emerald-300 px-4 text-sm font-semibold text-graphite-950 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-60"
          disabled={courseProgressDisabled}
          onClick={onSaveCourseProgress}
          type="button"
        >
          <Check className="h-4 w-4" />
          Save Progress
        </button>

        {courseQuery.isError ? (
          <p className="mt-3 text-sm text-rose-300">
            Course unavailable: {courseQuery.error.message}
          </p>
        ) : null}
        {updateCourseProgress.isError ? (
          <p className="mt-3 text-sm text-rose-300">
            Progress save failed: {updateCourseProgress.error.message}
          </p>
        ) : null}
      </section>

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
