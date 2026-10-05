// A date field that reads as plain YYYY-MM-DD text, the same format as the
// files, instead of the browser's locale format. Typing a full valid date
// applies it; the calendar button opens a small month calendar of our own
// (the browser's picker can't be closed reliably when its input is hidden).

import { type CSSProperties, useEffect, useRef, useState } from "react";
import { addMonths, type Day, dayParts, formatDay, monthName, parseDay, startOfMonth, startOfWeek, today } from "../model/dates";
import { Icon } from "./Icon";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const CAL_W = 232;
const CAL_H = 262;
const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

interface Props {
  /** YYYY-MM-DD, or "" for no date. */
  value: string;
  onChange(value: string): void;
  onBlur?(): void;
  disabled?: boolean;
  autoFocus?: boolean;
  "aria-label"?: string;
  placeholder?: string;
}

export function DateInput({ value, onChange, onBlur, disabled, autoFocus, placeholder, ...rest }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const [calendar, setCalendar] = useState<{ month: Day; style: CSSProperties } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const shown = draft ?? value;
  const invalid = draft !== null && draft !== "" && !(ISO.test(draft) && parseDay(draft) !== null);

  const open = () => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    // Below the field, or above it when there's no room; kept inside the window.
    const below = box.bottom + 4 + CAL_H <= window.innerHeight;
    const style: CSSProperties = {
      left: Math.max(8, Math.min(box.left, window.innerWidth - CAL_W - 8)),
      top: below ? box.bottom + 4 : Math.max(8, box.top - 4 - CAL_H),
    };
    setCalendar({ month: startOfMonth(parseDay(value) ?? today()), style });
  };
  const close = () => setCalendar(null);

  // Close on a click elsewhere, on scroll, or when the window changes size.
  useEffect(() => {
    if (!calendar) return;
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && close();
    const onScroll = (e: Event) => !ref.current?.contains(e.target as Node) && close();
    document.addEventListener("pointerdown", away, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [calendar]);

  const pick = (day: Day) => {
    onChange(formatDay(day));
    setDraft(null);
    close();
    onBlur?.();
  };

  return (
    <span
      ref={ref}
      className={`date-input${invalid ? " invalid" : ""}`}
      onKeyDown={(e) => {
        // Esc closes the calendar first, without also closing the editor around it.
        if (e.key === "Escape" && calendar) {
          e.stopPropagation();
          close();
        }
      }}
    >
      <input
        type="text"
        inputMode="numeric"
        placeholder={placeholder ?? "YYYY-MM-DD"}
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
        <button
          type="button"
          className="date-pick"
          tabIndex={-1}
          aria-label="Pick a date"
          aria-expanded={!!calendar}
          onClick={(e) => {
            e.preventDefault(); // inside a <label>, don't also focus the text field
            if (calendar) close();
            else open();
          }}
        >
          <Icon name="calendar" size={14} />
        </button>
      )}
      {calendar && (
        <Calendar
          month={calendar.month}
          selected={parseDay(value)}
          style={calendar.style}
          onMonth={(month) => setCalendar({ ...calendar, month })}
          onPick={pick}
        />
      )}
    </span>
  );
}

function Calendar({
  month,
  selected,
  style,
  onMonth,
  onPick,
}: {
  month: Day;
  selected: Day | null;
  style: CSSProperties;
  onMonth(month: Day): void;
  onPick(day: Day): void;
}) {
  const { year, month: m } = dayParts(month);
  const first = startOfWeek(month);
  const now = today();
  const days = Array.from({ length: 42 }, (_, i) => first + i);
  return (
    <div className="calendar" role="dialog" aria-label="Choose a date" style={style}>
      <div className="calendar-head">
        <button type="button" className="icon-button" aria-label="Previous month" onClick={() => onMonth(addMonths(month, -1))}>
          <Icon name="chevron-right" size={14} className="flip" />
        </button>
        <span className="calendar-title">
          {monthName(m)} {year}
        </span>
        <button type="button" className="icon-button" aria-label="Next month" onClick={() => onMonth(addMonths(month, 1))}>
          <Icon name="chevron-right" size={14} />
        </button>
      </div>
      <div className="calendar-grid">
        {WEEKDAYS.map((d, i) => (
          <span key={i} className="calendar-weekday">
            {d}
          </span>
        ))}
        {days.map((day) => {
          const p = dayParts(day);
          const classes = [
            "calendar-day",
            p.month !== m && "outside",
            p.weekday >= 5 && "weekend",
            day === now && "today",
            day === selected && "selected",
          ];
          return (
            <button
              key={day}
              type="button"
              className={classes.filter(Boolean).join(" ")}
              aria-label={formatDay(day)}
              aria-pressed={day === selected}
              onClick={() => onPick(day)}
            >
              {p.day}
            </button>
          );
        })}
      </div>
      <div className="calendar-foot">
        <button type="button" className="add-button small" onClick={() => onPick(now)}>
          Today
        </button>
      </div>
    </div>
  );
}
