// A heads-up that an edit broke rules, at the bottom of the roadmap (App.tsx
// says so to screen readers as it happens). Fetched once someone starts
// editing.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { main, useReturnFocus } from "../a11y/focus";
import type { Violation } from "../model/relations";
import { Icon } from "./Icon";

/**
 * A heads-up that the user's edit broke rules (announced as it appears, by
 * whoever sets `broken`: a live region added already filled often isn't
 * read). It goes by itself after 10 s, but not while focus is in it (being
 * read, or on its way to Dismiss); focus in it when it goes moves to the
 * roadmap. While it shows, the views leave room to scroll their last rows
 * up clear of it, so focus is never under it: `--toast-room` on the app, as
 * far as it reaches up from the window's bottom (more rules, or a narrow
 * window, make it taller).
 */
export function RuleToast({ broken, onDismiss }: { broken: Violation[]; onDismiss(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (held) return;
    const t = setTimeout(onDismiss, 10_000);
    return () => clearTimeout(t);
  }, [broken, held, onDismiss]);
  useLayoutEffect(() => {
    const el = ref.current;
    const app = el?.closest<HTMLElement>(".app");
    if (!el || !app) return;
    // None while it isn't drawn (printing).
    const measure = () => {
      const r = el.getBoundingClientRect();
      app.style.setProperty("--toast-room", `${r.height ? Math.ceil(window.innerHeight - r.top) : 0}px`);
    };
    measure();
    const sized = new ResizeObserver(measure);
    sized.observe(el);
    return () => {
      sized.disconnect();
      app.style.removeProperty("--toast-room");
    };
  }, []);
  useReturnFocus(ref, main, { ifLost: false });
  return (
    <div
      ref={ref}
      className="toast"
      onFocus={() => setHeld(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setHeld(false)}
    >
      <strong><Icon name="alert" size={14} /> That breaks {broken.length === 1 ? "a rule" : `${broken.length} rules`}</strong>
      <ul>
        {broken.map((v, i) => (
          <li key={i}>{v.message}</li>
        ))}
      </ul>
      <span className="hint">Nothing is blocked; it's a heads-up.</span>
      <button className="icon-button" onClick={onDismiss} aria-label="Dismiss">
        <Icon name="x" size={16} />
      </button>
    </div>
  );
}
