// Edit one PTO block: whose it is, its dates and a note. Opens from the block
// on the timeline, like the box editor.

import { useEffect, useId, useRef, useState } from "react";
import { formatDay, isWeekend, nextWorkday, parseDay, prettyDay, prevWorkday, workdays } from "../model/dates";
import { ptoKey, ptoRange, type PtoRef } from "../model/pto";
import type { Department, Person, TimeOff } from "../model/types";
import { popoverWidth, useAnchor } from "./useAnchor";
import { Icon } from "./Icon";
import { DateInput } from "./DateInput";
import { LiveRegion } from "../a11y/announce";
import { FieldError, describedBy } from "./FieldError";
import { loopTab, main, onPage, useReturnFocus } from "../a11y/focus";

const WIDTH = 360;

interface Props {
  target: PtoRef;
  pto: TimeOff;
  people: Person[];
  departments: Department[];
  /** `field` groups keystrokes in one field into a single undo step. */
  onChange(patch: Partial<TimeOff>, field: string): void;
  /** Give this PTO to someone else. */
  onReassign(personId: string): void;
  onDelete(): void;
  onClose(): void;
  /** A cell of the timeline (TimelineHandle.cell), drawn first if a big roadmap left it out, off screen: where focus goes back to. */
  cell(key: string): Element | null;
  /** Where focus goes if the block has gone (someone else's save deleted it, or an undo): beside it, as the roadmap was with it. */
  beside(): Element | null;
}

export function PtoEditor({ target, pto, people, departments, onChange, onReassign, onDelete, onClose, cell, beside }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const key = ptoKey(target);
  const pos = useAnchor(ref, `[data-pto-key="${CSS.escape(key)}"]`, WIDTH, [key, pto]);

  // Closed (or gone some other way): focus goes back to the PTO block, drawn again if it's off
  // screen (as for a box); with the block gone too, to what opened it, else beside the block. Not
  // after a click elsewhere, which is where the user went (focus going back would scroll).
  const clickedAway = useRef(false);
  useReturnFocus(ref, (opener) => (clickedAway.current ? null : (cell(`pto:${key}`) ?? onPage(opener) ?? beside() ?? main())));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      // Clicking another PTO block re-targets the editor instead of closing it.
      if (!ref.current?.contains(t) && !t.closest("[data-pto-key]")) {
        clickedAway.current = true;
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [onClose]);

  // Weekends don't exist on the roadmap: a weekend start moves to Monday, a weekend end to Friday.
  // The other end moves too when one passes it: said in the same note. `n` counts the notes, so
  // the same one twice running is said twice.
  const [snapped, setSnapped] = useState<{ text: string; n: number } | null>(null);
  const snap = (notes: (string | false)[]) => {
    const text = notes.filter(Boolean).join(" ");
    setSnapped((cur) => (text ? { text, n: (cur?.n ?? 0) + 1 } : null));
  };
  const setStart = (text: string) => {
    const picked = parseDay(text);
    if (picked === null) return;
    const start = nextWorkday(picked);
    snap([isWeekend(picked) && `Moved to ${prettyDay(start)}: PTO starts on a weekday.`, start > pto.end && `The end moved to ${prettyDay(start)} too.`]);
    onChange(start > pto.end ? { start, end: start } : { start }, "start");
  };
  const setEnd = (text: string) => {
    const picked = parseDay(text);
    if (picked === null) return;
    const end = prevWorkday(picked);
    snap([isWeekend(picked) && `Moved to ${prettyDay(end)}: PTO ends on a weekday.`, end < pto.start && `The start moved to ${prettyDay(end)} too.`]);
    onChange(end < pto.start ? { end, start: end } : { end }, "end");
  };
  const ids = { start: useId(), end: useId(), note: useId() };

  const person = people.find((p) => p.id === target.personId);
  const days = workdays(pto.start, pto.end);
  // Engineers with a department, grouped like the timeline (PTO is drawn in its owner's department).
  const groups = departments
    .map((d) => ({ d, members: people.filter((p) => p.department === d.id).sort((a, b) => a.name.localeCompare(b.name)) }))
    .filter((g) => g.members.length);

  return (
    <div
      ref={ref}
      className="editor pto-editor"
      role="dialog"
      // Modal for the keyboard and screen readers (Tab stays inside); a click outside closes it.
      aria-modal="true"
      aria-label={`Edit PTO for ${person?.name ?? "engineer"}`}
      style={{ width: popoverWidth(WIDTH), top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
      onKeyDown={loopTab}
    >
      {/* VoiceOver reads only live regions inside a modal dialog while it's open. */}
      <LiveRegion />
      <div className="editor-head">
        <span className="code-chip pto-chip">PTO</span>
        <select
          className="editor-title"
          value={target.personId}
          aria-label="Engineer"
          // Whose time off it is comes first, as a box's title does.
          autoFocus
          onChange={(e) => onReassign(e.target.value)}
        >
          {groups.map(({ d, members }) => (
            <optgroup key={d.id} label={d.name}>
              {members.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <button className="icon-button" onClick={onClose} aria-label="Close">
          <Icon name="x" size={16} />
        </button>
      </div>

      <div className="editor-grid">
        <FieldError id={ids.note} className="field-note span-2" news={snapped?.n}>
          {snapped?.text}
        </FieldError>
        {/* Not <label>s: one around the calendar would take its clicks, and its buttons' names. */}
        <div className="field">
          <span className="field-label" id={ids.start}>
            Start
          </span>
          <DateInput value={formatDay(pto.start)} onChange={setStart} aria-labelledby={ids.start} aria-describedby={describedBy(snapped && ids.note)} />
        </div>
        <div className="field">
          <span className="field-label" id={ids.end}>
            End
          </span>
          <DateInput value={formatDay(pto.end)} onChange={setEnd} aria-labelledby={ids.end} aria-describedby={describedBy(snapped && ids.note)} />
        </div>
        <label className="span-2">
          Note
          <input
            value={pto.note ?? ""}
            placeholder="e.g. Holiday, conference"
            onChange={(e) => onChange({ note: e.target.value || undefined }, "note")}
          />
        </label>
      </div>

      <div className="editor-foot">
        <span className="hint">
          {ptoRange(pto)} · {days} working day{days === 1 ? "" : "s"}
        </span>
        <button className="danger" onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  );
}
