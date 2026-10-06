import { type KeyboardEvent, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Person } from "../model/types";

/** Between the button and the list, and the least between the list and the window's edge (px). */
const GAP = 4;
const EDGE = 8;

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
  /** Everyone's name by id, when the caller has it already (the table, one for every row). */
  names?: Map<string, string>;
}

/** The list `el` below `button` if it fits there, else above it if it fits there, else on the roomier side, as tall as there's room for. */
function place(el: HTMLElement, button: HTMLElement) {
  const at = button.getBoundingClientRect();
  el.style.maxHeight = "";
  const below = window.innerHeight - at.bottom - GAP - EDGE;
  const above = at.top - GAP - EDGE;
  const down = el.offsetHeight <= below || (el.offsetHeight > above && below >= above);
  const room = Math.max(0, down ? below : above);
  if (el.offsetHeight > room) el.style.maxHeight = `${room}px`;
  el.style.left = `${Math.max(EDGE, Math.min(at.left, window.innerWidth - el.offsetWidth - EDGE))}px`;
  el.style.top = `${down ? at.bottom + GAP : at.top - GAP - el.offsetHeight}px`;
}

/**
 * Whether `e` scrolled what `button` is in (the box editor's fields, the table) till the button's middle is out
 * of sight: past that one's edge, or under its sticky header or title column. The list `menu` doesn't count.
 */
function scrolledAway(e: Event, button: HTMLElement, menu: HTMLElement): boolean {
  if (e.type !== "scroll" || !(e.target instanceof Element) || !e.target.contains(button)) return false;
  const at = button.getBoundingClientRect();
  const top = document.elementsFromPoint(at.left + at.width / 2, at.top + at.height / 2).find((el) => !menu.contains(el));
  return !top || !button.contains(top);
}

/**
 * A button saying who's assigned, opening a small dialog: a checkbox per
 * engineer on the roster, plus a field to add someone new. The button's name
 * says who's assigned ("Engineers: Sam Lee, Robin Park"). Opening it focuses
 * the first ticked engineer; ↑ and ↓ move between engineers, Space ticks, and
 * Enter or Escape closes it, back on the button. Tab goes through the
 * engineers to the new-engineer field (Safari's own Tab, which the box editor
 * doesn't use, skips the checkboxes: hence ↑ and ↓). The list is fixed on the
 * screen, below the button or above it without room there, so the box
 * editor's scrolling fields or the table don't cut it off; a scroll or a
 * resize, which would leave it adrift, closes it, except while a new name
 * is typed: then it moves with the button, unless the editor's fields or the
 * table are scrolled till the button is out of sight.
 */
export function EngineerPicker({ value, people, department, onChange, onAddPerson, readOnly, emptyLabel, names: given }: Props) {
  const label = "Engineers";
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const nameField = useRef<HTMLInputElement>(null);
  const menuId = useId();
  const own = useMemo(() => (given ? null : new Map(people.map((p) => [p.id, p.name]))), [given, people]);
  const names = given ?? own!;
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
    const adrift = (e: Event) => {
      if (e.target instanceof Node && menu.current?.contains(e.target)) return;
      // Typing a new name: on a phone, the keyboard opening for the field scrolls or shrinks the window.
      if (document.activeElement === nameField.current && menu.current && button.current && !scrolledAway(e, button.current, menu.current)) {
        place(menu.current, button.current);
        return;
      }
      if (menu.current?.contains(document.activeElement)) button.current?.focus({ preventScroll: true });
      setOpen(false);
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
    window.addEventListener("scroll", adrift, true);
    window.addEventListener("resize", adrift);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", adrift, true);
      window.removeEventListener("resize", adrift);
    };
  }, [open]);

  // Placed before it's painted, and again as it grows (someone added).
  useLayoutEffect(() => {
    if (open && menu.current && button.current) place(menu.current, button.current);
  });

  // The department's engineers first, then everyone else, by name: sorted only while it's open (a table
  // has a closed one in every row).
  const ordered = useMemo(
    () =>
      open
        ? [...people].sort((a, b) => Number(b.department === department) - Number(a.department === department) || a.name.localeCompare(b.name))
        : [],
    [open, people, department],
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
              ref={nameField}
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
