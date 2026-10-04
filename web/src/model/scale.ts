// A box's scale: how much work it is, as FTE × working days (FTE-days).
// Derived from the box, never stored.

import { addWorkdays, workdays } from "./dates";
import { capacityOn } from "./lanes";
import type { Box, Department } from "./types";

export const boxScale = (b: Pick<Box, "fte" | "start" | "end">) => Math.round(b.fte * workdays(b.start, b.end) * 10) / 10;

export const SCALE_HELP = "Scale: FTE × working days";

/** Working days in an average week, month and quarter (260 a year). */
export const PERIOD_DAYS = { week: 5, month: 260 / 12, quarter: 65 } as const;
export type Period = keyof typeof PERIOD_DAYS;

export interface ScaleStats {
  scale: number;
  days: number;
  /** Scale as a share of one engineer's week, month, quarter (1 = 100%). */
  ofPerson: Record<Period, number>;
  /** The department, its average FTE over the box's days, and the scale's share of its week, month, quarter. */
  dept?: { name: string; fte: number; of: Record<Period, number> };
  /** Scale per assigned engineer. */
  perEngineer?: { value: number; engineers: number };
  /** Share of all the department's boxes' scale, and this box's rank by scale there. */
  inDept?: { share: number; rank: number; of: number };
  /** Share of every box's scale on the roadmap. */
  ofRoadmap: number;
}

export function scaleStats(box: Box, boxes: Box[], departments: Department[]): ScaleStats {
  const scale = boxScale(box);
  const days = workdays(box.start, box.end);
  const share = (per: number) => ({
    week: scale / (per * PERIOD_DAYS.week),
    month: scale / (per * PERIOD_DAYS.month),
    quarter: scale / (per * PERIOD_DAYS.quarter),
  });
  const dept = departments.find((d) => d.lanes.some((l) => l.id === box.lane));
  // Average capacity over the box's working days (dated lanes can open or close meanwhile).
  let capSum = 0;
  for (let i = 0; i < days; i++) capSum += dept ? capacityOn(dept, addWorkdays(box.start, i)) : 0;
  const fte = days ? Math.round((capSum / days) * 100) / 100 : 0;

  const total = (list: Box[]) => list.reduce((n, b) => n + boxScale(b), 0);
  const deptBoxes = dept ? boxes.filter((b) => dept.lanes.some((l) => l.id === b.lane)) : [];
  const deptTotal = total(deptBoxes);
  const roadmapTotal = total(boxes);
  const engineers = box.engineers?.length ?? 0;
  return {
    scale,
    days,
    ofPerson: share(1),
    dept: dept && fte > 0 ? { name: dept.name, fte, of: share(fte) } : undefined,
    perEngineer: engineers ? { value: Math.round((scale / engineers) * 10) / 10, engineers } : undefined,
    inDept:
      dept && deptTotal > 0
        ? {
            share: scale / deptTotal,
            rank: 1 + deptBoxes.filter((b) => boxScale(b) > scale).length,
            of: deptBoxes.length,
          }
        : undefined,
    ofRoadmap: roadmapTotal > 0 ? scale / roadmapTotal : 0,
  };
}

/** 6 → "600%", 0.462 → "46%", 0.031 → "3.1%". */
export function percent(x: number): string {
  const p = x * 100;
  return `${p >= 10 || p === 0 ? Math.round(p).toLocaleString("en-US") : p.toFixed(1)}%`;
}
