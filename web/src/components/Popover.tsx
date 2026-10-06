// A toolbar button with a small panel below it. Closes on Escape, a click
// elsewhere, or when something in it calls `close`. Opened from the keyboard,
// focus goes into the panel; Escape, or a choice made in it, puts focus back
// on the button (a click elsewhere leaves it where the click put it).

import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { focusLater, tabbable } from "../a11y/focus";

/** The least room between a panel and the window's edge (px). */
const EDGE = 8;

export function Popover(props: {
  className?: string;
  label: string;
  button: ReactNode;
  buttonClass?: string;
  /** The pointer or focus reached the button: about to open, maybe. */
  onIntent?(): void;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const triggerId = useId();
  /** Opened by Enter or Space on the button, not a click. */
  const byKey = useRef(false);

  useEffect(() => {
    if (!open) return;
    // Into the panel, from the keyboard: its first control, or the panel itself until its contents
    // have loaded (the settings menu's are fetched the first time), then their first control.
    const p = panel.current;
    const loaded = new MutationObserver(() => {
      const first = p && tabbable(p)[0];
      if (!first) return;
      if (document.activeElement === p) first.focus();
      loaded.disconnect();
    });
    if (byKey.current && p) {
      const first = tabbable(p)[0];
      (first ?? p).focus();
      if (!first) loaded.observe(p, { childList: true, subtree: true });
    }
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation(); // don't also close the box editor underneath
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc, true);
    return () => {
      loaded.disconnect();
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc, true);
    };
  }, [open]);

  // Inside the window, wherever its button is (a narrow one wraps the toolbar): moved right if it
  // would spill past the left edge, and no taller than the room below (contents still to load too).
  useLayoutEffect(() => {
    const el = panel.current;
    if (!open || !el) return;
    el.style.translate = "";
    el.style.maxHeight = "";
    const r = el.getBoundingClientRect();
    if (r.left < EDGE) el.style.translate = `${EDGE - r.left}px 0`;
    const room = Math.max(0, window.innerHeight - EDGE - r.top);
    if (!(parseFloat(getComputedStyle(el).maxHeight) <= room)) el.style.maxHeight = `${room}px`;
  }, [open]);

  /** A choice made in the panel: focus goes back to the button, unless the choice put it somewhere (a dialog it opened). */
  const close = () => {
    setOpen(false);
    focusLater([() => document.getElementById(triggerId)]);
  };

  return (
    <div className={`popover ${props.className ?? ""}`} ref={ref}>
      <button
        ref={trigger}
        id={triggerId}
        className={props.buttonClass}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? panelId : undefined}
        aria-label={props.label}
        onClick={(e) => {
          byKey.current = e.detail === 0; // a click made by a key has no pointer, so no click count
          setOpen((o) => !o);
        }}
        onPointerEnter={props.onIntent}
        onFocus={props.onIntent}
      >
        {props.button}
      </button>
      {open && (
        <div className="popover-panel" role="dialog" aria-label={props.label} id={panelId} ref={panel} tabIndex={-1}>
          {props.children(close)}
        </div>
      )}
    </div>
  );
}
