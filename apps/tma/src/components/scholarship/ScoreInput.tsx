import { useEffect, useState, useId, useRef } from "react";
import { parseStudyScore } from "../study/model";
export function ScoreInput({
  label,
  value,
  onChange,
  required = false,
  placeholder = "Неизвестно",
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  required?: boolean;
  placeholder?: string;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(value === null ? "" : String(value));
  useEffect(() => {
    setText(value === null ? "" : String(value));
    input.current?.setCustomValidity("");
  }, [value]);
  const invalid =
    parseStudyScore(text) === "invalid" || (required && !text.trim());
  return (
    <div className="block min-w-0 text-xs text-zinc-300">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        ref={input}
        aria-describedby={invalid ? `${id}-error` : undefined}
        className="mt-1 min-h-11 w-full rounded-lg border border-white/15 bg-graphite-950 px-3 text-base tabular-nums text-white focus:border-cyan-300"
        inputMode="decimal"
        type="text"
        maxLength={12}
        required={required}
        value={text}
        placeholder={placeholder}
        aria-invalid={invalid}
        onChange={(event) => {
          const next = event.currentTarget.value;
          setText(next);
          const parsed = parseStudyScore(next);
          event.currentTarget.setCustomValidity(
            parsed === "invalid" || (required && parsed === null)
              ? "Введите число от 0 до 100"
              : "",
          );
          if (parsed !== "invalid" && (!required || parsed !== null))
            onChange(parsed);
        }}
      />
      {invalid ? (
        <span id={`${id}-error`} className="mt-1 block text-amber-200">
          Число от 0 до 100
        </span>
      ) : null}
    </div>
  );
}
