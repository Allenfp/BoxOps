// A small modal dialog: title bar with a close button, closes on Escape.
// Named by its title; focus starts on the dialog itself (its title and text
// are read, and the Close button shows no ring), or in its first field, and
// goes back where it came from when it closes. Taller than the window, its
// title bar stays put while the rest scrolls, and "More below" at its foot
// says there's more until it's scrolled to the end (WebKit shows no
// scrollbar to say so).

import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { LiveRegion } from "../a11y/announce";
import { onPage, type Target, useReturnFocus } from "../a11y/focus";
import { Icon } from "./Icon";

export function Modal({
  title,
  className,
  onClose,
  startIn = "dialog",
  returnTo,
  children,
}: {
  title: string;
  className?: string;
  onClose(): void;
  /** Where focus starts: the dialog (something to read) or its first field (a form). */
  startIn?: "dialog" | "field";
  /** Where focus goes when it closes if what opened it has gone (a menu item, say). */
  returnTo?: Target;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) {
      d.showModal();
      const field = startIn === "field" ? d.querySelector<HTMLElement>("input:not([type=color]), select, textarea") : null;
      (field ?? d).focus();
    }
  }, [startIn]);
  useReturnFocus(ref, (opener) => onPage(opener) ?? returnTo?.());
  // Whether there's more to scroll to, as it scrolls or it, or what's in it, changes size.
  const [more, setMore] = useState(false);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const check = () => setMore(d.scrollTop + d.clientHeight < d.scrollHeight - 2);
    const sized = new ResizeObserver(check);
    for (const el of [d, ...d.children]) sized.observe(el);
    d.addEventListener("scroll", check, { passive: true });
    check();
    return () => {
      sized.disconnect();
      d.removeEventListener("scroll", check);
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`save-dialog${className ? ` ${className}` : ""}`}
      aria-labelledby={titleId}
      tabIndex={-1}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header className="dialog-head">
        <h2 id={titleId}>{title}</h2>
        <button className="icon-button" onClick={onClose} aria-label="Close">
          <Icon name="x" size={16} />
        </button>
      </header>
      {/* VoiceOver reads only live regions inside an open modal dialog. */}
      <LiveRegion />
      {children}
      {/* Seen, not read: a screen reader reads on regardless. */}
      <div className={`more-below${more ? "" : " done"}`} aria-hidden>
        More below <Icon name="chevron-down" size={12} />
      </div>
    </dialog>
  );
}
