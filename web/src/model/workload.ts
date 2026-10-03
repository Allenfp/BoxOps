// How much each engineer is carrying. A box's FTE is split evenly across its
// engineers (a 1.5-FTE box with two people is 0.75 each). Weekends don't count.

import { type Day, dayOfWorkIndex, workIndex } from "./dates";
import type { Box } from "./types";

export interface Workload {
  boxes: Box[];
  /** FTE on the given day (on a weekend, the coming Monday). */
  today: number;
  /** Most FTE on any working day. */
  peak: number;
  /** Stretches of working days above 1 FTE, with the most FTE in each. */
  over: { from: Day; to: Day; fte: number }[];
}

const round = (n: number) => Math.round(n * 100) / 100;

export function workload(personId: string, boxes: Box[], today: Day): Workload {
  const mine = boxes.filter((b) => b.engineers?.includes(personId));
  const share = (b: Box) => b.fte / b.engineers!.length;

  // FTE change at each working-day index: a sweep, so cost doesn't depend on box length.
  const delta = new Map<number, number>();
  for (const b of mine) {
    const s = workIndex(b.start);
    const e = workIndex(b.end + 1); // exclusive
    if (e <= s) continue;
    delta.set(s, (delta.get(s) ?? 0) + share(b));
    delta.set(e, (delta.get(e) ?? 0) - share(b));
  }
  const points = [...delta.keys()].sort((a, b) => a - b);

  let load = 0;
  let peak = 0;
  const over: Workload["over"] = [];
  let run: { from: number; fte: number } | null = null;
  for (let i = 0; i < points.length; i++) {
    load = round(load + delta.get(points[i])!);
    peak = Math.max(peak, load);
    const next = points[i + 1];
    if (load > 1) {
      run = run ? { from: run.from, fte: Math.max(run.fte, load) } : { from: points[i], fte: load };
    }
    if (run && (load <= 1 || next === undefined)) {
      const end = load <= 1 ? points[i] : next;
      over.push({ from: dayOfWorkIndex(run.from), to: dayOfWorkIndex(end - 1), fte: run.fte });
      run = null;
    }
  }

  const t = workIndex(today);
  const onToday = mine.filter((b) => workIndex(b.start) <= t && t < workIndex(b.end + 1));
  return { boxes: mine, today: round(onToday.reduce((n, b) => n + share(b), 0)), peak: round(peak), over };
}
