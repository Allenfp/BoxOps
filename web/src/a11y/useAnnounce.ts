// Announcing what a component shows (announce.tsx says how messages are
// spoken): a message as it changes, and search results once typing pauses.
// Used by the parts fetched on first use, not by the timeline.

import { useEffect, useRef } from "react";
import { announce } from "./announce";

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
