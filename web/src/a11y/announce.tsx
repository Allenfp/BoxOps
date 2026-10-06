// Status messages for screen readers (WCAG 4.1.3): saves, others' saves coming
// in, search results, warnings. They're spoken from live regions, which are
// read only when what they hold changes, so the regions are on the page from
// the start (one added already holding its message is often not read), empty.
//
// The app has a pair (polite and assertive) at its root. VoiceOver reads no
// live region outside a modal dialog while one is open (w3c/aria#1854), so
// each modal dialog and editor has a pair of its own: announce() writes to
// the innermost open one's. The hooks that announce what a component shows
// are useAnnounce.ts's, kept out of the app's main file.

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
