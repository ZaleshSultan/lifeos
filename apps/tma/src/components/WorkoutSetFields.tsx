import type { SetDraft } from "../lib/workout";

export const workoutInputClass =
  "min-h-11 w-full min-w-0 rounded-lg border border-white/10 bg-graphite-950 px-3 text-base text-white focus:border-cyan-300 focus:outline-none";
export const workoutButtonClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-white/10 px-3 text-sm font-semibold active:scale-[0.98] disabled:opacity-40";
export const workoutPanelClass =
  "rounded-xl border border-white/[0.08] bg-white/[0.03] p-4";

export function WorkoutSetFields({
  value,
  onChange,
  disabled = false,
  labelPrefix = "Подход",
}: {
  value: SetDraft;
  onChange: (value: SetDraft) => void;
  disabled?: boolean;
  labelPrefix?: string;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {(
        [
          ["reps", "Повторы", "numeric"],
          ["weightKg", "Вес, кг", "decimal"],
          ["restSeconds", "Отдых, с", "numeric"],
        ] as const
      ).map(([key, label, mode]) => (
        <label key={key} className="min-w-0 space-y-1 text-xs text-zinc-400">
          <span>{label}</span>
          <input
            aria-label={`${labelPrefix}: ${label}`}
            className={workoutInputClass}
            disabled={disabled}
            inputMode={mode}
            type="text"
            value={value[key]}
            maxLength={8}
            placeholder={key === "weightKg" ? "—" : "0"}
            onChange={(event) =>
              onChange({ ...value, [key]: event.target.value })
            }
          />
        </label>
      ))}
    </div>
  );
}
