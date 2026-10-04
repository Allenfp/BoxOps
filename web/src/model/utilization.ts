// How much of a department's capacity its boxes use, week by week. Used FTE on
// a day is the FTE of the boxes running that day; capacity is the FTE of the
// lanes open that day. A week's figure is its working days added up.

import { type Day, startOfWeek } from "./dates";
import { capacityOn } from "./lanes";
import type { Box, Department } from "./types";

export interface WeekUse {
  /** The Monday. */
  start: Day;
  /** Average FTE used and available over the week's working days. */
  used: number;
  capacity: number;
  /** used / capacity; null when there's no capacity and nothing planned. */
  ratio: number | null;
  /** The busiest working day, by used / capacity, when it's over 100%. */
  peak?: { day: Day; used: number; capacity: number };
}

/** One entry per week from the week holding `from` to the one holding `to` (exclusive). */
export function weeklyUse(dept: Department, boxes: Box[], from: Day, to: Day): WeekUse[] {
  const out: WeekUse[] = [];
  for (let monday = startOfWeek(from); monday < to; monday += 7) {
    let used = 0;
    let capacity = 0;
    let peak: WeekUse["peak"];
    for (let day = monday; day < monday + 5; day++) {
      const cap = capacityOn(dept, day);
      let use = 0;
      for (const b of boxes) if (b.start <= day && day <= b.end) use += b.fte;
      used += use;
      capacity += cap;
      if (use > cap && (!peak || use / cap > peak.used / peak.capacity)) peak = { day, used: use, capacity: cap };
    }
    used /= 5;
    capacity /= 5;
    const ratio = capacity > 0 ? used / capacity : used > 0 ? Infinity : null;
    out.push({ start: monday, used, capacity, ratio, ...(peak && { peak }) });
  }
  return out;
}
