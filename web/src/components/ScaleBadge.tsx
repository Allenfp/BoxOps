// The scale number on a box or table row: underlined, and hovering it shows
// what the scale means against a week, month and quarter.

import { type CSSProperties, useState } from "react";
import { createPortal } from "react-dom";
import { boxScale, type Period, percent, SCALE_HELP, scaleStats } from "../model/scale";
import type { Box, Department } from "../model/types";

const PERIODS: Period[] = ["week", "month", "quarter"];
const WIDTH = 300;

/** 1 → "1st", 2 → "2nd", 11 → "11th", 23 → "23rd". */
const ordinal = (n: number) => {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return `${n}${teen ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;
};

interface Props {
  box: Box;
  boxes: Box[];
  departments: Department[];
  className?: string;
}

export function ScaleBadge({ box, boxes, departments, className }: Props) {
  const [at, setAt] = useState<DOMRect | null>(null);
  const scale = boxScale(box);
  const stats = at ? scaleStats(box, boxes, departments) : null;

  let style: CSSProperties = {};
  if (at) {
    const left = Math.min(Math.max(8, at.right - WIDTH), window.innerWidth - WIDTH - 8);
    style = at.bottom + 260 < window.innerHeight ? { left, top: at.bottom + 6 } : { left, bottom: window.innerHeight - at.top + 6 };
  }

  return (
    <>
      <span
        className={`scale-number${className ? ` ${className}` : ""}`}
        // An empty title keeps the box's own tooltip from covering the popup.
        title=""
        aria-label={`Scale ${scale}`}
        onMouseEnter={(e) => setAt(e.currentTarget.getBoundingClientRect())}
        onMouseLeave={() => setAt(null)}
      >
        {scale}
      </span>
      {stats &&
        createPortal(
          <div className="scale-pop" role="tooltip" style={{ ...style, width: WIDTH }}>
            <div className="scale-pop-head">
              <strong>Scale {stats.scale}</strong>
              <span className="hint">
                {box.fte} FTE × {stats.days} working day{stats.days === 1 ? "" : "s"}
              </span>
            </div>
            <table>
              <thead>
                <tr>
                  <th>% of a…</th>
                  {PERIODS.map((p) => (
                    <th key={p}>{p[0].toUpperCase() + p.slice(1)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th>One engineer</th>
                  {PERIODS.map((p) => (
                    <td key={p}>{percent(stats.ofPerson[p])}</td>
                  ))}
                </tr>
                {stats.dept && (
                  <tr>
                    <th title={`${stats.dept.name}'s capacity over the box's dates`}>
                      {stats.dept.name}
                      <span className="hint scale-pop-sub">{stats.dept.fte} FTE</span>
                    </th>
                    {PERIODS.map((p) => (
                      <td key={p}>{percent(stats.dept!.of[p])}</td>
                    ))}
                  </tr>
                )}
              </tbody>
            </table>
            <ul>
              {stats.perEngineer && (
                <li>
                  <span>Per engineer</span>
                  <b>
                    {stats.perEngineer.value} <span className="hint">({stats.perEngineer.engineers} assigned)</span>
                  </b>
                </li>
              )}
              {stats.inDept && (
                <li>
                  <span>Share of {stats.dept?.name ?? "its department"}’s work</span>
                  <b>
                    {percent(stats.inDept.share)}{" "}
                    <span className="hint">
                      ({ordinal(stats.inDept.rank)} largest of {stats.inDept.of})
                    </span>
                  </b>
                </li>
              )}
              <li>
                <span>Share of the whole roadmap</span>
                <b>{percent(stats.ofRoadmap)}</b>
              </li>
            </ul>
            <p className="hint">{SCALE_HELP}. A month is about 21.7 working days, a quarter 65.</p>
          </div>,
          document.body,
        )}
    </>
  );
}
