import type { Ref } from "react";
import { Minus, Plus } from "lucide-react";

/** Accepts blank, digits, and one decimal separator (dot or comma). Returns normalized text or null if rejected. */
export function normalizeQuantityInput(raw: string): string | null {
  const text = raw.trim().replace(",", ".");
  if (text === "") return "";
  if (!/^\d*\.?\d*$/.test(text)) return null;
  if (text === ".") return text;
  return Number.isFinite(Number(text)) ? text : null;
}

export function adjustQuantityText(current: string, delta: number): string {
  const base = Number(current);
  const start = Number.isFinite(base) ? base : 0;
  return String(Math.max(0, Number((start + delta).toFixed(12))));
}

interface CountQuantityFieldProps {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  onEnter?: () => void;
  enterKeyHint: "next" | "done";
  active?: boolean;
  disabled?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  testId: string;
}

export function CountQuantityField({
  id, label, hint, value, onChange, onFocus, onEnter, enterKeyHint,
  active, disabled, inputRef, testId,
}: CountQuantityFieldProps) {
  const stepBtn =
    "h-9 w-9 shrink-0 rounded-md border bg-surface flex items-center justify-center text-foreground active:bg-black/10 disabled:opacity-40";
  return (
    <div
      className={`flex-1 min-w-0 rounded-[12px] border-2 bg-surface px-2.5 py-2 ${
        active ? "border-[#C2410C] bg-orange-50/50" : "border-border"
      }`}
    >
      <label htmlFor={id} className="mb-1 flex items-center justify-between text-[13px] font-semibold text-foreground">
        <span className="capitalize">{label}</span>
        {hint && <span className="font-medium text-muted-foreground">{hint}</span>}
      </label>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className={stepBtn}
          aria-label={`Decrease ${label}`}
          disabled={disabled}
          onClick={() => onChange(adjustQuantityText(value, -1))}
          data-testid={`${testId}-minus`}
        >
          <Minus className="h-4 w-4" />
        </button>
        <input
          id={id}
          ref={inputRef}
          type="text"
          inputMode="decimal"
          enterKeyHint={enterKeyHint}
          autoComplete="off"
          placeholder="0"
          value={value}
          disabled={disabled}
          onFocus={onFocus}
          onChange={(e) => {
            const next = normalizeQuantityInput(e.target.value);
            if (next !== null) onChange(next);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onEnter?.();
            }
          }}
          className="h-11 w-full min-w-0 flex-1 rounded-md bg-transparent text-center font-mono text-[28px] font-bold leading-none tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-[#C2410C] disabled:opacity-50"
          data-testid={testId}
        />
        <button
          type="button"
          className={stepBtn}
          aria-label={`Increase ${label}`}
          disabled={disabled}
          onClick={() => onChange(adjustQuantityText(value, 1))}
          data-testid={`${testId}-plus`}
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
