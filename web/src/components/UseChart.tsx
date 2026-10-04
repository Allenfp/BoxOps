// A collapsed department's row: how much of its capacity the boxes use, week by
// week, as a line or as bars. A dashed line marks 100%; anything above it is
// drawn in the warning colour. The scale is the same for every department
// (0 – 125%, higher values clipped), so rows can be compared at a glance.

import { useMemo } from "react";
import { formatDay } from "../model/dates";
import type { Box, Department } from "../model/types";
import { type WeekUse, weeklyUse } from "../model/utilization";
import type { Scale } from "../timeline/scale";

const TOP = 1.25;
const PAD = 5;

const pct = (r: number) => (r === Infinity ? "no open lanes" : `${Math.round(r * 100)}%`);
const fte = (n: number) => (Math.round(n * 10) / 10).toString();

export function weekTitle(w: WeekUse): string {
  if (w.ratio === null) return `Week of ${formatDay(w.start)}: no lanes open`;
  const text = `Week of ${formatDay(w.start)}: ${fte(w.used)} of ${fte(w.capacity)} FTE used (${pct(w.ratio)})`;
  const p = w.peak;
  return p ? `${text}; over capacity on ${formatDay(p.day)}: ${fte(p.used)} of ${fte(p.capacity)} FTE` : text;
}

export function UseChart({
  dept,
  boxes,
  scale,
  height,
  kind,
}: {
  dept: Department;
  boxes: Box[];
  scale: Scale;
  height: number;
  kind: "line" | "bars";
}) {
  const weeks = useMemo(() => weeklyUse(dept, boxes, scale.start, scale.end), [dept, boxes, scale.start, scale.end]);
  const weekW = scale.pxPerDay * 5;
  const plotH = height - PAD * 2;
  const y = (r: number) => PAD + plotH * (1 - Math.min(r, TOP) / TOP);
  const full = y(1);
  const clip = `use-over-${dept.id}`;
  const peak = Math.max(0, ...weeks.map((w) => w.ratio ?? 0));

  // The line: one point per week's middle, broken where no lanes are open.
  const runs: string[] = [];
  let run: string[] = [];
  for (const w of weeks) {
    if (w.ratio === null) {
      if (run.length) runs.push(run.join(" "));
      run = [];
      continue;
    }
    const x = scale.x(w.start) + weekW / 2;
    run.push(`${x.toFixed(1)},${y(w.ratio).toFixed(1)}`);
  }
  if (run.length) runs.push(run.join(" "));

  const marks =
    kind === "bars" ? (
      weeks.map((w) =>
        w.ratio === null || w.ratio === 0 ? null : (
          <rect
            key={w.start}
            x={scale.x(w.start) + 1}
            width={Math.max(1, weekW - 2)}
            y={y(w.ratio)}
            height={height - PAD - y(w.ratio)}
            rx={Math.min(2, weekW / 6)}
          />
        ),
      )
    ) : (
      <>
        {runs.map((pts, i) => {
          const first = pts.split(" ")[0]!.split(",")[0];
          const last = pts.split(" ").at(-1)!.split(",")[0];
          return <polygon key={`a${i}`} className="use-area" points={`${first},${height - PAD} ${pts} ${last},${height - PAD}`} />;
        })}
        {runs.map((pts, i) => (
          <polyline key={`l${i}`} points={pts} />
        ))}
      </>
    );

  return (
    <svg
      className={`use-chart ${kind}`}
      width={scale.width}
      height={height}
      role="img"
      aria-label={`${dept.name}: capacity used by week, up to ${pct(peak)}`}
    >
      <defs>
        <clipPath id={clip}>
          {/* A line's stroke straddles its value: start the red just above 100% so a full week isn't drawn over. */}
          <rect x={0} y={0} width={scale.width} height={kind === "line" ? full - 1 : full} />
        </clipPath>
      </defs>
      <line className="use-full" x1={0} x2={scale.width} y1={full} y2={full} />
      <g className="use-marks">{marks}</g>
      <g className="use-marks over" clipPath={`url(#${clip})`}>
        {marks}
      </g>
      {weeks.map((w) => (
        <rect key={w.start} className="use-hit" data-week={formatDay(w.start)} x={scale.x(w.start)} width={weekW} y={0} height={height}>
          <title>{weekTitle(w)}</title>
        </rect>
      ))}
    </svg>
  );
}
