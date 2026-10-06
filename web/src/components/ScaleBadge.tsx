// The scale number on a box or table row: underlined, and hovering it shows
// the box's scale card (ScaleCard.tsx, fetched the first time a card shows).
// Keyboard focus on a box doesn't show it, as it would cover the lane below:
// I does (Timeline.tsx), and the box's name says its scale all the same.

import { Suspense, lazy, useRef, useState } from "react";
import { boxScale } from "../model/scale";
import type { Box, Department } from "../model/types";

/** The card, fetched the first time one shows. One that can't be fetched shows nothing: what it says is in the box's tooltip and name too. */
export const ScaleCard = lazy(() => import("./ScaleCard").then((m) => ({ default: m.ScaleCard }), () => ({ default: () => null })));

interface Props {
  box: Box;
  departments: Department[];
  className?: string;
}

export function ScaleBadge({ box, departments, className }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = useState(false);
  return (
    <>
      <span
        ref={ref}
        className={`scale-number${className ? ` ${className}` : ""}`}
        // An empty title keeps the box's own tooltip from covering the card.
        title=""
        onMouseEnter={() => setHovered(true)}
      >
        {/* Said as "Scale 30" where the number is read (a table cell): a name on a plain <span> isn't. */}
        <span className="sr-only">Scale </span>
        {boxScale(box)}
      </span>
      {hovered && (
        <Suspense fallback={null}>
          <ScaleCard box={box} departments={departments} anchor={ref} hover onClose={() => setHovered(false)} />
        </Suspense>
      )}
    </>
  );
}
