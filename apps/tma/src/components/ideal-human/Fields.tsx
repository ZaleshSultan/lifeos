import type { ReactNode } from "react";
import { cx } from "../../lib/styles";

export const inputClass =
  "mt-1 min-h-11 w-full min-w-0 rounded-lg border border-white/15 bg-zinc-950 px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400 disabled:opacity-60";
export const panelClass =
  "rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 shadow-panel";
export const buttonClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-sm font-medium text-zinc-200 hover:bg-white/[0.06] active:scale-[0.98] disabled:opacity-50";
const labelClass = "block min-w-0 text-xs font-medium text-zinc-300";

export function NumberField({
  title,
  value,
  onChange,
  step = 1,
  min = 0,
  max,
}: {
  title: string;
  value: number | null;
  onChange: (value: number | null) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  return (
    <label className={labelClass}>
      {title}
      <input
        className={inputClass}
        type="number"
        inputMode={step < 1 ? "decimal" : "numeric"}
        min={min}
        max={max}
        step={step}
        value={value ?? ""}
        onChange={(event) =>
          onChange(
            event.target.value === "" ? null : Number(event.target.value),
          )
        }
      />
    </label>
  );
}

export function TextField({
  title,
  value,
  onChange,
  maxLength = 2000,
  multiline = false,
  type = "text",
}: {
  title: string;
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  multiline?: boolean;
  type?: "text" | "time";
}) {
  return (
    <label className={labelClass}>
      {title}
      {multiline ? (
        <textarea
          className={inputClass}
          rows={3}
          maxLength={maxLength}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          className={inputClass}
          type={type}
          maxLength={maxLength}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}

export function ChoiceField<T extends string>({
  title,
  value,
  choices,
  onChange,
}: {
  title: string;
  value: T | null;
  choices: readonly { value: T; label: string }[];
  onChange: (value: T | null) => void;
}) {
  return (
    <label className={labelClass}>
      {title}
      <select
        className={inputClass}
        value={value ?? ""}
        onChange={(e) => onChange((e.target.value || null) as T | null)}
      >
        <option value="">Нет записи</option>
        {choices.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ObservationField({
  title,
  value,
  onChange,
  yes = "Да",
  no = "Нет",
}: {
  title: string;
  value: boolean | null;
  onChange: (value: boolean | null) => void;
  yes?: string;
  no?: string;
}) {
  return (
    <ChoiceField
      title={title}
      value={value === null ? null : value ? "yes" : "no"}
      choices={[
        { value: "yes", label: yes },
        { value: "no", label: no },
      ]}
      onChange={(next) => onChange(next === null ? null : next === "yes")}
    />
  );
}

export function Fold({
  title,
  children,
  open = false,
  detail,
}: {
  title: string;
  children: ReactNode;
  open?: boolean;
  detail?: string;
}) {
  return (
    <details className={panelClass} open={open || undefined}>
      <summary className="min-h-11 cursor-pointer text-base font-semibold text-white marker:text-cyan-300">
        {title}
        {detail ? (
          <span className="mt-1 block pl-4 text-xs font-normal text-zinc-400">
            {detail}
          </span>
        ) : null}
      </summary>
      <div className="mt-3 space-y-3">{children}</div>
    </details>
  );
}

export function StatusTile({
  title,
  value,
  recorded = false,
}: {
  title: string;
  value: string;
  recorded?: boolean;
}) {
  return (
    <div
      className={cx(
        "min-w-0 rounded-lg border p-2.5",
        recorded
          ? "border-emerald-400/20 bg-emerald-400/[0.04]"
          : "border-white/[0.08] bg-white/[0.02]",
      )}
    >
      <p className="text-[11px] text-zinc-400">{title}</p>
      <p className="mt-1 break-words text-sm font-semibold text-zinc-100">
        {value}
      </p>
    </div>
  );
}
