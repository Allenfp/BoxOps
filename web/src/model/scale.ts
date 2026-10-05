// A box's scale: how much work it is, as FTE × working days (FTE-days).
// Derived from the box, never stored.

import { addWorkdays, workdays } from "./dates";
import { capacityOn } from "./lanes";
import type { Box, Department } from "./types";

export const boxScale = (b: Pick<Box, "fte" | "start" | "end">) => Math.round(b.fte * workdays(b.start, b.end) * 10) / 10;

export const SCALE_HELP = "Scale: FTE × working days";

/** Working days in a week, month and quarter, rounded for planning (one engineer's working day is one FTE-day). */
export const PERIOD_DAYS = { week: 5, month: 20, quarter: 60 } as const;
export type Period = keyof typeof PERIOD_DAYS;

export interface ScaleStats {
  scale: number;
  days: number;
  /** The scale in person-weeks, -months and -quarters (scale ÷ working days in each). */
  in: Record<Period, number>;
  /** The department, and the share of its capacity the box uses while it runs. */
  dept?: { name: string; share: number };
}

export function scaleStats(box: Box, departments: Department[]): ScaleStats {
  const scale = boxScale(box);
  const days = workdays(box.start, box.end);
  const dept = departments.find((d) => d.lanes.some((l) => l.id === box.lane));
  // Average capacity over the box's working days (dated lanes can open or close meanwhile).
  let capSum = 0;
  for (let i = 0; i < days; i++) capSum += dept ? capacityOn(dept, addWorkdays(box.start, i)) : 0;
  const fte = days ? capSum / days : 0;
  return {
    scale,
    days,
    in: { week: scale / PERIOD_DAYS.week, month: scale / PERIOD_DAYS.month, quarter: scale / PERIOD_DAYS.quarter },
    dept: dept && fte > 0 ? { name: dept.name, share: box.fte / fte } : undefined,
  };
}

/** The scale in words: "Scale 30 (1 FTE × 30 working days): about 6 weeks, 1.5 months or 0.5 quarters; 29% of Data Engineering while it runs." */
export function scaleSentence(box: Box, departments: Department[]): string {
  const s = scaleStats(box, departments);
  const days = `${s.days} working day${s.days === 1 ? "" : "s"}`;
  const share = s.dept ? `; ${percent(s.dept.share)} of ${s.dept.name} while it runs` : "";
  return `Scale ${s.scale} (${box.fte} FTE × ${days}): about ${amount(s.in.week)} weeks, ${amount(s.in.month)} months or ${amount(s.in.quarter)} quarters${share}.`;
}

/** 2 significant-ish digits: 6, 1.4, 0.46, 12. */
export function amount(x: number): string {
  if (x >= 10) return String(Math.round(x));
  if (x >= 1) return String(Math.round(x * 10) / 10);
  return String(Math.round(x * 100) / 100);
}

/** 6 → "600%", 0.462 → "46%", 0.031 → "3.1%". */
export function percent(x: number): string {
  const p = x * 100;
  return `${p >= 10 || p === 0 ? Math.round(p).toLocaleString("en-US") : p.toFixed(1)}%`;
}
