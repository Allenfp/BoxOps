import { type FocusEvent, type PointerEvent, type RefObject, useEffect, useRef, useState } from "react";
import { keepInView, rowKeyOf } from "./focusRow";

/**
 * The row of the table or People that focus is in, or that a press is in
 * (Safari doesn't focus a button that's clicked): `active`, drawn wherever it
 * is. And `held`: the row that keeps its place, and stays shown, though an
 * edit would sort it elsewhere or filter it out, until focus leaves it.
 * `held` follows `active`, but not mid-press: a row moving away as a press
 * began would leave another under the pointer, and the click with it. Put
 * `handlers` on the scroller; they also keep what has focus clear of its
 * sticky header and column.
 */
export function useActiveRow(scroller: RefObject<HTMLElement | null>) {
  const [active, setActive] = useState<string | null>(null);
  const [held, setHeld] = useState<string | null>(null);
  const pressing = useRef(false);
  const latest = useRef<string | null>(null);
  const follow = (key: string | null) => {
    latest.current = key;
    setActive(key);
    if (!pressing.current) setHeld(key);
  };
  useEffect(() => {
    // Once the press is over and its click has gone where it was meant to.
    const up = () => {
      if (!pressing.current) return;
      pressing.current = false;
      setTimeout(() => setHeld(latest.current), 0);
    };
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    return () => {
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
    };
  }, []);
  const handlers = {
    onFocus: (e: FocusEvent) => {
      const key = rowKeyOf(e.target);
      if (key !== null) follow(key);
      keepInView(scroller.current, e.target);
    },
    onBlur: (e: FocusEvent) => {
      if (!(e.relatedTarget instanceof Node && scroller.current?.contains(e.relatedTarget))) follow(null);
    },
    onPointerDown: (e: PointerEvent) => {
      pressing.current = true;
      const key = rowKeyOf(e.target);
      if (key !== null) follow(key);
    },
  };
  return { active, held, handlers };
}
