// A date field that reads as plain YYYY-MM-DD text, the same format as the
// files, instead of the browser's locale format. Typing a full valid date
// applies it, and in an `optional` field clearing the text clears the date.
// Text that more typing can't make a date says why just under the field
// (tied to it, and announced); leaving the field without a date puts its
// value back.
//
// Beside it, "Choose date" (or Option/Alt+↓ in the field) opens a month
// calendar of our own, an APG date-picker dialog: the browser's picker can't
// be closed reliably when its input is hidden. Its days are a grid with one
// Tab stop: ← → move a working day (weekends show, but can't be picked),
// ↑ ↓ a week, Home and End to Monday and Friday, Page Up and Page Down a
// month (with Shift, a year), as calendarMove (model/dates.ts) says; Enter or
// Space picks. Tab goes round the calendar's own controls, buttons too (Safari's
// Tab skips them). Escape closes the calendar and nothing else: not the
// editor or native dialog it's in. Closing gives focus back to what opened it.

import { type KeyboardEvent, type RefObject, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { announce } from "../a11y/announce";
import { focusLater, focusLost, loopTab } from "../a11y/focus";
import { APPLE } from "../a11y/keys";
import {
  calendarMove,
  type Day,
  dayParts,
  formatDay,
  isWeekend,
  makeDay,
  monthName,
  nextWorkday,
  parseDay,
  sameDayMonthsOn,
  spokenDay,
  startOfWeek,
  today,
  WEEKDAYS,
  workdayInMonth,
} from "../model/dates";
import { describedBy, FieldError } from "./FieldError";
import { Icon } from "./Icon";
import { scrolledAway } from "./useAnchor";

/** A date's shape, d for a digit. */
const SHAPE = "dddd-dd-dd";
/** How to write a date here, and how to open the calendar from the keyboard (said with the field). */
const HINT = `Written YYYY-MM-DD. ${APPLE ? "Option" : "Alt"} with Down opens a calendar.`;

/** Why `text`, typed in a date field, can't become a date however it goes on (half a date will do), or null. */
function problem(text: string): string | null {
  const shaped = [...text].every((c, i) => (SHAPE[i] === "-" ? c === "-" : SHAPE[i] === "d" && c >= "0" && c <= "9"));
  if (!shaped) return "Dates are written YYYY-MM-DD.";
  return text.length === SHAPE.length && parseDay(text) === null ? `${text} isn’t a date.` : null;
}

interface Props {
  /** YYYY-MM-DD, or "" for no date. */
  value: string;
  onChange(value: string): void;
  onBlur?(): void;
  disabled?: boolean;
  autoFocus?: boolean;
  /** The date can be left out: clearing the text clears it (onChange("")), and the calendar has Clear. */
  optional?: boolean;
  /**
   * The calendar button is a Tab stop as buttons are (in Safari, as its Tab setting says, but in the
   * box and PTO editors, whose Tab goes round every control). Not in a table's rows, where two more a
   * row would be too many: Option/Alt+↓ opens it there, and everywhere.
   */
  pickerTabStop?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  /** Notes about the field (a weekend date moved to a weekday, say). */
  "aria-describedby"?: string;
  placeholder?: string;
}

export function DateInput({ value, onChange, onBlur, disabled, autoFocus, optional, pickerTabStop = true, placeholder, ...rest }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  /**
   * The open calendar: the field's box, to show it by; what opened it, which focus goes back
   * to; and whether a key did, when focus in it shows its ring at once.
   */
  const [calendar, setCalendar] = useState<{ anchor: DOMRect; opener: HTMLElement; byKey: boolean } | null>(null);
  const field = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const ids = { error: useId(), hint: useId(), label: useId(), value: useId(), dialog: useId() };
  const day = parseDay(value);
  const shown = draft ?? value;
  const wrong = draft === null ? null : problem(draft);

  // Made read-only while it's open (a table row while a save runs, say): it goes, and nothing in it can be picked.
  if (disabled && calendar) setCalendar(null);

  const open = (opener: HTMLElement, byKey: boolean) => {
    const anchor = field.current?.getBoundingClientRect();
    if (anchor) setCalendar({ anchor, opener, byKey });
  };
  /** Put the calendar away, focus going back to what opened it. */
  const close = () => {
    calendar?.opener.focus();
    setCalendar(null);
  };

  // A press elsewhere closes it, leaving focus where the press put it (put nowhere, a press on
  // text say, it goes back to what opened it); so does a resize. A scroll moves it with the field (a
  // table scrolls a clicked button clear of its header or title column as it opens), until what
  // opened it is scrolled out of sight: then it closes too. So do a table's rows above it getting
  // shorter or taller (a description closing as the click that left it ends).
  useEffect(() => {
    if (!calendar) return;
    const inCalendar = (t: EventTarget | null) => t instanceof Node && !!dialog.current?.contains(t);
    const away = (e: PointerEvent) => {
      if (inCalendar(e.target) || button.current?.contains(e.target as Node)) return;
      if (inCalendar(document.activeElement)) focusLater([() => calendar.opener]);
      setCalendar(null);
    };
    const adrift = (e: Event) => {
      if (inCalendar(e.target)) return;
      if (e.type === "scroll" && field.current && dialog.current && !scrolledAway(e, calendar.opener, dialog.current)) {
        setCalendar({ ...calendar, anchor: field.current.getBoundingClientRect() });
        return;
      }
      if (inCalendar(document.activeElement)) calendar.opener.focus({ preventScroll: true });
      setCalendar(null);
    };
    // The table it's in changing height: a row above it may have, moving the field.
    const rows = new ResizeObserver(() => {
      const at = field.current?.getBoundingClientRect();
      if (at && (at.top !== calendar.anchor.top || at.left !== calendar.anchor.left)) setCalendar({ ...calendar, anchor: at });
    });
    const table = field.current?.closest("table");
    if (table) rows.observe(table);
    document.addEventListener("pointerdown", away, true);
    window.addEventListener("scroll", adrift, true);
    window.addEventListener("resize", adrift);
    return () => {
      rows.disconnect();
      document.removeEventListener("pointerdown", away, true);
      window.removeEventListener("scroll", adrift, true);
      window.removeEventListener("resize", adrift);
    };
  }, [calendar]);

  /** Done typing (focus left, or Enter): text that isn't a date is dropped, and the field shows its value again. */
  const settle = () => {
    if (draft === "") announce(`A date is needed here, so the field is back to ${value}.`);
    else if (draft !== null) announce(`“${draft}” isn’t a date, so the field is back to ${value || "empty"}.`);
    setDraft(null);
    onBlur?.();
  };

  /** A day picked in the calendar, or null: the date cleared. */
  const pick = (picked: Day | null) => {
    onChange(picked === null ? "" : formatDay(picked));
    setDraft(null);
    close();
    onBlur?.();
  };

  return (
    <span ref={field} className={`date-input${wrong ? " invalid" : ""}`}>
      <input
        type="text"
        inputMode="numeric"
        placeholder={placeholder ?? "YYYY-MM-DD"}
        maxLength={10}
        value={shown}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-label={rest["aria-label"]}
        aria-labelledby={rest["aria-labelledby"]}
        aria-invalid={!!wrong || undefined}
        aria-describedby={describedBy(wrong && ids.error, rest["aria-describedby"], !disabled && ids.hint)}
        aria-keyshortcuts={disabled ? undefined : "Alt+ArrowDown"}
        onChange={(e) => {
          const text = e.target.value;
          if (parseDay(text) !== null || (optional && text === "")) {
            onChange(text);
            setDraft(null);
          } else setDraft(text);
        }}
        onBlur={settle}
        onKeyDown={(e) => {
          if (e.key === "Escape" && draft !== null) {
            // What was typed goes, and nothing else: not the editor, nor a native dialog (whose Escape is a default action).
            e.preventDefault();
            e.stopPropagation();
            setDraft(null);
          }
          // Enter settles the field as leaving it would, but stays in it.
          if (e.key === "Enter") settle();
          if (e.key === "ArrowDown" && e.altKey && !disabled) {
            e.preventDefault();
            // Half a date typed goes quietly as focus leaves for the calendar, the other way to give
            // the date, which opens on the field's. (A press on the button has left the field already.)
            setDraft(null);
            open(e.currentTarget, true);
          }
        }}
      />
      {!disabled && (
        <button
          ref={button}
          type="button"
          className="date-pick"
          tabIndex={pickerTabStop ? undefined : -1}
          aria-label="Choose date"
          // Which date, by the field's label (Start and End's buttons have one name), and the date in it.
          aria-describedby={describedBy(rest["aria-labelledby"] ?? (rest["aria-label"] && ids.label), day !== null && ids.value)}
          aria-haspopup="dialog"
          aria-expanded={!!calendar}
          aria-controls={calendar ? ids.dialog : undefined}
          // A click with no pointer (detail 0) is Enter or Space.
          onClick={(e) => (calendar ? close() : open(e.currentTarget, e.detail === 0))}
        >
          <Icon name="calendar" size={14} />
        </button>
      )}
      {!disabled && (
        <span id={ids.hint} hidden>
          {HINT}
        </span>
      )}
      {!disabled && rest["aria-label"] && (
        <span id={ids.label} hidden>
          {rest["aria-label"]}
        </span>
      )}
      {day !== null && (
        <span id={ids.value} hidden>
          {spokenDay(day)}
        </span>
      )}
      <FieldError id={ids.error} className="field-error date-problem">
        {wrong}
      </FieldError>
      {calendar && (
        <Calendar
          ref={dialog}
          id={ids.dialog}
          anchor={calendar.anchor}
          byKey={calendar.byKey}
          value={value}
          optional={optional}
          onPick={pick}
          onClose={close}
        />
      )}
    </span>
  );
}

function Calendar({
  ref,
  id,
  anchor,
  byKey,
  value,
  optional,
  onPick,
  onClose,
}: {
  ref: RefObject<HTMLDivElement | null>;
  id: string;
  /** The field's box: the calendar shows below it, or above it without room there. */
  anchor: DOMRect;
  /** Opened from the keyboard. */
  byKey: boolean;
  value: string;
  optional?: boolean;
  /** A day picked, or null: the date cleared. */
  onPick(day: Day | null): void;
  onClose(): void;
}) {
  const now = today();
  const selected = parseDay(value);
  /** What Today picks: today, or Monday at a weekend. */
  const todayPick = nextWorkday(now);
  const todayText = isWeekend(now) ? "Next working day" : "Today";
  // The day with the grid's Tab stop, which keys move: the field's date, else Today's. Its month is the one shown.
  const [active, setActive] = useState(() => (selected === null ? todayPick : workdayInMonth(selected)));
  const { year, month } = dayParts(active);
  const headId = useId();
  const grid = useRef<HTMLTableElement>(null);
  /**
   * Focus goes to the active day once it's drawn: on opening, and after a key in the grid; with
   * its ring when a key moved it (browsers differ on that for a script's focus, and on Option/Alt+↓).
   */
  const focusDay = useRef<{ ring: boolean } | null>({ ring: byKey });

  // Below the field, or above it when there's no room; kept inside the window.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const below = anchor.bottom + 4 + el.offsetHeight <= window.innerHeight;
    el.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - el.offsetWidth - 8))}px`;
    el.style.top = `${below ? anchor.bottom + 4 : Math.max(8, anchor.top - 4 - el.offsetHeight)}px`;
  }, [ref, anchor]);

  // Also when the day that had focus has gone: another month shown by a month button that
  // took no focus (WebKit gives a clicked button none). One that has focus keeps it.
  useLayoutEffect(() => {
    if (focusDay.current || focusLost()) {
      const focusVisible = focusDay.current?.ring || undefined;
      grid.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus({ preventScroll: true, focusVisible });
    }
    focusDay.current = null;
  }, [active]);

  const onGridKey = (e: KeyboardEvent<HTMLTableElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault(); // no click on the button focus goes back to, nor a scroll
      onPick(active);
      return;
    }
    const next = calendarMove(active, e.key, e.shiftKey);
    if (next === null) return;
    e.preventDefault();
    if (next === active) return;
    focusDay.current = { ring: true };
    setActive(next);
  };

  const first = makeDay(year, month, 1);
  const last = makeDay(year, month + 1, 0);
  const weeks: Day[] = [];
  for (let monday = startOfWeek(first); monday <= last; monday += 7) weeks.push(monday);

  return (
    <div
      ref={ref}
      id={id}
      className="calendar"
      role="dialog"
      aria-modal="true"
      aria-label="Choose date"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          // The calendar only: not the editor it's in, nor a native dialog (whose Escape is a default action).
          e.preventDefault();
          e.stopPropagation();
          onClose();
        } else loopTab(e);
      }}
      // A press on a day, a weekend or the space between leaves focus where it is (on the day with the Tab stop).
      onMouseDown={(e) => !(e.target as Element).closest("button") && e.preventDefault()}
    >
      <div className="calendar-head">
        <button type="button" className="icon-button" aria-label="Previous month" onClick={() => setActive(sameDayMonthsOn(active, -1))}>
          <Icon name="chevron-right" size={14} className="flip" />
        </button>
        {/* Said when it changes: the grid's name, and the month a key or button went to. */}
        <h2 id={headId} className="calendar-title" aria-live="polite">
          {monthName(month)} {year}
        </h2>
        <button type="button" className="icon-button" aria-label="Next month" onClick={() => setActive(sameDayMonthsOn(active, 1))}>
          <Icon name="chevron-right" size={14} />
        </button>
      </div>
      <div className="calendar-days">
        <table ref={grid} className="calendar-grid" role="grid" aria-labelledby={headId} onKeyDown={onGridKey}>
          <thead>
            <tr>
              {WEEKDAYS.map((name) => (
                <th key={name} scope="col">
                  <span aria-hidden="true">{name[0]}</span>
                  <span className="sr-only">{name}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((monday) => (
              <tr key={monday}>
                {WEEKDAYS.map((_, i) => {
                  const d = monday + i;
                  const p = dayParts(d);
                  if (p.month !== month) return <td key={d} />;
                  const weekend = p.weekday >= 5;
                  const classes = ["calendar-day", weekend && "weekend", d === now && "today", d === selected && "selected"];
                  return (
                    <td
                      key={d}
                      role="gridcell"
                      className={classes.filter(Boolean).join(" ")}
                      // Weekends can't be picked, so keys never stop on them: no tabindex at all.
                      tabIndex={weekend ? undefined : d === active ? 0 : -1}
                      // Today and the field's date are said, not only shown.
                      aria-label={[spokenDay(d), d === now && "today", d === selected && "selected"].filter(Boolean).join(", ")}
                      aria-selected={d === selected || undefined}
                      aria-current={d === now ? "date" : undefined}
                      aria-disabled={weekend || undefined}
                      // Focus put on a day another way (VoiceOver's cursor moves it) moves the Tab stop there, so keys go on from it.
                      onFocus={weekend ? undefined : () => setActive(d)}
                      onClick={weekend ? undefined : () => onPick(d)}
                    >
                      {p.day}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="calendar-foot">
        {optional && selected !== null && (
          <button type="button" className="add-button small" onClick={() => onPick(null)}>
            Clear
          </button>
        )}
        <button type="button" className="add-button small" aria-label={`${todayText}, ${formatDay(todayPick)}`} onClick={() => onPick(todayPick)}>
          {todayText}
        </button>
      </div>
    </div>
  );
}
