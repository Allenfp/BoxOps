import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import type { Person } from "../model/types";

interface Props {
  /** Selected engineer ids. */
  value: string[];
  people: Person[];
  /** The box's department: its engineers are listed first. */
  department?: string;
  onChange(ids: string[]): void;
  /** Add someone to the roster; returns their new id. */
  onAddPerson(name: string): string;
  readOnly?: boolean;
  /** Shown when nobody is assigned; defaults to "Unassigned". */
  emptyLabel?: string;
}

/**
 * A button saying who's assigned, opening a small dialog: a checkbox per
 * engineer on the roster, plus a field to add someone new. The button's name
 * says who's assigned ("Engineers: Sam Lee, Robin Park"). Opening it focuses
 * the first ticked engineer; ↑ and ↓ move between engineers, Space ticks, and
 * Enter or Escape closes it, back on the button. Tab goes through the
 * engineers to the new-engineer field (Safari's own Tab, which the box editor
 * doesn't use, skips the checkboxes: hence ↑ and ↓).
 */
export function EngineerPicker({ value, people, department, onChange, onAddPerson, readOnly, emptyLabel }: Props) {
  const label = "Engineers";
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const names = new Map(people.map((p) => [p.id, p.name]));
  const selected = new Set(value);
  const shown = value.map((id) => names.get(id) ?? id).join(", ");

  /** Close, and put focus back on the button. */
  const done = () => {
    setOpen(false);
    button.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const boxes = [...(menu.current?.querySelectorAll<HTMLInputElement>("input[type=checkbox]") ?? [])];
    (boxes.find((b) => b.checked) ?? boxes[0] ?? menu.current?.querySelector("input"))?.focus();
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation(); // close just this, not the box editor around it
        setOpen(false);
        if (ref.current?.contains(document.activeElement) || document.activeElement === document.body) button.current?.focus();
      }
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const ordered = [...people].sort(
    (a, b) =>
      Number(b.department === department) - Number(a.department === department) || a.name.localeCompare(b.name),
  );
  const toggle = (id: string) => onChange(selected.has(id) ? value.filter((v) => v !== id) : [...value, id]);
  const add = () => {
    const name = newName.trim();
    if (!name) return;
    const existing = people.find((p) => p.name.toLowerCase() === name.toLowerCase());
    const id = existing?.id ?? onAddPerson(name);
    if (!selected.has(id)) onChange([...value, id]);
    setNewName("");
  };

  /** ↑, ↓, Home and End move between the engineers; Enter closes. */
  const onOptionKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const boxes = [...(menu.current?.querySelectorAll<HTMLInputElement>("input[type=checkbox]") ?? [])];
    const i = boxes.indexOf(e.currentTarget);
    const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: boxes.length - 1 }[e.key];
    if (to !== undefined) {
      e.preventDefault();
      boxes[Math.max(0, Math.min(boxes.length - 1, to))]?.focus();
    } else if (e.key === "Enter") {
      e.preventDefault();
      done();
    }
  };

  return (
    <div
      className="picker"
      ref={ref}
      // Tabbing (or clicking) away to something else closes it.
      onBlur={(e) => e.relatedTarget instanceof Node && !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}
    >
      <button
        ref={button}
        type="button"
        className={`picker-button${value.length ? "" : " empty"}`}
        onClick={() => setOpen((o) => !o)}
        disabled={readOnly}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`${label}: ${shown || "unassigned"}`}
      >
        {shown || (emptyLabel ?? "Unassigned")}
      </button>
      {open && (
        <div className="picker-menu" role="dialog" aria-label={label} id={menuId} ref={menu}>
          {ordered.length === 0 && <p className="hint picker-empty">No engineers yet. Add one below.</p>}
          <div role="group" aria-label="Assigned engineers">
            {ordered.map((p) => (
              <label key={p.id} className="picker-option">
                <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} onKeyDown={onOptionKey} />
                {p.name}
              </label>
            ))}
          </div>
          <form
            className="picker-add"
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Add engineer…"
              aria-label="New engineer name"
            />
            <button type="submit" disabled={!newName.trim()}>
              Add
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
