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

/** Messages waiting to be written: an object each, so one can be taken back without another that says the same. */
const pending: Record<Level, { text: string }[]> = { polite: [], assertive: [] };
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
 * together are read together, in order (the same one once); `assertive`
 * interrupts what's being read (for something that went wrong). Returns a
 * function that takes the message back if it hasn't been written yet (true
 * if it did).
 */
export function announce(text: string, { assertive = false }: { assertive?: boolean } = {}): () => boolean {
  const level: Level = assertive ? "assertive" : "polite";
  const message = { text: text.replace(/\s+/g, " ").trim() };
  if (!message.text) return () => false;
  pending[level].push(message);
  for (const r of document.querySelectorAll<HTMLElement>(`[data-live="${level}"]`)) r.textContent = "";
  clearTimeout(timers[level]);
  // The region is chosen when the message is written: by then a dialog closing with the change it reports has gone.
  timers[level] = setTimeout(() => {
    const said = [...new Set(pending[level].map((m) => m.text))].join(" ");
    pending[level] = [];
    const r = region(level);
    if (r && said) r.textContent = said;
  }, DELAY_MS);
  return () => {
    const before = pending[level].length;
    pending[level] = pending[level].filter((m) => m !== message);
    return pending[level].length < before;
  };
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
 * Announce `text` whenever it changes to something new, or only when `news`
 * does (for the same message again: a value that's new each time it's
 * meant). What it says when first rendered is announced only if `ready` (not
 * what's on the page when it first shows). Empty or null says nothing.
 * `withdraw`: a message not yet read when `text` changes, or the component
 * goes, is taken back, as what it said no longer holds (a field's problem
 * put right at once).
 */
export function useAnnounce(
  text: string | null | false | undefined,
  { assertive = false, ready = true, news, withdraw = false }: { assertive?: boolean; ready?: boolean; news?: unknown; withdraw?: boolean } = {},
): void {
  /** What was announced last (the text, or `news`); unset before the first render. */
  const said = useRef<{ key: unknown } | null>(null);
  useEffect(() => {
    const now = text || "";
    const key = news === undefined ? now : news;
    const before = said.current;
    if (before && Object.is(before.key, key)) return;
    said.current = { key };
    if (!now || (!before && !ready)) return;
    const takeBack = announce(now, { assertive });
    if (!withdraw) return;
    // Taken back before it was read, it wasn't said: asked for again (as React's development
    // checks do, running each effect twice), it's said then.
    return () => {
      if (takeBack()) said.current = before;
    };
  }, [text, assertive, ready, news, withdraw]);
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
