// Today's date, kept current for every view at once: a tab left open
// overnight (a wall display, say) moves on at local midnight, and checks
// again when it comes back into view or gets focus (a laptop waking up, whose
// timers were paused meanwhile).

import { useSyncExternalStore } from "react";
import { type Day, today } from "../model/dates";

let current = today();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;

function check(): void {
  const now = today();
  if (now !== current) {
    current = now;
    for (const l of listeners) l();
  }
  // A second past the next local midnight.
  const d = new Date();
  clearTimeout(timer);
  timer = setTimeout(check, new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() - d.getTime() + 1000);
}

const onVisible = () => {
  if (!document.hidden) check();
};

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    check();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size) return;
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("focus", check);
  };
}

/** Today in the viewer's local calendar, re-rendering when the date changes. */
export function useToday(): Day {
  return useSyncExternalStore(subscribe, () => current);
}
