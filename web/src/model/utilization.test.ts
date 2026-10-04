import { describe, expect, it } from "vitest";
import { parseDay } from "./dates";
import type { Box, Department } from "./types";
import { weeklyUse } from "./utilization";

const d = (s: string) => parseDay(s)!;
const dept: Department = {
  id: "de",
  code: "DE",
  name: "DE",
  color: "#000",
  order: 0,
  collapsed: false,
  lanes: [
    { id: "a", fte: 1 },
    { id: "b", fte: 1, start: d("2026-10-07") }, // opens on a Wednesday
  ],
};
const box = (start: string, end: string, fte: number): Box =>
  ({ id: start, code: "X", title: "x", lane: "a", start: d(start), end: d(end), type: "t", fte, engineers: [] }) as Box;

describe("weeklyUse", () => {
  it("averages used and available FTE over each week's working days", () => {
    const weeks = weeklyUse(dept, [box("2026-10-05", "2026-10-16", 1), box("2026-10-12", "2026-10-13", 1)], d("2026-10-07"), d("2026-10-20"));
    expect(weeks.map((w) => w.start)).toEqual([d("2026-10-05"), d("2026-10-12"), d("2026-10-19")]);
    expect(weeks[0]).toMatchObject({ used: 1, capacity: 1.6 }); // lane b open Wed–Fri
    expect(weeks[0]!.ratio).toBeCloseTo(0.625);
    expect(weeks[1]).toMatchObject({ used: 1.4, capacity: 2, ratio: 0.7 });
    expect(weeks[2]).toMatchObject({ used: 0, ratio: 0 });
    // Monday 2026-10-05: 1 FTE planned, but only lane a (1 FTE) is open — full, not over.
    expect(weeks[0]!.peak).toBeUndefined();
    expect(weeklyUse(dept, [box("2026-10-05", "2026-10-05", 1.5)], d("2026-10-05"), d("2026-10-10"))[0]!.peak).toEqual({
      day: d("2026-10-05"),
      used: 1.5,
      capacity: 1,
    });
  });

  it("has no ratio when there's no capacity and nothing planned, and an infinite one when work has no lanes", () => {
    const closed: Department = { ...dept, lanes: [{ id: "a", fte: 1, end: d("2026-10-02") }] };
    expect(weeklyUse(closed, [], d("2026-10-05"), d("2026-10-10"))[0]!.ratio).toBeNull();
    expect(weeklyUse(closed, [box("2026-10-05", "2026-10-05", 1)], d("2026-10-05"), d("2026-10-10"))[0]!.ratio).toBe(Infinity);
  });
});
