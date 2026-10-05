// Status messages for screen readers (WCAG 4.1.3): saves, others' saves coming
// in, search results, warnings. They're spoken from live regions, which are
// read only when what they hold changes, so the regions are on the page from
// the start (one added already holding its message is often not read), empty.
//
// The app has a pair (polite and assertive) at its root. VoiceOver reads no
// live region outside a modal dialog while one is open (w3c/aria#1854), so
// each modal dialog and editor has a pair of its own: announce() writes to
// the innermost open one's.

import { useEffect, useRef } from "react";

type Level = "polite" | "assertive";

/** How long after it's asked for a message is written: its region is emptied first, so the same message twice is read twice. */
const DELAY_MS = 150;

const pending: Record<Level, string[]> = { polite: [], assertive: [] };
const timers: Partial<Record<Level, ReturnType<typeof setTimeout>>> = {};

/** The region to speak from: in an open native modal dialog, else in an open editor (aria-modal), else the app's own. */
function region(level: Level): HTMLElement | null {
  const all = [...document.querySelectorAll<HTMLElement>(`[data-live="${level}"]`)];
  return (
    all.filter((r) => r.closest("dialog[open]")).at(-1) ??
    all.filter((r) => r.closest('[aria-modal="true"]')).at(-1) ??
    all.find((r) => !r.closest('dialog, [role="dialog"]')) ??
    null
  );
}

/**
 * Say `text` to screen-reader users without moving focus. Messages asked for
 * together are read together, in order; `assertive` interrupts what's being
 * read (for something that went wrong).
 */
export function announce(text: string, { assertive = false }: { assertive?: boolean } = {}): void {
  const level: Level = assertive ? "assertive" : "polite";
  const message = text.replace(/\s+/g, " ").trim();
  if (!message) return;
  if (!pending[level].includes(message)) pending[level].push(message);
  for (const r of document.querySelectorAll<HTMLElement>(`[data-live="${level}"]`)) r.textContent = "";
  clearTimeout(timers[level]);
  // The region is chosen when the message is written: by then a dialog closing with the change it reports has gone.
  timers[level] = setTimeout(() => {
    const said = pending[level].join(" ");
    pending[level] = [];
    const r = region(level);
    if (r) r.textContent = said;
  }, DELAY_MS);
}

/** A polite and an assertive live region, empty until announce() writes to them. */
export function LiveRegion() {
  return (
    <div className="sr-only">
      <div aria-live="polite" aria-atomic="true" data-live="polite" />
      <div aria-live="assertive" aria-atomic="true" data-live="assertive" />
    </div>
  );
}

/**
 * Announce `text` whenever it changes to something new, once `ready` (so
 * what's on the page when it first shows isn't read out as news). Empty or
 * null says nothing.
 */
export function useAnnounce(text: string | null | false | undefined, { assertive = false, ready = true } = {}): void {
  const said = useRef<string | null>(null);
  useEffect(() => {
    const now = text || "";
    if (now === said.current) return;
    const first = said.current === null;
    said.current = now;
    if (now && (ready || !first)) announce(now, { assertive });
  }, [text, assertive, ready]);
}

/** How long typing must pause before search results are announced. */
const SETTLE_MS = 600;

/**
 * Announce `text` (how many results there are) once `input` (what's searched
 * for) has stopped changing for a moment, each time it changes: not for every
 * key typed, and not for the input as the page first shows it.
 */
export function useAnnounceResults(input: string, text: string): void {
  const latest = useRef(text);
  const searched = useRef(input);
  useEffect(() => {
    latest.current = text;
  });
  useEffect(() => {
    if (input === searched.current) return;
    searched.current = input;
    const t = setTimeout(() => announce(latest.current), SETTLE_MS);
    return () => clearTimeout(t);
  }, [input]);
}
