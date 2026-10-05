// A toolbar button with a small panel below it. Closes on Escape, a click
// elsewhere, or when something in it calls `close`.

import { type ReactNode, useEffect, useRef, useState } from "react";

export function Popover(props: {
  className?: string;
  label: string;
  button: ReactNode;
  buttonClass?: string;
  align?: "left" | "right";
  /** The pointer or focus reached the button: about to open, maybe. */
  onIntent?(): void;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation(); // don't also close the box editor underneath
      setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc, true);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc, true);
    };
  }, [open]);

  return (
    <div className={`popover ${props.className ?? ""}`} ref={ref}>
      <button
        className={props.buttonClass}
        aria-expanded={open}
        aria-label={props.label}
        onClick={() => setOpen((o) => !o)}
        onPointerEnter={props.onIntent}
        onFocus={props.onIntent}
      >
        {props.button}
      </button>
      {open && (
        <div className={`popover-panel ${props.align === "left" ? "left" : ""}`} role="dialog" aria-label={props.label}>
          {props.children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
