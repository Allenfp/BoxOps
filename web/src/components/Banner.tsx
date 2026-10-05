// A banner under the toolbar: a message in its first <span>, then buttons.
// A banner is a flex row, so its text goes in that one span (each run of
// text, <code> and link would otherwise be spaced apart).

import { type ReactNode, type RefObject, useEffect, useRef } from "react";
import { announce } from "../a11y/announce";
import { main, useReturnFocus } from "../a11y/focus";

/**
 * `live`: its message is announced when the banner appears, once the roadmap
 * is up (`ready`; what's there from the start is just the page), and again
 * whenever it changes, or only when `news` does (a new value, for a message
 * that also follows something else, like the unsaved changes). Focus inside
 * it when it goes (its Dismiss button, say) moves to the roadmap; focus
 * anywhere else stays put.
 */
export function Banner({
  className,
  live,
  ready,
  news,
  children,
}: {
  className?: string;
  live?: "polite" | "assertive";
  ready?: RefObject<boolean>;
  news?: unknown;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  /** What was announced last (the message, or `news`); unset before the first render. */
  const said = useRef<{ key: unknown } | null>(null);
  useEffect(() => {
    const text = ref.current?.querySelector(":scope > span")?.textContent ?? ref.current?.textContent ?? "";
    const key = news === undefined ? text : news;
    if (said.current && said.current.key === key) return;
    const first = !said.current;
    said.current = { key };
    if (live && (!first || (ready?.current ?? true))) announce(text, { assertive: live === "assertive" });
  });
  useReturnFocus(ref, main, { ifLost: false });
  return (
    <div ref={ref} className={`banner${className ? ` ${className}` : ""}`}>
      {children}
    </div>
  );
}
