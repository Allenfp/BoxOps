// A small modal dialog: title bar with a close button, closes on Escape.
// Named by its title; focus starts on the dialog itself (its title and text
// are read, and the Close button shows no ring), or in its first field, and
// goes back where it came from when it closes. Taller than the window, its
// title bar stays put while the rest scrolls, and "More below" at its foot
// says there's more until it's scrolled to the end (WebKit shows no
// scrollbar to say so). What has focus is never left under either
// (useFocusClear).

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
  useFocusClear();
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
      className={`save-dialog${className ? ` ${className}` : ""}${more ? " has-more" : ""}`}
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

/** How far (px) what has focus is kept from a dialog's title bar and More below. */
const CLEAR = 8;

/**
 * Keeps what has focus in an open dialog clear of its title bar, which stays put as it scrolls, and of
 * More below while that shows (WCAG 2.4.11). Chromium and Firefox scroll it clear themselves, by the
 * dialog's scroll-padding (dialogs.css); WebKit leaves it under them, or doesn't scroll to it at all.
 * So once the browser has scrolled (a frame later), the dialog scrolls the rest of the way if need be.
 */
export function useFocusClear(): void {
  useEffect(() => {
    let frame = 0;
    const onFocus = (e: FocusEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => clearOf(e.target as Element));
    };
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("focusin", onFocus);
      cancelAnimationFrame(frame);
    };
  }, []);
}

function clearOf(el: Element) {
  const d = el.isConnected ? el.closest("dialog") : null;
  const head = d?.querySelector(":scope > .dialog-head");
  if (!d || el === d || !head || head.contains(el) || document.activeElement !== el) return;
  const more = d.querySelector(":scope > .more-below:not(.done)");
  const r = el.getBoundingClientRect();
  const top = head.getBoundingClientRect().bottom + CLEAR;
  const bottom = (more ? more.getBoundingClientRect().top : d.getBoundingClientRect().top + d.clientTop + d.clientHeight) - CLEAR;
  // Too tall to fit between them: its top shows.
  if (r.top < top) d.scrollTop -= top - r.top;
  else if (r.bottom > bottom) d.scrollTop += Math.min(r.bottom - bottom, r.top - top);
}
