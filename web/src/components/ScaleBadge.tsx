// The scale number on a box or table row: underlined, and hovering it shows
// a short card: the sum, the scale in person-weeks/months/quarters, and the
// share of the department the box takes while it runs.

import { type CSSProperties, useState } from "react";
import { createPortal } from "react-dom";
import { amount, boxScale, percent, scaleStats } from "../model/scale";
import type { Box, Department } from "../model/types";

const WIDTH = 300;

interface Props {
  box: Box;
  departments: Department[];
  className?: string;
}

export function ScaleBadge({ box, departments, className }: Props) {
  const [at, setAt] = useState<DOMRect | null>(null);
  const scale = boxScale(box);
  const stats = at ? scaleStats(box, departments) : null;

  let style: CSSProperties = {};
  if (at) {
    const left = Math.min(Math.max(8, at.right - WIDTH), window.innerWidth - WIDTH - 8);
    style = at.bottom + 100 < window.innerHeight ? { left, top: at.bottom + 6 } : { left, bottom: window.innerHeight - at.top + 6 };
  }

  return (
    <>
      <span
        className={`scale-number${className ? ` ${className}` : ""}`}
        // An empty title keeps the box's own tooltip from covering the popup.
        title=""
        onMouseEnter={(e) => setAt(e.currentTarget.getBoundingClientRect())}
        onMouseLeave={() => setAt(null)}
      >
        {scale}
      </span>
      {stats &&
        createPortal(
          <div className="scale-pop" role="tooltip" style={{ ...style, width: WIDTH }}>
            <strong>Scale {stats.scale}</strong>
            <span className="hint">
              {" "}
              = {box.fte} FTE × {stats.days} working day{stats.days === 1 ? "" : "s"}
            </span>
            <div>
              ≈ {amount(stats.in.week)} weeks · {amount(stats.in.month)} months · {amount(stats.in.quarter)} quarters
            </div>
            {stats.dept && (
              <div>
                {percent(stats.dept.share)} of {stats.dept.name} while it runs
              </div>
            )}
            <div className="hint">FTE per Month = ~20</div>
          </div>,
          document.body,
        )}
    </>
  );
}
