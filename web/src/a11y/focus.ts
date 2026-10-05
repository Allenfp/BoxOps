// Keeping keyboard focus somewhere sensible. Browsers leave it on <body> when
// the focused element goes away (a dialog React unmounts, a deleted row, a
// button that turns into text), and WebKit fires no blur or focusout when that
// happens, nor focuses a button that's clicked. So focus is put back by hand,
// after the change that removed it has reached the page.

import { type KeyboardEvent as ReactKeyboardEvent, type RefObject, useLayoutEffect, useRef, useState } from "react";

/** A place focus can go, looked up when it's needed (after the change). */
export type Target = () => Element | null | undefined;

/** Focus is nowhere in particular: on <body>, or on nothing. */
export const focusLost = () => !document.activeElement || document.activeElement === document.body;

/** The first of `targets` that's on the page and can take focus. */
function first(targets: Target[]): HTMLElement | null {
  for (const t of targets) {
    const el = t();
    if (el instanceof HTMLElement && el.isConnected && !el.closest("[inert]") && el.getClientRects().length) return el;
  }
  return null;
}

/**
 * Once the change under way has reached the page (the next frame), focus the
 * first of `targets` there, unless something has taken focus meanwhile.
 * `from`: focus may also be taken back from that element (one a closing
 * dialog put it on).
 */
export function focusLater(targets: Target[], from?: Element | null): void {
  requestAnimationFrame(() => {
    if (!focusLost() && document.activeElement !== from) return;
    first(targets)?.focus();
  });
}

/**
 * The roadmap (<main>): where focus goes when there's nowhere better, and
 * where the skip link sends it. It takes focus only while it has it: with a
 * tabindex for good, a click anywhere in it would focus it (WebKit and
 * Chromium focus the nearest ancestor that can be), not <body>.
 */
export const main = (): HTMLElement | null => {
  const el = document.getElementById("main");
  if (el && !el.hasAttribute("tabindex")) {
    el.tabIndex = -1;
    el.addEventListener("blur", () => el.removeAttribute("tabindex"), { once: true });
  }
  return el;
};

/**
 * Put focus back when this dialog (or other container) goes: if it had focus,
 * or focus had been lost, it goes to `where(opener)`, where `opener` is what
 * had focus before it opened (null if that was nothing). A native <dialog> is
 * closed first, so the rest of the page is no longer inert.
 */
export function useReturnFocus(ref: RefObject<HTMLElement | null>, where: (opener: HTMLElement | null) => Element | null | undefined): void {
  // What had focus when this first rendered, before anything in it took it.
  const [opener] = useState(() => (focusLost() ? null : (document.activeElement as HTMLElement)));
  const latest = useRef(where);
  useLayoutEffect(() => {
    latest.current = where;
  });
  useLayoutEffect(() => {
    const el = ref.current;
    return () => {
      // Still on the page here: React removes it after this runs.
      if (!el || !(focusLost() || el.contains(document.activeElement))) return;
      let from: Element | null = null;
      if (el instanceof HTMLDialogElement && el.open) {
        el.close();
        from = document.activeElement; // where closing put it (what had focus when it opened)
      }
      focusLater([() => latest.current(opener)], from);
    };
  }, [ref, opener]);
}

/** An element that's still on the page, or null. */
export const onPage = <T extends Element>(el: T | null | undefined): T | null => (el?.isConnected ? el : null);

const TABBABLE = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex]';

/** What Tab can stop on inside `root`, in order. */
export function tabbable(root: Element): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(TABBABLE)].filter(
    (el) => el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled && !el.closest("[inert]") && el.getClientRects().length > 0,
  );
}

/**
 * Keep Tab inside a dialog that isn't a native modal one (an editor): Tab,
 * Shift+Tab and Alt+Tab go round its own controls, buttons too. Safari's Tab
 * skips buttons unless "Press Tab to highlight each item" is on, which a page
 * can't tell, so the dialog decides. For its onKeyDown.
 */
export function loopTab(e: ReactKeyboardEvent<HTMLElement>): void {
  if (e.key !== "Tab" || e.metaKey || e.ctrlKey || e.defaultPrevented) return;
  const list = tabbable(e.currentTarget);
  if (!list.length) return;
  e.preventDefault();
  const i = list.indexOf(document.activeElement as HTMLElement);
  const next = e.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : (i + 1) % list.length;
  list[next].focus();
}
