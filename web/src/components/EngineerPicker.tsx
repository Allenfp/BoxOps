import { useEffect, useRef, useState } from "react";
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
  /** Accessible name for the button. */
  label?: string;
}

/** A dropdown of the roster with checkboxes, plus a field to add someone new. */
export function EngineerPicker({ value, people, department, onChange, onAddPerson, readOnly, label = "Engineers", emptyLabel }: Props) {
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const names = new Map(people.map((p) => [p.id, p.name]));
  const selected = new Set(value);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation(); // close just this, not the box editor around it
        setOpen(false);
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

  return (
    <div className="picker" ref={ref}>
      <button
        type="button"
        className={`picker-button${value.length ? "" : " empty"}`}
        onClick={() => setOpen((o) => !o)}
        disabled={readOnly}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
      >
        {value.length ? value.map((id) => names.get(id) ?? id).join(", ") : (emptyLabel ?? "Unassigned")}
      </button>
      {open && (
        <div className="picker-menu" role="listbox" aria-multiselectable="true" aria-label={label}>
          {ordered.length === 0 && <p className="hint picker-empty">No engineers yet. Add one below.</p>}
          {ordered.map((p) => (
            <label key={p.id} className="picker-option" role="option" aria-selected={selected.has(p.id)}>
              <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
              {p.name}
            </label>
          ))}
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
