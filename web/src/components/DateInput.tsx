// A date field that reads as plain YYYY-MM-DD text, the same format as the
// files, instead of the browser's locale format. Typing a full valid date
// applies it; the calendar button opens the browser's date picker.

import { useRef, useState } from "react";
import { parseDay } from "../model/dates";
import { Icon } from "./Icon";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

interface Props {
  /** YYYY-MM-DD, or "" for no date. */
  value: string;
  onChange(value: string): void;
  onBlur?(): void;
  disabled?: boolean;
  autoFocus?: boolean;
  "aria-label"?: string;
  className?: string;
}

export function DateInput({ value, onChange, onBlur, disabled, autoFocus, className, ...rest }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const native = useRef<HTMLInputElement>(null);
  const shown = draft ?? value;
  const invalid = draft !== null && draft !== "" && !(ISO.test(draft) && parseDay(draft) !== null);

  return (
    <span className={`date-input${invalid ? " invalid" : ""}${className ? ` ${className}` : ""}`}>
      <input
        type="text"
        inputMode="numeric"
        placeholder="YYYY-MM-DD"
        maxLength={10}
        value={shown}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-label={rest["aria-label"]}
        aria-invalid={invalid || undefined}
        onChange={(e) => {
          const text = e.target.value;
          setDraft(text);
          if (ISO.test(text) && parseDay(text) !== null) {
            onChange(text);
            setDraft(null);
          }
        }}
        onBlur={() => {
          setDraft(null);
          onBlur?.();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && draft !== null) {
            e.stopPropagation();
            setDraft(null);
          }
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
      {!disabled && (
        <>
          <button
            type="button"
            className="date-pick"
            tabIndex={-1}
            aria-label="Pick a date"
            onClick={(e) => {
              e.preventDefault();
              const el = native.current;
              if (!el) return;
              try {
                el.showPicker();
              } catch {
                el.focus();
              }
            }}
          >
            <Icon name="calendar" size={14} />
          </button>
          <input
            ref={native}
            className="date-native"
            type="date"
            tabIndex={-1}
            aria-hidden="true"
            value={value}
            onChange={(e) => e.target.value && onChange(e.target.value)}
          />
        </>
      )}
    </span>
  );
}
